const fs=require('fs'),path=require('path');
const counters=['runtime_seconds','total_attacks','gold_gained','elixir_gained','dark_gained','donations_completed','bb_attacks','bb_walls_upgraded','stars_0','stars_1','stars_2','stars_3','walls_upgraded','obstacles_removed','upgrades_done','research_done','potions_used'];
function dayKey(date){return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');}
function readNativeAccounts(root,{range='today',now=Date.now}={}){
 const file=path.join(root,'logs','stats','stats.db');if(!fs.existsSync(file))return {available:false,accounts:[],info:{}};
 const {DatabaseSync}=require('node:sqlite');let db;
 try{
  db=new DatabaseSync(file,{readOnly:true});db.exec('PRAGMA busy_timeout=1000');
  const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));
  const info={};if(tables.has('profile_info'))for(const row of db.prepare('SELECT profile,town_hall,last_seen FROM profile_info').all())info[row.profile]={townHall:Number.isInteger(row.town_hall)&&row.town_hall>0?row.town_hall:null,lastSeen:row.last_seen>0?row.last_seen*1000:null};
  if(!tables.has('profile_daily'))return {available:false,accounts:[],info};
  const date=new Date(now());if(range==='week')date.setDate(date.getDate()-6);const since=range==='all'?'0000-00-00':dayKey(date);
  const bounds=db.prepare('SELECT MIN(day_key) AS firstDay,MAX(day_key) AS lastDay FROM profile_daily').get();
  const rows=db.prepare('SELECT * FROM profile_daily WHERE day_key>=? ORDER BY day_key,profile').all(since),accounts=new Map();
  for(const row of rows){if(typeof row.profile!=='string'||!row.profile)continue;let account=accounts.get(row.profile);if(!account){account={profile:row.profile,counters:{},source:'acbot',estimated:false,townHall:info[row.profile]?.townHall||null,lastActivity:null,firstDay:row.day_key,lastDay:row.day_key};accounts.set(row.profile,account);}
   for(const key of counters)if(typeof row[key]==='number'&&Number.isFinite(row[key])&&row[key]>=0)account.counters[key]=(account.counters[key]||0)+row[key];
   account.lastDay=row.day_key;if(row.last_seen>0)account.lastActivity=Math.max(account.lastActivity||0,row.last_seen*1000);
  }
  return {available:true,accounts:[...accounts.values()],info,source:'stats.db / profile_daily',firstDay:bounds?.firstDay||null,lastDay:bounds?.lastDay||null};
 }catch(error){return {available:false,accounts:[],info:{},error:error.message};}finally{db?.close();}
}
function accountView({engine,history,range='today',instance,profile,source='auto',now=Date.now}){
 const config=engine.mobileConfig(),instances=[],accounts=[],turns=[],unassigned={},warnings=[];let since=0,native=0,estimated=0;
 for(const item of config.instances){if(instance&&item.id!==instance)continue;
  const legacy=history.view({instance:item.id,range,profile}),status=legacy.instances.find(i=>i.id===item.id)||{id:item.id,label:item.label,active:null};since=legacy.since;
  const root=engine.resolveAutoClashRootPath(item),recorded=root?readNativeAccounts(root,{range,now}):{available:false,info:{}};
  const useNative=source!=='legacy'&&recorded.available;
  instances.push({...status,label:item.label,source:useNative?'acbot':'estimated',nativeAvailable:recorded.available===true,recordedSince:recorded.firstDay||null});
  if(recorded.error)warnings.push(item.label+': '+recorded.error);
  if(useNative){native++;for(const account of recorded.accounts)if(!profile||account.profile===profile)accounts.push({...account,instance:item.id,active:account.profile===status.active});}
  else {estimated++;for(const account of legacy.accounts)accounts.push({...account,townHall:recorded.info?.[account.profile]?.townHall||null,source:'estimated',estimated:true});for(const [key,value]of Object.entries(legacy.unassigned))unassigned[key]=(unassigned[key]||0)+value;}
  turns.push(...legacy.turns.map(turn=>({...turn,estimated:true})));
 }
 const mode=native&&estimated?'mixed':native?'acbot':'estimated';
 const message=source==='legacy'?'Legacy estimates collected by this monitor. These values are separate from ACBot’s own profile records.':mode==='acbot'?'Totals are read directly from ACBot’s per-account daily records. Earlier monitor estimates are kept separately in Legacy estimates.':mode==='mixed'?'ACBot records are used where available; older instances use clearly labeled estimates. Each instance uses one source, so records are never added twice.':'These ACBot instances do not have per-account records yet. Showing the monitor’s legacy estimates.';
 return {range,since,source,mode,estimated:mode!=='acbot',message,instances,accounts,turns:turns.sort((a,b)=>b.started-a.started).slice(0,200),unassigned,error:warnings.join(' · ')||null};
}
module.exports={readNativeAccounts,accountView,counters,dayKey};
