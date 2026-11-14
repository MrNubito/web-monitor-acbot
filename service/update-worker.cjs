const fs=require('fs'),path=require('path'),http=require('http'),{spawn}=require('child_process');
const {managed,target,validateBundle}=require('./update-package.cjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const read=(file,fallback=null)=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return fallback;}};
function httpCall(state,route,method='GET',port=state.controlPort){return new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port,path:route,method,headers:{'X-Setup-Token':state.token||''},timeout:1000},res=>{let text='';res.on('data',part=>text+=part);res.on('end',()=>{let body={};try{body=JSON.parse(text);}catch{}resolve({status:res.statusCode,...body});});});req.on('error',reject);req.on('timeout',()=>req.destroy(Error('Timeout')));req.end();});}
async function retry(action){for(let n=0;n<20;n++){try{return action();}catch(error){if(n===19)throw error;await sleep(250);}}}
function erase(root,name){const file=target(root,name);if(fs.existsSync(file))fs.rmSync(file,{recursive:true,force:true});}
async function executePlan(plan,{stop,start,healthy,failAfter=()=>{},recover=false}={}){
 if(!/^[a-f0-9]{32}$/.test(plan.job))throw Error('Invalid update job.');
 const root=fs.realpathSync(plan.root),dataDir=path.resolve(plan.dataDir);
 if(dataDir.toLowerCase()!==path.join(root,'data').toLowerCase())throw Error('Updates must use the portable data folder.');
 const dir=path.join(dataDir,'updates'),work=path.join(dir,plan.job),backup=path.join(dir,'backups',plan.job),app=path.join(backup,'app'),journalFile=path.join(work,'journal.json'),lock=path.join(dir,'install.lock'),statusFile=path.join(dir,'status.json');
 if(read(lock)?.job!==plan.job)throw Error('The update lock no longer belongs to this job.');
 const write=(phase,message)=>fs.writeFileSync(statusFile,JSON.stringify({job:plan.job,phase,message,targetVersion:plan.targetVersion,at:Date.now()})+'\n');
 const lockBeat=()=>fs.writeFileSync(lock,JSON.stringify({job:plan.job,pid:process.pid,at:Date.now()})+'\n');lockBeat();const beat=setInterval(lockBeat,3000);beat.unref();
 let journal=read(journalFile),committed=false,stopped=false;
 const save=()=>fs.writeFileSync(journalFile,JSON.stringify(journal)+'\n');
 const stopAgent=stop||async function(){const file=path.join(dataDir,'launcher-state.json'),state=read(file);if(!state)return;try{await httpCall(state,'/api/stop','POST');}catch{}for(let n=0;n<80;n++){if(!fs.existsSync(file))return;try{await httpCall(state,'/api/health');}catch{return;}await sleep(150);}throw Error('The portable agent did not stop. No program files were replaced.');};
 const startAgent=start||async function(){const child=spawn(path.join(root,'runtime','node.exe'),[path.join(root,'portable','launcher.cjs')],{cwd:root,env:{...process.env,ACBOT_UPDATE_JOB:plan.job,ACBOT_NO_BROWSER:'1'},windowsHide:true,detached:true,stdio:'ignore'});child.unref();};
 const isHealthy=healthy||async function(){const state=read(path.join(dataDir,'launcher-state.json'));if(!state)return false;try{const control=await httpCall(state,'/api/health');if(control.app!=='ACBot Portable'||!control.configured)return false;const url=new URL(state.dashboard);return (await httpCall(state,'/api/status','GET',Number(url.port))).status===401;}catch{return false;}};
 async function waitHealthy(){const until=Date.now()+Math.max(3000,Math.min(60000,plan.healthTimeout||45000));while(Date.now()<until){if(await isHealthy())return;await sleep(250);}throw Error('The updated agent failed its startup check.');}
 async function restore(){
  if(!journal)return;
  for(const name of managed){const old=path.join(app,name);if(fs.existsSync(old)){await retry(()=>erase(root,name));await retry(()=>fs.renameSync(old,target(root,name)));}else if(!journal.old.includes(name))await retry(()=>erase(root,name));}
 }
 try{
  if(recover){
   await stopAgent();if(journal?.committed){await startAgent();await waitHealthy();committed=true;write('completed','Update recovered and running.');return;}
   await restore();await startAgent();await waitHealthy();write('rolled-back','An interrupted update was recovered. The previous version is running.');return;
  }
  const actual=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
  if(actual!==plan.fromVersion)throw Error('The installed version changed before this update started.');
  const source=fs.realpathSync(plan.source);if(!source.toLowerCase().startsWith((work+path.sep).toLowerCase()))throw Error('Invalid update staging folder.');
  validateBundle(source,plan.targetVersion);
  write('installing','Stopping the agent and backing up your files…');await stopAgent();stopped=true;
  fs.mkdirSync(app,{recursive:true});const snapshot=path.join(backup,'data');fs.mkdirSync(snapshot);
  for(const item of fs.readdirSync(dataDir))if(!['updates','launcher-state.json'].includes(item))fs.cpSync(path.join(dataDir,item),path.join(snapshot,item),{recursive:true,dereference:false});
  journal={old:managed.filter(name=>fs.existsSync(target(root,name))),installed:[],committed:false};save();
  fs.writeFileSync(path.join(backup,'metadata.json'),JSON.stringify({id:plan.job,version:plan.fromVersion,root,createdAt:Date.now()})+'\n');
  for(const name of journal.old){await retry(()=>fs.renameSync(target(root,name),path.join(app,name)));failAfter('backup:'+name);}
  for(const name of managed)if(fs.existsSync(path.join(source,name))){await retry(()=>fs.renameSync(path.join(source,name),target(root,name)));journal.installed.push(name);save();failAfter('install:'+name);}
  write('installing','Starting the updated agent…');await startAgent();await waitHealthy();
  fs.writeFileSync(path.join(dir,'previous.json'),JSON.stringify({id:plan.job,version:plan.fromVersion})+'\n');journal.committed=true;save();committed=true;
  write(plan.mode==='rollback'?'rolled-back':'completed',plan.mode==='rollback'?'The previous version is running.':'Update installed successfully. Sign in again to continue.');
 }catch(error){
  try{if(journal&&!journal.committed){await stopAgent();await restore();await startAgent();await waitHealthy();write('rolled-back','Update failed; the previous version was restored. '+error.message);}else{if(stopped){await startAgent();await waitHealthy();}write('error',error.message);}}
  catch(rollbackError){write('error','Automatic recovery needs attention: '+rollbackError.message+'. Your data and backup remain in the data folder.');throw rollbackError;}
 }finally{
  clearInterval(beat);
  // Keep the lock if recovery failed, so the launcher can retry recovery safely.
  const state=read(statusFile);if(['completed','rolled-back'].includes(state?.phase)||!journal)if(read(lock)?.job===plan.job)fs.unlinkSync(lock);
 }
}
if(require.main===module){const plan=read(process.argv[2]);executePlan(plan,{recover:process.argv.includes('--recover')}).catch(error=>{console.error(error.stack);process.exitCode=1;});}
module.exports={executePlan};
