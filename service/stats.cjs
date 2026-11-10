const fs=require('fs'),path=require('path');
function readStats(root,period='session') {
  const dir=path.join(root,'logs','stats'),dbFile=path.join(dir,'stats.db');
  if(fs.existsSync(dbFile)){
    const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(dbFile,{readOnly:true});
    try{
      if(period==='session'){const stats=db.prepare('SELECT * FROM session_stats ORDER BY timestamp DESC LIMIT 1').get();if(stats)return {available:true,stats,source:'stats.db',period};}
      else {const date=db.prepare('SELECT MAX(day_key) AS day FROM session_stats').get()?.day;if(date){const rows=db.prepare('SELECT * FROM session_stats WHERE day_key = ?').all(date),stats={day_key:date};for(const row of rows)for(const [key,value]of Object.entries(row))if(typeof value==='number'&&!['timestamp','id'].includes(key))stats[key]=(stats[key]||0)+value;return {available:true,stats,date,source:'stats.db',period};}}
    }finally{db.close();}
  }
  if(!fs.existsSync(dir))return {available:false,period,message:'No statistics have been written by ACBot yet.'};
  if(period==='daily'){const file=path.join(dir,'daily_totals.json');if(fs.existsSync(file)){const data=JSON.parse(fs.readFileSync(file,'utf8')),date=Object.keys(data).sort().at(-1);if(date)return {available:true,stats:data[date],date,source:'daily_totals.json',period};}}
  else {const file=fs.readdirSync(dir).filter(n=>/^session-\d+.*\.json$/i.test(n)).map(n=>({n,mtime:fs.statSync(path.join(dir,n)).mtimeMs})).sort((a,b)=>b.mtime-a.mtime)[0];if(file)return {available:true,stats:JSON.parse(fs.readFileSync(path.join(dir,file.n),'utf8')),source:file.n,period};}
  return {available:false,period,message:'No statistics have been written by ACBot yet.'};
}
module.exports={readStats};
