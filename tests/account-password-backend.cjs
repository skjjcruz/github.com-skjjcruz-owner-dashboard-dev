'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {PGlite}=require('@electric-sql/pglite');
const {createHash}=require('node:crypto');
const load=require('./helpers/security-ts-loader.cjs');
const Babel=require('@babel/standalone');
const hash=s=>createHash('sha256').update(s).digest('hex');
const plain=x=>JSON.parse(JSON.stringify(x));
const req=body=>new Request('https://example.invalid/change',{method:'POST',body:JSON.stringify(body)});
async function database(){
 const db=new PGlite();const q=async(s,a=[]) => (await db.query(s,a)).rows;
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create table app_users(id uuid primary key default gen_random_uuid(),email text,password_hash text,updated_at timestamptz);
   create table saved_games(user_id uuid references app_users(id),state jsonb);`);
  await db.exec(fs.readFileSync('supabase/migrations/20260502020000_security_baseline.sql','utf8'));
  await db.exec(fs.readFileSync('supabase/migrations/20260918010000_atomic_password_reset.sql','utf8'));
  const signup=load('supabase/functions/fw-signup/index.ts',{},['hashPassword']).context.hashPassword;
  const verify=load('supabase/functions/fw-signin/index.ts',{},['verifyPassword']).context.verifyPassword;
  const oldHash=await signup('CurrentPassword1!');
  const [a,b]=(await q("insert into app_users(email,password_hash) values('a@example.invalid',$1),('b@example.invalid',$1) returning id",[oldHash])).map(r=>r.id);
  await q("insert into saved_games values($1,'{\"week\":9}'),($2,'{\"week\":3}')",[a,b]);
  const games=await q('select * from saved_games order by user_id');
  const token=async(value,owner=a)=>q("insert into password_reset_tokens(user_id,token_hash,expires_at) values($1,$2,clock_timestamp()+interval '30 minutes')",[owner,hash(value)]);
  await token('pre-change');await token('other-account',b);
  const before=await q('select * from app_users order by id');
  const migration=fs.readFileSync('supabase/migrations/20260918030000_account_password_change.sql','utf8');
  await db.exec(migration);await db.exec(migration);assert.deepEqual(await q('select * from app_users order by id'),before);
  let actor=a,version=1,blocked=false,outage=false,readFailure=false;const events=[];
  const admin={
   from(table){assert.equal(table,'app_users');return {select(){return this;},eq(field,value){assert.equal(field,'id');this.id=value;return this;},async maybeSingle(){return readFailure?{error:Error('isolated read failure')}:{data:(await q('select * from app_users where id=$1',[this.id]))[0]};}};},
   async rpc(name,args){assert.equal(name,'change_app_password');if(outage)return {error:Error('isolated outage')};try{return {data:(await q('select change_app_password($1,$2,$3,$4) as changed',[args.p_user_id,args.p_expected_version,args.p_expected_hash,args.p_password_hash]))[0].changed};}catch(error){return {error};}},
  };
  const active=load('supabase/functions/_shared/security.ts',{verifyJwtPayload:async()=>actor?{sub:actor,app_metadata:{session_version:version}}:null},['requireActiveAppSession']).context.requireActiveAppSession;
  const handler=load('supabase/functions/fw-change-password/index.ts',{
   createClient:()=>admin,requireActiveAppSession:active,handleOptions:()=>null,clientIp:()=> 'fixture',checkRateLimit:async()=>({allowed:!blocked}),
   auditEvent:async(_db,_r,type,outcome,who,meta)=>events.push({type,outcome,who,meta}),json:(_r,body,status=200)=>({body,status}),console:{error(){}},
  }).handler;
  const change=(currentPassword='CurrentPassword1!',password='NewPassword2!',extra={})=>handler(req({currentPassword,password,...extra}));
  assert.equal((await change('wrong')).status,400);assert.deepEqual(await q('select * from app_users order by id'),before);
  actor=null;assert.equal((await change()).status,401);actor=a;
  blocked=true;assert.equal((await change()).status,429);blocked=false;
  assert.equal((await handler(new Request('https://example.invalid/change',{method:'DELETE'}))).status,405);
  assert.equal((await handler(new Request('https://example.invalid/change',{method:'POST',body:'{'}))).status,400);
  assert.equal((await handler(new Request('https://example.invalid/change',{method:'POST',body:'x'.repeat(12001)}))).status,413);
  for(const body of [null,[],{currentPassword:[],password:'abcdefgh'},{currentPassword:'a',password:{}},{currentPassword:'a',password:'short'},{currentPassword:'a',password:'x'.repeat(1025)}])assert.equal((await handler(req(body))).status,400);
  assert.equal((await change('CurrentPassword1!','CurrentPassword1!')).status,400);
  assert.equal((await change('CurrentPassword1!','NewPassword2!',{userId:b})).status,200);
  const saved=(await q('select * from app_users where id=$1',[a]))[0];assert.equal(saved.session_version,2);assert(await verify('NewPassword2!',saved.password_hash));assert(!(await verify('CurrentPassword1!',saved.password_hash)));
  assert.equal((await q('select password_hash from app_users where id=$1',[b]))[0].password_hash,oldHash);
  assert((await q('select used_at from password_reset_tokens where token_hash=$1',[hash('pre-change')]))[0].used_at);
  assert.equal((await q('select used_at from password_reset_tokens where token_hash=$1',[hash('other-account')]))[0].used_at,null);
  assert.equal((await change()).status,401);version=2;assert(await active(admin,req({})));
  assert.equal((await q('select * from confirm_app_password_reset($1,$2)',[hash('pre-change'),oldHash])).length,0);
  assert.deepEqual(await q('select * from saved_games order by user_id'),games);
  await q("update app_users set password_hash='oauth:google' where id=$1",[b]);actor=b;version=1;const provider=await change();assert.equal(provider.status,400);assert.match(provider.body.error,/provider sign-in/);assert.equal((await q('select password_hash from app_users where id=$1',[b]))[0].password_hash,'oauth:google');actor=a;version=2;
  console.log('PASS actual endpoint/SQL changes only signed account, accepts signin PBKDF, invalidates old app sessions/reset links and preserves both accounts games; replay, input, method and rate guards');
  await token('rollback');
  const snapshot=(await q('select * from app_users where id=$1',[a]))[0];
  await db.exec(`create function fail_consumption() returns trigger language plpgsql as $$begin raise exception 'isolated failure';end;$$;create trigger fail_consumption before update on password_reset_tokens for each row execute function fail_consumption();`);
  assert.equal((await change('NewPassword2!','NextPassword3!')).status,500);assert.deepEqual((await q('select * from app_users where id=$1',[a]))[0],snapshot);
  await db.exec('drop trigger fail_consumption on password_reset_tokens;drop function fail_consumption()');
  outage=true;assert.equal((await change('NewPassword2!','NextPassword3!')).status,500);outage=false;
  readFailure=true;assert.equal((await change('NewPassword2!','NextPassword3!')).status,401);readFailure=false;
  const race=await Promise.all(Array.from({length:4},(_,i)=>change('NewPassword2!','ContenderPassword'+i)));
  assert.equal(race.filter(x=>x.status===200).length,1);assert(race.filter(x=>x.status!==200).every(x=>[401,409].includes(x.status)));
  assert.equal((await q('select session_version from app_users where id=$1',[a]))[0].session_version,3);
  assert(!JSON.stringify(events).includes('Password'));
  for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(()=>q('select change_app_password($1,$2,$3,$4)',[a,3,oldHash,oldHash]),/permission denied/);await db.exec('reset role');}
  assert.equal((await q('select change_app_password($1,$2,$3,$4) as ok',[a,2,oldHash,oldHash]))[0].ok,false);
  console.log('PASS transaction rollback/retry, competing actual handlers with one winner, stale snapshots and service-only grants; PGlite serializes connections, separate hosted contention remains required');
 }finally{await db.close();}
}
database().catch(error=>{console.error(error);process.exitCode=1;});
