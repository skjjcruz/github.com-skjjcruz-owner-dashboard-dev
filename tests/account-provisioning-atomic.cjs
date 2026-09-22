'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const load=require('./helpers/security-ts-loader.cjs');
const migration='supabase/migrations/20260920030000_atomic_account_provisioning.sql';
const email='provisioning-qa@example.invalid';
const args=(address=email, product='war_room')=>({p_email:address,p_password_hash:'oauth:google',p_display_name:'QA',p_product_slug:product});
const quiet={...console,error(){},warn(){}};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
(async()=>{
 const db=new PGlite();const q=async(sql,params=[])=>(await db.query(sql,params)).rows;
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;
   create table public.app_users(id uuid primary key default gen_random_uuid(),email text unique not null,password_hash text not null,display_name text,created_at timestamptz default now(),session_version integer not null default 1);
   create table public.products(slug text primary key);
   insert into public.products values('war_room'),('dynast_hq'),('bundle'),('dhq'),('dhq_gift');
   create table public.subscriptions(user_id uuid references public.app_users(id) on delete cascade,product_slug text references public.products(slug),tier text not null,status text not null,expires_at timestamptz,unique(user_id,product_slug));
   create table public.controlled_saves(user_id uuid references public.app_users(id) on delete cascade,state text);
   create function public.fixture_gift() returns trigger language plpgsql as $$begin
    if new.email like 'gift-%' then insert into public.subscriptions values(new.id,'dhq_gift','pro','active','2099-01-01');end if;return new;end;$$;
   create trigger fixture_gift after insert on public.app_users for each row execute function public.fixture_gift();
   create function public.fixture_subscription_failure() returns trigger language plpgsql as $$begin
    if new.tier='free' and current_setting('fixture.fail_free',true)='yes' then raise exception 'isolated initial subscription failure';end if;return new;end;$$;
   create trigger fixture_subscription_failure before insert on public.subscriptions for each row execute function public.fixture_subscription_failure();`);
  await db.exec(fs.readFileSync(migration,'utf8'));await db.exec(fs.readFileSync(migration,'utf8'));
  const create=a=>q('select * from public.create_app_account($1,$2,$3,$4)',[a.p_email,a.p_password_hash,a.p_display_name,a.p_product_slug]);
  await db.exec('set role anon');await assert.rejects(create(args()),/permission denied/);await db.exec('reset role');
  await db.exec('set role authenticated');await assert.rejects(create(args()),/permission denied/);await db.exec('reset role');
  await db.exec('set role service_role');const [initial]=await create(args('existing@example.invalid'));await db.exec('reset role');
  await q('insert into controlled_saves values($1,$2)',[initial.id,'private league state']);
  await assert.rejects(create(args('existing@example.invalid')),/duplicate key/);
  assert.equal((await q('select state from controlled_saves where user_id=$1',[initial.id]))[0].state,'private league state');
  assert.equal((await q('select password_hash from app_users where id=$1',[initial.id]))[0].password_hash,'oauth:google');
  await db.exec("set fixture.fail_free='yes'");await assert.rejects(create(args('gift-failure@example.invalid')),/isolated initial subscription failure/);await db.exec("set fixture.fail_free='no'");
  assert.equal((await q("select count(*)::int as n from app_users where email='gift-failure@example.invalid'"))[0].n,0,'initial subscription failure rolls back account and gift trigger');
  assert.equal((await q('select count(*)::int as n from subscriptions'))[0].n,1);
  const [gifted]=await create(args('gift-success@example.invalid'));
  assert.equal((await q('select count(*)::int as n from subscriptions where user_id=$1',[gifted.id]))[0].n,2);
  await assert.rejects(create({...args('invalid@example.invalid'),p_password_hash:'unusable'}),/Invalid account provisioning/);
  console.log('PASS actual SQL creates account/access/gift atomically, rolls back failed access, preserves existing saves/passwords, replays safely and only grants service access');

  let pauseFirst=false,failFirst=false,called=0,gate,started,issued=[];
  const admin={
   auth:{getUser:async()=>({data:{user:{email,email_confirmed_at:'2026-09-20T00:00:00Z',app_metadata:{provider:'google'},user_metadata:{full_name:'QA'}}}})},
   async rpc(name,a){assert.equal(name,'create_app_account');called++;if(pauseFirst&&called===1){started.resolve();await gate.promise;if(failFirst)return{error:{message:'controlled unavailable provisioning'}};}try{return{data:await create(a)};}catch(error){return{error};}},
   from(table){return{field:null,value:null,select(){return this;},eq(field,value){this.field=field;this.value=value;return this;},in(){return this;},
    async maybeSingle(){assert.equal(table,'app_users');return{data:(await q('select * from app_users where '+(this.field==='id'?'id':'email')+'=$1',[this.value]))[0]};},
    then(ok,bad){assert.equal(table,'subscriptions');return q('select * from subscriptions where user_id=$1',[this.value]).then(data=>({data})).then(ok,bad);},
    delete(){throw Error('No account deletion is allowed during auth recovery');},insert(){throw Error('Account provisioning must use one RPC transaction');},
   };},
  };
  const entitlements=load('supabase/functions/_shared/entitlements.ts').context;
  const security=load('supabase/functions/_shared/security.ts').context;
  const base={console:quiet,createClient:()=>admin,handleOptions:()=>null,json:(_req,body,status=200)=>({body,status}),normalizeEmail:security.normalizeEmail,isReservedTestEmail:security.isReservedTestEmail,bearerToken:security.bearerToken,decodeJwtPayload:security.decodeJwtPayload,
   checkRateLimit:async()=>({allowed:true}),auditEvent:async()=>{},clientIp:()=>null,resolveEntitlements:entitlements.resolveEntitlements,mintAppSessionJWT:async value=>{issued.push(value);return 'synthetic-session';},
   Deno:{env:{get:key=>key==='TEST_RESET_EMAILS'?email:'synthetic-config'},serve:null},
  };
  function handler(slug){let result;load('supabase/functions/'+slug+'/index.ts',{...base,Deno:{...base.Deno,serve:fn=>result=fn}});return result;}
  const oauth=handler('fw-oauth-sync'),signup=handler('fw-signup');
  const request=(body={})=>new Request('https://example.invalid/auth',{method:'POST',headers:{Authorization:'Bearer opaque-oauth-token'},body:JSON.stringify(body)});
  // The first RPC has not committed, so no account is exposed to another
  // request. The competing OAuth can win; the failed first call cannot erase it.
  pauseFirst=true;failFirst=true;gate=deferred();started=deferred();called=0;
  const first=oauth(request());await started.promise;
  assert.equal((await q('select count(*)::int as n from app_users where email=$1',[email]))[0].n,0);
  const second=await oauth(request());assert.equal(second.status,200);assert.equal(second.body.isNew,true);
  await q('insert into controlled_saves values($1,$2)',[second.body.user.id,'new session progress']);
  gate.resolve();assert.equal((await first).status,503);
  assert.equal((await q('select state from controlled_saves where user_id=$1',[second.body.user.id]))[0].state,'new session progress');
  assert.equal((await oauth(request())).body.user.id,second.body.user.id,'retry resumes the committed winner');
  console.log('PASS actual OAuth handler failed first setup cannot erase a concurrent successful account/session/save; retry resumes winner');

  // Clean only the exact controlled fixture, then make both initial reads see
  // no row. The unique-email conflict must resume the committed OAuth winner.
  await q('delete from app_users where email=$1',[email]);called=0;failFirst=false;gate=deferred();started=deferred();issued=[];
  const competing=oauth(request());await started.promise;const winner=await oauth(request());gate.resolve();const resumed=await competing;
  assert.equal(winner.status,200);assert.equal(resumed.status,200);assert.equal(resumed.body.user.id,winner.body.user.id);assert.equal(resumed.body.isNew,false);assert.equal((await q('select count(*)::int as n from app_users where email=$1',[email]))[0].n,1);
  console.log('PASS actual competing OAuth requests resume one committed identity and one initial subscription (PGlite serial SQL, independent connection contention unproven)');

  await q('delete from app_users where email=$1',[email]);called=0;failFirst=false;gate=deferred();started=deferred();
  const signedUp=signup(request({email,password:'valid-synthetic-password'}));await started.promise;const oauthWinner=await oauth(request());gate.resolve();
  assert.equal((await signedUp).status,409);assert.equal(oauthWinner.status,200);assert.equal((await q('select password_hash from app_users where email=$1',[email]))[0].password_hash,'oauth:google');
  assert.equal((await q('select state from controlled_saves where user_id=$1',[initial.id]))[0].state,'private league state');
  console.log('PASS actual competing signup returns conflict without overwriting/deleting OAuth winner or unrelated saves');
 }finally{await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
