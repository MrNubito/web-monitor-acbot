export function createVideoLiveView({video,open,onState=()=>{},quality=()=> 'normal',Muxer=globalThis.JMuxer}){
 let active=false,generation=0,controller=null,reader=null,muxer=null,retry=null,watch=null,feedTimer=null;
 function stop(message='Live video stopped',notify=true){
  active=false;generation++;clearTimeout(retry);clearInterval(watch);clearInterval(feedTimer);controller?.abort();controller=null;
  reader?.cancel().catch(()=>{});reader=null;
  muxer?.destroy();muxer=null;video.pause();video.removeAttribute('src');video.load();video.hidden=true;
  video.onplaying=null;video.onerror=null;
  if(notify)onState('stopped',message);
 }
 function start(id){
  stop('',false);
  if(!Muxer||!(globalThis.MediaSource||globalThis.ManagedMediaSource)){onState('error','This browser does not support live H.264 video. Try an updated Chrome, Edge or Safari browser.');return;}
  active=true;const current=generation;let attempts=0;
  async function connect(){
   if(!active||generation!==current)return;
   onState('connecting','Starting H.264 live video…');controller=new AbortController();let ready=false;
   try{
    await new Promise((resolve,reject)=>{
     let opened=false;
     const failure=message=>{if(!opened)reject(Error(message));else if(active&&generation===current){stop('',false);onState('error',message);}};
     muxer=new Muxer({node:video,mode:'video',flushingTime:0,maxDelay:500,clearBuffer:true,fps:30,readFpsFromTrack:false,debug:false,
      onReady:()=>{opened=true;resolve();},onError:()=>failure('The browser could not decode the live video.'),onUnsupportedCodec:()=>failure('The emulator video codec is not supported by this browser.')});
    });
    if(!active||generation!==current)return;
    const response=await open(id,quality(),controller.signal);
    if(!active||generation!==current){await response.body?.cancel();return;}
    if(!response.body)throw Error('Video streaming is unavailable in this browser.');
    reader=response.body.getReader();video.hidden=false;
    let pending=[],pendingSize=0,lastFeed=performance.now();
    feedTimer=setInterval(()=>{
     if(!active||generation!==current||!pendingSize)return;
     const combined=new Uint8Array(pendingSize);let offset=0;for(const part of pending){combined.set(part,offset);offset+=part.length;}
     pending=[];pendingSize=0;const now=performance.now();
     try{muxer.feed({video:combined,duration:Math.max(1,Math.round(now-lastFeed))});lastFeed=now;}catch{stop('',false);onState('error','The emulator video stream could not be decoded.');}
    },100);
    video.onplaying=()=>{if(active&&generation===current){ready=true;attempts=0;onState('live','Live video · H.264');}};
    video.onerror=()=>{if(active&&generation===current){stop('',false);onState('error','The live video decoder stopped. Press Live view to reconnect.');}};
    watch=setInterval(()=>{
     if(!active||!video.buffered.length)return;
     const end=video.buffered.end(video.buffered.length-1),lag=end-video.currentTime;
     if(lag>1.2)video.currentTime=Math.max(video.buffered.start(video.buffered.length-1),end-.25);
     video.play().catch(()=>{});
    },400);
    while(active&&generation===current){const {done,value}=await reader.read();if(done)break;if(!active||generation!==current)return;pending.push(value);pendingSize+=value.length;if(pendingSize>4*1024*1024)throw Error('The video connection is too slow. Try Low bandwidth.');}
    if(!active||generation!==current)return;
    if(!ready)throw Error('The emulator ended the video before playback started.');
    // Android screenrecord sessions are time limited; renew the encoder automatically.
    clearInterval(watch);clearInterval(feedTimer);muxer?.destroy();muxer=null;video.pause();reader=null;
    retry=setTimeout(connect,300);
   }catch(error){
    if(!active||generation!==current)return;
    clearInterval(watch);clearInterval(feedTimer);reader?.cancel().catch(()=>{});reader=null;muxer?.destroy();muxer=null;
    if(ready&&++attempts<=2){retry=setTimeout(connect,1000);onState('connecting','Reconnecting live video…');}
    else {stop('',false);onState('error',error.message||'Live video is unavailable.');}
   }
  }
  void connect();
 }
 return {start,stop,get active(){return active;}};
}
