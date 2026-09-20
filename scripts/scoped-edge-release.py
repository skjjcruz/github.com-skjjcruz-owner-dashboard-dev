#!/usr/bin/env python3
"""One-time reviewed release scopes; unchanged manifests never constrain later releases.

The manifest is active only in the push diff (or HEAD's first-parent diff for a
manual run). It pins the exact pre-push commit, patch bytes, local dependencies,
and previously observed hosted source. A mismatch stops before database writes.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import tempfile

PROJECT = 'sxshiqyxhhifvtfqawbq'
PREFIX = '.github/releases/'
WORKFLOW = '.github/workflows/deploy-functions.yml'
OWNED = '''nfl-depth-charts ops-board-vault ops-email-doctor admin-analytics-report
admin-audit-log admin-billing-summary admin-delete-user admin-grant-pro admin-list-users
admin-support-queue ai-analyze ai-feedback fw-billing-portal fw-change-password
fw-confirm-password-reset fw-create-checkout fw-delete-account fw-oauth-sync fw-profile
fw-refresh-session fw-request-password-reset fw-revenuecat-webhook fw-signin fw-signup
fw-stripe-webhook get-session-token nfl-scoreboard set-password'''.split()


class Rejected(Exception):
    pass


def git(root, *args):
    return subprocess.check_output(['git', *args], cwd=root, stderr=subprocess.DEVNULL).decode().strip()


def exists(root, rev):
    return bool(re.fullmatch(r'[0-9a-f]{40}', rev or '')) and subprocess.run(
        ['git', 'cat-file', '-e', rev + '^{commit}'], cwd=root,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0


def digest(data):
    return hashlib.sha256(data).hexdigest()


def safe_path(value):
    if not isinstance(value, str) or not value or PurePosixPath(value).is_absolute() or '..' in PurePosixPath(value).parts:
        raise Rejected('Invalid source path')
    return value


def files_changed(root, before, head):
    return set(filter(None, git(root, 'diff', '--name-only', before, head).splitlines()))


def content(root, head, path):
    safe_path(path)
    try:
        value = subprocess.check_output(['git', 'show', head + ':' + path], cwd=root, stderr=subprocess.DEVNULL)
    except subprocess.CalledProcessError as error:
        raise Rejected('Missing candidate file: ' + path) from error
    local = Path(root, path)
    if not local.is_file() or local.is_symlink() or local.read_bytes() != value:
        raise Rejected('Working source differs from candidate: ' + path)
    return value


def dependencies(root, head, entry):
    found, pending = set(), [entry]
    while pending:
        path = pending.pop()
        if path in found:
            continue
        found.add(path)
        source = content(root, head, path).decode()
        # Covers static/dynamic relative imports, export-from and import maps
        # only when used as literal paths. Computed local imports are rejected.
        if re.search(r'import\s*\(\s*[^\s\'\"]', source):
            raise Rejected('Computed import requires explicit review: ' + path)
        for ref in re.findall(r'[\'\"](\.[^\'\"\n]+\.(?:ts|js|json))[\'\"]', source):
            joined = os.path.normpath(str(PurePosixPath(path).parent / ref)).replace(os.sep, '/')
            if not joined.startswith('supabase/functions/'):
                raise Rejected('Local dependency outside functions: ' + joined)
            pending.append(joined)
    return found


def choose_plan(root, before, head, event):
    if not exists(root, head):
        raise Rejected('Candidate commit is unavailable')
    usable_before = exists(root, before)
    if event == 'push' and not usable_before:
        raise Rejected('Pre-push commit is unavailable; cannot safely determine release scope')
    if event == 'workflow_dispatch':
        try:
            compare = git(root, 'rev-parse', head + '^')
        except subprocess.CalledProcessError:
            compare = None
    else:
        compare = before
    changed = files_changed(root, compare, head) if compare else set()
    manifests = sorted(p for p in changed if p.startswith(PREFIX) and p.endswith('.json'))
    if manifests:
        if len(manifests) != 1:
            raise Rejected('Exactly one release manifest may change')
        manifest_path = manifests[0]
        manifest = json.loads(content(root, head, manifest_path))
        base = manifest.get('base')
        if manifest.get('schema') != 1 or manifest.get('project') != PROJECT:
            raise Rejected('Unsupported release manifest')
        # Manual reruns use the reviewed parent, never all functions. Pushes
        # require an exact event.before; an unknown before is unsafe here.
        actual_base = compare if event == 'workflow_dispatch' else before
        if not exists(root, base) or base != actual_base:
            raise Rejected('Stale release scope: pre-push commit differs from reviewed base')
        changed = files_changed(root, base, head)
        selected = manifest.get('functions', [])
        if not selected or len(set(selected)) != len(selected) or any(fn not in OWNED for fn in selected):
            raise Rejected('Invalid owned function scope')
        hashes = manifest.get('candidate', {})
        if not isinstance(hashes, dict) or not changed - {manifest_path} <= set(hashes):
            raise Rejected('Changed candidate file is not covered by release hashes')
        for path, expected in hashes.items():
            if not re.fullmatch(r'[0-9a-f]{64}', expected or '') or digest(content(root, head, path)) != expected:
                raise Rejected('Candidate hash mismatch: ' + path)
        for path in changed:
            if path.startswith('supabase/functions/'):
                owner = path.split('/')[2]
                if owner != '_shared' and owner not in selected:
                    raise Rejected('Changed function is outside reviewed scope: ' + owner)
        for fn in selected:
            refs = dependencies(root, head, 'supabase/functions/' + fn + '/index.ts')
            if not refs <= set(hashes):
                raise Rejected('Unpinned local dependency for ' + fn)
        hosted = manifest.get('hosted', {})
        if set(hosted) != set(selected):
            raise Rejected('Hosted scope does not match selected functions')
        for fn, expected in hosted.items():
            if not isinstance(expected, dict) or 'supabase/functions/' + fn + '/index.ts' not in expected:
                raise Rejected('Missing hosted entrypoint: ' + fn)
            for path, value in expected.items():
                safe_path(path)
                if not path.startswith('supabase/functions/') or not re.fullmatch(r'[0-9a-f]{64}', value or ''):
                    raise Rejected('Invalid hosted source digest')
        return {'functions': selected, 'manifest': manifest_path, 'hosted': hosted}
    if event == 'workflow_dispatch':
        return {'functions': OWNED, 'manifest': None}
    if any(p.startswith('supabase/functions/_shared/') or p == WORKFLOW or p == 'scripts/scoped-edge-release.py' for p in changed):
        return {'functions': OWNED, 'manifest': None}
    touched = {p.split('/')[2] for p in changed if p.startswith('supabase/functions/')}
    return {'functions': [fn for fn in OWNED if fn in touched], 'manifest': None}


def verify_hosted(plan, destination):
    for fn in plan['functions']:
        base = Path(destination, fn)
        actual = {str(p.relative_to(base)): digest(p.read_bytes()) for p in (base / 'supabase/functions').rglob('*') if p.is_file()}
        if actual != plan['hosted'][fn]:
            raise Rejected('Hosted source changed since review: ' + fn)


def download_and_verify(plan):
    with tempfile.TemporaryDirectory(prefix='dhq-reviewed-edge-') as directory:
        for fn in plan['functions']:
            target = Path(directory, fn)
            target.mkdir()
            result = subprocess.run(['supabase', 'functions', 'download', fn, '--project-ref', PROJECT, '--use-api'],
                                    cwd=target, capture_output=True, text=True)
            if result.returncode:
                # Do not print CLI output: source preflight needs no credentials
                # or provider diagnostics in public workflow logs.
                raise Rejected('Could not inspect current hosted source: ' + fn)
        verify_hosted(plan, directory)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--verify-deployed', action='store_true', help='Verify scoped deployment source against candidate bytes')
    parser.add_argument('--before', default='')
    parser.add_argument('--head', required=True)
    parser.add_argument('--event', choices=['push', 'workflow_dispatch'], required=True)
    args = parser.parse_args()
    try:
        plan = choose_plan(Path.cwd(), args.before, args.head, args.event)
        if plan['manifest']:
            if args.verify_deployed:
                plan['hosted'] = {fn: {path: digest(content(Path.cwd(), args.head, path))
                    for path in dependencies(Path.cwd(), args.head, 'supabase/functions/' + fn + '/index.ts')}
                    for fn in plan['functions']}
            download_and_verify(plan)
        value = ' '.join(plan['functions'])
        if os.environ.get('GITHUB_OUTPUT'):
            with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
                output.write('plan=' + value + '\n')
                output.write('manifest=' + (plan['manifest'] or '') + '\n')
        print('Verified one-time scope:' if plan['manifest'] else 'Normal selective plan:', value or '(none)')
    except (Rejected, ValueError, OSError, subprocess.SubprocessError) as error:
        raise SystemExit('Release stopped: ' + str(error)) from error


if __name__ == '__main__':
    main()
