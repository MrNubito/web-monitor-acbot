import {syncAccountOptions} from './account-dom.js';
import {mountLogViewer} from './log-viewer.js';
import {createVideoLiveView} from './video-live.js';

export function mountDiagnostics({root, get, open, icon, signedIn}) {
  const select = root.querySelector('#diagnosticInstance');
  const video = root.querySelector('#diagnosticVideo');
  const quality = root.querySelector('#diagnosticQuality');
  const toggle = root.querySelector('#diagnosticLive');
  const placeholder = root.querySelector('#diagnosticVideoPlaceholder');
  const status = root.querySelector('#diagnosticVideoStatus');
  const logs = mountLogViewer({root, get, icon, signedIn, instanceId: () => select.value});
  const live = createVideoLiveView({
    video,
    open,
    quality: () => quality.value,
    onState(state, message) {
      const running = state === 'live' || state === 'connecting';
      toggle.innerHTML = icon(running ? 'stop' : 'live') + (running ? ' Stop live' : ' Start live');
      status.textContent = message;
      status.dataset.state = state;
      placeholder.hidden = state === 'live';
      placeholder.textContent = state === 'error' ? 'Video unavailable' : state === 'connecting'
        ? 'Connecting to the emulator…' : 'Start live to view the emulator.';
    },
  });
  let instance = '';
  let showing = false;

  function syncSelection() {
    const selected = select.value;
    toggle.disabled = !signedIn() || !selected;
    if (instance === selected) return;
    instance = selected;
    const restart = live.active && !!selected && showing && signedIn();
    if (restart) live.start(selected);
    else live.stop(selected ? 'Ready to start live video' : 'Choose an instance');
    logs.refresh();
  }

  select.onchange = syncSelection;
  toggle.onclick = () => {
    if (live.active) live.stop();
    else if (showing && signedIn() && instance) live.start(instance);
  };
  quality.onchange = () => { if (live.active) live.start(instance); };

  function setInstances(instances, preferredId) {
    const previous = select.value;
    syncAccountOptions(select, instances.length ? instances : [{id: '', label: 'No instances available'}]);
    if (!previous && instances.some(item => item.id === preferredId)) select.value = preferredId;
    select.disabled = !instances.length;
    syncSelection();
  }

  return {
    setInstances,
    show() { showing = true; logs.show(); },
    hide() { showing = false; if (live.active) live.stop(); logs.hide(); },
    tick() { logs.tick(); },
    suspend() { if (live.active) live.stop(); },
    disconnect() { if (showing || live.active) live.stop('Agent disconnected'); logs.reset(); },
    reset() { setInstances([]); logs.reset(); },
  };
}
