const fs=require('fs'),path=require('path');
const normalize=value=>String(value||'').toLowerCase().replace(/[^a-z0-9]/g,'');
function pauseReason(text){
  for(const line of String(text).split(/\r?\n/).reverse()){
    if(/bot end condition met|\[LOG\]\s*Session log ended|\bbot\s+(?:is\s+)?(?:stopped|paused)\b/i.test(line))return 'Stopped or paused';
    if(/outside active hours.*sleeping|humanized break started/i.test(line))return 'Scheduled pause';
    if(/\bbot\s+(?:is\s+)?(?:started|resumed)\b|\[STARTUP\].*(?:Launching|App ready)|ATTACK (?:START|FINISHED)|\[DONATIONS\]Request found|humanized break ended/i.test(line))return null;
  }
  return null;
}
function tail(file){
  const stat=fs.statSync(file),length=Math.min(stat.size,32768),fd=fs.openSync(file,'r');
  try{const buffer=Buffer.alloc(length);fs.readSync(fd,buffer,0,length,stat.size-length);return {at:stat.mtimeMs,text:buffer.toString('utf8').split(/\r?\n/).slice(-80).join('\n')};}finally{fs.closeSync(fd);}
}
function createTelemetryReader({engine,readStats,runtimeFromStats,now=Date.now}){
  const progress=new Map();
  return ()=>{
    const sampledAt=now(),config=engine.mobileConfig(),logs=engine.mobileLogsConfig();
    const instances=config.instances.map(instance=>{
      const empty=runtimeFromStats();
      try{
        const root=engine.resolveAutoClashRootPath(instance);
        const snapshot=root?readStats(root):{available:false,message:'Configure the ACBot folder first.'};
        const runtime=runtimeFromStats(snapshot.stats);
        const stamp=Number(snapshot.stats?.timestamp);
        let reportedAt=Number.isFinite(stamp)&&stamp>0?stamp*1000:null;
        if(!reportedAt&&root&&snapshot.source){try{reportedAt=fs.statSync(path.join(root,'logs','stats',snapshot.source)).mtimeMs;}catch{}}
        const identity=snapshot.stats?.session_key||'';
        const previous=progress.get(instance.id);
        let advancedAt=previous?.identity===identity&&runtime.seconds>=previous.seconds?previous.advancedAt:null;
        if(previous?.identity===identity&&runtime.available&&runtime.seconds>previous.seconds)advancedAt=reportedAt;
        progress.set(instance.id,{identity,seconds:runtime.seconds,advancedAt});
        const match=logs.find(log=>[instance.id,instance.label].some(name=>normalize(name)===normalize(log.name)));
        let activity=null;
        if(match){try{const file=engine.resolveMobileLogFile(match.path);if(file)activity=tail(file.filePath);}catch{}}
        const reason=pauseReason(activity?.text);
        const fresh=at=>at!=null&&sampledAt-at>=-5000&&sampledAt-at<90000;
        const running=runtime.available&&fresh(reportedAt)&&!reason&&(fresh(advancedAt)||fresh(activity?.at));
        const drift=running?Math.max(0,Math.min(90,Math.floor((sampledAt-reportedAt)/1000))):0;
        return {id:instance.id,snapshot,runtime:{...runtime,running,estimated:running,estimateSeconds:runtime.available?runtime.seconds+drift:null,reportedAt,sampledAt,pauseReason:reason},lastLogAt:activity?.at||null};
      }catch(error){return {id:instance.id,snapshot:{available:false,message:'ACBot statistics are temporarily unavailable.'},runtime:{...empty,running:false,estimated:false,sampledAt},error:error.message};}
    });
    const current=new Set(config.instances.map(i=>i.id));for(const id of progress.keys())if(!current.has(id))progress.delete(id);
    return {sampledAt,instances};
  };
}
module.exports={createTelemetryReader,pauseReason};
