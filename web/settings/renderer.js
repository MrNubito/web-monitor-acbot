const fields = [
  "discordToken",
  "fallbackChannelId",
  "checkIntervalSeconds",
  "stalledAfterSeconds",
  "maxLinesPerCheck",
  "maxStoredLines",
  "liveLogEnabled",
  "liveLogIntervalSeconds",
  "liveLogMaxThreadMessages",
  "cocVisualCheckEnabled",
  "cocVisualCheckIntervalSeconds",
  "adbRecoveryStopDelaySeconds",
  "adbRecoveryStartDelaySeconds",
  "screenshotRetentionHours",
  "screenshotMaxSizeMb",
  "autoRestartMode",
  "autoControlEnabled",
  "autoControlChannelId",
  "autoControlSendPanelOnStart",
  "autoControlAutoUpdateEnabled",
  "autoControlAdbPath",
  "mobileControlEnabled",
  "mobileControlHost",
  "mobileControlPort",
  "androidApkEnabled",
  "androidApkAlertsEnabled",
  "androidApkCheckSeconds",
  "androidApkIdleMinutes",
];

const form = document.getElementById("configForm");
const consoleOutput = document.getElementById("consoleOutput");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const logsList = document.getElementById("logsList");
const autoInstancesList = document.getElementById("autoInstancesList");
const autoStartInstancesList = document.getElementById("autoStartInstancesList");
const mobileUrlPreview = document.getElementById("mobileUrlPreview");

let logs = [];
let autoInstances = [];
let androidApkInstances = [];

function getConfig() {
  const config = {};
  for (const field of fields) {
    config[field] = document.getElementById(field).value.trim();
  }
  config.autoStartBot = document.getElementById("autoStartBot").checked ? "true" : "false";
  config.logs = getLogsFromDom();
  config.autoControlInstances = serializeAutoInstances(getAutoInstancesForSave());
  config.androidApkInstances = JSON.stringify(getAndroidApkInstances());
  return config;
}

function setConfig(config) {
  for (const field of fields) {
    document.getElementById(field).value = config[field] || "";
  }
  updateMobileUrlPreview();
  document.getElementById("autoStartBot").checked = String(config.autoStartBot || "false") === "true";
  logs = Array.isArray(config.logs) ? config.logs : [];
  autoInstances = parseAutoInstances(config.autoControlInstances || "");
  renderLogs();
  renderAutoInstances();
  renderAutoStartInstances();
  try { androidApkInstances = JSON.parse(config.androidApkInstances || "[]"); } catch { androidApkInstances = []; }
  renderAndroidApkInstances();
  setRunning(Boolean(config.botRunning));
}

function updateMobileUrlPreview() {
  if (!mobileUrlPreview) return;
  const host = document.getElementById("mobileControlHost")?.value.trim() || "0.0.0.0";
  const port = document.getElementById("mobileControlPort")?.value.trim() || "17891";
  const displayHost = host === "0.0.0.0" ? "YOUR_TAILSCALE_IP" : host;
  mobileUrlPreview.textContent = `http://${displayHost}:${port}`;
}

