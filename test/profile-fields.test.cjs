const {test}=require('node:test');const assert=require('node:assert/strict');
const {describeProfile,validateChange,readonly}=require('../service/profile-fields.cjs');
test('profile editor exposes recorded halls separately and preserves upgrade slot formats',async()=>{
 const {structuredValue,structuredControl}=await import('../web/profile-controls.js');
 const config={TH_LEVEL:14,HOME_UPGRADE_SLOTS:['__GROUP:Heroes__','',''],BB_RESEARCH_SLOTS:'["",""]',HOME_RESEARCH_PET_TARGET:'pet_upgrade_phoenix',USE_POTIONS_SELECTED:'[]',HOME_UPGRADE_USE_GOBLIN:true};
 const view=describeProfile(config);assert.equal(view.metadata.townHall,14);assert.ok(readonly.has('TH_LEVEL'));assert.ok(!view.fields.some(f=>f.key==='TH_LEVEL'));assert.equal(describeProfile({}).metadata.townHall,null);
 const home=view.fields.find(f=>f.key==='HOME_UPGRADE_SLOTS');assert.ok(home.control.options.some(o=>o.label==='Any Defences'));assert.ok(structuredControl(home,home.value).includes('Slot 3'));
 const next=structuredValue(home,home.value,1,'home_upgrade_townhall');assert.deepEqual(next,['__GROUP:Heroes__','home_upgrade_townhall','']);assert.equal(config.HOME_UPGRADE_SLOTS[1],'');assert.deepEqual(validateChange(home,next),next);
 assert.throws(()=>validateChange(home,['not-valid','','']),/valid upgrade/);assert.throws(()=>validateChange(home,['']),/valid upgrade/);
 const bb=view.fields.find(f=>f.key==='BB_RESEARCH_SLOTS');const encoded=structuredValue(bb,bb.value,0,'bb_research_baby_dragon');assert.equal(typeof encoded,'string');assert.equal(JSON.parse(encoded)[0],'bb_research_baby_dragon');validateChange(bb,encoded);
 const potion=view.fields.find(f=>f.key==='USE_POTIONS_SELECTED');assert.equal(structuredValue(potion,'[]',0,'builder',true),'["builder"]');assert.throws(()=>validateChange(potion,'["fake"]'),/valid potion/);
});
const {isPrivateIPv4}=require('../service/network.cjs');
test('LAN mode recognizes only private IPv4 ranges',()=>{for(const ip of ['10.100.102.234','192.168.1.20','172.16.0.1','172.31.255.1'])assert.equal(isPrivateIPv4(ip),true);for(const ip of ['8.8.8.8','172.32.0.1','172.15.0.1','example.com'])assert.equal(isPrivateIPv4(ip),false);});
