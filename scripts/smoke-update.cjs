const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto'),{spawn,execFileSync}=require('child_process');
const {createUpdater}=require('../service/updates.cjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));async function waitFor(test){for(let i=0;i<450;i++){try{const value=await test();if(value)return value;}catch{}await sleep(150);}throw Error('Update smoke test timed out.');}
async function main(){
 const archive=path.resolve(process.argv[2]||'');if(!fs.existsSync(archive))throw Error('Pass the portable ZIP path.');
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ACBot Update QA '));let bundle,state;
 const control=async(route,body)=>{const response=await fetch('http://127.0.0.1:'+state.controlPort+'/api/'+route,{method:body===undefined?'GET':'POST',headers:{'X-Setup-Token':state.token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw Error(result.error);return result;};
 try{
  execFileSync('tar.exe',['-xf',archive,'-C',temp],{windowsHide:true});bundle=path.join(temp,fs.readdirSync(temp)[0]);
  const dataDir=path.join(bundle,'data'),stateFile=path.join(dataDir,'launcher-state.json');
  const manifest=JSON.parse(fs.readFileSync(path.join(bundle,'BUILD.json'),'utf8')),targetVersion=manifest.version,oldVersion='0.2.0-preview.0';
  for(const file of ['package.json','BUILD.json']){const data=JSON.parse(fs.readFileSync(path.join(bundle,file),'utf8'));data.version=oldVersion;fs.writeFileSync(path.join(bundle,file),JSON.stringify(data));}
  const child=spawn(path.join(bundle,'ACBot Web Monitor.exe'),[],{env:{...process.env,ACBOT_NO_BROWSER:'1',PORT:'19142'},windowsHide:true,detached:true,stdio:'ignore'});child.unref();
  state=await waitFor(()=>fs.existsSync(stateFile)&&JSON.parse(fs.readFileSync(stateFile,'utf8')));
  const fixture=path.join(temp,'Fixture ACBot');fs.mkdirSync(path.join(fixture,'profiles','demo'),{recursive:true});fs.writeFileSync(path.join(fixture,'ACBot.exe'),'fixture');fs.writeFileSync(path.join(fixture,'profiles','demo','config.json'),'{}');
  const settings={instances:[{root:fixture,label:'Demo',device:''}],adb:'',password:'portable-update-test-password',startup:false,lan:false,remote:false};
  await control('finish',settings);fs.writeFileSync(path.join(dataDir,'private-history.txt'),'must survive update and rollback');
  const passwordHash=fs.readFileSync(path.join(dataDir,'access.json'),'utf8');
  const zip=fs.readFileSync(archive),name=path.basename(archive),tag='v'+targetVersion,prefix='https://github.com/MrNubito/web-monitor-acbot/releases/download/'+tag+'/';
  const releases=[{tag_name:tag,prerelease:true,assets:[name,name+'.sha256'].map(n=>({name:n,state:'uploaded',browser_download_url:prefix+n}))}];
  const download=async url=>url.includes('api.github.com')?Buffer.from(JSON.stringify(releases)):url.endsWith('.sha256')?Buffer.from(crypto.createHash('sha256').update(zip).digest('hex')+'  '+name):zip;
  const updater=createUpdater({root:bundle,dataDir,download});await updater.check({includePreview:true});const result=await updater.prepare('install',{expectedVersion:targetVersion});
  const statusFile=path.join(dataDir,'updates','status.json');
  const installed=await waitFor(()=>{const status=JSON.parse(fs.readFileSync(statusFile,'utf8'));if(status.phase==='error'||status.phase==='rolled-back')throw Error(status.message);return status.phase==='completed'&&status;});
  if(JSON.parse(fs.readFileSync(path.join(bundle,'package.json'))).version!==targetVersion)throw Error('New version not installed.');
  state=JSON.parse(fs.readFileSync(stateFile,'utf8'));
  const login=()=>fetch(state.dashboard+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:settings.password})}).then(r=>r.json());
  if(!(await login()).token)throw Error('Password lost after update.');
  const newer=createUpdater({root:bundle,dataDir,download});await newer.prepare('rollback',{expectedVersion:oldVersion});
  await waitFor(()=>{const status=JSON.parse(fs.readFileSync(statusFile,'utf8'));return status.phase==='rolled-back'&&status.job!==result.job;});
  state=JSON.parse(fs.readFileSync(stateFile,'utf8'));
  if(JSON.parse(fs.readFileSync(path.join(bundle,'package.json'))).version!==oldVersion)throw Error('Previous version not restored.');
  if(!(await login()).token)throw Error('Password lost after rollback.');
  if(fs.readFileSync(path.join(dataDir,'private-history.txt'),'utf8')!=='must survive update and rollback'||fs.readFileSync(path.join(dataDir,'access.json'),'utf8')!==passwordHash)throw Error('Private data changed.');
  await control('stop',{});await waitFor(()=>!fs.existsSync(stateFile));state=null;
  console.log(JSON.stringify({passed:true,verifiedDownload:true,installed:targetVersion,restored:oldVersion,passwordPreserved:true,historyPreserved:true,nativeRestart:true},null,2));
 }catch(error){
  if(bundle){const updates=path.join(bundle,'data','updates');try{console.error(fs.readFileSync(path.join(updates,'status.json'),'utf8'));for(const name of fs.readdirSync(updates))if(/^[a-f0-9]{32}$/.test(name)){const log=path.join(updates,name,'worker.log');if(fs.existsSync(log))console.error(fs.readFileSync(log,'utf8'));}}catch{}}
  throw error;
 }finally{
  if(bundle){try{const stateFile=path.join(bundle,'data','launcher-state.json');if(fs.existsSync(stateFile)){state=JSON.parse(fs.readFileSync(stateFile,'utf8'));await control('stop',{});await sleep(1200);}}catch{}}
  const target=path.resolve(temp);if(!target.startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('Unsafe cleanup path.');fs.rmSync(target,{recursive:true,force:true,maxRetries:20,retryDelay:250});
 }
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