function getAndroidApkInstances() {
  return [...document.querySelectorAll('#androidApkInstancesList .android-apk-instance')].map(item => {
    const get = field => item.querySelector(`[data-apk-field='${field}']`).value.trim();
    return { id: item.dataset.apkId, label: get('label'), device: get('device'), packageName: get('packageName') || 'com.autoclash.app', channelId: get('channelId'), liveLogChannelId: get('liveLogChannelId'), autostart: get('autostart') === 'true', emulatorPath: get('emulatorPath'), emulatorIndex: get('emulatorIndex') };
  });
}
function renderAndroidApkInstances() {
  const list = document.getElementById('androidApkInstancesList');
  list.innerHTML = '';
  androidApkInstances.forEach((instance, index) => {
    const item = document.createElement('div');
    item.className = 'log-item android-apk-instance';
    item.dataset.apkId = instance.id || `apk${index + 1}`;
    item.innerHTML = `<div class="log-head"><label>Name<input data-apk-field="label" type="text" value="${escapeHtml(instance.label || 'ACBot APK')}" /></label><label>Discord channel ID<input data-apk-field="channelId" type="text" inputmode="numeric" value="${escapeHtml(instance.channelId || '')}" /></label><button type="button" class="danger remove-apk-instance">Remove</button></div><div class="two-columns"><label>ADB device<input data-apk-field="device" type="text" list="androidAdbDevices" placeholder="emulator-5556 or 127.0.0.1:5555" value="${escapeHtml(instance.device || '')}" /></label><label>Android package<input data-apk-field="packageName" type="text" value="${escapeHtml(instance.packageName || 'com.autoclash.app')}" /></label></div><label>Live log channel ID (optional)<input data-apk-field="liveLogChannelId" type="text" inputmode="numeric" placeholder="Leave blank to disable live logs" value="${escapeHtml(instance.liveLogChannelId || '')}" /></label>`;
    item.insertAdjacentHTML('beforeend', `<div class="two-columns"><label>Android Autostart<select data-apk-field="autostart"><option value="false">Manual only</option><option value="true">Start when Monitor opens</option></select></label><label>Emulator instance index<input data-apk-field="emulatorIndex" type="number" min="0" max="999" value="${escapeHtml(String(instance.emulatorIndex ?? ''))}" /></label></div><label>Emulator console executable<input data-apk-field="emulatorPath" type="text" placeholder="mumu-cli.exe or ldconsole.exe" value="${escapeHtml(instance.emulatorPath || '')}" /></label><div class="actions"><button type="button" class="secondary pick-apk-emulator">Choose emulator console</button><button type="button" class="start-apk">Start now</button><button type="button" class="secondary cancel-apk-start">Cancel start</button></div><p class="field-hint apk-start-progress">Uses the saved key in ACBot. Opens the emulator, authenticates, launches the game and presses Start. Checks for an already running bot.</p>`);
    item.querySelector('[data-apk-field=autostart]').value = instance.autostart === true || instance.autostart === 'true' ? 'true' : 'false';
    item.querySelector('.pick-apk-emulator').addEventListener('click', async () => { const selected = await window.monitorApp.pickExe(); if (selected) item.querySelector('[data-apk-field=emulatorPath]').value = selected; });
    item.querySelector('.start-apk').addEventListener('click', async () => {
      const button = item.querySelector('.start-apk'), hint = item.querySelector('.apk-start-progress');
      button.disabled = true; hint.textContent = 'Starting Android Autostart…';
      try { const result = await window.monitorApp.startAndroid(getConfig(), item.dataset.apkId); hint.textContent = result.alreadyRunning ? 'Bot is already running.' : 'Bot started successfully.'; }
      catch (error) { hint.textContent = error.message; }
      finally { button.disabled = false; }
    });
    item.querySelector('.cancel-apk-start').addEventListener('click', () => window.monitorApp.cancelAndroidStart(item.querySelector('[data-apk-field=device]').value.trim()));
    item.querySelector('.remove-apk-instance').addEventListener('click', () => { androidApkInstances = getAndroidApkInstances(); androidApkInstances.splice(index, 1); renderAndroidApkInstances(); });
    list.appendChild(item);
  });
}
window.monitorApp.onAndroidStartProgress(({ id, message }) => {
  const item = [...document.querySelectorAll('.android-apk-instance')].find(el => el.dataset.apkId === id);
  if (item) item.querySelector('.apk-start-progress').textContent = message;
});
document.getElementById('addAndroidApkInstance').addEventListener('click', () => {
  androidApkInstances = getAndroidApkInstances();
  if (androidApkInstances.length >= 25) return;
  androidApkInstances.push({ id: `apk${Date.now().toString(36)}`, label: `ACBot APK ${androidApkInstances.length + 1}`, device: '', packageName: 'com.autoclash.app', channelId: document.getElementById('autoControlChannelId').value.trim() || document.getElementById('fallbackChannelId').value.trim() });
  renderAndroidApkInstances();
});
document.getElementById('refreshAndroidDevices').addEventListener('click', async () => {
  const hint = document.getElementById('androidDevicesHint');
  try {
    const devices = await window.monitorApp.listAndroidDevices();
    document.getElementById('androidAdbDevices').innerHTML = devices.map(device => `<option value="${escapeHtml(device)}"></option>`).join('');
    hint.textContent = devices.length ? `Connected devices: ${devices.join(', ')}` : 'No authorized ADB devices found. Open the emulator and try again.';
  } catch (error) { hint.textContent = `Unable to list devices: ${error.message}`; }
});

