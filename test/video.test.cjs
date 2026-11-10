const {test}=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');const {PassThrough}=require('node:stream');const {createVideoService}=require('../service/video.cjs');
test('real video pipes encoded bytes and kills the encoder when the viewer disconnects',async()=>{
 let child,killed=0,args;const png=Buffer.alloc(24);png.writeUInt32BE(1920,16);png.writeUInt32BE(1080,20);
 const engine={mobileConfig:()=>({adbPath:__filename}),captureMobileAdbScreen:async()=>png};
 const service=createVideoService({engine,execCommand:async()=> 'device',spawnProcess:(file,arguments)=>{args=arguments;child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{killed++;};return child;}});
 const res=new EventEmitter();res.headersSent=false;res.writableEnded=false;res.destroyed=false;let bytes=0;res.writeHead=(status,headers)=>{res.headersSent=true;assert.equal(status,200);assert.equal(headers['Content-Type'],'video/avc');};res.write=chunk=>{bytes+=chunk.length;return true;};res.end=()=>{res.writableEnded=true;};
 await service.stream({id:'one',device:'emulator-1'},{url:'/video?quality=normal'},res);assert.ok(args.includes('screenrecord'));assert.ok(args.includes('960x544'));assert.ok(args.includes('2500000'));
 child.stdout.write(Buffer.from([0,0,0,1,103]));assert.equal(bytes,5);res.emit('close');assert.equal(killed,1);service.stopAll();assert.equal(killed,1);
});
test('video player aborts its authenticated stream and discards late responses after stop',async()=>{
 const {createVideoLiveView}=await import('../web/video-live.js');const previous=global.MediaSource;global.MediaSource=class{};let pending,signal,destroyed=0;const states=[];
 const video={hidden:true,pause(){},removeAttribute(){},load(){},play:async()=>{},buffered:{length:0}};
 class Muxer{constructor(options){queueMicrotask(options.onReady);}destroy(){destroyed++;}feed(){throw Error('A stopped stream must not decode');}}
 const player=createVideoLiveView({video,Muxer,open:async(id,q,s)=>{signal=s;return new Promise(resolve=>pending=resolve);},onState:s=>states.push(s)});
 try{player.start('one');await new Promise(r=>setImmediate(r));assert.equal(player.active,true);player.stop();assert.equal(signal.aborted,true);pending({body:new ReadableStream()});await new Promise(r=>setImmediate(r));assert.equal(video.hidden,true);assert.equal(player.active,false);assert.ok(destroyed);assert.ok(!states.includes('live'));}finally{player.stop();global.MediaSource=previous;}
});
