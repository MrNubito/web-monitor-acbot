const {test}=require('node:test');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
test('runtime uses reported working seconds, supports legacy text and never wraps at 24 hours',async()=>{
  const {runtimeFromStats}=await import(pathToFileURL(path.join(__dirname,'../web/runtime.js')).href);
  assert.deepEqual(runtimeFromStats({runtime_seconds:44954,runtime:'00:01:00'}),{available:true,seconds:44954,label:'12:29:14'});
  assert.equal(runtimeFromStats({runtime_seconds:0}).label,'00:00:00');
  assert.equal(runtimeFromStats({runtime_seconds:'90061'}).label,'25:01:01');
  assert.equal(runtimeFromStats({runtime:'123:45:06'}).label,'123:45:06');
  assert.equal(runtimeFromStats({runtime_seconds:65.9}).label,'00:01:05');
  for(const data of [{},{runtime_seconds:''},{runtime_seconds:-1},{runtime_seconds:Infinity},{runtime:'12:90:00'},null])assert.equal(runtimeFromStats(data).available,false);
});
