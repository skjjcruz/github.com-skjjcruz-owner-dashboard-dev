'use strict';
const assert=require('node:assert/strict');
const load=require('./helpers/security-ts-loader.cjs');
const env={APP_ALLOWED_ORIGINS:'https://configured.example.invalid'};
const deno={env:{get:key=>env[key]},serve(){}};
const security=load('supabase/functions/_shared/security.ts',{Deno:deno}).context;

for(const origin of ['https://dhqfootball.com','https://www.dhqfootball.com','https://c2-football.github.io','https://jcc100218.github.io','https://skjjcruz.github.io','capacitor://localhost','https://localhost','https://configured.example.invalid']) {
 const request=new Request('https://example.invalid',{headers:{Origin:origin}});
 assert.equal(security.corsHeaders(request)['Access-Control-Allow-Origin'],origin);

}
for(const module of [security])assert.notEqual(module.corsHeaders(new Request('https://example.invalid',{headers:{Origin:'https://untrusted.example.invalid'}}))['Access-Control-Allow-Origin'],'https://untrusted.example.invalid');
assert.match(security.corsHeaders(new Request('https://example.invalid'))['Access-Control-Allow-Headers'],/x-ai-key/);
for(const email of ['fixture@example.invalid','fixture@example.com','fixture@sub.example.com','fixture@example.net','fixture@local.test'])assert.equal(security.isReservedTestEmail(email),true);
assert.equal(security.isReservedTestEmail('fixture@dhqfootball.com'),false);
console.log('PASS actual account shared CORS preserve supported web/native origins plus configured origins without wildcard; reserved-address helper retained');

let handlerRef;
(async()=>{
 let tokenStored=false, deliveries=[],vaultCalls=[];
 const vault={RESEND_API_KEY:'synthetic-vault-key',PASSWORD_RESET_FROM_EMAIL:'QA <qa@dhqfootball.com>'};
 const admin={
  from(table){return{select(){return this;},eq(){return this;},async maybeSingle(){assert.equal(table,'app_users');return{data:{id:'controlled',email:'fixture@example.invalid'}};},async insert(){assert.equal(table,'password_reset_tokens');tokenStored=true;return{error:null};}};},
  async rpc(name,args){assert.equal(name,'get_app_secret');vaultCalls.push(args.secret_name);return{data:vault[args.secret_name]||null};},
 };
 const config={};
 const handler=load('supabase/functions/fw-request-password-reset/index.ts',{
  Deno:{env:{get:key=>config[key]},serve(fn){handlerRef=fn;}},
  createClient:()=>admin,handleOptions:()=>null,checkRateLimit:async()=>({allowed:true}),auditEvent:async()=>{},clientIp:()=>null,normalizeEmail:value=>String(value||'').toLowerCase(),sha256Hex:async()=> 'synthetic-hashed-token',
  json:(_req,body,status=200)=>({body,status}),
  fetch:async(url,options)=>{assert(tokenStored,'persist before attempting delivery');assert.equal(url,'https://api.resend.com/emails');deliveries.push({headers:options.headers,body:JSON.parse(options.body)});return{ok:true};},
 }).context;
 // The loader intentionally removes imports, but the production handler runs.
 function call(){tokenStored=false;return handlerRef(new Request('https://example.invalid/request',{method:'POST',body:JSON.stringify({email:'fixture@example.invalid'})}));}
 assert.equal((await call()).status,200);assert.equal(deliveries[0].headers.Authorization,'Bearer synthetic-vault-key');assert.equal(deliveries[0].body.from,'QA <qa@dhqfootball.com>');assert.match(deliveries[0].body.text,/https:\/\/dhqfootball.com\/reset-password.html\?token=/);
 config.RESEND_API_KEY='synthetic-env-key';config.PASSWORD_RESET_FROM_EMAIL='Configured <noreply@dhqfootball.com>';config.APP_RESET_URL='https://c2-football.github.io/WarRoom/reset-password.html';vaultCalls=[];
 await call();assert.equal(deliveries[1].headers.Authorization,'Bearer synthetic-env-key');assert.equal(deliveries[1].body.from,config.PASSWORD_RESET_FROM_EMAIL);assert.equal(vaultCalls.length,0,'explicit env wins without unnecessary Vault reads');assert.match(deliveries[1].body.text,/c2-football.github.io\/WarRoom\/reset-password.html/);
 delete config.PASSWORD_RESET_FROM_EMAIL;delete vault.PASSWORD_RESET_FROM_EMAIL;await call();assert.equal(deliveries[2].body.from,'Dynasty HQ <noreply@dhqfootball.com>','retain current operational default sender');
 console.log('PASS actual reset request preserves env-first/Vault-fallback delivery, current sender/domain and configured URL override without real mail');
 env.JWT_SECRET='synthetic-test-secret';
 const appClaims={sub:'app-user',app_metadata:{user_id:'app-user',session_version:2,email:'member@example.invalid'}};
 let authCalls=0, authError=false, confirmed=true;
 const jwt = payload => 'header.'+Buffer.from(JSON.stringify(payload)).toString('base64url')+'.signature';
 security.jwtVerify=async token=>({payload:JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString())});
 const identityDb={
  auth:{getUser:async()=>{authCalls++;return authError?{error:new Error('invalid')}:{data:{user:{email:'member@example.invalid',email_confirmed_at:confirmed?'2026-09-20T00:00:00Z':null}}};}},
  from(){return{select(){return this;},eq(field){this.field=field;return this;},async maybeSingle(){return{data:{id:'app-user',email:'member@example.invalid',session_version:2}};}};},
 };
 const resolve=payload=>security.resolveAppUserId(identityDb,new Request('https://example.invalid',{headers:{Authorization:'Bearer '+jwt(payload)}}));
 assert.equal((await resolve(appClaims)).userId,'app-user');assert.equal(authCalls,0);
 assert.equal(await resolve({...appClaims,app_metadata:{...appClaims.app_metadata,session_version:1}}),null);assert.equal(authCalls,0,'revoked app token cannot fall through even if Auth would accept it');
 assert.equal(await resolve({...appClaims,app_metadata:{user_id:'app-user'}}),null);assert.equal(authCalls,0,'malformed modern token also cannot fall through');
 const oauth={sub:'auth-principal',app_metadata:{provider:'google'}};
 assert.equal((await resolve(oauth)).userId,'app-user');assert.equal(authCalls,1);
 confirmed=false;assert.equal(await resolve(oauth),null,'unconfirmed Auth email cannot identify an app account');
 confirmed=true;authError=true;assert.equal(await resolve(oauth),null,'Auth must verify the external token');
 console.log('PASS actual identity helper preserves confirmed OAuth mapping while rejecting revoked/malformed app tokens, unverified email and invalid Auth');
 const limiter=await security.checkRateLimit({rpc:async()=>({error:new Error('offline')})},'fixture','fixture',{limit:2,windowSeconds:60});assert.equal(limiter.allowed,false,'operational merge retains fail-closed atomic limiter');
 console.log('PASS operational reconciliation retains atomic fail-closed authentication limits');
})().catch(error=>{console.error(error);process.exitCode=1;});
