const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {createLogIssueReader, consoleIssues} = require('../service/log-issues.cjs');
const {logSeverity} = require('../web/log-severity.js');

test('ACBot uses the listed severities even when the text contains misleading keywords', () => {
  const examples = [
    ['warning', '20:50:14 | [UPGRADES] Suggested upgrade not found'],
    ['warning', '[UPGRADES] Researcher busy, skipping research'],
    ['warning', '[WATCHDOG] Ranked battle timeout'],
    ['warning', '[ARMY] Hero selection didn\'t open, skipping'],
    ['warning', '[RUSH_BH] Guard Post: already upgrading'],
    ['warning', '[RUSH_BH] Guard Post: not affordable'],
    ['warning', '[EQUIPMENT] Epic equipment not enabled, skipping'],
    ['warning', '[EQUIPMENT] Common equipment not enabled, skipping'],
    ['warning', '[MAIN]CG_TROOP_CHALLENGES in config: False'],
    ['error', '20:50:16 | [ADB ERROR] tap timed out after 10.0s'],
    ['error', '[WATCHDOG] Ranked battle timeout: error dismissed, retrying'],
    ['error', '[WATCHDOG] Device Error popup gone, resuming bot'],
    ['error', '[CLAN GAME] Saved screenshot of the failed open: C:\\logs\\failed (1).png'],
    ['error', '[RECOVERY] Emulator restarted after crash'],
    ['error', '[RAID][MATCH] Failed to save in-match debug image: output is locked'],
    ['error', '[LICENSE] ❌\uFE0F Server unavailable'],
    ['error', 'Crashed'],
    ['info', '20:50:19 | Insufficient loot for wall upgrades, waiting for 90%'],
    ['info', '[SEARCH] Previous timeout setting is 30 seconds'],
    ['info', 'The last attempt failed, but the bot is still running'],
  ];
  for (const [severity, message] of examples) assert.equal(logSeverity(message), severity, message);
});

test('monitor console still recognizes its own failures', () => {
  assert.equal(logSeverity('Bot stopped. code=0 signal=null', 'info'), 'info');
  assert.equal(logSeverity('Bot stopped. code=1 signal=null', 'info'), 'error');
  assert.equal(consoleIssues([{text:'Something went wrong.',type:'stderr',time:new Date().toISOString()}]).issues[0].severity,'error');
});

test('history reads archived files, orders rollover timestamps and refreshes appended issues', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'acbot-log-issues-'));
  t.after(async () => {
    for(const entry of await fs.readdir(dir))await fs.unlink(path.join(dir,entry));
    await fs.rmdir(dir);
  });
  const archive = path.join(dir,'log-2026-11-21_23-50.txt');
  const current = path.join(dir,'log-2026-11-22_11-20.txt');
  const old = path.join(dir,'log-2026-11-10_11-20.txt');
  const now = new Date(2026,10,22,13,0).getTime();
  await fs.writeFile(archive,'23:59:50 | [WATCHDOG] Ranked battle timeout\n00:00:17 | [RECOVERY] Emulator restarted after crash\n');
  await fs.writeFile(current,'11:20:01 | Found 2 collectors\n');
  await fs.writeFile(old,'11:20:01 | [ADB ERROR] old issue\n');
  const oldTime = new Date(2026,10,10,12,0);
  await fs.utimes(old,oldTime,oldTime);
  const read = createLogIssueReader(() => [archive,current,old]);
  const history = await read(dir,now);
  assert.deepEqual(history.issues.map(issue => issue.severity),['error','warning']);
  assert.equal(history.issues[0].time,new Date(2026,10,22,0,0,17).toISOString());
  assert.equal(history.issues[1].file,'log-2026-11-21_23-50.txt');
  await fs.appendFile(current,'11:21:10 | [UPGRADES] Suggested research not found\n');
  const updated = await read(dir,now);
  assert.equal(updated.issues.length,3);
  assert.match(updated.issues[0].text,/research not found/);
});
