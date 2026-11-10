export function runtimeFromStats(stats={}){
  let seconds=null;
  const raw=stats?.runtime_seconds;
  if((typeof raw==='number'||typeof raw==='string'&&raw.trim()!=='')&&Number.isFinite(Number(raw))&&Number(raw)>=0&&Number.isSafeInteger(Math.floor(Number(raw))))seconds=Math.floor(Number(raw));
  if(seconds===null&&typeof stats?.runtime==='string'){
    const match=stats.runtime.trim().match(/^(\d+):([0-5]\d):([0-5]\d)$/);
    if(match){const value=Number(match[1])*3600+Number(match[2])*60+Number(match[3]);if(Number.isSafeInteger(value))seconds=value;}
  }
  if(seconds===null)return {available:false,seconds:null,label:'—'};
  const hours=Math.floor(seconds/3600),minutes=Math.floor(seconds%3600/60),remaining=seconds%60;
  return {available:true,seconds,label:[hours,minutes,remaining].map(value=>String(value).padStart(2,'0')).join(':')};
}
