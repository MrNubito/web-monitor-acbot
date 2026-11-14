const fs=require('fs'),path=require('path'),crypto=require('crypto'),http=require('http'),net=require('net'),{spawn,fork,execFile,execFileSync}=require('child_process');
const root=path.resolve(__dirname,'..'),dataDir=path.join(root,'data');process.env.ACBOT_WEB_DATA=dataDir;fs.mkdirSync(dataDir,{recursive:true});
const background=process.argv.includes('--background');
function record(event,details={}){try{const file=path.join(dataDir,'supervisor.log');if(fs.existsSync(file)&&fs.statSync(file).size>1024*1024){const old=file+'.previous';if(fs.existsSync(old))fs.unlinkSync(old);fs.renameSync(file,old);}fs.appendFileSync(file,JSON.stringify({at:new Date().toISOString(),event,...details})+'\n');}catch{}}
const stateFile=path.join(dataDir,'launcher-state.json'),settingsFile=path.join(dataDir,'portable.json');
const request=(state,route,method='GET')=>new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port:state.controlPort,path:route,method,headers:{'X-Setup-Token':state.token},timeout:1500},res=>{let body='';res.on('data',b=>body+=b);res.on('end',()=>{try{resolve({status:res.statusCode,...JSON.parse(body)});}catch{reject(Error('Invalid launcher response'));}});});req.on('error',reject);req.on('timeout',()=>req.destroy(Error('Launcher not available')));req.end();});
function open(url){if(!background&&process.env.ACBOT_NO_BROWSER!=='1')execFile('rundll32.exe',['url.dll,FileProtocolHandler',url],{windowsHide:true},()=>{});console.log('Open: '+url);}
function available(port){return new Promise(resolve=>{const probe=net.createServer();probe.once('error',()=>resolve(false));probe.listen(port,'127.0.0.1',()=>probe.close(()=>resolve(true)));});}
async function choosePort(preferred){for(let port=preferred;port<preferred+30;port++)if(await available(port))return port;throw Error('No free local agent port found.');}
function startupFile(){return 'ACBot-Web-Monitor-'+crypto.createHash('sha256').update(root.toLowerCase()).digest('hex').slice(0,8);}
function setStartup(enabled){
 const name=startupFile(),key='HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',exe=path.join(root,'ACBot Web Monitor.exe'),statusFile=path.join(dataDir,'recovery-task.json');
 if(!enabled){for(const args of [['delete',key,'/v',name,'/f']])try{execFileSync('reg.exe',args,{windowsHide:true,stdio:'ignore'});}catch{}try{execFileSync('schtasks.exe',['/Delete','/TN',name,'/F'],{windowsHide:true,stdio:'ignore'});}catch{}fs.writeFileSync(statusFile,JSON.stringify({enabled:false})+'\n');return;}
 if(!fs.existsSync(exe))throw Error('Windows startup is available in the built portable package.');
 execFileSync('reg.exe',['add',key,'/v',name,'/t','REG_SZ','/d','"'+exe+'" --background','/f'],{windowsHide:true,stdio:'ignore'});
 let previous;try{previous=JSON.parse(fs.readFileSync(statusFile,'utf8'));}catch{}
 if(previous?.enabled&&previous.exe===exe)return;
 try{execFileSync('schtasks.exe',['/Create','/SC','MINUTE','/MO','2','/TN',name,'/TR','"'+exe+'" --background','/IT','/F'],{windowsHide:true,stdio:'pipe'});fs.writeFileSync(statusFile,JSON.stringify({enabled:true,exe,task:name,at:Date.now()})+'\n');record('windows-recovery-enabled',{task:name});}
 catch(error){fs.writeFileSync(statusFile,JSON.stringify({enabled:false,exe,error:error.message})+'\n');record('windows-recovery-unavailable',{message:error.message});}
}
async function main(){
 const paused=path.join(dataDir,'stopped.json');if(background&&fs.existsSync(paused))return;if(!background&&fs.existsSync(paused))fs.unlinkSync(paused);
 let previous;try{previous=JSON.parse(fs.readFileSync(stateFile,'utf8'));const response=await request(previous,'/api/health');if(response.status===200&&response.app==='ACBot Portable'){open(response.configured?previous.dashboard:previous.setup);return;}}catch{}
 const updateDir=path.join(dataDir,'updates'),updateLock=path.join(updateDir,'install.lock');
 if(fs.existsSync(updateLock)){
  let lock;try{lock=JSON.parse(fs.readFileSync(updateLock,'utf8'));}catch{throw Error('Update recovery is needed. Inspect data/updates/status.json.');}
  if(process.env.ACBOT_UPDATE_JOB!==lock.job){
   let alive=false;if(lock.pid)try{process.kill(lock.pid,0);alive=true;}catch{}
   if(alive)throw Error('An update is still running. Please wait before reopening the monitor.');
   const work=path.join(updateDir,String(lock.job));
   if(!/^[a-f0-9]{32}$/.test(lock.job))throw Error('Invalid update lock.');
   if(fs.existsSync(path.join(work,'journal.json'))){const child=spawn(path.join(work,'runner.exe'),[path.join(work,'worker.cjs'),path.join(work,'plan.json'),'--recover'],{cwd:work,windowsHide:true,detached:true,stdio:'ignore'});child.unref();return;}
   fs.unlinkSync(updateLock);
  }
 }

 const launcherLock=path.join(dataDir,'launcher.lock');let claimed=false;
 for(let attempt=0;attempt<20;attempt++){
  try{fs.writeFileSync(launcherLock,JSON.stringify({pid:process.pid})+'\n',{flag:'wx'});claimed=true;break;}
  catch(error){if(error.code!=='EEXIST')throw error;let other;try{other=JSON.parse(fs.readFileSync(launcherLock,'utf8'));}catch{}let alive=false;if(other?.pid)try{process.kill(other.pid,0);alive=true;}catch{}if(!alive){try{fs.unlinkSync(launcherLock);}catch{}continue;}if(attempt===19){record('launcher-already-running',{pid:other.pid});return;}await new Promise(r=>setTimeout(r,250));}
 }
 if(!claimed)throw Error('Could not acquire the launcher lock. Retry Start.');
 process.once('exit',()=>{try{if(JSON.parse(fs.readFileSync(launcherLock,'utf8')).pid===process.pid)fs.unlinkSync(launcherLock);}catch{}});
 const {createSetupServer}=require('./setup-server.cjs'),{createRemote}=require('./remote.cjs'),{createSupervisor}=require('./supervisor.cjs'),{createConnectionGuard}=require('./connection-guard.cjs');
 let settings;try{settings=JSON.parse(fs.readFileSync(settingsFile,'utf8'));}catch{}
 const configured=()=>fs.existsSync(path.join(dataDir,'access.json'))&&fs.existsSync(settingsFile);
 const preferred=Number(process.env.PORT||settings?.port||17942),ownerFile=path.join(dataDir,'agent-owner.key');
 if(fs.existsSync(ownerFile)&&!await available(preferred)){
  const ownerRequest=method=>new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port:preferred,path:'/api/local-agent',method,headers:{'X-Agent-Owner':fs.readFileSync(ownerFile,'utf8').trim()},timeout:2000},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>{try{resolve({status:res.statusCode,...JSON.parse(text)});}catch{resolve({status:res.statusCode});}});});req.on('error',reject);req.on('timeout',()=>req.destroy(Error('Timeout')));req.end();});
  let proof;try{proof=await ownerRequest('GET');}catch{}
  if(proof?.status===200&&proof.app==='ACBotAgent'&&proof.root.toLowerCase()===fs.realpathSync(root).toLowerCase()){
   record('recovering-orphan-agent',{});await ownerRequest('POST');let released=false;for(let attempt=0;attempt<60;attempt++){if(await available(preferred)){released=true;break;}await new Promise(r=>setTimeout(r,150));}if(!released)throw Error('The previous agent did not shut down. Check data/agent.log.');
  }
 }
 const port=await choosePort(preferred);
 const token=crypto.randomBytes(32).toString('hex'),remote=createRemote({port,dataDir});let stopping=false,wizard,supervisor,connectionGuard;
 async function probe(){return new Promise(resolve=>{const req=http.get('http://127.0.0.1:'+port+'/api/status',res=>{res.resume();resolve(res.statusCode===401);});req.on('error',()=>resolve(false));req.setTimeout(1500,()=>{req.destroy();resolve(false);});});}
 async function startAgent(options){
  if(supervisor)return;
  supervisor=createSupervisor({probe,log:record,launch:()=>{
   const file=path.join(dataDir,'agent.log');if(fs.existsSync(file)&&fs.statSync(file).size>10*1024*1024){const old=file+'.previous';if(fs.existsSync(old))fs.unlinkSync(old);fs.renameSync(file,old);}
   const fd=fs.openSync(file,'a');const child=fork(path.join(root,'service','server.cjs'),options.lan?['--lan']:[],{cwd:root,execPath:process.execPath,env:{...process.env,PORT:String(port),ACBOT_WEB_DATA:dataDir},windowsHide:true,stdio:['ignore',fd,fd,'ipc']});fs.closeSync(fd);record('spawn',{pid:child.pid});return child;
  }});await supervisor.start();
  if(options.remote){
   const ts=path.join(process.env.ProgramFiles||'C:\\Program Files','Tailscale','tailscale.exe');
   const execute=(file,args)=>new Promise((resolve,reject)=>execFile(file,args,{env:{...process.env,PORT:String(port),ACBOT_WEB_DATA:dataDir},windowsHide:true,timeout:25000},(error,out,err)=>error?reject(Error(String(err||out||error.message).slice(-1200))):resolve(out)));
   connectionGuard=createConnectionGuard({inspect:async()=>{
    const status=JSON.parse(await execute(ts,['status','--json']));if(status.BackendState!=='Running')return {backend:status.BackendState};
    const config=JSON.parse(await execute(ts,['funnel','status','--json'])),text=JSON.stringify(config),expected='http://127.0.0.1:'+port;
    const present=text.includes(expected),enabled=Object.values(config.AllowFunnel||{}).some(Boolean),hostname=String(status.Self?.DNSName||'').replace(/\.$/,'');let saved={};try{saved=JSON.parse(fs.readFileSync(path.join(dataDir,'network.json'),'utf8'));}catch{}
    return {backend:'Running',ready:present&&enabled&&saved.publicUrl==='https://'+hostname,conflict:!present&&text.includes('"Proxy"')};
   },repair:()=>execute(process.execPath,[path.join(root,'service','funnel.cjs')]),record:state=>{fs.writeFileSync(path.join(dataDir,'remote-health.json'),JSON.stringify(state)+'\n');record('remote',state);}});connectionGuard.start();
  }
 }
 async function stop({pause=false}={}){if(stopping)return;stopping=true;if(pause)fs.writeFileSync(path.join(dataDir,'stopped.json'),JSON.stringify({at:Date.now(),reason:'Stopped by user'})+'\n');connectionGuard?.stop();remote.close();await supervisor?.stop();wizard.close();try{const current=JSON.parse(fs.readFileSync(stateFile,'utf8'));if(current.token===token)fs.unlinkSync(stateFile);}catch{}record('launcher-stopped',{pause});process.exit(0);}
 wizard=createSetupServer({token,configured,remote,onStop:stop,onHealth:()=>({supervision:supervisor?.status||null}),onFinish:async input=>{
  if(configured())throw Error('This portable copy is already configured.');
  const engine=require('../service/agent/app/main');engine.ensureRuntimeFiles();
  const instances=input.instances.map(i=>[i.id,i.label,i.root,i.device,i.version,'false',i.emulator,i.emulatorIndex].join('|')).join(';');
  engine.writeEnv({...engine.configFromEnv(),discordToken:'',autoControlInstances:instances,autoControlAdbPath:input.adb,logs:input.instances.map(i=>({name:i.label,path:path.join(i.root,'logs')})),autoStartBot:'false',autoControlEnabled:'false',mobileControlEnabled:'false'});
  const saved={port,lan:input.lan,remote:input.remote,startup:input.startup};setStartup(input.startup);
  require('../service/auth.cjs').createAuth(dataDir).setPassword(input.password);fs.writeFileSync(settingsFile,JSON.stringify(saved,null,2)+'\n');
  await startAgent(saved);return {ok:true,url:'http://127.0.0.1:'+port,publicUrl:input.remote?remote.state().url:null};
 }});
 await new Promise(resolve=>wizard.listen(0,'127.0.0.1',resolve));
 const setup='http://127.0.0.1:'+wizard.address().port+'/#'+token,dashboard='http://127.0.0.1:'+port;
 fs.writeFileSync(stateFile,JSON.stringify({controlPort:wizard.address().port,token,setup,dashboard})+'\n',{mode:0o600});
 if(configured()){
  settings={...settings,port};fs.writeFileSync(settingsFile,JSON.stringify(settings,null,2)+'\n');
  if(settings.startup)try{setStartup(true);}catch(error){record('startup-error',{message:error.message});}
  await startAgent(settings);
  open(dashboard);
 }else open(setup);
 process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());
}
if(require.main===module)main().catch(error=>{console.error(error.message);fs.appendFileSync(path.join(dataDir,'launcher-error.log'),new Date().toISOString()+' '+error.stack+'\n');process.exitCode=1;});
module.exports={request,choosePort,startupFile,setStartup};