function getLogsFromDom() {
  return [...logsList.querySelectorAll(".log-item")].map((item) => ({
    name: item.querySelector("[data-log-field='name']").value.trim(),
    path: item.querySelector("[data-log-field='path']").value.trim(),
    channelId: item.querySelector("[data-log-field='channelId']").value.trim(),
    channelName: item.querySelector("[data-log-field='channelName']").value.trim(),
  }));
}

function renderLogs() {
  logsList.innerHTML = "";

  logs.forEach((log, index) => {
    const item = document.createElement("div");
    item.className = "log-item";
    item.innerHTML = `
      <div class="log-head">
        <label>
          Name
          <input data-log-field="name" type="text" value="${escapeHtml(log.name || "")}" />
        </label>
        <label>
          Channel ID
          <input data-log-field="channelId" type="text" inputmode="numeric" value="${escapeHtml(log.channelId || "")}" />
        </label>
        <label>
          Channel name
          <input data-log-field="channelName" type="text" value="${escapeHtml(log.channelName || "")}" />
        </label>
        <button type="button" class="danger remove-log">Remove</button>
      </div>
      <label>
        Log folder or pattern
        <div class="path-row">
          <input data-log-field="path" type="text" value="${escapeHtml(log.path || "")}" />
          <button type="button" class="pick-log-folder">Browse</button>
        </div>
      </label>
    `;

    item.querySelector(".remove-log").addEventListener("click", () => {
      logs = getLogsFromDom();
      logs.splice(index, 1);
      renderLogs();
    });

    item.querySelector(".pick-log-folder").addEventListener("click", async () => {
      const folder = await window.monitorApp.pickFolder();
      if (folder) item.querySelector("[data-log-field='path']").value = folder;
    });

    logsList.appendChild(item);
  });
}

function parseAutoInstances(value) {
  return String(value || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item, index) => {
      const [id, label, exePath, device, version, active, emulator, emulatorIndex] = item.split("|");
      return {
        id: (id || `auto${index + 1}`).trim(),
        label: (label || `AutoClash ${index + 1}`).trim(),
        exePath: (exePath || "").trim(),
        device: (device || "").trim(),
        version: normalizeAutoVersion(version),
        active: parseAutoActive(active),
        emulator: normalizeEmulator(emulator),
        emulatorIndex: (emulatorIndex || "").trim(),
      };
    });
}

function serializeAutoInstances(instances) {
  return instances
    .filter((instance) => instance.id && instance.label && instance.exePath)
    .map((instance) =>
      [
        cleanInstancePart(instance.id),
        cleanInstancePart(instance.label),
        cleanInstancePart(instance.exePath),
        cleanInstancePart(instance.device),
        normalizeAutoVersion(instance.version),
        instance.active ? "true" : "false",
        normalizeEmulator(instance.emulator),
        cleanInstancePart(instance.emulatorIndex),
      ].join("|")
    )
    .join(";");
}

function cleanInstancePart(value) {
  return String(value || "").replace(/[|;]/g, " ").trim();
}

