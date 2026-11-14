const {test}=require('node:test');const assert=require('node:assert/strict');
test('detailed statistics show recorded counters and distinguish missing data from zero',async()=>{
 const {statisticsSummary,miscStatistics}=await import('../web/statistics-summary.js');
 const stats={upgrades_done:45,research_done:9,potions_used:3,obstacles_removed:254,bb_attacks:0,bb_walls_upgraded:0,walls_upgraded:0,donations_completed:12,stars_0:56,stars_1:9,stars_2:18,stars_3:0};
 const html=statisticsSummary(stats);for(const [label,key] of miscStatistics){assert.ok(html.includes(label));assert.ok(html.includes('<strong>'+stats[key]+'</strong>'));}
 assert.equal((html.match(/<img /g)||[]).length,8);assert.ok(html.includes('resource-upgrades.png'));
 assert.ok(html.includes('aria-label="0 star attacks"'));assert.ok(html.includes('aria-label="3 star attacks"'));
 assert.equal((statisticsSummary().match(/<strong>—<\/strong>/g)||[]).length,12);
 assert.equal((html.match(/class="earned"/g)||[]).length,6);
});
