import {logSeverity} from './log-severity.js';
import {createAccountRefresh} from './account-refresh.js';

const displayTime = time => new Date(time).toLocaleTimeString();

export function mountLogViewer({root, get, icon, signedIn, instanceId}) {
  const part = name => root.querySelector('[data-log-part="' + name + '"]');
  const source = part('source'), mode = part('mode'), severity = part('severity');
  const search = part('search'), content = part('content'), action = part('action');
  const summary = part('summary'), title = part('title'), count = part('count'), badge = part('badge');
  let rows = [], response = null, showing = false, paused = false, lastRender = '';
  const history = () => mode?.value === 'history';
  const levels = {warning: 'Warning', error: 'Error'};

  function updateAction() {
    const label = history() ? 'Refresh history' : paused ? 'Resume updates' : 'Pause updates';
    const symbol = history() ? 'refresh' : paused ? 'play' : 'pause';
    action.innerHTML = icon(symbol) + ' ' + label;
    badge.textContent = history() ? 'Issue history' : paused ? 'Paused' : 'Updating every 2s';
    action.disabled = !!instanceId && (!signedIn() || !instanceId());
  }

  function draw() {
    const query = search.value.trim().toLowerCase();
    const wanted = severity.value;
    const filtered = rows.filter(row => (wanted === 'all' || wanted === row.severity || (wanted === 'issues' && row.severity !== 'info')) && row.text.toLowerCase().includes(query));
    const atBottom = content.scrollHeight - content.clientHeight - content.scrollTop < 32;
    const emptyMessage = !signedIn() ? 'Connect your agent to start reading logs.'
      : instanceId && !instanceId() ? 'Choose an instance to view its log.' : 'No matching log messages.';
    const signature = JSON.stringify([history(), filtered, response?.message, emptyMessage]);
    if (signature === lastRender) return;
    lastRender = signature;
    content.classList.toggle('log-history', history());
    const fragment = document.createDocumentFragment();
    if (!filtered.length) {
      fragment.append(document.createTextNode(response?.message || emptyMessage));
    }
    for (const row of filtered) {
      const line = document.createElement('span');
      line.className = 'log-row log-' + row.severity;
      if (history()) {
        const meta = document.createElement('small');
        const time = row.time ? new Date(row.time).toLocaleString() : row.clock;
        meta.textContent = [levels[row.severity], time, row.file].filter(Boolean).join(' · ');
        line.append(meta);
      }
      line.append(document.createTextNode(row.text));
      fragment.append(line);
    }
    content.replaceChildren(fragment);
    count.textContent = `${filtered.length} ${history() ? 'issues' : 'lines'}`;
    if (!history() && atBottom) content.scrollTop = content.scrollHeight;
  }

  const loader = createAccountRefresh({
    async request(query, signal) {
      if (query.history) return get('/api/log-issues?' + new URLSearchParams({source: query.source}), {signal});
      if (!instanceId && query.source === 'console') {
        const result = await get('/api/console', {signal});
        return {rows: result.logs.map(log => ({text: `[${displayTime(log.time)}] ${log.text}`, severity: logSeverity(log.text, log.type)}))};
      }
      const key = encodeURIComponent(query.source);
      const route = instanceId ? '/api/instances/' + key + '/log' : '/api/logs/' + key + '/tail?lines=100';
      const result = await get(route, {signal});
      if (!result.available) return {name: result.name, rows: [], message: 'The log file is not available yet.'};
      if (instanceId) return result;
      return {rows: result.lines.split('\n').filter(Boolean).map(text => ({text, severity: logSeverity(text)}))};
    },
    render(result, query) {
      response = result;
      rows = result.issues || result.rows;
      if (query.history && !result.available) response.message = 'The log file is not available yet.';
      if (query.history && result.available && !rows.length) response.message = 'No warnings or errors found in the available logs.';
      title.textContent = instanceId ? result.name : query.source === 'console' ? 'monitor / console' : query.source;
      const notes = [];
      if (query.history) notes.push(result.console ? 'Recent events from the current monitor session.' : `Past ${result.windowDays} days of available ACBot logs.`);
      if (result.limited) notes.push('Showing the most recent results within the history limits.');
      if (result.unreadable) notes.push(`${result.unreadable} log file(s) could not be read.`);
      summary.textContent = notes.join(' ');
      draw();
      if (!query.history && rows.length && content.scrollTop === 0 && forcedScroll) content.scrollTop = content.scrollHeight;
      forcedScroll = false;
    },
    onState(state, message) {
      if (state === 'error') summary.textContent = 'Unable to load logs. ' + message;
      if (state === 'loading' && !response) summary.textContent = 'Loading logs…';
    },
  });
  let forcedScroll = false;

  function load(force = false) {
    if (!showing || !signedIn() || (!force && (paused || history()))) return;
    const selected = instanceId ? instanceId() : source.value || 'console';
    if (selected) return loader.load({source: selected, history: history()}, {force});
  }

  function changeView() {
    loader.stop();
    rows = [];
    response = null;
    summary.textContent = '';
    if (instanceId) title.textContent = 'ACBot log';
    content.scrollTop = 0;
    forcedScroll = true;
    updateAction();
    draw();
    void load(true);
  }
  if (source) source.onchange = changeView;
  if (mode) mode.onchange = changeView;
  search.oninput = draw;
  severity.onchange = draw;
  action.onclick = () => {
    if (history()) { void load(true); return; }
    paused = !paused;
    if (paused) loader.stop();
    else void load(true);
    updateAction();
  };
  return {
    show() { showing = true; forcedScroll = true; updateAction(); void load(!instanceId || !paused); },
    hide() { showing = false; loader.stop(); },
    tick() { void load(); },
    refresh() { if (showing || instanceId) changeView(); },
    reset() { loader.stop(); rows = []; response = null; summary.textContent = ''; updateAction(); draw(); },
  };
}
