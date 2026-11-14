const fs=require('fs'),path=require('path'),crypto=require('crypto'),{execFileSync,spawn}=require('child_process');
const {compare,version,inspectZip,validateBundle,managed}=require('./update-package.cjs');
const repo='MrNubito/web-monitor-acbot',releaseBase='https://github.com/'+repo+'/releases/download/';
async function github(url,{limit=300*1024*1024,onProgress=()=>{}}={}){
 const allowed=new Set(['api.github.com','github.com','release-assets.githubusercontent.com','objects.githubusercontent.com']);
 for(let redirect=0;redirect<6;redirect++){
  const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.username||parsed.password||!allowed.has(parsed.hostname))throw Error('Untrusted release download address.');
  const response=await fetch(url,{redirect:'manual',headers:{'User-Agent':'ACBot-Web-Monitor-Updater','Accept':'application/vnd.github+json'},signal:AbortSignal.timeout(120000)});
  if([301,302,303,307,308].includes(response.status)){await response.body?.cancel();url=new URL(response.headers.get('location'),url).href;continue;}
  if(response.status===404)return null;if(!response.ok)throw Error(response.status===403||response.status===429?'GitHub temporarily limited update checks. Try again later.':'GitHub request failed ('+response.status+').');
  const chunks=[];let bytes=0;const total=Number(response.headers.get('content-length'))||0;if(total>limit)throw Error('Release file is too large.');
  for await(const chunk of response.body){bytes+=chunk.length;if(bytes>limit)throw Error('Release file is too large.');chunks.push(Buffer.from(chunk));onProgress(bytes,total);}
  return Buffer.concat(chunks);
 }throw Error('Too many release download redirects.');
}
function selectRelease(releases,current,includePreview=false){
 const available=[];
 for(const release of releases){if(release.draft||release.prerelease&&!includePreview)continue;let v;try{v=version(release.tag_name).value;}catch{continue;}
  const name='ACBot-Web-Monitor-'+v+'-windows-x64.zip',zip=release.assets?.find(a=>a.name===name&&a.state==='uploaded'),sum=release.assets?.find(a=>a.name===name+'.sha256'&&a.state==='uploaded');
  if(!zip||!sum)continue;
  const prefix=releaseBase+encodeURIComponent(release.tag_name)+'/';
  if(zip.browser_download_url!==prefix+name||sum.browser_download_url!==prefix+name+'.sha256')continue;
  if(compare(v,current)>0)available.push({version:v,tag:release.tag_name,name,url:zip.browser_download_url,checksumUrl:sum.browser_download_url,notes:String(release.body||'').slice(0,12000),page:'https://github.com/'+repo+'/releases/tag/'+encodeURIComponent(release.tag_name),size:zip.size||0});
 }
 return available.sort((a,b)=>compare(b.version,a.version))[0]||null;
}
function createUpdater({root,dataDir,download=github,launchWorker,now=Date.now}){
 const directory=path.join(dataDir,'updates');fs.mkdirSync(directory,{recursive:true});
 const statusFile=path.join(directory,'status.json'),lockFile=path.join(directory,'install.lock'),backupFile=path.join(directory,'previous.json');
 const current=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
 const capable=fs.existsSync(path.join(root,'BUILD.json'))&&fs.existsSync(path.join(root,'runtime','node.exe'))&&fs.existsSync(path.join(dataDir,'portable.json'))&&!fs.existsSync(path.join(root,'.git'));
 let lastPruned=0;
 let busy=false,cached=null,checked=0,preview=false,checkMessage='Check GitHub Releases for a new version.';
 const read=(file,fallback={})=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return fallback;}};
 function prune(){
  if(busy||fs.existsSync(lockFile)||now()-lastPruned<3600000||read(statusFile).phase==='error')return;lastPruned=now();
  const previous=read(backupFile),active=read(statusFile).job;
  for(const base of [directory,path.join(directory,'backups')]){
   try{
    const real=fs.realpathSync(base);if(real.toLowerCase()!==path.resolve(base).toLowerCase())continue;
    const entries=fs.readdirSync(base,{withFileTypes:true}).filter(e=>e.isDirectory()&&/^[a-f0-9]{32}$/.test(e.name)).map(e=>({name:e.name,at:fs.statSync(path.join(base,e.name)).mtimeMs})).sort((a,b)=>b.at-a.at);
    const keep=new Set([...entries.slice(0,2).map(e=>e.name),previous.id,active]);
    for(const entry of entries)if(!keep.has(entry.name)){const file=path.resolve(base,entry.name);if(path.dirname(file)===path.resolve(base)&&fs.realpathSync(file).toLowerCase()===file.toLowerCase())try{fs.rmSync(file,{recursive:true,force:true});}catch{}}
   }catch{}
  }
 }
 function status(){prune();const saved=read(statusFile),previous=read(backupFile);return {version:current,portable:capable,release:cached,checkedAt:checked||null,includePreview:preview,message:checkMessage,operation:saved,rollback:previous.id?{available:fs.existsSync(path.join(directory,'backups',previous.id,'app')),version:previous.version}:null,busy:busy||fs.existsSync(lockFile)};}
 function health(job){const saved=read(statusFile);if(!job||job!==saved.job)return null;return {job,version:current,phase:saved.phase,message:saved.message};}
 function write(job,phase,message,extra={}){fs.writeFileSync(statusFile,JSON.stringify({job,phase,message,at:now(),...extra})+'\n');}
 async function check({includePreview=false,force=false}={}){
  if(!force&&checked&&now()-checked<10*60000&&preview===includePreview)return status();
  const response=await download('https://api.github.com/repos/'+repo+'/releases?per_page=30',{limit:2*1024*1024});
  const releases=response?JSON.parse(response.toString('utf8')):[];if(!Array.isArray(releases))throw Error('Invalid GitHub release response.');
  cached=selectRelease(releases,current,includePreview);checked=now();preview=includePreview;
  checkMessage=cached?'A new portable version is available.':releases.length?'No newer compatible release is available.':'No downloadable releases have been published yet.';return status();
 }
 async function prepare(mode='install',{expectedVersion}={}){
  if(!capable)throw Error('In-app installation is available in the portable edition.');
  if(busy||fs.existsSync(lockFile))throw Error('An update is already in progress.');
  const job=crypto.randomBytes(16).toString('hex');const work=path.join(directory,job);let ownsLock=false;
  busy=true;
  try{
   fs.writeFileSync(lockFile,JSON.stringify({job,at:now()})+'\n',{flag:'wx'});ownsLock=true;fs.mkdirSync(work);
   let source,targetVersion;
   if(mode==='rollback'){
    const previous=read(backupFile);if(!/^[a-f0-9]{32}$/.test(previous.id||''))throw Error('No previous version is available.');
    targetVersion=version(previous.version).value;if(expectedVersion&&targetVersion!==expectedVersion)throw Error('The previous-version selection changed. Refresh Updates.');source=path.join(work,'rollback');fs.cpSync(path.join(directory,'backups',previous.id,'app'),source,{recursive:true});validateBundle(source,targetVersion);
   }else{
    if(!cached)await check({includePreview:preview});if(!cached)throw Error('No update is available.');
    targetVersion=cached.version;if(expectedVersion&&targetVersion!==expectedVersion)throw Error('The release selection changed. Check updates again.');write(job,'downloading','Downloading '+targetVersion+'…');let last=0;
    const archive=await download(cached.url,{onProgress:(bytes,total)=>{if(now()-last>700){last=now();write(job,'downloading','Downloading '+targetVersion+'…',{bytes,total});}}});
    const checksum=await download(cached.checksumUrl,{limit:2048});
    if(!archive||!checksum)throw Error('The release archive or checksum is missing.');
    const match=checksum.toString('utf8').trim().match(/^([a-f0-9]{64})\s+\*?([^\r\n]+)$/i);
    if(!match||match[2]!==cached.name||crypto.createHash('sha256').update(archive).digest('hex')!==match[1].toLowerCase())throw Error('The downloaded update failed checksum verification.');
    write(job,'verifying','Verifying update files…');const prefix=inspectZip(archive,targetVersion),zip=path.join(work,'update.zip'),extract=path.join(work,'extract');fs.writeFileSync(zip,archive);fs.mkdirSync(extract);
    execFileSync('tar.exe',['-xf',zip,'-C',extract],{windowsHide:true});source=path.join(extract,prefix);validateBundle(source,targetVersion);
   }
   const plan={job,root:path.resolve(root),dataDir:path.resolve(dataDir),source,fromVersion:current,targetVersion,mode,healthTimeout:45000};
   const runner=path.join(work,'runner.exe');fs.copyFileSync(path.join(root,'runtime','node.exe'),runner);
   fs.copyFileSync(path.join(__dirname,'update-worker.cjs'),path.join(work,'worker.cjs'));fs.copyFileSync(path.join(__dirname,'update-package.cjs'),path.join(work,'update-package.cjs'));fs.writeFileSync(path.join(work,'plan.json'),JSON.stringify(plan)+'\n');
   write(job,'installing','Preparing backup and restart…',{targetVersion});
   const launch=launchWorker||((executable,args)=>{const fd=fs.openSync(path.join(work,'worker.log'),'a'),child=spawn(executable,args,{cwd:work,windowsHide:true,detached:true,stdio:['ignore',fd,fd]});fs.closeSync(fd);child.once('error',error=>{write(job,'error',error.message);if(read(lockFile)?.job===job)try{fs.unlinkSync(lockFile);}catch{}});child.unref();});
   setTimeout(()=>{try{launch(runner,[path.join(work,'worker.cjs'),path.join(work,'plan.json')]);}catch(error){write(job,'error',error.message);try{fs.unlinkSync(lockFile);}catch{}}},400).unref();
   return {job,targetVersion};
  }catch(error){if(ownsLock)write(job,'error',error.message);if(ownsLock)try{fs.unlinkSync(lockFile);}catch{}throw error;}
  finally{busy=false;}
 }
 return {status,health,check,prepare};
}
module.exports={createUpdater,selectRelease,github};
