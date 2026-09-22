#!/usr/bin/env python3
"""Actual planner against disposable Git histories and downloaded-source fixtures."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('release', Path(__file__).resolve().parents[1] / 'scripts/scoped-edge-release.py')
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)


class Scope(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.run_git('init', '-q')
        self.run_git('config', 'user.email', 'fixture@example.invalid')
        self.run_git('config', 'user.name', 'Release Fixture')
        self.entry = 'supabase/functions/fw-signin/index.ts'
        self.shared = 'supabase/functions/_shared/security.ts'
        self.manifest_path = '.github/releases/fixture.json'
        self.write(self.entry, 'old signin')
        self.write(self.shared, 'old helper')
        self.base = self.commit()
        self.write(self.entry, 'import { check } from "../_shared/security.ts";\nnew signin')
        self.write(self.shared, 'new helper')
        self.manifest = {
            'schema': 1, 'base': self.base, 'project': release.PROJECT,
            'functions': ['fw-signin'],
            'candidate': {p: release.digest((self.root / p).read_bytes()) for p in [self.entry, self.shared]},
            'hosted': {'fw-signin': {self.entry: release.digest(b'old signin'), self.shared: release.digest(b'old helper')}},
        }
        self.freeze()

    def run_git(self, *args):
        return subprocess.check_output(['git', *args], cwd=self.root, stderr=subprocess.DEVNULL).decode().strip()

    def write(self, path, value):
        file = self.root / path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(value)

    def commit(self):
        self.run_git('add', '.')
        self.run_git('commit', '-qm', 'fixture')
        return self.run_git('rev-parse', 'HEAD')

    def freeze(self):
        self.write(self.manifest_path, json.dumps(self.manifest))
        if hasattr(self, 'head'):
            self.run_git('add', '.')
            self.run_git('commit', '--amend', '--no-edit', '-q')
            self.head = self.run_git('rev-parse', 'HEAD')
        else:
            self.head = self.commit()

    def plan(self, **kwargs):
        return release.choose_plan(self.root, kwargs.get('before', self.base), kwargs.get('head', self.head), kwargs.get('event', 'push'))

    def test_valid_release_and_manual_retry_select_only_reviewed_function(self):
        self.assertEqual(self.plan()['functions'], ['fw-signin'])
        self.assertEqual(self.plan(event='workflow_dispatch')['functions'], ['fw-signin'])

    def test_unknown_or_stale_push_base_cannot_fall_back_to_full_release(self):
        for before in ['', '0' * 40, self.head]:
            if before == self.head:
                # A real stale upstream commit, not an empty diff.
                self.run_git('checkout', '-q', self.base)
                self.write('README.md', 'new upstream change')
                before = self.commit()
                self.run_git('checkout', '-q', self.head)
            with self.assertRaises(release.Rejected):
                self.plan(before=before)

    def test_changed_or_uncommitted_candidate_bytes_fail(self):
        self.write(self.shared, 'different helper')
        with self.assertRaises(release.Rejected):
            self.plan()
        self.freeze()
        with self.assertRaisesRegex(release.Rejected, 'hash mismatch'):
            self.plan()

    def test_unlisted_function_or_unhashed_patch_file_fails(self):
        self.write('supabase/functions/ai-analyze/index.ts', 'unreviewed AI')
        self.freeze()
        with self.assertRaises(release.Rejected):
            self.plan()
        self.manifest['candidate']['supabase/functions/ai-analyze/index.ts'] = release.digest(b'unreviewed AI')
        self.freeze()
        with self.assertRaisesRegex(release.Rejected, 'outside reviewed scope'):
            self.plan()

    def test_unchanged_dependency_still_must_be_pinned(self):
        self.write(self.shared, 'old helper')
        del self.manifest['candidate'][self.shared]
        self.freeze()
        with self.assertRaisesRegex(release.Rejected, 'Unpinned local dependency'):
            self.plan()

    def test_hosted_mismatch_missing_and_extra_source_fail(self):
        plan = self.plan()
        hosted = self.root / 'download'
        for path, value in [(self.entry, 'old signin'), (self.shared, 'old helper')]:
            self.write('download/fw-signin/' + path, value)
        release.verify_hosted(plan, hosted)
        self.write('download/fw-signin/' + self.shared, 'owner changed hosted helper')
        with self.assertRaises(release.Rejected):
            release.verify_hosted(plan, hosted)
        self.write('download/fw-signin/' + self.shared, 'old helper')
        self.write('download/fw-signin/supabase/functions/_shared/new.ts', 'new dependency')
        with self.assertRaises(release.Rejected):
            release.verify_hosted(plan, hosted)
        (hosted / 'fw-signin' / self.entry).unlink()
        with self.assertRaises(release.Rejected):
            release.verify_hosted(plan, hosted)

    def test_later_unrelated_commit_uses_normal_selective_behavior(self):
        before = self.head
        self.write('supabase/functions/ai-analyze/index.ts', 'later reviewed AI')
        head = self.commit()
        self.assertEqual(self.plan(before=before, head=head)['functions'], ['ai-analyze'])
        self.assertIsNone(self.plan(before=before, head=head)['manifest'])
        self.assertEqual(self.plan(before=before, head=head, event='workflow_dispatch')['functions'], release.OWNED)
        self.write(self.shared, 'later shared security update')
        next_head = self.commit()
        self.assertEqual(self.plan(before=head, head=next_head)['functions'], release.OWNED)

    def test_unknown_push_base_after_manifest_cannot_expand_to_all_functions(self):
        self.write('README.md', 'later documentation checkpoint')
        head = self.commit()
        with self.assertRaisesRegex(release.Rejected, 'Pre-push commit is unavailable'):
            self.plan(before='0' * 40, head=head)
        self.assertEqual(self.plan(before=self.head, head=head)['functions'], [])

    def test_manifest_removal_or_multiple_scopes_cannot_select_full_release(self):
        (self.root / self.manifest_path).unlink()
        head = self.commit()
        with self.assertRaises(release.Rejected):
            self.plan(before=self.head, head=head)


if __name__ == '__main__':
    unittest.main()
