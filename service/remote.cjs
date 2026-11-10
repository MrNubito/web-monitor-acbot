const fs=require('fs'),path=require('path');
const {spawn}=require('child_process');
const {dataDir}=require('./runtime-host');
const defaultOrigin='https://mrnubito.github.io';
function remoteNetwork(previous,address,websiteOrigin=defaultOrigin){
  const url=new URL(address),website=new URL(websiteOrigin);
  if(url.protocol!=='https:'||!/^[-a-z0-9]+\.trycloudflare\.com$/.test(url.hostname)||url.origin!==address)throw Error('Invalid Cloudflare tunnel address.');
  if(website.protocol!=='https:'||website.origin!==websiteOrigin)throw Error('Set an exact HTTPS website origin.');
  return {...previous,publicUrl:url.origin,allowedOrigins:[...new Set([...(previous.allowedOrigins||[]),website.origin,url.origin])]};
}
async function startRemote(){
  if(!fs.existsSync(path.join(dataDir,'access.json')))throw Error('Create your web access password first with npm run setup.');
  const binary=process.env.CLOUDFLARED_PATH||path.join(dataDir,'bin','cloudflared.exe');
  if(!fs.existsSync(binary))throw Error('Install the official connector first: npm run tunnel:install');
  const projectRoot=path.resolve(__dirname,'..'),port=Number(process.env.PORT||17942);
  const local='http://127.0.0.1:'+port,networkFile=path.join(dataDir,'network.json'),statusFile=path.join(dataDir,'remote-status.json'),lockFile=path.join(dataDir,'remote.lock');
  function readNetwork(){try{return JSON.parse(fs.readFileSync(networkFile,'utf8'));}catch(error){if(error.code==='ENOENT')return {};throw Error('data/network.json is invalid JSON.');}}
  try{const pid=Number(fs.readFileSync(lockFile,'utf8'));if(pid){let alive=false;try{process.kill(pid,0);alive=true;}catch{}if(alive)throw Error('A remote connection is already running. Use its existing address or stop it before opening another.');}}catch(error){if(error.code!=='ENOENT')throw error;}
  fs.writeFileSync(lockFile,String(process.pid));
  let ownedServer=null,tunnel=null,address=null,stopping=false;
  const previous=readNetwork();
  const website=process.env.WEB_WEBSITE_ORIGIN||defaultOrigin;
  function stop(code=0){
    if(stopping)return;stopping=true;
    try{tunnel?.kill();}catch{}try{ownedServer?.kill();}catch{}
    try{
      const current=readNetwork();
      if(address&&current.publicUrl===address){
        if(previous.publicUrl)current.publicUrl=previous.publicUrl;else delete current.publicUrl;
        if(!(previous.allowedOrigins||[]).includes(address))current.allowedOrigins=(current.allowedOrigins||[]).filter(origin=>origin!==address);
        fs.writeFileSync(networkFile,JSON.stringify(current,null,2));
      }
      if(Number(fs.readFileSync(lockFile,'utf8'))===process.pid)fs.unlinkSync(lockFile);
      fs.writeFileSync(statusFile,JSON.stringify({state:'stopped',stoppedAt:new Date().toISOString()}));
    }catch(error){console.error('Remote cleanup: '+error.message);}
    console.log('Remote connection stopped.');process.exitCode=code;
  }
  process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
  async function localReady(){try{const res=await fetch(local,{signal:AbortSignal.timeout(1500)});return res.ok&&(await res.text()).includes('ACBot');}catch{return false;}}
  try{
    if(!await localReady()){
      console.log('Starting the independent PC agent…');
      ownedServer=spawn(process.execPath,[path.join(__dirname,'server.cjs')],{cwd:projectRoot,windowsHide:true,stdio:['ignore','pipe','pipe']});
      ownedServer.stdout.on('data',chunk=>process.stdout.write(chunk));ownedServer.stderr.on('data',chunk=>process.stderr.write(chunk));
      ownedServer.on('error',error=>{console.error(error.message);stop(1);});
      const deadline=Date.now()+15000;while(!stopping&&Date.now()<deadline&&!await localReady())await new Promise(resolve=>setTimeout(resolve,500));
      if(stopping)return;if(!await localReady())throw Error('The local PC agent did not start.');
      ownedServer.on('exit',()=>{if(!stopping){console.error('The local PC agent exited.');stop(1);}});
    }
    console.log('Opening a temporary HTTPS connection. Your existing web password is still required.');
    tunnel=spawn(binary,['tunnel','--no-autoupdate','--protocol','http2','--url',local],{cwd:projectRoot,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let recent='';
    function output(chunk){
      const text=chunk.toString();process.stdout.write(text);recent=(recent+text).slice(-12000);
      const found=recent.match(/https:\/\/[-a-z0-9]+\.trycloudflare\.com/);
      if(found&&!address){
        address=new URL(found[0]).origin;
        fs.writeFileSync(networkFile,JSON.stringify(remoteNetwork(previous,address,website),null,2));
        fs.writeFileSync(statusFile,JSON.stringify({state:'starting',url:address,website:website+'/web-monitor-acbot/',pid:process.pid,startedAt:new Date().toISOString()},null,2));
        console.log('\nPC AGENT ADDRESS: '+address+'\nWEBSITE: '+website+'/web-monitor-acbot/\nUse your existing web password. Keep this process and your PC running.\nThis temporary address changes when the tunnel restarts.\n');
      }
      if(address&&/Registered tunnel connection/.test(text))fs.writeFileSync(statusFile,JSON.stringify({state:'connected',url:address,website:website+'/web-monitor-acbot/',pid:process.pid,updatedAt:new Date().toISOString()},null,2));
    }
    tunnel.stdout.on('data',output);tunnel.stderr.on('data',output);
    tunnel.on('error',error=>{console.error('Cloudflare Tunnel: '+error.message);stop(1);});
    tunnel.on('exit',code=>{if(!stopping){console.error('Cloudflare Tunnel exited ('+code+').');stop(code||1);}});
  }catch(error){console.error(error.message);stop(1);}
}
if(require.main===module)startRemote().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={remoteNetwork,startRemote};
