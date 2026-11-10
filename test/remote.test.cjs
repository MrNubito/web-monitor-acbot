const {test}=require('node:test');
const assert=require('node:assert/strict');
const {remoteNetwork}=require('../service/remote.cjs');
test('remote configuration keeps authentication boundaries and an exact website origin',()=>{
  const previous={customSetting:'keep',allowedOrigins:['https://other-owned.example']};
  const result=remoteNetwork(previous,'https://example-test.trycloudflare.com');
  assert.equal(result.publicUrl,'https://example-test.trycloudflare.com');
  assert.equal(result.customSetting,'keep');
  assert.deepEqual(result.allowedOrigins,['https://other-owned.example','https://mrnubito.github.io','https://example-test.trycloudflare.com']);
  assert.deepEqual(previous.allowedOrigins,['https://other-owned.example']);
  assert.throws(()=>remoteNetwork({},'http://example.trycloudflare.com'),/Invalid/);
  assert.throws(()=>remoteNetwork({},'https://example.trycloudflare.com.evil.example'),/Invalid/);
  assert.throws(()=>remoteNetwork({},'https://user:password@example.trycloudflare.com'),/Invalid/);
  assert.throws(()=>remoteNetwork({},'https://example.trycloudflare.com/?token=secret'),/Invalid/);
  assert.throws(()=>remoteNetwork({},'https://example.trycloudflare.com','https://mrnubito.github.io/web-monitor-acbot/'),/exact HTTPS/);
});
