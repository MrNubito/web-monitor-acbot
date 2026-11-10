const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const crypto = require('crypto');

function redact(text) {
  if (/licen[cs]e|password|api[_ -]?key|\btoken\b/i.test(text)) return '[Sensitive app log omitted]';
  return String(text).replace(/AC-[A-Z0-9-]{8,}/gi, '[redacted]').replace(/```/g, "'''").slice(0, 700);
}
function configFromEnv(env) {
  const enabled = env.ANDROID_APK_ENABLED === 'true';
  let instances;
  try { instances = JSON.parse(env.ANDROID_APK_INSTANCES || '[]'); } catch { throw Error('Android APK instance settings are not valid. Save the Android APK tab again.'); }
  if (!Array.isArray(instances) || instances.length > 25) throw Error('Configure up to 25 Android APK instances.');
  const ids = new Set();
  instances = instances.map((item, index) => {
    const id = String(item.id || `apk${index + 1}`);
    const device = String(item.device || '').trim();
    const packageName = String(item.packageName || 'com.autoclash.app').trim();
    const channelId = String(item.channelId || env.AUTOCONTROL_CHANNEL_ID || env.DISCORD_CHANNEL_ID || '').trim();
    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(id) || ids.has(id)) throw Error('Android APK instance IDs must be unique letters, numbers or hyphens.');
    if (!/^[a-zA-Z0-9_.:[\]-]{1,150}$/.test(device)) throw Error(`Set a valid ADB device for Android APK ${index + 1}.`);
    if (!/^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(packageName)) throw Error('Set a valid Android package name.');
    if (!/^\d{10,22}$/.test(channelId)) throw Error('Set a Discord channel ID for each Android APK instance.');
    const liveLogChannelId = String(item.liveLogChannelId || '').trim();
    if (liveLogChannelId && !/^\d{10,22}$/.test(liveLogChannelId)) throw Error('Set a valid live log channel ID or leave it blank.');
    ids.add(id);
    return { id, label: String(item.label || `ACBot APK ${index + 1}`).slice(0, 100), device, packageName, channelId, liveLogChannelId, autostart: item.autostart === true || item.autostart === 'true', emulatorPath: String(item.emulatorPath || '').trim(), emulatorIndex: String(item.emulatorIndex ?? '').trim() };
  });
  const number = (value, fallback, min, max) => Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max ? Number(value) : fallback;
  return { enabled, instances, adbPath: env.AUTOCONTROL_ADB_PATH || '', checkSeconds: number(env.ANDROID_APK_CHECK_SECONDS, 15, 10, 300), idleMinutes: number(env.ANDROID_APK_IDLE_MINUTES, 10, 1, 240), alertsEnabled: env.ANDROID_APK_ALERTS_ENABLED !== 'false' };
}
function parseLog(line) {
  const match = line.match(/^\s*(\d{9,}(?:\.\d+)?)\s+(\d+)\s+\d+\s+[VDIWEF]\s+([^:]+):\s?(.*)$/);
  if (!match || !/^(python\.(stdout|stderr))$|acbot|autoclash/i.test(match[3].trim())) return null;
  return { timestamp: Number(match[1]) * 1000, pid: match[2], text: redact(match[4]), fingerprint: crypto.createHash('sha1').update(line).digest('hex') };
}
const states = {
  working: { label: '🟢 Working — recent app activity', color: 3066993 },
  idle: { label: '🟡 No recent activity', color: 16705372 },
  closed: { label: '🔴 App closed', color: 15158332 },
  disconnected: { label: '⚫ Emulator disconnected', color: 6323595 },
  paused: { label: '⏸ Paused / stopped in app', color: 9807270 },
  unknown: { label: '🟡 Waiting for app activity', color: 16705372 },
  error: { label: '⚠ Monitoring unavailable', color: 15105570 },
};
class ApkObservation {
  constructor(instance, now) {
    Object.assign(this, { instance, startedAt: now, attachedAt: now, pid: '', primed: false, lastActivityAt: null, lastCheckAt: null, attacks: 0, donations: 0, attackStarts: 0, latestStars: null, recent: [], livePending: [], seen: new Set(), paused: false, clockOffset: 0, status: 'unknown', error: '', candidate: '', consecutive: 0, alerted: false, lastAlertAt: 0 });
  }
  ingest(raw, now, baseline = false) {
    let changed = false;
    for (const line of raw.split(/\r?\n/)) {
      const entry = parseLog(line);
      if (!entry || entry.pid !== this.pid || this.seen.has(entry.fingerprint)) continue;
      this.seen.add(entry.fingerprint);
      if (this.seen.size > 5000) this.seen.delete(this.seen.values().next().value);
      const at = Math.min(now, entry.timestamp + this.clockOffset);
      this.lastActivityAt = Math.max(this.lastActivityAt || 0, at);
      this.recent.push({ at, text: entry.text });
      if (this.recent.length > 100) this.recent.shift();
      if (/\b(?:BOT|AUTOMATION)\s+(?:IS\s+)?(?:PAUSED|STOPPED)\b/i.test(entry.text)) this.paused = true;
      if (/\b(?:BOT|AUTOMATION)\s+(?:IS\s+)?(?:STARTED|RESUMED|RUNNING)\b|\bATTACK\s+(?:START|FINISHED|COMPLETED)\b/i.test(entry.text)) this.paused = false;
      if (!baseline) {
        if (this.instance.liveLogChannelId) {
          this.livePending.push({ at, text: entry.text });
          if (this.livePending.length > 2000) this.livePending.shift();
        }
        if (/\bRequest found\.\s*Donating now\b/i.test(entry.text)) this.donations++;
        if (/\bATTACK\s+START\b/i.test(entry.text)) this.attackStarts++;
        if (/\bATTACK\s+(?:FINISHED|COMPLETED)\b/i.test(entry.text)) this.attacks++;
        const stars = entry.text.match(/Battle stars:\s*([0-3])\b/i);
        if (stars) this.latestStars = Number(stars[1]);
      }
      changed = true;
    }
    return changed;
  }
  activityState(now, idleMinutes) {
    if (this.paused) return 'paused';
    if (!this.lastActivityAt) return now - this.attachedAt >= idleMinutes * 60000 ? 'idle' : 'unknown';
    return now - this.lastActivityAt >= idleMinutes * 60000 ? 'idle' : 'working';
  }
  transition(status, now, enabled) {
    this.status = status;
    if (this.candidate === status) this.consecutive++; else { this.candidate = status; this.consecutive = 1; }
    if (!enabled || this.consecutive < 2) return null;
    const unhealthy = ['idle', 'closed', 'disconnected', 'error'].includes(status);
    if (unhealthy && this.alerted !== status && (!this.lastAlertAt || now - this.lastAlertAt >= 5 * 60000)) {
      this.alerted = status; this.lastAlertAt = now;
      return `⚠ **${this.instance.label}**: ${states[status].label}. ${status === 'idle' ? 'The APK is open but no recent app logs were observed. It may be waiting, paused or blocked. No automatic restart was performed.' : 'Check the instance. No automatic restart was performed.'}`;
    }
    if (!unhealthy && status !== 'unknown' && this.alerted) {
      this.alerted = false;
      return `✅ **${this.instance.label}**: ${states[status].label}.`;
    }
    return null;
  }
}
function makePanel(observation, idleMinutes, includeButtons = true) {
  const s = observation;
  const timestamp = value => value ? `<t:${Math.floor(value / 1000)}:R>` : 'Not observed yet';
  const current = states[s.status] || states.unknown;
  const text = value => String(value).replace(/[`*_~<>@]/g, '\\$&');
  return {
    embeds: [{ title: `${s.instance.label} · Android APK`, color: current.color,
      description: `${current.label}\n${s.error ? text(s.error).slice(0, 500) + '\n' : ''}${s.status === 'idle' ? 'No recent logs does not prove the app is blocked; it may be waiting or paused.\n' : ''}`,
      fields: [
        { name: 'Last Activity', value: timestamp(s.lastActivityAt), inline: true },
        { name: 'Donations', value: String(s.donations), inline: true },
        { name: 'Observed Attack Completions', value: String(s.attacks), inline: true },
        { name: 'Last Reported Battle Stars', value: s.latestStars == null ? 'Not observed yet' : String(s.latestStars), inline: true },
        { name: 'Observation Started', value: timestamp(s.startedAt), inline: true },
        { name: 'Last Monitor Check', value: timestamp(s.lastCheckAt), inline: true },
        { name: 'Inactivity Threshold', value: `${idleMinutes} min`, inline: true },
        { name: 'Latest App Message', value: text(s.recent.at(-1)?.text || 'Waiting for app logs.').slice(0, 900) },
      ], footer: { text: 'Observed while this monitor is running · not official ACBot totals · no automatic restarts' } }],
    components: includeButtons ? [{ type: 1, components: [
      { type: 2, style: 1, label: 'Status', custom_id: `android:${s.instance.id}:status` },
      { type: 2, style: 2, label: 'Recent Logs', custom_id: `android:${s.instance.id}:logs` },
      { type: 2, style: 2, label: 'Screenshot', custom_id: `android:${s.instance.id}:screen` },
    ] }] : [], allowed_mentions: { parse: [] },
  };
}
function defaultRun(adbPath, args, binary = false) {
  return new Promise(resolve => execFile(adbPath, args, { encoding: binary ? null : 'utf8', windowsHide: true, timeout: 10000, maxBuffer: binary ? 16 * 1024 * 1024 : 4 * 1024 * 1024 }, (error, stdout, stderr) => resolve({ code: error?.code || 0, stdout: stdout || (binary ? Buffer.alloc(0) : ''), stderr: String(stderr || '') })));
}
function createAndroidApkMonitor({ env = process.env, sendPayload, editPayload, sendAlert, createThread, request, guildId, run = defaultRun, now = Date.now, stateFile = path.join(process.cwd(), 'android-apk-state.json') }) {
  const config = configFromEnv(env);
  const observations = config.instances.map(instance => new ApkObservation(instance, now()));
  const messages = {};
  try { Object.assign(messages, JSON.parse(fs.readFileSync(stateFile, 'utf8'))); } catch {}
  let stopped = false, checking = false, timer;
  const lastPayloads = new Map();
  const adb = (s, args, binary) => run(config.adbPath, ['-s', s.instance.device, ...args], binary);
  async function poll(s) {
    const at = now(); s.lastCheckAt = at; s.error = '';
    if (s.instance.device.includes(':')) await run(config.adbPath, ['connect', s.instance.device]);
    const connection = await adb(s, ['get-state']);
    if (connection.code || String(connection.stdout).trim() !== 'device') return 'disconnected';
    const pid = await adb(s, ['shell', 'pidof', s.instance.packageName]);
    const pids = String(pid.stdout).trim().split(/\s+/).filter(v => /^\d+$/.test(v));
    if (!pids.length) {
      if (pid.code && pid.code !== 1) { s.error = 'Unable to check the app process.'; return 'error'; }
      s.pid = ''; s.primed = false; return 'closed';
    }
    const changed = s.pid !== pids[0];
    if (changed) {
      s.pid = pids[0]; s.primed = false; s.paused = false; s.lastActivityAt = null; s.attachedAt = at;
      const clock = await adb(s, ['shell', 'date', '+%s']);
      const seconds = Number(String(clock.stdout).trim());
      s.clockOffset = !clock.code && Number.isFinite(seconds) && seconds > 0 ? at - seconds * 1000 : 0;
    }
    const logs = await adb(s, ['logcat', '-d', '-v', 'epoch', '--pid=' + s.pid, '-t', '1000']);
    if (logs.code || /permission denied|unknown option|invalid option/i.test(logs.stderr)) { s.error = 'App logs could not be read through ADB.'; return 'error'; }
    s.ingest(String(logs.stdout), at, !s.primed);
    s.primed = true;
    return s.activityState(at, config.idleMinutes);
  }
  async function publish(s) {
    const payload = makePanel(s, config.idleMinutes);
    const signature = JSON.stringify(payload);
    const published = lastPayloads.get(s.instance.id);
    if (published?.signature === signature || (published?.status === s.status && now() - published.at < 30000)) return;
    const prior = messages[s.instance.id];
    const valid = prior && prior.channelId === s.instance.channelId;
    if (valid) {
      try { await editPayload(s.instance.channelId, prior.messageId, payload); }
      catch (error) { if (!/404|unknown message|10008/i.test(error.message)) throw error; delete messages[s.instance.id]; }
    }
    if (!messages[s.instance.id] || !valid) {
      const message = await sendPayload(s.instance.channelId, payload);
      messages[s.instance.id] = { channelId: s.instance.channelId, messageId: message.id };
      const temp = stateFile + '.tmp';
      fs.writeFileSync(temp, JSON.stringify(messages, null, 2)); fs.renameSync(temp, stateFile);
    }
    lastPayloads.set(s.instance.id, { signature, at: now(), status: s.status });
  }
  function saveMessages() {
    const temp = stateFile + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(messages, null, 2)); fs.renameSync(temp, stateFile);
  }
  async function liveThread(s) {
    const key = 'live:' + s.instance.id;
    const previous = messages[key];
    if (previous?.channelId === s.instance.liveLogChannelId && previous.threadId && (previous.count || 0) < 10000) return previous;
    if (!createThread) throw Error('Discord thread creation is unavailable. Restart the monitor.');
    const thread = await createThread(s.instance.liveLogChannelId, (s.instance.label + ' live log').slice(0, 100));
    messages[key] = { channelId: s.instance.liveLogChannelId, threadId: thread.id, count: 0 };
    saveMessages(); return messages[key];
  }
  async function sendLive(s, payload) {
    let thread = await liveThread(s);
    try { await sendPayload(thread.threadId, payload); }
    catch (error) {
      if (!/404|unknown channel|10003|50083|thread.*archived/i.test(error.message)) throw error;
      delete messages['live:' + s.instance.id];
      thread = await liveThread(s);
      await sendPayload(thread.threadId, payload);
    }
    thread.count++; saveMessages();
  }
  async function flushLiveLog(s) {
    if (!s.instance.liveLogChannelId) return;
    // Send bounded batches; remove entries only after Discord accepts them.
    for (let batch = 0; batch < 5 && s.livePending.length; batch++) {
      let content = '', count = 0;
      for (const entry of s.livePending) {
        const line = `${new Date(entry.at).toISOString()} ${entry.text}\n`;
        if (content.length + line.length > 1700) break;
        content += line; count++;
      }
      if (!count) break;
      await sendLive(s, { content: `**Android APK live log**\n\`\`\`text\n${content}\`\`\``, allowed_mentions: { parse: [] } });
      s.livePending.splice(0, count);
    }
  }
  async function tick() {
    if (stopped || checking || !config.enabled) return;
    checking = true;
    try {
      for (const s of observations) {
        if (stopped) break;
        let status;
        try { status = await poll(s); } catch { status = 'error'; s.error = 'Unable to read APK status. Check ADB settings.'; }
        const previous = { alerted: s.alerted, lastAlertAt: s.lastAlertAt };
        const alert = s.transition(status, now(), config.alertsEnabled);
        if (alert && sendAlert) {
          try { await sendAlert(s.instance.channelId, alert); }
          catch (error) { Object.assign(s, previous); console.error('[android] Alert delivery failed:', error.message); }
        }
        try { await flushLiveLog(s); } catch (error) { console.error('[android] Live log delivery failed:', error.message); }
        try { await publish(s); } catch (error) { console.error('[android] Status panel failed:', error.message); }
      }
    } finally { checking = false; }
  }
  async function callback(control, interaction, type, data) {
    return request(control.token, `/interactions/${interaction.id}/${interaction.token}/callback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, data }) });
  }
  async function handle(control, interaction) {
    const custom = interaction.data?.custom_id || '';
    const command = interaction.type === 2 && interaction.data?.name === 'acbot-android';
    if (!command && !custom.startsWith('android:')) return false;
    const authorizedGuild = guildId?.() || control.uploadGuildId;
    if (!authorizedGuild || interaction.guild_id !== authorizedGuild || !(BigInt(interaction.member?.permissions || '0') & 8n)) {
      await callback(control, interaction, 4, { content: 'Android APK monitoring controls are available to administrators of the configured server.', flags: 64 }); return true;
    }
    if (!config.enabled || !observations.length) { await callback(control, interaction, 4, { content: 'Enable Android APK monitoring and add an instance in the desktop app.', flags: 64 }); return true; }
    const parts = custom.split(':');
    const s = command ? observations[0] : observations.find(v => v.instance.id === parts[1]);
    const action = command ? 'status' : parts[2];
    if (!s) { await callback(control, interaction, 4, { content: 'This Android APK instance is no longer configured.', flags: 64 }); return true; }
    if (action === 'status') {
      const payload = makePanel(s, config.idleMinutes, true);
      await callback(control, interaction, 4, { ...payload, flags: 64 });
    } else if (action === 'logs') {
      const logs = s.recent.slice(-12).map(v => `${new Date(v.at).toISOString()} ${v.text}`).join('\n');
      await callback(control, interaction, 4, { content: `**Recent APK logs (may include messages from before observation started)**\n\`\`\`text\n${(logs || 'No app logs observed yet.').slice(-1700)}\n\`\`\``, flags: 64, allowed_mentions: { parse: [] } });
    } else if (action === 'screen') {
      await callback(control, interaction, 5, { flags: 64 });
      try {
        const screen = await adb(s, ['exec-out', 'screencap', '-p'], true);
        if (screen.code || !Buffer.isBuffer(screen.stdout) || !screen.stdout.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw Error('The emulator screenshot could not be captured.');
        const form = new FormData();
        form.append('payload_json', JSON.stringify({ content: `Screenshot · ${s.instance.label}`, attachments: [{ id: 0, filename: 'acbot-apk.png' }], allowed_mentions: { parse: [] } }));
        form.append('files[0]', new Blob([screen.stdout], { type: 'image/png' }), 'acbot-apk.png');
        await request(control.token, `/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`, { method: 'PATCH', body: form });
      } catch (error) {
        await request(control.token, `/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: error.message, allowed_mentions: { parse: [] } }) });
      }
    } else await callback(control, interaction, 4, { content: 'Unknown Android monitoring action.', flags: 64 });
    return true;
  }
  return { config, observations, tick, handle, async start() { if (!config.enabled) return; if (!config.adbPath || !fs.existsSync(config.adbPath)) throw Error('Set a valid ADB executable under AutoClash settings.'); await tick(); timer = setInterval(() => tick().catch(e => console.error('[android]', e.message)), config.checkSeconds * 1000); timer.unref(); }, stop() { stopped = true; clearInterval(timer); } };
}
module.exports = { configFromEnv, parseLog, redact, ApkObservation, makePanel, createAndroidApkMonitor };
