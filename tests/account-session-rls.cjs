'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
(async()=>{
  const db=new PGlite();
  const q=async(sql,args=[]) => (await db.query(sql,args)).rows;
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create function auth.jwt() returns jsonb language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb$$;
      grant usage on schema auth to anon,authenticated,service_role;`);
    await db.exec(fs.readFileSync('supabase/migrations/20260317000000_app_users_and_subscriptions.sql','utf8'));
    await db.exec(fs.readFileSync('supabase/migrations/20260502020000_security_baseline.sql','utf8'));
    // Use the real previous helper from the shared schema, and its actual
    // account-owner policy installer against one representative private table.
    const legacy=fs.readFileSync('tests/fixtures/account-identity-before-session-gate.sql','utf8');
    const start=legacy.indexOf('create or replace function public.current_app_user_id()');
    const end=legacy.indexOf('-- ── gm_strategy:');
    await db.exec(legacy.slice(start,end));
    await db.exec(`create table private_fixture(id uuid primary key default gen_random_uuid(),user_id uuid,username text,note text);
      select public._add_account_owner_policy('private_fixture','username');
      create policy legacy_fixture on private_fixture for all to public using(username=auth.jwt()->'app_metadata'->>'sleeper_username') with check(username=auth.jwt()->'app_metadata'->>'sleeper_username');
      create table telemetry_fixture(user_id uuid,note text);alter table telemetry_fixture enable row level security;
      create policy raw_claim on telemetry_fixture for insert to public with check(user_id::text=auth.jwt()->>'sub');
      grant select on app_users,products,subscriptions to anon,authenticated;
      grant insert on telemetry_fixture to anon,authenticated;
      grant all on app_users,products,subscriptions,private_fixture,telemetry_fixture,password_reset_tokens to service_role;`);
    const [a,b]=(await q("insert into app_users(email,password_hash,session_version) values('a@example.invalid','unchanged-a',2),('b@example.invalid','unchanged-b',1) returning id")).map(r=>r.id);
    await q("insert into subscriptions(user_id,product_slug) values($1,'war_room'),($2,'war_room')",[a,b]);
    await q("insert into private_fixture(user_id,note) values($1,'A private note'),($2,'B private note')",[a,b]);
    await q("insert into private_fixture(username,note) values('legacy-owner','Legacy private note')");
    const claims=async(value,role='authenticated')=>{await db.exec('reset role');await q("select set_config('request.jwt.claims',$1,false)",[JSON.stringify(value)]);await db.exec('set role '+role);};
    const app=(id,version)=>({sub:id,app_metadata:{user_id:id,session_version:version}});
    await claims(app(a,1));
    assert.equal((await q('select id from app_users')).length,1,'baseline reproduces revoked account read');
    assert.equal((await q('select note from private_fixture'))[0].note,'A private note','baseline reproduces revoked private read');
    assert.equal((await q("update private_fixture set note='Revoked-token write' returning id")).length,1,'baseline reproduces revoked private mutation');
    await db.exec('reset role');
    await q("update private_fixture set note='A private note' where user_id=$1",[a]);
    const before=await q('select id,email,password_hash,session_version from app_users order by id');
    const migration=fs.readFileSync('supabase/migrations/20260918020000_account_session_rls.sql','utf8');
    await db.exec(migration); await db.exec(migration);
    assert.deepEqual(await q('select id,email,password_hash,session_version from app_users order by id'),before,'additive migration and replay preserve account rows');
    await claims(app(a,1));
    for(const table of ['app_users','subscriptions','products','private_fixture']) assert.equal((await q('select * from '+table)).length,0,'revoked caller cannot read '+table);
    assert.equal((await q("update private_fixture set note='wrong' returning id")).length,0);
    assert.equal((await q('delete from private_fixture returning id')).length,0);
    await assert.rejects(()=>q('insert into private_fixture(user_id,note) values($1,$2)',[a,'wrong']),/row-level security/);
    await assert.rejects(()=>q('insert into telemetry_fixture(user_id,note) values($1,$2)',[a,'wrong']),/row-level security/);
    console.log('PASS reproduced revoked-token direct read/write with old SQL, then blocked account/private/ownership/raw-claim paths after additive replay-safe migration');

    await claims(app(a,2));
    assert.deepEqual((await q('select id from app_users')).map(r=>r.id),[a]);
    assert.deepEqual((await q('select user_id from subscriptions')).map(r=>r.user_id),[a]);
    assert.equal((await q('select note from private_fixture'))[0].note,'A private note');
    assert.equal((await q("update private_fixture set note='A updated' returning id")).length,1);
    assert.equal((await q("update private_fixture set note='B stolen' where user_id=$1 returning id",[b])).length,0);
    await assert.rejects(()=>q("insert into private_fixture(user_id,note) values($1,'B forged')",[b]),/row-level security/);
    await q("insert into telemetry_fixture(user_id,note) values($1,'active event')",[a]);
    await claims(app(b,1));
    assert.deepEqual((await q('select id from app_users')).map(r=>r.id),[b]);
    assert.equal((await q('select note from private_fixture'))[0].note,'B private note');
    for(const metadata of [{user_id:a},{user_id:a,session_version:'bad'},{user_id:'not-a-uuid',session_version:1},{user_id:a,session_version:'9999999999999999999999999'},{user_id:a,session_version:0}]) {
      await claims({app_metadata:metadata});
      assert.equal((await q('select current_app_user_id() as id'))[0].id,null);
      assert.equal((await q('select * from app_users')).length,0);
    }
    console.log('PASS current sessions keep own reads/writes, other accounts remain isolated, malformed/missing/overflowed version claims fail closed');

    await claims({sub:'legacy-owner',app_metadata:{sleeper_username:'legacy-owner'}},'anon');
    assert.equal((await q('select current_app_user_id() as id'))[0].id,null);
    assert.equal((await q('select note from private_fixture'))[0].note,'Legacy private note');
    assert.equal((await q("update private_fixture set note='Legacy updated' returning id")).length,1);
    assert.equal((await q('select id from app_users')).length,0);
    await claims({sub:'oauth-fixture',app_metadata:{}},'authenticated');
    assert.equal((await q('select * from private_fixture')).length,0,'restrictive policy does not create new OAuth access');
    await claims(app(a,1),'service_role');
    assert.equal((await q('select id from app_users')).length,2);
    assert.equal((await q('select id from private_fixture')).length,3);
    console.log('PASS legacy owner policy unchanged, no new OAuth access, service role retains server access');

    await db.exec('reset role');
    await db.exec(fs.readFileSync('supabase/migrations/20260918010000_atomic_password_reset.sql','utf8'));
    const tokenHash='1'.repeat(64),passwordHash='2'.repeat(32)+':'+ '3'.repeat(64);
    await q("insert into password_reset_tokens(user_id,token_hash,expires_at) values($1,$2,clock_timestamp()+interval '1 hour')",[a,tokenHash]);
    await claims(app(a,2));assert.equal((await q('select note from private_fixture')).length,1);
    await db.exec('reset role');await q('select * from confirm_app_password_reset($1,$2)',[tokenHash,passwordHash]);
    await claims(app(a,2));assert.equal((await q('select * from private_fixture')).length,0);
    await claims(app(a,3));assert.equal((await q('select note from private_fixture'))[0].note,'A updated');
    await claims(app(b,1));assert.equal((await q('select note from private_fixture'))[0].note,'B private note');
    console.log('PASS actual atomic password reset revokes direct SQL immediately; refreshed session recovers retained data and unrelated account stays active');
  } finally {await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
