#!/usr/bin/env node
'use strict';
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const native=require('./native-artifact.cjs');
const root=path.resolve(__dirname,'..');
try{
 if(Number(process.versions.node.split('.')[0])<22)throw Error('Capacitor8 requires Node22 or newer.');
 const source=process.env.DHQ_SHARED_SOURCE||path.resolve(root,'../DHQ-Shared');
 const shared=native.verifyShared(root,source);
 execFileSync(process.execPath,['scripts/sync-reconai-shared.cjs'],{cwd:root,env:{...process.env,DHQ_SHARED_SOURCE:source},stdio:'inherit'});
 execFileSync(process.execPath,['scripts/build-deploy.cjs'],{cwd:root,stdio:'inherit'});
 const result=native.stage(root,shared.revision);
 console.log(`[build-native] Verified ${result.files} public assets (${(result.bytes/1024/1024).toFixed(2)}MiB). This is web-asset staging, not a native build, installation or store approval.`);
}catch(error){console.error('[build-native] '+error.message);process.exitCode=1;}
