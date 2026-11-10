const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createTelemetryReader,pauseReason}=require('../service/telemetry.cjs');
test('fast telemetry follows recorded progress and freezes stale or reset sessions without probing ADB',async()=>{
 const {runtimeFromStats,runtimeAt}=await import('../web/runtime.js');
 let clock=1000000,seconds=10,stamp=1000;
 const engine={mobileConfig:()=>({instances:[{id:'one'}]}),mobileLogsConfig:()=>[],resolveAutoClashRootPath:()=>'.'};
 const read=createTelemetryReader({engine,now:()=>clock,runtimeFromStats,readStats:()=>({available:true,stats:{runtime_seconds:seconds,timestamp:stamp,session_key:'a',gold_gained:42}})});
 assert.equal(read().instances[0].runtime.running,false);
 clock+=2000;stamp+=2;seconds+=2;
 let sample=read().instances[0];assert.equal(sample.runtime.running,true);assert.equal(sample.snapshot.stats.gold_gained,42);
 assert.equal(runtimeAt(sample.runtime,3000).seconds,15);
 assert.equal(runtimeAt(sample.runtime,60000).seconds,22);
 clock+=91000;assert.equal(read().instances[0].runtime.running,false);
 seconds=0;stamp=clock/1000;assert.equal(read().instances[0].runtime.running,false);
 assert.equal(runtimeAt({...sample.runtime,running:false},5000).seconds,12);
 assert.equal(pauseReason('Bot started\nBot paused'),'Stopped or paused');
 assert.equal(pauseReason('Bot paused\nBot resumed'),null);
});
