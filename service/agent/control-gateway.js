// Discord Gateway lifecycle: persistent button routing, heartbeat ACKs and session resume.
function createControlGateway({ token, request, WebSocketClient, onReady, onInteraction, log = console.log, error = console.error, setTimer = setTimeout, clearTimer = clearTimeout, random = Math.random }) {
  let socket, retry, heartbeat, watchdog, stopped = false, sequence = null, sessionId = null, resumeUrl = null, gatewayUrl = null, failures = 0;
  const fatal = new Set([4004, 4010, 4011, 4012, 4013, 4014]);
  const clearConnectionTimers = () => { clearTimer(heartbeat); clearTimer(watchdog); heartbeat = watchdog = null; };
  const resetSession = () => { sessionId = resumeUrl = null; sequence = null; };
  function reconnect(delay) {
    if (stopped || retry) return;
    retry = setTimer(() => { retry = null; connect(); }, delay);
  }
  async function connect() {
    if (stopped) return;
    let ws;
    let failed = false, awaitingAck = false, interval = 0;
    function fail(reason, delay = Math.min(30000, 1000 * 2 ** Math.min(failures++, 5))) {
      if (failed || stopped || (ws && socket !== ws)) return;
      failed = true; clearConnectionTimers();
      if (socket === ws) socket = null;
      try { ws?.close(4000, 'Reconnecting'); } catch {}
      error('[control] Gateway reconnect: ' + reason);
      reconnect(delay);
    }
    function send(packet) {
      try { ws.send(JSON.stringify(packet)); return true; }
      catch { fail('send failed'); return false; }
    }
    function beat(checkAck = true) {
      if (failed || stopped || socket !== ws) return;
      if (checkAck && awaitingAck) { fail('heartbeat acknowledgement missing'); return; }
      if (send({ op: 1, d: sequence })) awaitingAck = true;
    }
    function scheduleBeat(delay) {
      heartbeat = setTimer(() => { beat(); if (!failed && !stopped) scheduleBeat(interval); }, delay);
    }
    try {
      if (!gatewayUrl) gatewayUrl = (await request(token, '/gateway/bot')).url;
      if (stopped) return;
      ws = new WebSocketClient((sessionId && resumeUrl ? resumeUrl : gatewayUrl).replace(/\/$/, '') + '/?v=10&encoding=json');
      socket = ws;
      watchdog = setTimer(() => fail('Hello timeout'), 30000);
      ws.onmessage = event => {
        if (failed || stopped || socket !== ws) return;
        let packet;
        try { packet = JSON.parse(String(event.data)); } catch { fail('invalid gateway packet'); return; }
        if (packet.s != null) sequence = packet.s;
        if (packet.op === 11) { awaitingAck = false; return; }
        if (packet.op === 1) { beat(false); return; }
        if (packet.op === 7) { fail('Discord requested reconnect', 1000); return; }
        if (packet.op === 9) {
          if (!packet.d) resetSession();
          fail('invalid session', 1000 + Math.floor(random() * 4000)); return;
        }
        if (packet.op === 10) {
          clearConnectionTimers();
          interval = Number(packet.d?.heartbeat_interval);
          if (!(interval > 0)) { fail('invalid heartbeat interval'); return; }
          awaitingAck = false; scheduleBeat(Math.floor(random() * interval));
          watchdog = setTimer(() => fail('session handshake timeout'), 30000);
          if (sessionId && sequence != null) send({ op: 6, d: { token, session_id: sessionId, seq: sequence } });
          else send({ op: 2, d: { token, intents: 0, properties: { os: 'windows', browser: 'discord-log-monitor', device: 'discord-log-monitor' } } });
          return;
        }
        if (packet.op !== 0) return;
        if (packet.t === 'READY') {
          clearTimer(watchdog); watchdog = null; failures = 0;
          sessionId = packet.d.session_id; resumeUrl = packet.d.resume_gateway_url;
          log('AutoClash control gateway connected.');
          Promise.resolve().then(() => onReady(packet.d)).catch(e => error('[control] Ready handler: ' + e.message));
        } else if (packet.t === 'RESUMED') {
          clearTimer(watchdog); watchdog = null; failures = 0;
          log('[control] Discord session resumed. Panel buttons are connected.');
        } else if (packet.t === 'INTERACTION_CREATE') {
          Promise.resolve().then(() => onInteraction(packet.d)).catch(e => error('[control] Interaction failed: ' + e.message));
        }
      };
      ws.onclose = event => {
        if (failed || stopped || socket !== ws) return;
        if (fatal.has(event.code)) {
          stopped = true; clearConnectionTimers(); socket = null;
          error('[control] Discord rejected the connection (code ' + event.code + '). Check bot credentials/settings.'); return;
        }
        if ([4007, 4009].includes(event.code)) resetSession();
        fail('socket closed (' + event.code + ')');
      };
      ws.onerror = () => fail('socket error');
    } catch { fail('connection could not be established'); }
  }
  return { start() { connect(); }, stop() { stopped = true; clearTimer(retry); retry = null; clearConnectionTimers(); const ws = socket; socket = null; try { ws?.close(1000, 'Stopped'); } catch {} } };
}
module.exports = { createControlGateway };
