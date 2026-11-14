function createSupervisor({launch,probe,log=()=>{},interval=20000,failures=3,startupTimeout=10000,shutdownTimeout=7000,retryBase=1000,retryMax=60000}){
 let child=null,stopped=true,busy=false,timer=null,retry=null,failed=0,attempts=0,startedAt=0,restarting=false;
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 function schedule(){if(stopped||retry)return;const delay=Math.min(retryMax,retryBase*2**Math.min(attempts++,8));log('retry',{delay});retry=setTimeout(()=>{retry=null;void ensure();},delay);}
 async function terminate(){const current=child;if(!current)return;restarting=true;await new Promise(resolve=>{let done=false;const finish=()=>{if(done)return;done=true;clearTimeout(timeout);resolve();};const timeout=setTimeout(()=>{current.kill();finish();},shutdownTimeout);current.once('exit',finish);try{if(current.connected)current.send({type:'shutdown'});else current.kill();}catch{current.kill();}});if(child===current)child=null;restarting=false;}
 async function ensure(){
  if(stopped||busy)return;busy=true;
  try{
   if(child)return;
   const current=launch();child=current;startedAt=Date.now();
   current.once('error',error=>{log('spawn-error',{message:error.message});if(child===current)child=null;if(!busy&&!restarting)schedule();});
   current.once('exit',(code,signal)=>{if(child!==current)return;child=null;failed=0;log('exit',{code,signal,intentional:stopped||restarting});if(!stopped&&!restarting&&!busy)schedule();});
   const until=Date.now()+startupTimeout;let ready=false;
   while(!stopped&&child===current&&Date.now()<until){try{ready=await probe();}catch{}if(ready)break;await sleep(100);}
   if(stopped)return;
   if(!ready||child!==current)throw Error('Agent startup did not become healthy.');
   failed=0;log('ready',{pid:current.pid});
  }catch(error){log('start-error',{message:error.message});await terminate();schedule();}
  finally{busy=false;}
 }
 async function check(){if(stopped||busy||restarting)return;if(!child){schedule();return;}busy=true;try{let healthy=false;try{healthy=await probe();}catch{}if(healthy){failed=0;if(Date.now()-startedAt>60000)attempts=0;return;}failed++;log('health-failed',{count:failed});if(failed>=failures){log('restarting-unresponsive',{});await terminate();failed=0;schedule();}}finally{busy=false;}}
 return {async start(){if(!stopped)return;stopped=false;timer=setInterval(()=>{void check();},interval);await ensure();},async stop(){stopped=true;clearInterval(timer);clearTimeout(retry);retry=null;await terminate();},get child(){return child;},get status(){return {running:!!child,stopped,failedChecks:failed,retryAttempt:attempts};}};
}
module.exports={createSupervisor};
