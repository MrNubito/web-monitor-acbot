// Sequential authenticated frames: never queue captures or keep streaming after leaving the page.
export function createLiveView({capture,render,onState=()=>{},interval=()=>1000,schedule=setTimeout,cancel=clearTimeout}) {
  let active=false,generation=0,timer=null,controller=null;
  function stop(message='Live view stopped',notify=true) {
    active=false;generation++;if(timer!==null)cancel(timer);timer=null;
    controller?.abort();controller=null;if(notify)onState('stopped',message);
  }
  function start(instanceId) {
    stop('',false);active=true;const current=generation;onState('connecting','Connecting to emulator…');
    async function next() {
      if(!active||current!==generation)return;
      controller=new AbortController();
      try {
        const frame=await capture(instanceId,controller.signal);
        if(!active||current!==generation)return;
        await render(frame);
        if(!active||current!==generation)return;
        onState('live','Live · '+new Date().toLocaleTimeString());
        timer=schedule(next,Math.max(500,Number(interval())||1000));
      } catch(error) {
        if(!active||current!==generation)return;
        stop('',false);onState('error',error.message||'The emulator could not be reached.');
      }
    }
    next();
  }
  return {start,stop,get active(){return active;}};
}
