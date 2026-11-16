const INTERVAL=15*60*1000,REMINDER=24*60*60*1000;
export function createUpdateNotice({context,request,onStatus=()=>{},canShow=()=>true,show,storage,now=Date.now}){
 const dismissed=new Map();let checked=new Map(),inFlight=null,pending=null,open=null,generation=0;
 const key=(agent,version)=>'acbot.updateNotice:'+encodeURIComponent(agent)+':'+version;
 function until(agent,version){const id=key(agent,version);try{return Math.max(dismissed.get(id)||0,Number(storage?.getItem(id))||0);}catch{return dismissed.get(id)||0;}}
 function snooze(agent,version){const id=key(agent,version),expires=now()+REMINDER;dismissed.set(id,expires);try{storage?.setItem(id,String(expires));}catch{}}
 function present(){const current=context();if(!pending||open||!current.session||pending.agent!==current.agent||pending.session!==current.session||!canShow())return;const {agent,state}=pending;if(until(agent,state.release.version)>now()){pending=null;return;}open={agent,version:state.release.version};pending=null;show(state);}
 async function poll(){const current=context();if(!current.agent||!current.session)return;if(pending)present();const identity=current.agent+'|'+current.session;if(inFlight||now()-(checked.get(identity)??-Infinity)<INTERVAL)return;checked.set(identity,now());const run=++generation;inFlight=run;try{const state=await request();const next=context();if(run!==generation||next.agent!==current.agent||next.session!==current.session)return;onStatus(state);if(state.release&&!state.busy&&!['downloading','verifying','installing'].includes(state.operation?.phase)){pending={...current,state};present();}else pending=null;}catch{}finally{if(inFlight===run)inFlight=null;}}
 function dismiss(){if(open)snooze(open.agent,open.version);open=null;}
 function acknowledge(version){const {agent}=context();if(agent&&version)snooze(agent,version);if(pending?.state.release.version===version)pending=null;}
 return {poll,present,dismiss,acknowledge,reset(){generation++;inFlight=null;pending=null;open=null;}};
}
