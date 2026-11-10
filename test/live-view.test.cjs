const {test}=require('node:test');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const load=()=>import(pathToFileURL(path.join(__dirname,'../web/live-view.js')).href);
const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
test('live frames are sequential and stop cancels in-flight captures',async()=>{
  const {createLiveView}=await load();const pending=[],rendered=[],timers=[],states=[];
  const live=createLiveView({capture:(id,signal)=>new Promise(resolve=>pending.push({id,signal,resolve})),render:frame=>rendered.push(frame),onState:(state)=>states.push(state),schedule:(fn,ms)=>{const timer={fn,ms};timers.push(timer);return timer;},cancel:timer=>{const index=timers.indexOf(timer);if(index>=0)timers.splice(index,1);},interval:()=>1500});
  live.start('first');assert.equal(pending.length,1);assert.equal(timers.length,0);
  pending[0].resolve('frame 1');await settle();assert.deepEqual(rendered,['frame 1']);assert.equal(timers.length,1);assert.equal(timers[0].ms,1500);
  timers.shift().fn();assert.equal(pending.length,2);assert.equal(timers.length,0,'no parallel frame requests');
  live.stop();assert.equal(pending[1].signal.aborted,true);pending[1].resolve('late frame');await settle();assert.deepEqual(rendered,['frame 1']);assert.equal(timers.length,0);assert.equal(live.active,false);
});
test('switching emulators cannot display a frame from the previous instance',async()=>{
  const {createLiveView}=await load();const pending=[],rendered=[],timers=[];
  const live=createLiveView({capture:(id,signal)=>new Promise(resolve=>pending.push({id,signal,resolve})),render:frame=>rendered.push(frame),schedule:fn=>{timers.push(fn);return fn;},cancel:()=>{}});
  live.start('old');live.start('new');assert.equal(pending[0].signal.aborted,true);
  pending[0].resolve('old image');pending[1].resolve('new image');await settle();assert.deepEqual(rendered,['new image']);assert.equal(timers.length,1);live.stop();
});
test('capture failure stops live view with a recoverable error',async()=>{
  const {createLiveView}=await load();const states=[];let captures=0;
  const live=createLiveView({capture:async()=>{captures++;throw Error('Emulator disconnected');},render:()=>assert.fail('no image should render'),onState:(state,message)=>states.push({state,message}),schedule:()=>assert.fail('failed captures must not retry forever')});
  live.start('offline');await settle();assert.equal(live.active,false);assert.equal(captures,1);assert.deepEqual(states.at(-1),{state:'error',message:'Emulator disconnected'});
});
