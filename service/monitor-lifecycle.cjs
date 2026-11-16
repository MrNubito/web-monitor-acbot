const fs=require('fs'),path=require('path');
function createMonitorLifecycle({file,engine,log=()=>{},now=Date.now,interval=2000,retryBase=5000,retryMax=60000}){
 let blocked=null,desired=false,closed=false,timer,busy=false,next=0,attempt=0;try{desired=JSON.parse(fs.readFileSync(file,'utf8')).running===true;}catch{desired=String(engine.configFromEnv().autoStartBot)==='true';}
 function persist(){fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify({running:desired})+'\n',{mode:0o600});fs.renameSync(temp,file);}
 function validate(){try{engine.validateMonitorConfig?.();blocked=null;}catch(error){if(error.code==='MONITOR_CONFIG_INVALID'){desired=false;blocked=error.message;persist();}throw error;}}
 function state(){return {blocked,desiredRunning:desired,running:engine.botRunning(),retryAt:desired&&!engine.botRunning()?next:null};}
 function tick(){if(closed||busy||!desired)return;if(engine.botRunning()){if(now()-next>60000)attempt=0;return;}if(now()<next)return;busy=true;try{validate();engine.startBot({autoStartSequence:false});log('Monitor recovery started.');}catch(error){log('Monitor recovery: '+error.message);}finally{next=now()+Math.min(retryMax,retryBase*2**Math.min(attempt++,5));busy=false;}}
 return {start(){if(closed)throw Error('Monitor is shutting down.');validate();desired=true;persist();next=now()+retryBase;engine.startBot();return state();},stop(){desired=false;persist();engine.stopBot();return state();},async restart(){busy=true;try{validate();desired=true;persist();await engine.stopBotAndWait();engine.startBot({autoStartSequence:false});next=now()+retryBase;return state();}finally{busy=false;}},begin(){timer=setInterval(tick,interval);timer.unref?.();tick();},changed(){if(engine.botRunning())return {restartRequired:true};return {restartRequired:false};},state,close(){closed=true;clearInterval(timer);}};
}
module.exports={createMonitorLifecycle};