function getAutoInstancesFromDom() {
  return [...autoInstancesList.querySelectorAll(".auto-instance-item")].map((item) => ({
    id: item.querySelector("[data-auto-field='id']").value.trim(),
    label: item.querySelector("[data-auto-field='label']").value.trim(),
    exePath: item.querySelector("[data-auto-field='exePath']").value.trim(),
    device: normalizeAdbDevice(item.querySelector("[data-auto-field='device']").value),
    version: normalizeAutoVersion(item.querySelector("[data-auto-field='version']").value),
    emulator: normalizeEmulator(item.querySelector("[data-auto-field='emulator']").value),
    emulatorIndex: item.querySelector("[data-auto-field='emulatorIndex']").value.trim().replace(/[^0-9]/g, ""),
    active: Boolean(autoInstances[Number(item.dataset.autoIndex)]?.active),
  }));
}

function getAutoStartActiveByIndex() {
  const activeByIndex = new Map();
  autoStartInstancesList.querySelectorAll("[data-autostart-field='active']").forEach((input) => {
    activeByIndex.set(Number(input.dataset.autoIndex), input.checked);
  });
  return activeByIndex;
}

function getAutoInstancesForSave() {
  const activeByIndex = getAutoStartActiveByIndex();
  return getAutoInstancesFromDom().map((instance, index) => ({
    ...instance,
    active: activeByIndex.has(index) ? activeByIndex.get(index) : Boolean(autoInstances[index]?.active),
  }));
}

function normalizeAdbDevice(value) {
  const device = String(value || "").trim();
  if (!device) return "";
  if (device.includes(":")) return device;
  return `127.0.0.1:${device.replace(/[^0-9]/g, "")}`;
}

function adbPortFromDevice(value) {
  const device = String(value || "").trim();
  const match = device.match(/:(\d+)$/);
  return match ? match[1] : device;
}

function normalizeAutoVersion(value) {
  const version = String(value || "pro").trim().toLowerCase();
  return version === "basic" ? "basic" : "pro";
}

function normalizeEmulator(value) {
  const emulator = String(value || "auto").trim().toLowerCase();
  return ["auto", "ldplayer", "mumu", "memu", "bluestacks"].includes(emulator) ? emulator : "auto";
}

function parseAutoActive(value) {
  return ["1", "true", "yes", "on", "active"].includes(String(value || "").trim().toLowerCase());
}

