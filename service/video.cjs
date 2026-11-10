const fs=require('fs');
const {spawn,execFile}=require('child_process');
const exec=(file,args)=>new Promise((resolve,reject)=>execFile(file,args,{windowsHide:true,timeout:10000,maxBuffer:1024*1024},(e,out)=>e?reject(e):resolve(out)));
function createVideoService({engine,spawnProcess=spawn,execCommand=exec}){
 const sessions=new Map();
 async function stream(instance,req,res){
  const config=engine.mobileConfig();
  if(!instance.device)throw Error('Configure an ADB device for this instance first.');
  if(!fs.existsSync(config.adbPath))throw Error('The configured ADB executable was not found.');
  try{await execCommand(config.adbPath,['-s',instance.device,'get-state']);}catch{await exec(config.adbPath,['connect',instance.device]);}
  if(res.destroyed)return;
  const query=new URL(req.url,'http://localhost').searchParams;
  const quality=query.get('quality')==='low'?'low':query.get('quality')==='high'?'high':'normal';
  const maxSide={low:640,normal:960,high:1280}[quality],bitrate={low:1000000,normal:2500000,high:5000000}[quality];
  const png=await engine.captureMobileAdbScreen(config,instance);
  if(res.destroyed)return;
  if(png.length<24)throw Error('Could not determine emulator screen size.');
  const width=png.readUInt32BE(16),height=png.readUInt32BE(20),scale=Math.min(1,maxSide/Math.max(width,height));
  const size=Math.max(16,Math.round(width*scale/16)*16)+'x'+Math.max(16,Math.round(height*scale/16)*16);
  if(sessions.size>=4&&!sessions.has(instance.id))throw Error('Too many live video sessions. Stop another live view first.');
  sessions.get(instance.id)?.();
  const child=spawnProcess(config.adbPath,['-s',instance.device,'exec-out','screenrecord','--output-format=h264','--size',size,'--bit-rate',String(bitrate),'--time-limit','175','-'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let stopped=false,stderr='';
  const stop=()=>{if(stopped)return;stopped=true;clearTimeout(startTimeout);clearTimeout(slowTimeout);child.kill();if(!res.destroyed&&!res.writableEnded)res.end();if(sessions.get(instance.id)===stop)sessions.delete(instance.id);};
  let slowTimeout;
  const startTimeout=setTimeout(()=>{if(!res.headersSent){res.writeHead(504,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'The emulator did not start the video encoder.'}));}stop();},15000);
  sessions.set(instance.id,stop);res.once('close',stop);
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-2000);});
  child.stdout.on('data',chunk=>{
   if(stopped||res.destroyed)return;
   clearTimeout(startTimeout);
   if(!res.headersSent)res.writeHead(200,{'Content-Type':'video/avc','Cache-Control':'no-store','X-Accel-Buffering':'no'});
   if(!res.write(chunk)){
    child.stdout.pause();
    slowTimeout=setTimeout(()=>{stop();res.destroy();},5000);
    res.once('drain',()=>{clearTimeout(slowTimeout);if(!stopped)child.stdout.resume();});
   }
  });
  function finish(error){if(stopped)return;const message=error?.message||stderr.trim()||'Video capture ended before producing frames.';if(!res.headersSent){res.writeHead(502,{'Content-Type':'application/json'});res.end(JSON.stringify({error:message}));}else res.end();stop();}
  child.once('error',finish);child.once('exit',()=>finish());
 }
 return {stream,stopAll(){for(const stop of sessions.values())stop();}};
}
module.exports={createVideoService};
