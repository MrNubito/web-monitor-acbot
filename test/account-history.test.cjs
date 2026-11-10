const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createAccountHistory,profileEvents}=require('../service/account-history.cjs');
test('account recorder attributes stable intervals, quarantines boundaries and survives restarts',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'acbot-accounts-')),log=path.join(temp,'log.txt'),file=path.join(temp,'history.db');let clock=Date.now(),gold=100,session='session-a';
 fs.writeFileSync(log,'[PROFILES]Starting on china1\n[PROFILES] Root profile swap enabled for china1\n[PROFILES] Profile loaded OK (root swap)\n');
 const engine={mobileConfig:()=>({instances:[{id:'one',label:'One'}]}),resolveAutoClashRootPath:()=>temp,listMobileProfiles:()=>['china1','china2'].map(id=>({id,available:true})),mobileLogsConfig:()=>[{name:'One',path:log}],resolveMobileLogFile:()=>({filePath:log})};
 const options={file,engine,now:()=>clock,readStats:()=>({available:true,stats:{session_key:session,gold_gained:gold,runtime_seconds:gold}})};
 let recorder=createAccountHistory(options);
 const tick=()=>{clock+=2000;recorder.tick();};
 try{
 tick();assert.equal(recorder.view({range:'all'}).accounts[0].profile,'china1');assert.equal(recorder.view({range:'all'}).accounts[0].counters.gold_gained,undefined);
 gold=110;tick();assert.equal(recorder.view({range:'all'}).unassigned.gold_gained,10);
 gold=130;tick();assert.equal(recorder.view({range:'all'}).accounts[0].counters.gold_gained,20);
 fs.appendFileSync(log,'[PROFILE]Switching to china2\n');gold=140;tick();assert.equal(recorder.view({range:'all'}).instances[0].active,null);
 fs.appendFileSync(log,'[PROFILES] Profile loaded OK (root swap)\n');gold=150;tick();assert.equal(recorder.view({range:'all'}).accounts.find(a=>a.profile==='china2').counters.gold_gained,undefined);
 gold=170;tick();assert.equal(recorder.view({range:'all'}).accounts.find(a=>a.profile==='china2').counters.gold_gained,20);
 recorder.close();clock+=60000;gold=200;recorder=createAccountHistory(options);tick();assert.equal(recorder.view({range:'all'}).accounts.find(a=>a.profile==='china2').counters.gold_gained,20);
 session='session-b';gold=2;tick();assert.equal(recorder.view({range:'all'}).accounts.find(a=>a.profile==='china2').counters.gold_gained,20);
 gold=5;tick();gold=9;tick();assert.equal(recorder.view({range:'all'}).accounts.find(a=>a.profile==='china2').counters.gold_gained,24);
 const before=recorder.view({range:'all'});tick();assert.deepEqual(recorder.view({range:'all'}).accounts.map(a=>a.counters),before.accounts.map(a=>a.counters));
 assert.ok(before.turns.some(t=>t.profile==='china1'&&t.ended));assert.ok(before.unassigned.gold_gained>=30);
 }finally{recorder.close();assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(temp,{recursive:true,force:true});}
});
test('profile recognition requires a known profile and successful load confirmation',()=>{assert.deepEqual(profileEvents('[PROFILE]Switching to unknown\n[PROFILES]Profile loaded OK',['china1']),[{type:'begin',profile:null},{type:'loaded'}]);assert.deepEqual(profileEvents('[PROFILE]Switching to china1\n[PROFILES]Load failed',['china1']),[{type:'begin',profile:'china1'},{type:'failed'}]);});
