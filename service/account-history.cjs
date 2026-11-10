const fs=require('fs'),path=require('path');
const {DatabaseSync}=require('node:sqlite');
const keys=['runtime_seconds','total_attacks','gold_gained','elixir_gained','dark_gained','donations_completed','walls_upgraded','bb_attacks','bb_walls_upgraded','obstacles_removed','upgrades_done','research_done','stars_0','stars_1','stars_2','stars_3'];
const normalize=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
function profileEvents(text,known){
 const events=[];
 for(const line of text.split(/\r?\n/)){
  const match=line.match(/\[PROFILES?\]\s*(?:Starting on|Switching to|Root profile swap enabled for)\s+(.+?)\s*$/i);
  if(match){const name=known.find(p=>p===match[1].trim());events.push({type:'begin',profile:name||null});}
  else if(/\[PROFILES?\]\s*Profile loaded OK/i.test(line))events.push({type:'loaded'});
  else if(/\[PROFILES?\].*(?:failed|unable to load|load error)/i.test(line))events.push({type:'failed'});
 }
 return events;
}
function readLog(file,state){
 const stat=fs.statSync(file),restart=state.file!==file||stat.size<(state.offset||0)||state.birth!==stat.birthtimeMs;
 let start=restart?Math.max(0,stat.size-2*1024*1024):(state.offset||0);
 const lost=stat.size-start>2*1024*1024;if(lost)start=stat.size-2*1024*1024;
 const fd=fs.openSync(file,'r'),buffer=Buffer.alloc(stat.size-start);
 try{fs.readSync(fd,buffer,0,buffer.length,start);}finally{fs.closeSync(fd);}
 let text=(restart||lost?'':state.remainder||'')+buffer.toString('utf8');
 if((restart||lost)&&start>0)text=text.slice(text.indexOf('\n')+1);
 const end=text.lastIndexOf('\n');
 return {text:end<0?'':text.slice(0,end),cursor:{file,birth:stat.birthtimeMs,offset:stat.size,remainder:text.slice(end+1).slice(-8192)},restart:restart||lost};
}
function createAccountHistory({file,engine,readStats,now=Date.now}){
 const db=new DatabaseSync(file);db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS state (id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS turns (id INTEGER PRIMARY KEY, instance TEXT NOT NULL, profile TEXT NOT NULL, started INTEGER NOT NULL, ended INTEGER); CREATE TABLE IF NOT EXISTS samples (id INTEGER PRIMARY KEY, instance TEXT NOT NULL, profile TEXT, turn_id INTEGER, at INTEGER NOT NULL, counters TEXT NOT NULL, reason TEXT); CREATE INDEX IF NOT EXISTS samples_lookup ON samples(instance,at);');
 let timer,closed=false,lastError=null;
 function tick(){
  if(closed)return;
  lastError=null;
  for(const instance of engine.mobileConfig().instances){
   try{
    const root=engine.resolveAutoClashRootPath(instance);if(!root)continue;
    const at=now(),row=db.prepare('SELECT value FROM state WHERE id=?').get(instance.id);
    let state=row?JSON.parse(row.value):{},previousProfile=state.active;
    const gap=state.seen&&at-state.seen>15000;
    const known=engine.listMobileProfiles(instance).filter(p=>p.available).map(p=>p.id);
    const logs=engine.mobileLogsConfig(),match=logs.find(l=>[instance.id,instance.label].some(s=>normalize(s)===normalize(l.name)));
    const resolved=match?engine.resolveMobileLogFile(match.path):null;
    let boundary=false,logAvailable=false;
    if(resolved?.filePath){
     try{
      const update=readLog(resolved.filePath,state);logAvailable=true;
      if(update.restart){state.active=null;state.pending=null;boundary=true;}
      Object.assign(state,update.cursor);
      for(const event of profileEvents(update.text,known)){
       if(event.type==='begin'){state.pending=event.profile;state.active=null;boundary=true;}
       else if(event.type==='loaded'&&state.pending){state.active=state.pending;state.pending=null;}
       else if(event.type==='failed'){state.active=null;state.pending=null;boundary=true;}
      }
     }catch{}
    }
    if(!logAvailable){state.active=null;boundary=true;}
    const snapshot=readStats(root),current=snapshot.available?snapshot.stats:null;
    const reset=current&&state.snapshot&&(current.session_key!==state.snapshot.session_key||keys.some(k=>typeof current[k]==='number'&&typeof state.snapshot[k]==='number'&&current[k]<state.snapshot[k]));
    if(boundary||gap||reset)state.transition=true;
    db.exec('BEGIN IMMEDIATE');
    try{
     if(boundary||gap||previousProfile!==state.active){
      if(state.turn)db.prepare('UPDATE turns SET ended=? WHERE id=? AND ended IS NULL').run(at,state.turn);
      state.turn=null;
      if(state.active)state.turn=Number(db.prepare('INSERT INTO turns(instance,profile,started) VALUES(?,?,?)').run(instance.id,state.active,at).lastInsertRowid);
     }
     if(current&&state.snapshot&&!reset){
      const delta={};for(const key of keys)if(typeof current[key]==='number'&&typeof state.snapshot[key]==='number'&&current[key]>state.snapshot[key])delta[key]=current[key]-state.snapshot[key];
      if(Object.keys(delta).length){
       const account=state.active&&!state.transition?state.active:null;
       db.prepare('INSERT INTO samples(instance,profile,turn_id,at,counters,reason) VALUES(?,?,?,?,?,?)').run(instance.id,account,account?state.turn:null,at,JSON.stringify(delta),account?null:gap?'Agent interruption':state.transition?'Account switch or log boundary':'Account not confirmed');
       if(state.active&&logAvailable)state.transition=false;
      }
     }
     if(reset)state.transition=true;
     if(current)state.snapshot=Object.fromEntries(['session_key','timestamp',...keys].filter(k=>current[k]!=null).map(k=>[k,current[k]]));
     state.seen=at;state.label=instance.label;state.root=root;
     db.prepare('INSERT INTO state(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(instance.id,JSON.stringify(state));db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
   }catch(error){lastError=error.message;}
  }
 }
 function view({instance,range='today',profile}={}){
  const date=new Date(now());if(range==='week')date.setDate(date.getDate()-6);date.setHours(0,0,0,0);
  const since=range==='all'?0:date.getTime();
  const rows=db.prepare('SELECT * FROM samples WHERE at>=? ORDER BY at').all(since).filter(r=>!instance||r.instance===instance);
  const accounts=new Map(),unassigned={};
  for(const row of rows){
   const values=JSON.parse(row.counters);if(!row.profile){for(const [key,value]of Object.entries(values))unassigned[key]=(unassigned[key]||0)+value;continue;}
   const id=row.instance+'\0'+row.profile;let account=accounts.get(id);if(!account){account={instance:row.instance,profile:row.profile,counters:{},lastActivity:row.at};accounts.set(id,account);}
   for(const [key,value]of Object.entries(values))account.counters[key]=(account.counters[key]||0)+value;account.lastActivity=row.at;
  }
  const states=db.prepare('SELECT id,value FROM state').all().filter(r=>!instance||r.id===instance).map(r=>({id:r.id,...JSON.parse(r.value)}));
  for(const state of states)if(state.active){const id=state.id+'\0'+state.active;if(!accounts.has(id))accounts.set(id,{instance:state.id,profile:state.active,counters:{},lastActivity:null});accounts.get(id).active=true;}
  const turns=db.prepare('SELECT * FROM turns WHERE started>=? OR ended>=? OR ended IS NULL ORDER BY started DESC LIMIT 200').all(since,since).filter(t=>(!instance||t.instance===instance)&&(!profile||t.profile===profile)).map(turn=>{
   const counters={};for(const row of rows)if(row.turn_id===turn.id)for(const [key,value]of Object.entries(JSON.parse(row.counters)))counters[key]=(counters[key]||0)+value;
   return {...turn,counters};
  });
  return {range,since,estimated:true,message:'Estimated from recorded instance counter differences. Switch-boundary and interruption intervals remain unassigned. Tracking starts when this agent runs; old totals are not imported.',accounts:[...accounts.values()].filter(a=>!profile||a.profile===profile),turns,unassigned,instances:states.map(s=>({id:s.id,label:s.label,active:s.active||null,pending:s.pending||null,lastChecked:s.seen})),error:lastError};
 }
 return {tick,view,start(){tick();timer=setInterval(tick,2000);timer.unref();},close(){if(closed)return;closed=true;clearInterval(timer);db.close();}};
}
module.exports={createAccountHistory,profileEvents};