function renderAutoInstances() {
  autoInstancesList.innerHTML = "";

  autoInstances.forEach((instance, index) => {
    const version = normalizeAutoVersion(instance.version);
    const emulator = normalizeEmulator(instance.emulator);
    const item = document.createElement("div");
    item.className = "log-item auto-instance-item";
    item.dataset.autoIndex = String(index);
    item.innerHTML = `
      <div class="auto-instance-header">
        <div>
          <div class="auto-instance-title">${escapeHtml(instance.label || `AutoClash ${index + 1}`)}</div>
          <div class="auto-instance-subtitle">${escapeHtml(instance.id || `auto${index + 1}`)}</div>
        </div>
        <div class="auto-instance-actions">
          <button type="button" class="danger remove-auto-instance">Remove</button>
        </div>
      </div>
      <div class="auto-instance-grid">
        <label>
          ID
          <input data-auto-field="id" type="text" value="${escapeHtml(instance.id || "")}" />
        </label>
        <label>
          Button name
          <input data-auto-field="label" type="text" value="${escapeHtml(instance.label || "")}" />
        </label>
        <label>
          ADB port
          <div class="adb-port-row">
            <span>127.0.0.1:</span>
            <input data-auto-field="device" type="text" inputmode="numeric" value="${escapeHtml(adbPortFromDevice(instance.device))}" placeholder="5555" />
          </div>
        </label>
        <label>
          Version
          <select data-auto-field="version">
            <option value="pro"${version === "pro" ? " selected" : ""}>PRO</option>
            <option value="basic"${version === "basic" ? " selected" : ""}>BASIC</option>
          </select>
        </label>
        <label>
          Emulator
          <select data-auto-field="emulator">
            <option value="auto"${emulator === "auto" ? " selected" : ""}>Auto detect</option>
            <option value="ldplayer"${emulator === "ldplayer" ? " selected" : ""}>LDPlayer</option>
            <option value="mumu"${emulator === "mumu" ? " selected" : ""}>MuMu Player</option>
            <option value="memu"${emulator === "memu" ? " selected" : ""}>MEmu</option>
            <option value="bluestacks"${emulator === "bluestacks" ? " selected" : ""}>BlueStacks</option>
          </select>
        </label>
        <label>
          Emulator index
          <input data-auto-field="emulatorIndex" type="text" inputmode="numeric" value="${escapeHtml(instance.emulatorIndex || "")}" placeholder="MuMu: 1 / LD: 6" />
          <span class="field-hint">Optional. Use this when one ADB port cannot identify the emulator.</span>
        </label>
      </div>
      <label>
        AutoClash folder or exe
        <div class="path-row">
          <input data-auto-field="exePath" type="text" value="${escapeHtml(instance.exePath || "")}" />
          <button type="button" class="pick-auto-exe">Browse</button>
        </div>
      </label>
    `;

    item.querySelector(".remove-auto-instance").addEventListener("click", () => {
      autoInstances = getAutoInstancesForSave();
      autoInstances.splice(index, 1);
      renderAutoInstances();
      renderAutoStartInstances();
    });

    item.querySelector(".pick-auto-exe").addEventListener("click", async () => {
      const selectedPath = await window.monitorApp.pickAutoClashPath();
      if (!selectedPath) return;

      item.querySelector("[data-auto-field='exePath']").value = selectedPath;

      const labelInput = item.querySelector("[data-auto-field='label']");
      const idInput = item.querySelector("[data-auto-field='id']");
      const versionInput = item.querySelector("[data-auto-field='version']");
      const inferredLabel = inferInstanceLabel(selectedPath);

      if (!labelInput.value.trim() || /^AutoClash \d+$/i.test(labelInput.value.trim())) {
        labelInput.value = inferredLabel;
      }

      if (!idInput.value.trim() || /^auto\d+$/i.test(idInput.value.trim())) {
        idInput.value = makeInstanceId(inferredLabel, index);
      }

      if (/basic/i.test(selectedPath)) {
        versionInput.value = "basic";
      }
    });

    autoInstancesList.appendChild(item);
  });
}

function renderAutoStartInstances() {
  autoStartInstancesList.innerHTML = "";

  if (autoInstances.length === 0) {
    const empty = document.createElement("div");
    empty.className = "autostart-empty";
    empty.textContent = "No AutoClash instances configured yet.";
    autoStartInstancesList.appendChild(empty);
    return;
  }

  autoInstances.forEach((instance, index) => {
    const item = document.createElement("div");
    item.className = `autostart-item${instance.active ? " enabled" : ""}`;
    item.innerHTML = `
      <div class="autostart-item-main">
        <div class="autostart-item-title">${escapeHtml(instance.label || `AutoClash ${index + 1}`)}</div>
        <div class="autostart-item-meta">ADB ${escapeHtml(instance.device || "not set")} · ${escapeHtml(normalizeAutoVersion(instance.version).toUpperCase())}</div>
        <div class="autostart-item-path">${escapeHtml(instance.exePath || "No folder or exe selected")}</div>
      </div>
      <label class="switch-control auto-active-toggle" title="Open this AutoClash on app AutoStart and allow automatic ADB checks/recovery.">
        <input data-autostart-field="active" data-auto-index="${index}" type="checkbox"${instance.active ? " checked" : ""} />
        <span class="switch-track" aria-hidden="true"></span>
        <span class="switch-text">${instance.active ? "Enabled" : "Disabled"}</span>
      </label>
    `;

    const input = item.querySelector("[data-autostart-field='active']");
    input.addEventListener("change", () => {
      autoInstances = getAutoInstancesFromDom();
      autoInstances[index].active = input.checked;
      item.classList.toggle("enabled", input.checked);
      item.querySelector(".switch-text").textContent = input.checked ? "Enabled" : "Disabled";
    });

    autoStartInstancesList.appendChild(item);
  });
}

