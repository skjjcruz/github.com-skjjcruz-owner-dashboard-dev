'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawnSync}=require('node:child_process');
const native=require('../scripts/native-artifact.cjs');
const root=path.resolve(__dirname,'..'),output=path.join(root,native.OUTPUT);
let passed=0;
function test(name,run){run();passed++;console.log('PASS '+name);}
function change(file,next,run){const prior=fs.readFileSync(file);try{fs.writeFileSync(file,next);run();}finally{fs.writeFileSync(file,prior);}}
test('built actual entries, canonical shared assets and every shipped script parse',()=>{
 const manifest=native.inspect(root);assert.equal(native.ENTRIES.length,16);
 for(const file of native.ENTRIES)assert(manifest.assets[file]);
 for(const file of Object.keys(manifest.assets).filter(file=>file.endsWith('.js'))){const result=spawnSync(process.execPath,['--check',path.join(output,file)],{encoding:'utf8'});assert.equal(result.status,0,file+' must ship executable JavaScript: '+result.stderr);}
 assert(Object.keys(manifest.assets).every(file=>!/(?:^|\/)(?:supabase|tests|reports|node_modules|\.git)(?:\/|$)/.test(file)));
});
test('untracked source is not silently packaged',()=>{
 const file=path.join(root,'js/native-private-fixture.json');assert(!fs.existsSync(file));
 try{fs.writeFileSync(file,'{"private":"disposable fixture"}');assert(!native.sourceFiles(root).includes('js/native-private-fixture.json'));native.inspect(root);}finally{fs.unlinkSync(file);}
});
test('changed compiled bytes fail inspection',()=>change(path.join(output,'index.html'),'tampered',()=>assert.throws(()=>native.inspect(root),/asset changed/)));
test('changed source fails inspection before native copy',()=>{
 const file=path.join(root,'index.html');change(file,fs.readFileSync(file,'utf8')+'\n<!-- changed -->',()=>assert.throws(()=>native.inspect(root),/source changed/));
});
test('unknown private output fails actual installed Capacitor sync hook',()=>{
 const file=path.join(output,'.env');assert(!fs.existsSync(file));try{fs.writeFileSync(file,'DISPOSABLE_FIXTURE=1');const result=spawnSync(process.execPath,['node_modules/@capacitor/cli/bin/capacitor','sync'],{cwd:root,encoding:'utf8'});assert.notEqual(result.status,0);assert.match(result.stdout+result.stderr,/native-copy-guard|non-public/);}finally{fs.unlinkSync(file);}
});
test('symlinked public output is rejected',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dhq-native-'));const file=path.join(output,'linked.json');try{fs.writeFileSync(path.join(dir,'private.json'),'{}');fs.symlinkSync(path.join(dir,'private.json'),file);assert.throws(()=>native.inspect(root),/symbolic link/);}finally{if(fs.existsSync(file))fs.unlinkSync(file);fs.rmSync(dir,{recursive:true});}
});
test('future web-only Vault archive fails closed instead of disappearing',()=>{
 const parent=path.join(root,'data'),archive=path.join(parent,'time-league');assert(!fs.existsSync(archive));const madeParent=!fs.existsSync(parent);try{fs.mkdirSync(archive,{recursive:true});assert.throws(()=>native.inspect(root),/web-only Vault archive/);}finally{fs.rmdirSync(archive);if(madeParent)fs.rmdirSync(parent);}
});
test('root-directory and remote-web workarounds are rejected',()=>{
 const file=path.join(root,'capacitor.config.json'),original=JSON.parse(fs.readFileSync(file));
 for(const extra of [{webDir:'.'},{server:{url:'https://example.invalid'}}])change(file,JSON.stringify({...original,...extra}),()=>assert.throws(()=>native.inspect(root),/repository-root copy and server.url/));
});
native.inspect(root);console.log(`${passed} native packaging checks passed. No native build/install/device/store claim.`);
