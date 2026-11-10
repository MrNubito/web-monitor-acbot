const {test}=require('node:test');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const load=()=>import(pathToFileURL(path.join(__dirname,'../web/performance-chart.js')).href);
test('performance history uses actual values, isolates instances and resets cumulative counters',async()=>{
  const {createPerformanceHistory,performanceSvg}=await load();const history=createPerformanceHistory(3);
  assert.deepEqual(history.record('empty',{},1000),[]);
  let rows=history.record('one',{gold_gained:100,elixir_gained:50},1000);assert.equal(rows[0].values[2],null);
  rows=history.record('one',{gold_gained:150,elixir_gained:75},3000);assert.equal(rows.length,2);
  assert.equal(history.record('two',{gold_gained:800},4000).length,1);
  rows=history.record('one',{gold_gained:20,elixir_gained:10},5000);assert.equal(rows.length,1,'new session must not look like negative progress');
  history.record('one',{gold_gained:30},7000);history.record('one',{gold_gained:40},9000);rows=history.record('one',{gold_gained:50},11000);assert.equal(rows.length,3);
  const svg=performanceSvg(rows);assert.match(svg,/role="img"/);assert.ok(!svg.includes('NaN'));assert.ok(!svg.includes('Infinity'));
  assert.match(performanceSvg([]),/Waiting/);
});
