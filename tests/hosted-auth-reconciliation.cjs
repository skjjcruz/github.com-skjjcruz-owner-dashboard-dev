'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./helpers/security-ts-loader.cjs');
const snapshot = process.env.HOSTED_AUTH_SNAPSHOT;
const root = path.resolve(__dirname, '..');
const source = (slug) => snapshot ? path.relative(root, path.join(snapshot, slug, 'supabase/functions', slug, 'index.ts')) : `supabase/functions/${slug}/index.ts`;
const email = 'designated-qa@example.invalid';
const plain = value => JSON.parse(JSON.stringify(value));
const jwt = claims => 'header.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.signature';

function fixture(slug, options = {}) {
  const user = { id: 'app-a', email, display_name: 'A', session_version: 2, password_hash: 'unchanged-private-hash' };
  const state = { users: options.empty ? [] : [user], subscriptions: [{user_id: 'app-a', product_slug: 'dhq', tier: 'pro', status: 'trialing'}], deletes: [], limits: [], minted: [], authCalls: 0, writes: [], queries: 0 };
  const admin = {
    async rpc(name,args) {
      assert.equal(name,'create_app_account');
      if(options.provisionFailure)return {error:{message:'provisioning unavailable'}};
      if(state.users.some(row=>row.email===args.p_email))return {error:{code:'23505'}};
      const row={id:'new-a',email:args.p_email,display_name:args.p_display_name,session_version:1,password_hash:args.p_password_hash};
      state.users.push(row);
      if(options.gifted)state.subscriptions.push({user_id:row.id,product_slug:'dhq_gift',tier:'pro',status:'active',expires_at:'2099-01-01T00:00:00Z'});
      state.subscriptions.push({user_id:row.id,product_slug:args.p_product_slug,tier:'free',status:'active'});
      return {data:[row]};
    },
    auth: { getUser: async () => { state.authCalls++; return options.authError ? {error: new Error('invalid')} : {data: {user: {id: 'auth-a', email, email_confirmed_at: options.unconfirmed ? null : '2026-09-20T00:00:00Z', app_metadata: {provider: 'google'}, user_metadata: {full_name: 'A'}}}}; } },
    from(table) {
      const q = { mode: 'read', filters: [], values: null,
        select() { return this; }, eq(key,value) { this.filters.push(row=>row[key]===value); return this; }, in(key,values) {this.filters.push(row=>values.includes(row[key]));return this;},
        insert(values) { this.mode='insert'; this.values=values; return this; }, update(values) {this.mode='update';this.values=values;return this;}, delete() {this.mode='delete';return this;},
        async exec(single) {
          state.queries++;
          if ((options.queryFailure || (options.subscriptionFailure && table==='subscriptions')) && this.mode==='read') return {error: {message:'unavailable'}};
          const rows = table==='app_users' ? state.users : state.subscriptions;
          if (this.mode==='insert') {const row={id:'new-a',session_version:1,...this.values};rows.push(row);if(table==='app_users'&&options.gifted)state.subscriptions.push({user_id:row.id,product_slug:'dhq_gift',tier:'pro',status:'active',expires_at:'2099-01-01T00:00:00Z'});state.writes.push({table,mode:this.mode});return {data:single ? {...row} : [row]};}
          const matches=rows.filter(row=>this.filters.every(test=>test(row)));
          if(this.mode==='delete') {state.deletes.push({table,ids:matches.map(row=>row.id)});for(const row of matches)rows.splice(rows.indexOf(row),1);}
          if(this.mode==='update') {state.writes.push({table,mode:this.mode});matches.forEach(row=>Object.assign(row,this.values));}
          return {data:single ? (matches[0] ? {...matches[0]} : null) : matches.map(row=>({...row}))};
        }, maybeSingle(){return this.exec(true);},single(){return this.exec(true);},then(ok,bad){return this.exec(false).then(ok,bad);}
      };return q;
    }
  };
  const env={TEST_RESET_EMAILS:email,JWT_SECRET:'synthetic',SUPABASE_URL:'https://example.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service'};
  const security=load('supabase/functions/_shared/security.ts').context;
  const entitlements=load('supabase/functions/_shared/entitlements.ts').context;
  let handler;
  const globals={
    Deno:{env:{get:key=>env[key]},serve:fn=>handler=fn},createClient:()=>admin,
    handleOptions:()=>null,json:(_req,body,status=200)=>({body,status}),normalizeEmail:security.normalizeEmail,isReservedTestEmail:security.isReservedTestEmail,
    bearerToken:security.bearerToken,decodeJwtPayload:security.decodeJwtPayload,
    auditEvent:async()=>{},clearRateLimit:async()=>{},clientIp:()=> 'synthetic-ip',
    checkRateLimit:async(_db,scope)=>{state.limits.push(scope);return {allowed:!options.limited};},
    expandProductSlugs:entitlements.expandProductSlugs,resolveEntitlements:entitlements.resolveEntitlements,
    mintAppSessionJWT:async args=>{state.minted.push(plain(args));return 'synthetic-jwt';},
    requireActiveAppSession:async()=> {if(options.revoked)return null;if(options.resetAfterValidation)state.users[0].session_version=3;return {userId:'app-a',email,sessionVersion:2};},
  };
  const module=load(source(slug),globals);
  async function call(body={},claims={sub:'auth-a',app_metadata:{provider:'google'}},method='POST') {return handler(new Request('https://example.invalid/functions/'+slug,{method,headers:{Authorization:'Bearer '+jwt(claims),'Content-Type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify(body)})}));}
  return {state,admin,module,call,env};
}

async function signup() {
  let x=fixture('fw-signup');
  let result=await x.call({email,password:'different-new-password',productSlug:'dhq'});
  assert.equal(result.status,409,'public signup must not replace a designated existing QA account');
  assert.equal(x.state.deletes.length,0);assert.equal(x.state.users[0].password_hash,'unchanged-private-hash');
  assert.equal(x.state.limits.length,2,'QA identifiers retain IP and email abuse limits');
  x=fixture('fw-signup',{empty:true,limited:true});result=await x.call({email,password:'valid-password'});assert.equal(result.status,429);assert.equal(x.state.users.length,0);
  x=fixture('fw-signup',{empty:true});result=await x.call({email,password:'valid-password',productSlug:'dhq'});assert.equal(result.status,200);assert.deepEqual(plain(result.body.user.products),['war_room','dynast_hq']);assert.equal(x.state.minted[0].sessionVersion,1);
  x=fixture('fw-signup',{empty:true,gifted:true});result=await x.call({email,password:'valid-password',productSlug:'war_room'});assert.equal(result.status,200);assert.equal(result.body.user.tier,'pro','signup respects existing gift trigger');assert.deepEqual(plain(result.body.user.products),['war_room','dynast_hq']);assert.equal(x.state.minted[0].tier,'pro');
  x=fixture('fw-signup',{empty:true,subscriptionFailure:true});result=await x.call({email,password:'valid-password'});assert.equal(result.status,503);assert.match(result.body.error,/account was created/);assert.equal(x.state.users.length,1);assert.equal(x.state.minted.length,0);assert.equal(x.state.deletes.length,0,'outage retains the newly created account for sign-in recovery');
  x=fixture('fw-signup',{empty:true});result=await x.call({email:'unlisted@example.invalid',password:'valid-password'});assert.equal(result.status,400);assert.equal(x.state.users.length,0,'reserved-domain policy remains enforced');
  x=fixture('fw-signup',{queryFailure:true});result=await x.call({email,password:'valid-password'});assert.equal(result.status,503);assert.equal(x.state.writes.length,0,'failed existence read cannot create replacement');
  for(const password of [12345678,{},'x'.repeat(1025)]) {x=fixture('fw-signup',{empty:true});assert.equal((await x.call({email,password})).status,400);assert.equal(x.state.writes.length,0);}
  console.log('PASS actual signup preserves existing QA accounts, enforces limits/input bounds, keeps reserved-address policy and DHQ expansion');
}
async function oauth() {
  let x=fixture('fw-oauth-sync');let result=await x.call();assert.equal(result.status,200);assert.equal(result.body.user.id,'app-a');assert.equal(result.body.isNew,false);assert.equal(x.state.deletes.length,0,'OAuth sign-in must preserve the existing designated QA account');assert.deepEqual(plain(result.body.user.products),['war_room','dynast_hq']);assert.equal(result.body.user.tier,'pro');
  x=fixture('fw-oauth-sync',{unconfirmed:true});result=await x.call();assert.equal(result.status,401);assert.equal(x.state.queries,0,'unconfirmed email cannot map to existing account');
  for(const claims of [{sub:'app-a',app_metadata:{user_id:'app-a',session_version:1}},{sub:'app-a',app_metadata:{user_id:'app-a'}}]) {x=fixture('fw-oauth-sync');result=await x.call({},claims);assert.equal(result.status,401);assert.equal(x.state.authCalls,0,'custom app tokens never exchange through OAuth after rejection');assert.equal(x.state.minted.length,0);}
  x=fixture('fw-oauth-sync',{empty:true});result=await x.call({productSlug:'dhq'});assert.equal(result.status,200);assert.equal(result.body.isNew,true);assert.equal(x.state.users[0].password_hash,'oauth:google');assert.deepEqual(plain(result.body.user.products),['war_room','dynast_hq']);
  x=fixture('fw-oauth-sync',{queryFailure:true});result=await x.call();assert.equal(result.status,503);assert.equal(x.state.writes.length,0);
  console.log('PASS actual OAuth exchange preserves account/data, requires confirmed identity, rejects custom app tokens, retains first-user onboarding and entitlement behavior');
}
async function refresh() {
  let x=fixture('fw-refresh-session',{resetAfterValidation:true});let result=await x.call();assert.equal(result.status,401,'refresh cannot adopt a version incremented by password reset after validation');assert.equal(x.state.minted.length,0);
  x=fixture('fw-refresh-session',{revoked:true});result=await x.call();assert.equal(result.status,401);assert.equal(x.state.minted.length,0);
  x=fixture('fw-refresh-session');result=await x.call();assert.equal(result.status,200);assert.equal(x.state.minted[0].sessionVersion,2);assert.equal(result.body.user.tier,'pro');assert.deepEqual(plain(result.body.user.products),['war_room','dynast_hq']);
  console.log('PASS actual session refresh preserves live entitlements and refuses reset/revocation races');
}
async function entitlement() {
 const helper=load('supabase/functions/_shared/entitlements.ts').context;
 const x=fixture('fw-signup');x.state.subscriptions=[
  {user_id:'app-a',product_slug:'dhq_gift',tier:'pro',status:'active',expires_at:'2020-01-01T00:00:00Z'},
  {user_id:'app-a',product_slug:'bundle',tier:'pro',status:'canceled'},
  {user_id:'app-a',product_slug:'dhq',tier:'pro',status:'trialing',expires_at:'2099-01-01T00:00:00Z'}];
 assert.deepEqual(plain(await helper.resolveEntitlements(x.admin,'app-a')),{tier:'pro',products:['war_room','dynast_hq']});
 x.state.subscriptions.pop();assert.deepEqual(plain(await helper.resolveEntitlements(x.admin,'app-a')),{tier:'free',products:[]});
 const y=fixture('fw-signup',{queryFailure:true});await assert.rejects(helper.resolveEntitlements(y.admin,'app-a'),/Subscriptions query failed/);
 console.log('PASS actual entitlements keep active/trialing/gift/bundle expiry semantics and fail on database errors');
}

async function signinAndProfile() {
  const hash = load('supabase/functions/fw-signup/index.ts', {}, ['hashPassword']).context.hashPassword;
  const x = fixture('fw-signin'); x.state.users[0].password_hash = await hash('synthetic-current-password');
  let result = await x.call({email,password:'synthetic-current-password'});
  assert.equal(result.status,200); assert.equal(result.body.user.tier,'pro'); assert.deepEqual(plain(result.body.user.products),['war_room','dynast_hq']);
  result = await x.call({email,password:'incorrect-password'}); assert.equal(result.status,401); assert.equal(x.state.minted.length,1);
  const p = fixture('fw-profile'); result = await p.call({}, {}, 'GET');
  assert.equal(result.status,200); assert.equal(result.body.user.tier,'pro'); assert.deepEqual(plain(result.body.user.products),['war_room','dynast_hq']);
  const broken = fixture('fw-profile'); const original = broken.admin.from;
  broken.admin.from = table => table==='subscriptions' ? {select(){return this;},eq(){return this;},in:async()=>({error:{message:'offline'}})} : original(table);
  result = await broken.call({}, {}, 'GET'); assert.equal(result.status,500,'profile must not claim free tier on subscription outage'); assert.equal(result.body.user,undefined);
  console.log('PASS actual password sign-in and profile agree on trial entitlement, and failed profile lookup never downgrades the account');
}

(async()=>{const groups={signup,oauth,refresh,entitlement,signinAndProfile};for(const [name,run] of Object.entries(groups)){if(!process.argv[2]||process.argv[2]===name)await run();}})().catch(error=>{console.error(error);process.exitCode=1;});
