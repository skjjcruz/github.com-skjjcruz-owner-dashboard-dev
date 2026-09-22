'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const load = require('./helpers/security-ts-loader.cjs');
const hash = text => createHash('sha256').update(text).digest('hex');
const events = [];
const base = {
  handleOptions: () => null, clientIp: () => 'isolated-test-ip',
  checkRateLimit: async () => ({ allowed: true }), sha256Hex: async value => hash(value),
  normalizeEmail: value => typeof value === 'string' ? value.trim().toLowerCase() : '',
  auditEvent: async (_db, _req, type, outcome, actor, metadata) => { events.push({ type, outcome, actor, metadata }); },
  json: (_req, body, status = 200) => ({ body, status }),
  console: { ...console, error() {}, warn() {} },
};
const request = body => new Request('https://example.invalid/reset', { method: 'POST', body: JSON.stringify(body) });

(async () => {
  const db = new PGlite();
  const q = async (sql, args = []) => (await db.query(sql, args)).rows;
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create table app_users(id uuid primary key default gen_random_uuid(), email text unique not null, password_hash text not null, updated_at timestamptz);`);
    await db.exec(fs.readFileSync('supabase/migrations/20260502020000_security_baseline.sql', 'utf8'));
    const [a, b] = (await q("insert into app_users(email,password_hash) values('a@example.invalid','old-a'),('b@example.invalid','old-b') returning id")).map(r => r.id);
    const token = async (value, owner = a, validity = '30 minutes') => q("insert into password_reset_tokens(user_id,token_hash,expires_at) values($1,$2,clock_timestamp()+$3::interval)", [owner, hash(value), validity]);
    await token('pre-migration-link');
    const migration = fs.readFileSync('supabase/migrations/20260918010000_atomic_password_reset.sql', 'utf8');
    await db.exec(migration); await db.exec(migration);
    assert.equal((await q('select count(*)::int as n from password_reset_tokens'))[0].n, 1, 'replay preserves existing links');
    assert.equal((await q('select password_hash from app_users where id=$1', [a]))[0].password_hash, 'old-a');
    let rpcFailure = false, tokenFailure = false, lookupFailure = false, deliveries = 0;
    const admin = {
      async rpc(name, args) {
        if (name === 'get_app_secret') return { data: null };
        assert.equal(name, 'confirm_app_password_reset');
        if (rpcFailure) return { error: new Error('isolated RPC outage') };
        try { return { data: await q('select * from confirm_app_password_reset($1,$2)', [args.p_token_hash, args.p_password_hash]) }; }
        catch (error) { return { error }; }
      },
      from(table) { return {
        select() { return this; }, eq(field, value) { this.field = field; this.value = value; return this; },
        async maybeSingle() {
          assert.equal(table, 'app_users');
          if (lookupFailure) return { error: new Error('isolated lookup outage') };
          const data = (await q('select id,email,session_version from app_users where '+(this.field === 'id' ? 'id' : 'email')+'=$1', [this.value]))[0];
          return { data };
        },
        async insert(row) {
          assert.equal(table, 'password_reset_tokens');
          if (tokenFailure) return { error: new Error('isolated token storage outage') };
          await q('insert into password_reset_tokens(user_id,token_hash,expires_at) values($1,$2,$3)', [row.user_id, row.token_hash, row.expires_at]);
          return { error: null };
        },
      }; },
    };
    const confirmLoaded = load('supabase/functions/fw-confirm-password-reset/index.ts', { ...base, createClient: () => admin });
    confirmLoaded.context.Deno.env.get = key => key === 'PASSWORD_RESET_URL' ? 'https://example.invalid/reset-password.html' : '';
    const confirm = confirmLoaded.handler;
    const configuredRedirect = await confirm(new Request('https://example.invalid/reset?token=escaped%20token'));
    assert.equal(configuredRedirect.headers.get('location'), 'https://example.invalid/reset-password.html?token=escaped%20token');
    confirmLoaded.context.Deno.env.get = () => '';
    const defaultRedirect = await confirm(new Request('https://example.invalid/reset?token=public-route'));
    assert.equal(defaultRedirect.headers.get('location'), 'https://dhqfootball.com/reset-password.html?token=public-route');
    confirmLoaded.context.Deno.env.get = key => key === 'APP_RESET_URL' ? 'https://legacy.example.invalid/reset.html?flow=reset' : '';
    assert.equal((await confirm(new Request('https://example.invalid/reset?token=legacy-route'))).headers.get('location'), 'https://legacy.example.invalid/reset.html?flow=reset&token=legacy-route');
    confirmLoaded.context.Deno.env.get = () => '';

    const reset = (value, password = 'replacement-password') => confirm(request({ token: value, password }));
    const verifier = load('supabase/functions/fw-signin/index.ts', {}, ['verifyPassword']).context.verifyPassword;
    const session = version => load('supabase/functions/_shared/security.ts', {
      verifyJwtPayload: async () => ({ sub: a, app_metadata: { session_version: version } }),
    }, ['requireActiveAppSession']).context.requireActiveAppSession(admin, request({}));
    assert.ok(await session(1));
    await token('sibling-link'); await token('b-link', b);
    assert.equal((await reset('pre-migration-link')).status, 200);
    const saved = (await q('select * from app_users where id=$1', [a]))[0];
    assert.equal(await verifier('replacement-password', saved.password_hash), true, 'real PBKDF format is accepted by signin');
    assert.equal(saved.session_version, 2);
    assert.ok(saved.password_changed_at);
    assert.equal(await session(1), null, 'existing app session rejected after rotation');
    assert.ok(await session(2));
    assert.equal((await reset('pre-migration-link')).status, 400);
    assert.equal((await reset('sibling-link')).status, 400, 'other pre-reset link cannot rotate new password');
    assert.equal((await q('select used_at from password_reset_tokens where token_hash=$1', [hash('b-link')]))[0].used_at, null, 'another account link untouched');
    assert.equal((await q('select password_hash from app_users where id=$1', [b]))[0].password_hash, 'old-b');
    console.log('PASS actual SQL migration/replay preserves accounts and links; PBKDF password, old-session revocation, one-time and sibling-link use, and account isolation');

    await token('expired', a, '-1 minute');
    assert.equal((await reset('expired')).status, 400);
    assert.equal((await reset('unknown')).status, 400);
    await token('raced');
    const raced = await Promise.all(Array.from({ length: 12 }, (_, i) => reset('raced', 'candidate-'+i)));
    assert.equal(raced.filter(r => r.status === 200).length, 1);
    assert.equal(raced.filter(r => r.status === 400).length, 11);
    assert.equal((await q('select session_version from app_users where id=$1', [a]))[0].session_version, 3);
    console.log('PASS actual handlers submit competing token uses with one winner (PGlite serializes SQL; independent-connection contention still requires hosted proof)');

    await token('rollback');
    const before = (await q('select * from app_users where id=$1', [a]))[0];
    await db.exec(`create function fail_reset_consumption() returns trigger language plpgsql as $$ begin raise exception 'isolated consumption failure'; end; $$;
      create trigger fail_reset_consumption before update on password_reset_tokens for each row execute function fail_reset_consumption();`);
    const successes = events.filter(e => e.type === 'password_reset_confirmed' && e.outcome === 'success').length;
    assert.equal((await reset('rollback')).status, 500);
    assert.deepEqual((await q('select * from app_users where id=$1', [a]))[0], before, 'consumption error rolls back password, version, timestamps');
    assert.equal((await q('select used_at from password_reset_tokens where token_hash=$1', [hash('rollback')]))[0].used_at, null);
    assert.equal(events.filter(e => e.type === 'password_reset_confirmed' && e.outcome === 'success').length, successes);
    await db.exec('drop trigger fail_reset_consumption on password_reset_tokens; drop function fail_reset_consumption()');
    rpcFailure = true; assert.equal((await reset('rollback')).status, 500); rpcFailure = false;
    assert.deepEqual((await q('select * from app_users where id=$1', [a]))[0], before);
    assert.equal((await reset('rollback')).status, 200, 'same link remains recoverable after transaction failure');
    console.log('PASS token-consumption failure rolls back password/session mutation; RPC outages never report success; retry recovers');

    const passwordHash = '1'.repeat(32)+':'+ '2'.repeat(64);
    await assert.rejects(() => q('select * from confirm_app_password_reset($1,$2)', ['bad', passwordHash]), /Invalid password reset arguments/);
    await assert.rejects(() => q('select * from confirm_app_password_reset($1,$2)', [hash('b-link'), 'bad']), /Invalid password reset arguments/);
    for (const role of ['anon', 'authenticated']) {
      await db.exec('set role '+role);
      await assert.rejects(() => q('select * from confirm_app_password_reset($1,$2)', [hash('b-link'), passwordHash]), /permission denied/);
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    assert.equal((await q('select * from confirm_app_password_reset($1,$2)', [hash('b-link'), passwordHash])).length, 1);
    await db.exec('reset role');
    assert.equal((await confirm(new Request('https://example.invalid/reset', { method: 'DELETE' }))).status, 405);
    for (const body of [{token:{},password:'abcdefgh'}, {token:'test',password:{}}, {token:'test',password:'tiny'}, {token:'test',password:'x'.repeat(1025)}]) {
      assert.equal((await confirm(request(body))).status, 400);
    }
    const redirect = await confirm(new Request('https://example.invalid/reset?token=legacy-link'));
    assert.equal(redirect.status, 302);
    assert.match(redirect.headers.get('location'), /token=legacy-link/);
    console.log('PASS browser roles cannot call trusted reset mutation; malformed inputs and unsupported methods rejected; emailed-link redirect retained');

    const requestLoaded = load('supabase/functions/fw-request-password-reset/index.ts', {
      ...base, createClient: () => admin,
      fetch: async () => { deliveries++; return { ok: true }; },
    });
    requestLoaded.context.Deno.env.get = key => ({ RESET_DEBUG_RETURN_TOKEN: 'true', RESEND_API_KEY: 'synthetic' })[key];
    const requestReset = requestLoaded.handler;
    tokenFailure = true;
    const unsaved = await requestReset(request({ email: 'a@example.invalid' }));
    assert.equal(unsaved.status, 200);
    assert.deepEqual(JSON.parse(JSON.stringify(unsaved.body)), { ok: true }, 'public response does not disclose known accounts');
    assert.equal(deliveries, 0, 'no email for a token that failed to persist');
    assert.ok(events.some(e => e.outcome === 'failure' && e.metadata.reason === 'token_storage_failed'));
    tokenFailure = false; lookupFailure = true;
    assert.equal((await requestReset(request({ email: 'a@example.invalid' }))).status, 200);
    assert.equal(deliveries, 0); lookupFailure = false;
    const issued = await requestReset(request({ email: 'a@example.invalid' }));
    assert.equal(deliveries, 1);
    assert.equal(issued.body.emailSent, true);
    assert.ok(issued.body.resetToken);
    assert.equal(new URL(issued.body.resetUrl).origin, 'https://dhqfootball.com');
    assert.equal(new URL(issued.body.resetUrl).pathname, '/reset-password.html');
    assert.equal(new URL(issued.body.resetUrl).searchParams.get('token'), issued.body.resetToken);
    assert.equal((await q('select count(*)::int as n from password_reset_tokens where token_hash=$1', [hash(issued.body.resetToken)]))[0].n, 1);
    assert.equal((await reset(issued.body.resetToken)).status, 200);
    const unknown = await requestReset(request({ email: 'missing@example.invalid' }));
    assert.deepEqual(JSON.parse(JSON.stringify(unknown.body)), { ok: true });
    assert.equal(deliveries, 1);
    requestLoaded.context.fetch = async () => ({ ok: false, status: 503, text: async () => 'isolated delivery outage' });
    const undelivered = await requestReset(request({ email: 'a@example.invalid' }));
    assert.equal(undelivered.body.emailSent, false);
    assert.ok(events.some(e => e.type === 'password_reset_requested' && e.outcome === 'failure' && e.metadata.emailReason === 'resend_503'));
    console.log('PASS actual request handler persists hashed tokens before delivery; storage/provider outages produce honest audit outcomes without account enumeration or live email');
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
