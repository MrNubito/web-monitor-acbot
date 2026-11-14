export function createAccountRefresh({request,render,onState=()=>{}}){
 let generation=0,controller=null,key='',paused=false;
 async function load(query,{force=false}={}){
  if(paused&&!force)return;const nextKey=JSON.stringify(query);
  if(controller&&key===nextKey&&!force)return;
  controller?.abort();const current=++generation,abort=new AbortController();controller=abort;key=nextKey;onState('loading');
  try{const result=await request(query,abort.signal);if(current!==generation||abort.signal.aborted)return;render(result,query);onState('updated',Date.now());}
  catch(error){if(current===generation&&!abort.signal.aborted)onState('error',error.message);}
  finally{if(controller===abort)controller=null;}
 }
 return {load,pause(value){paused=!!value;if(paused){generation++;controller?.abort();controller=null;}onState(paused?'paused':'idle');},stop(){generation++;controller?.abort();controller=null;},get paused(){return paused;}};
}
