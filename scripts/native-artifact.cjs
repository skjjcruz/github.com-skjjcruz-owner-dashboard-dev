'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const OUTPUT='dist-native', MANIFEST='native-artifact.json';
const ENTRIES=['index.html','admin.html','landing.html','connect-sleeper.html','upgrade.html','ai-setup.html','login.html','reset-password.html','gift.html','draft-warroom.html','free-agency.html','trade-calculator.html','draft-war-room/index.html','draft-war-room/player-detail.html','legal/privacy-policy.html','legal/terms-of-service.html'];
const FILES=new Set([...ENTRIES,'charts.js','college-stats.js','draft-history.js','themes.js','manifest.json','icon-192.png','icon-512.png']);
const DIRECTORIES=new Set(['js','content','draft-war-room','team-comps','img','images','icons','vendor','legal','css']);
const EXTENSIONS=new Set(['.html','.js','.css','.json','.csv','.svg','.png','.jpg','.jpeg','.webp','.gif','.ico','.woff','.woff2','.ttf','.webmanifest']);
const PRIVATE=new Set(['scripts','tests','reports','docs','supabase','node_modules','ios','android','backups','mocks','mockups','package.json','package-lock.json','capacitor.config.json']);
const INPUTS=['package.json','package-lock.json','capacitor.config.json','native-build.json','scripts/build-deploy.cjs','scripts/build-native.cjs','scripts/native-artifact.cjs','scripts/cap-sync-guard.cjs'];
const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
function safePath(file){const parts=file.split('/');return file&&!path.isAbsolute(file)&&!file.includes('\\')&&!parts.some(p=>!p||p.startsWith('.')||PRIVATE.has(p))&&EXTENSIONS.has(path.extname(file).toLowerCase());}
function regular(root,file){let current=root;for(const part of file.split('/')){current=path.join(current,part);if(fs.lstatSync(current).isSymbolicLink())throw Error('Native assets cannot use symbolic links: '+file);}if(!fs.statSync(current).isFile())throw Error('Native asset must be a file: '+file);return current;}
function walk(root,prefix=''){return fs.readdirSync(path.join(root,prefix)).sort().flatMap(name=>{const file=prefix?prefix+'/'+name:name;const stat=fs.lstatSync(path.join(root,file));if(stat.isSymbolicLink())throw Error('Native output contains a symbolic link: '+file);return stat.isDirectory()?walk(root,file):[file];});}
function noRestrictedArchive(root){if(fs.existsSync(path.join(root,'data/time-league')))throw Error('A web-only Vault archive is present. Native archive distribution and required asset coverage must be reviewed before packaging; it cannot be silently omitted or loaded remotely.');}
function sourceFiles(root){
 noRestrictedArchive(root);
 const tracked=execFileSync('git',['-C',root,'ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
 const files=tracked.filter(file=>safePath(file)&&(FILES.has(file)||DIRECTORIES.has(file.split('/')[0])||(!file.includes('/')&&file.endsWith('.css'))));
 const shared=path.join(root,'reconai-shared');
 if(!fs.existsSync(shared))throw Error('Canonical shared assets are missing; build with DHQ_SHARED_SOURCE.');
 files.push(...walk(shared).map(file=>'reconai-shared/'+file));
 for(const file of files)if(!safePath(file))throw Error('Non-public native asset: '+file);
 for(const entry of ENTRIES)if(!files.includes(entry))throw Error('Required native entry missing: '+entry);
 return [...new Set(files)].sort();
}
function verifyShared(root,source){
 const config=JSON.parse(fs.readFileSync(path.join(root,'native-build.json'),'utf8'));
 if(!source||!fs.existsSync(path.join(source,'manifest.json')))throw Error('Set DHQ_SHARED_SOURCE to the pinned skjjcruz/DHQ-Shared checkout.');
 if(!/^[a-f0-9]{40}$/.test(config.sharedRevision)||git(source,'rev-parse','HEAD')!==config.sharedRevision)throw Error('Canonical shared revision differs from native-build.json; review and update the pin before building.');
 const manifest=JSON.parse(fs.readFileSync(path.join(source,'manifest.json'),'utf8'));
 execFileSync('git',['-C',source,'diff','--exit-code','HEAD','--','manifest.json',...manifest.modules,...manifest.data],{stdio:'pipe'});
 return {revision:config.sharedRevision,modules:manifest.modules,data:manifest.data};
}
function stage(root,sharedRevision){
 noRestrictedArchive(root);
 const output=path.join(root,OUTPUT),overlay=path.join(root,'dist-deploy');
 if(fs.existsSync(output)&&fs.lstatSync(output).isSymbolicLink())throw Error('Native output cannot be a symbolic link.');
 const sources=sourceFiles(root),inputs={};
 fs.rmSync(output,{recursive:true,force:true});fs.mkdirSync(output,{recursive:true});
 for(const file of [...sources,...INPUTS])inputs[file]=sha256(fs.readFileSync(regular(root,file)));
 for(const file of sources){const original=regular(root,file);const compiled=path.join(overlay,file);const selected=fs.existsSync(compiled)?regular(overlay,file):original;fs.mkdirSync(path.dirname(path.join(output,file)),{recursive:true});fs.copyFileSync(selected,path.join(output,file));}
 const assets=Object.fromEntries(walk(output).map(file=>[file,sha256(fs.readFileSync(path.join(output,file)))]));
 const manifest={version:1,revision:git(root,'rev-parse','HEAD'),sharedRevision,node:process.version,inputs,assets};
 fs.writeFileSync(path.join(output,MANIFEST),JSON.stringify(manifest,null,2)+'\n');
 inspect(root);return {files:Object.keys(assets).length,bytes:Object.keys(assets).reduce((total,file)=>total+fs.statSync(path.join(output,file)).size,0)};
}
function inspect(root){
 noRestrictedArchive(root);
 const config=JSON.parse(fs.readFileSync(path.join(root,'capacitor.config.json'),'utf8'));
 if(config.webDir!==OUTPUT||config.server?.url)throw Error('Native packaging requires local dist-native assets; repository-root copy and server.url are unsupported.');
 const output=path.join(root,OUTPUT);
 if(!fs.existsSync(output)||fs.lstatSync(output).isSymbolicLink())throw Error('Build a fresh native asset bundle before copy/sync.');
 const manifest=JSON.parse(fs.readFileSync(path.join(output,MANIFEST),'utf8'));
 const pin=JSON.parse(fs.readFileSync(path.join(root,'native-build.json'),'utf8'));
 if(manifest.version!==1||manifest.sharedRevision!==pin.sharedRevision)throw Error('Native shared pin changed; rebuild.');
 const files=walk(output),expected=new Set([...Object.keys(manifest.assets),MANIFEST]);
 if(files.length!==expected.size||files.some(file=>!expected.has(file)||!safePath(file)))throw Error('Native artifact inventory changed or contains a non-public asset.');
 for(const [file,hash]of Object.entries(manifest.assets))if(sha256(fs.readFileSync(regular(output,file)))!==hash)throw Error('Native asset changed: '+file);
 const inputs=[...sourceFiles(root),...INPUTS];
 if(inputs.length!==Object.keys(manifest.inputs).length)throw Error('Native source inventory changed; rebuild.');
 for(const file of inputs)if(sha256(fs.readFileSync(regular(root,file)))!==manifest.inputs[file])throw Error('Native source changed; rebuild: '+file);
 for(const file of files.filter(file=>file.endsWith('.html'))){
  const html=fs.readFileSync(path.join(output,file),'utf8');
  if(/<script\b[^>]*\btype=["']text\/babel["']|<script\b[^>]*\bsrc=["'][^"']*@babel\/standalone/i.test(html))throw Error('Browser Babel remains in native entry: '+file);
  for(const match of html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)=["']([^"']+)["'][^>]*>/gi)){
   const url=match[1].split(/[?#]/)[0];if(!url||/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url))continue;
   const target=path.posix.normalize(path.posix.join(path.posix.dirname(file),url));
   if(!safePath(target)||!expected.has(target))throw Error('Missing native dependency: '+file+' -> '+url);
  }
 }
 return manifest;
}
module.exports={OUTPUT,MANIFEST,ENTRIES,safePath,sourceFiles,verifyShared,stage,inspect};
