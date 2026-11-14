const fs=require('fs'),path=require('path'),os=require('os'),{spawn,execFileSync}=require('child_process');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(test){for(let n=0;n<100;n++){try{const value=await test();if(value)return value;}catch{}await sleep(150);}throw Error('Portable smoke test timed out.');}
async function main(){
 const archive=path.resolve(process.argv[2]||'');if(!archive.endsWith('.zip')||!fs.existsSync(archive))throw Error('Pass the portable ZIP path.');
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ACBot Portable QA '));let state,bundle;
 const call=async(route,body)=>{const response=await fetch('http://127.0.0.1:'+state.controlPort+'/api/'+route,{method:body===undefined?'GET':'POST',headers:{'X-Setup-Token':state.token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw Error(data.error);return data;};
 try{
  const entries=execFileSync('tar.exe',['-tf',archive],{encoding:'utf8'}).split(/\r?\n/).filter(Boolean);
  const leaked=entries.filter(n=>/\/data\/.+|\/node_modules\/|\/\.env(?:$|\.)|access\.json|account-history\.db|license\.key|launcher-state/i.test(n));if(leaked.length)throw Error('Private files found in portable ZIP: '+leaked.join(','));
  execFileSync('tar.exe',['-xf',archive,'-C',temp],{windowsHide:true});bundle=path.join(temp,fs.readdirSync(temp)[0]);
  const runtime=execFileSync(path.join(bundle,'runtime','node.exe'),['--version'],{encoding:'utf8'}).trim();
  const start=()=>{const child=spawn(path.join(bundle,'ACBot Web Monitor.exe'),[],{windowsHide:true,detached:true,stdio:'ignore',env:{...process.env,ACBOT_NO_BROWSER:'1',PORT:'19042'}});child.unref();};
  const statePath=path.join(bundle,'data','launcher-state.json');start();state=await waitFor(()=>fs.existsSync(statePath)&&JSON.parse(fs.readFileSync(statePath,'utf8')));
  const health=await call('health');if(health.configured)throw Error('Fresh ZIP unexpectedly has existing settings.');
  const fixture=path.join(temp,'Fixture ACBot');fs.mkdirSync(path.join(fixture,'profiles','demo'),{recursive:true});fs.writeFileSync(path.join(fixture,'ACBot.exe'),'test fixture');fs.writeFileSync(path.join(fixture,'profiles','demo','config.json'),'{}');fs.mkdirSync(path.join(fixture,'logs','stats'),{recursive:true});fs.writeFileSync(path.join(fixture,'logs','stats','session-1.json'),JSON.stringify({runtime_seconds:60,total_attacks:2,gold_gained:1000,upgrades_done:3}));
  const settings={instances:[{root:fixture,label:'Demo',device:'',emulator:'auto',version:'pro'}],adb:'',password:'portable-test-passphrase',startup:false,lan:false,remote:false};
  const diagnostic=await call('probe',settings);if(diagnostic.statistics!=='Statistics found')throw Error('Statistics diagnostic failed.');
  const finished=await call('finish',settings);if(!finished.url)throw Error('No dashboard address.');
  const signed=await fetch(finished.url+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:settings.password})}).then(r=>r.json());if(!signed.token)throw Error('Own password did not work.');
  const statistics=await fetch(finished.url+'/api/instances/instance-1/stats',{headers:{Authorization:'Bearer '+signed.token}}).then(r=>r.json());if(statistics.stats.upgrades_done!==3)throw Error('Own instance configuration did not load.');
  const savedToken=state.token;start();await sleep(800);if(JSON.parse(fs.readFileSync(statePath,'utf8')).token!==savedToken)throw Error('A duplicate launcher was started.');
  const stop=spawn(path.join(bundle,'Stop ACBot Web Monitor.exe'),[],{windowsHide:true,detached:true,stdio:'ignore'});stop.unref();await waitFor(()=>!fs.existsSync(statePath));
  start();state=await waitFor(()=>fs.existsSync(statePath)&&JSON.parse(fs.readFileSync(statePath,'utf8')));await waitFor(async()=>{try{return (await fetch(finished.url+'/api/status')).status===401;}catch{return false;}});
  const restarted=await fetch(finished.url+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:settings.password})}).then(r=>r.json());if(!restarted.token)throw Error('Settings were not preserved on restart.');
  await call('stop',{});await waitFor(()=>!fs.existsSync(statePath));state=null;
  console.log(JSON.stringify({passed:true,runtime,files:entries.length,privateFilesExcluded:true,firstRun:true,ownPassword:true,ownStatistics:true,duplicateLaunchPrevented:true,stopAndRestart:true},null,2));
 }finally{
  if(state){try{await call('stop',{});await sleep(1200);}catch{}}
  const target=path.resolve(temp);if(!target.startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('Unsafe QA cleanup path.');
  fs.rmSync(target,{recursive:true,force:true,maxRetries:10,retryDelay:200});
 }
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