function inferInstanceLabel(filePath) {
  const parts = String(filePath || "").split(/[\\/]+/);
  const fileName = parts.pop() || "AutoClash";
  const folderName = parts.pop() || fileName.replace(/\.exe$/i, "");
  return folderName.replace(/^AutoClash\s*-\s*/i, "").trim() || "AutoClash";
}

function makeInstanceId(label, index) {
  const id = String(label || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return id || `auto${index + 1}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function setRunning(running) {
  statusDot.classList.toggle("running", running);
  statusDot.classList.toggle("stopped", !running);
  statusText.textContent = running ? "Running" : "Stopped";
}

function appendConsole(entry) {
  if (!entry.text) return;
  consoleOutput.textContent += `[${entry.time}] ${entry.text}\n`;
  consoleOutput.scrollTop = consoleOutput.scrollHeight;
}

async function saveConfig() {
  const nextConfig = await window.monitorApp.saveConfig(getConfig());
  setConfig(nextConfig);
  appendConsole({ time: new Date().toLocaleTimeString(), text: "Configuration saved." });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveConfig();
});

document.getElementById("addLog").addEventListener("click", () => {
  logs = getLogsFromDom();
  logs.push({
    name: `Log${logs.length + 1}`,
    path: "",
    channelId: "",
    channelName: `log-${logs.length + 1}`,
  });
  renderLogs();
});

document.getElementById("addAutoInstance").addEventListener("click", () => {
  autoInstances = getAutoInstancesForSave();
  const next = autoInstances.length + 1;
  autoInstances.push({
    id: `auto${next}`,
    label: `AutoClash ${next}`,
    exePath: "",
    device: "",
    version: "pro",
    active: false,
  });
  renderAutoInstances();
  renderAutoStartInstances();
});

document.getElementById("startBot").addEventListener("click", async () => {
  await saveConfig();
  const status = await window.monitorApp.startBot();
  setRunning(status.running);
});

document.getElementById("stopBot").addEventListener("click", async () => {
  const status = await window.monitorApp.stopBot();
  setRunning(status.running);
});

document.getElementById("clearConsole").addEventListener("click", () => {
  consoleOutput.textContent = "";
});

document.getElementById("minimizeWindow").addEventListener("click", () => {
  window.monitorApp.minimizeWindow();
});

document.getElementById("maximizeWindow").addEventListener("click", () => {
  window.monitorApp.toggleMaximizeWindow();
});

document.getElementById("closeWindow").addEventListener("click", () => {
  window.monitorApp.closeWindow();
});

document.querySelectorAll(".tab-button").forEach((button) => {
  button.addEventListener("click", () => {
    const target = button.getAttribute("data-tab");

    document.querySelectorAll(".tab-button").forEach((tab) => {
      tab.classList.toggle("active", tab === button);
    });

    document.querySelectorAll(".tab-panel").forEach((panel) => {
      panel.classList.toggle("active", panel.id === target);
    });
  });
});

document.querySelectorAll(".config-tab-button").forEach((button) => {
  button.addEventListener("click", () => {
    const target = button.getAttribute("data-config-tab");
    autoInstances = getAutoInstancesForSave();
    if (target === "autostartConfig") {
      renderAutoStartInstances();
    }

    document.querySelectorAll(".config-tab-button").forEach((tab) => {
      tab.classList.toggle("active", tab === button);
    });

    document.querySelectorAll(".config-panel").forEach((panel) => {
      panel.classList.toggle("active", panel.id === target);
    });
  });
});

["mobileControlHost", "mobileControlPort"].forEach((field) => {
  document.getElementById(field)?.addEventListener("input", updateMobileUrlPreview);
});

window.monitorApp.onBotLog(appendConsole);
window.monitorApp.onBotStatus((status) => setRunning(status.running));

window.monitorApp.loadConfig().then(setConfig);
window.monitorApp.getBotStatus().then((status) => setRunning(status.running));
