const fs=require('fs'),path=require('path'),{spawn,execFile}=require('child_process');
const executable=path.join(process.env.ProgramFiles||'C:\\Program Files','Tailscale','tailscale.exe');
const execute=args=>new Promise((resolve,reject)=>execFile(executable,args,{windowsHide:true,timeout:10000},(error,out,err)=>error?reject(Error(String(err||out||error.message))):resolve(out)));
function createRemote({port,dataDir}){
 let state={installed:fs.existsSync(executable),busy:false,ready:false,message:'Optional: sign in to your own Tailscale account for a fixed public address.',links:[],url:null},job;
 function capture(text){state.message=(state.message+'\n'+text).slice(-3000);for(const url of text.match(/https:\/\/[^\s<>"']+/g)||[])try{const parsed=new URL(url);if(parsed.hostname==='login.tailscale.com'&&!state.links.includes(parsed.href))state.links.push(parsed.href);}catch{}}
 async function update(){state.installed=fs.existsSync(executable);if(!state.installed)return;try{const status=JSON.parse(await execute(['status','--json']));state.signedIn=status.BackendState==='Running';const hostname=String(status.Self?.DNSName||'').replace(/\.$/,'');if(/^[a-z0-9.-]+\.ts\.net$/i.test(hostname))state.url='https://'+hostname;}catch(error){state.message=error.message;}}
 function start(action){
  if(state.busy)throw Error('A Tailscale step is already running. Complete it in the browser first.');
  if(!['install','login','enable','check'].includes(action))throw Error('Unknown Tailscale action.');
  state.busy=true;state.links=[];state.message='Working…';
  if(action==='check'){update().finally(()=>state.busy=false);return;}
  const file=action==='install'?'winget.exe':executable;
  if(action!=='install'&&!fs.existsSync(executable)){state.busy=false;throw Error('Install Tailscale first.');}
  const args=action==='install'?['install','--source','winget','--id','Tailscale.Tailscale','--exact','--silent','--accept-package-agreements','--accept-source-agreements','--disable-interactivity']:action==='login'?['up','--accept-dns=false','--accept-routes=false']:['funnel','--bg','--yes','http://127.0.0.1:'+port];
  job=spawn(file,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});job.stdout.on('data',b=>capture(String(b)));job.stderr.on('data',b=>capture(String(b)));
  const timeout=setTimeout(()=>{job?.kill();state.busy=false;capture('Complete the link shown above, then retry this step.');},180000);
  job.once('error',error=>{clearTimeout(timeout);state.busy=false;capture(error.message);});
  job.once('exit',async code=>{clearTimeout(timeout);await update();if(action==='enable'&&code===0&&state.url){state.ready=true;fs.writeFileSync(path.join(dataDir,'network.json'),JSON.stringify({publicUrl:state.url,allowedOrigins:[state.url]})+'\n');}state.busy=false;if(code===0)capture(action==='enable'?'Public access is ready.':'Step completed.');});
 }
 return {state:()=>({...state,links:[...state.links]}),start,close(){job?.kill();}};
}
module.exports={createRemote};
