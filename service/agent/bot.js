const fs = require("fs");
const path = require("path");
const { execFile, spawn } = require("child_process");
const { saveAttachment, folderChoices } = require("./autoclash-upload");
const { createProfileEditor } = require("./profile-config");
const { createAndroidApkMonitor, configFromEnv: androidApkConfigFromEnv } = require("./android-apk-monitor");
const { createControlGateway } = require("./control-gateway");
let androidApkMonitor = null;
const profileEditor = createProfileEditor({ request: discordRequest, rootForInstance: autoClashRootDir, restartInstance: restartAutoClashAfterConfigSave, busy: () => autoClashUpdateRecoveryRunning });
const WebSocketClient = globalThis.WebSocket || require("ws");

const STATE_FILE = path.join(process.cwd(), "bot-state.json");
const MOBILE_NOTIFICATIONS_FILE = path.join(process.cwd(), "mobile-notifications.json");
const SCREENSHOT_DIR = path.join(process.cwd(), "control-screenshots");
const selectedAutoControlInstances = new Map();
const restartLogsByKey = new Map();
let autoClashUpdateOperation = null;
let autoClashUpdateRecoveryRunning = false;
let lastAutoClashUpdaterScanAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withAutoClashUpdateLock(label, waitForTurn, task) {
  while (autoClashUpdateOperation) {
    if (!waitForTurn) return { busy: true, owner: autoClashUpdateOperation.label };
    await autoClashUpdateOperation.promise.catch(() => {});
  }

  let release;
  const operation = {
    label,
    promise: new Promise((resolve) => {
      release = resolve;
    }),
  };
  autoClashUpdateOperation = operation;

  try {
    return await task();
  } finally {
    if (autoClashUpdateOperation === operation) autoClashUpdateOperation = null;
    release();
  }
}

function parseNumberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function listFilesRecursive(directory) {
  if (!fs.existsSync(directory)) return [];

  const files = [];
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

function removeEmptyDirectories(directory) {
  if (!fs.existsSync(directory)) return;

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      removeEmptyDirectories(path.join(directory, entry.name));
    }
  }

  if (directory !== SCREENSHOT_DIR && fs.existsSync(directory) && fs.readdirSync(directory).length === 0) {
    fs.rmdirSync(directory);
  }
}

function deleteFileQuietly(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // Cleanup should never stop the bot.
  }
}

function cleanMobileNotificationText(value) {
  return String(value || "")
    .replace(/```(?:text)?/g, "")
    .replace(/`/g, "")
    .replace(/\*\*/g, "")
    .replace(/@everyone\s*/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 900);
}

function mobileNotificationSeverity(message) {
  const text = String(message || "").toLowerCase();
  if (text.includes("failed") || text.includes("error") || text.includes("stalled") || text.includes("alert")) return "error";
  if (text.includes("recovery") || text.includes("restart") || text.includes("stopped")) return "warning";
  if (text.includes("completed") || text.includes("finished") || text.includes("started")) return "success";
  return "info";
}

function shouldRecordMobileNotification(message) {
  const text = String(message || "");
  if (!text.trim()) return false;
  if (/live log/i.test(text) || /^Live thread rotated:/i.test(text)) return false;
  if (/last 10 lines/i.test(text)) return false;
  return true;
}

function recordMobileNotification(source, message, options = {}) {
  if (!shouldRecordMobileNotification(message)) return;
  try {
    const existing = fs.existsSync(MOBILE_NOTIFICATIONS_FILE)
      ? JSON.parse(fs.readFileSync(MOBILE_NOTIFICATIONS_FILE, "utf8"))
      : [];
    const items = Array.isArray(existing) ? existing : [];
    const cleanMessage = cleanMobileNotificationText(message);
    const item = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      time: new Date().toISOString(),
      source: source || "AutoClash",
      title: options.title || source || "AutoClash",
      severity: options.severity || mobileNotificationSeverity(cleanMessage),
      message: cleanMessage,
    };
    items.push(item);
    fs.writeFileSync(MOBILE_NOTIFICATIONS_FILE, JSON.stringify(items.slice(-200), null, 2), "utf8");
  } catch (error) {
    console.warn(`[mobile] Could not write notification feed: ${error.message}`);
  }
}

function requireReadableFile(filePath, label = "file") {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`${label} was not created: ${filePath || "empty path"}`);
  }

  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size <= 0) {
    throw new Error(`${label} is empty or not a file: ${filePath}`);
  }
}

function cleanupScreenshots(options = {}) {
  const maxAgeHours = options.maxAgeHours || parseNumberEnv("SCREENSHOT_RETENTION_HOURS", 24);
  const maxBytes = Math.floor((options.maxSizeMb || parseNumberEnv("SCREENSHOT_MAX_SIZE_MB", 1500)) * 1024 * 1024);
  const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;

  let fileStats = listFilesRecursive(SCREENSHOT_DIR)
    .map((filePath) => {
      try {
        const stat = fs.statSync(filePath);
        return { filePath, size: stat.size, mtimeMs: stat.mtimeMs };
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  for (const file of fileStats) {
    if (file.mtimeMs < cutoff) {
      deleteFileQuietly(file.filePath);
    }
  }

  fileStats = listFilesRecursive(SCREENSHOT_DIR)
    .map((filePath) => {
      try {
        const stat = fs.statSync(filePath);
        return { filePath, size: stat.size, mtimeMs: stat.mtimeMs };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.mtimeMs - b.mtimeMs);

  let totalBytes = fileStats.reduce((sum, file) => sum + file.size, 0);
  for (const file of fileStats) {
    if (totalBytes <= maxBytes) break;
    deleteFileQuietly(file.filePath);
    totalBytes -= file.size;
  }

  try {
    removeEmptyDirectories(SCREENSHOT_DIR);
  } catch {
    // Empty directory cleanup is best-effort.
  }
}

function isRetryableDiscordStatus(status) {
  return status === 429 || status >= 500;
}

async function fetchDiscordWithRetry(url, options, label) {
  const delays = [1200, 3500, 8000];
  let lastText = "";
  let lastStatus = 0;

  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    const response = await fetch(url, options);
    lastStatus = response.status;
    lastText = await response.text();

    if (response.ok) {
      return { response, text: lastText };
    }

    if (!isRetryableDiscordStatus(response.status) || attempt === delays.length) {
      break;
    }

    const retryAfter = Number(response.headers.get("retry-after"));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : delays[attempt];
    console.error(`[discord] ${label} returned ${response.status}. Retrying in ${Math.round(waitMs / 1000)}s.`);
    await sleep(waitMs);
  }

  throw new Error(`Discord responded with ${lastStatus}: ${lastText}`);
}

function parseDiscordJson(text) {
  return text ? JSON.parse(text) : null;
}

function loadEnv() {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) continue;

    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed.slice(equalsIndex + 1).trim().replace(/^"|"$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function requiredEnv(name) {
  const value = (process.env[name] || "").trim();
  if (!value) {
    throw new Error(`Missing ${name} in the .env file`);
  }
  return value;
}

function parseLogFiles(rawValue) {
  const logs = [];

  rawValue.split(";").forEach((item, index) => {
    const trimmed = item.trim();
    if (!trimmed) return;

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex >= 0) {
      const name = trimmed.slice(0, equalsIndex).trim() || `log-${index + 1}`;
      const logPath = trimmed.slice(equalsIndex + 1).trim().replace(/^"|"$/g, "");
      logs.push({ name, path: logPath });
      return;
    }

    const logPath = trimmed.replace(/^"|"$/g, "");
    logs.push({ name: path.basename(logPath, path.extname(logPath)) || `log-${index + 1}`, path: logPath });
  });

  if (logs.length === 0) {
    throw new Error("LOG_FILES does not have any configured log files");
  }

  return logs.map((log, index) => ({
    ...log,
    index,
    channelId: null,
    channelBaseName: null,
    lastChannelName: null,
    activePath: null,
    position: 0,
    recentLines: [],
    livePendingLines: [],
    liveThreadId: null,
    liveThreadMessageCount: 0,
    statusMessageId: null,
    statusPinnedMessageId: null,
    alertMessageId: null,
    status: "starting",
    lastActivity: Date.now(),
    alertedStalled: false,
    restartHandled: false,
    sleepingNotified: false,
    pausedReason: null,
    goldBelowThresholdCount: 0,
    deviceOfflineReconnectCount: 0,
    lastGoldRestartAt: 0,
    lastAdbRecoveryAt: 0,
    lastVisualCheckAt: 0,
    lastVisualRecoveryAt: 0,
    lastAutoUpdateCheckAt: 0,
    lastAutoUpdateHandledAt: 0,
    existedBefore: undefined,
  }));
}

function envKeyForLog(logName, suffix) {
  return `${logName.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_${suffix}`;
}

function defaultChannelName(logName) {
  return logName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "log";
}

function optionalChannelId(name) {
  const value = (process.env[name] || "").trim();
  return /^\d{15,25}$/.test(value) ? value : null;
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return {};

  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch (error) {
    console.error(`Could not read ${STATE_FILE}: ${error.message}`);
    return {};
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function stateKey(log) {
  return `${log.name}:${log.channelId}`;
}

function applySavedState(log, state) {
  const saved = state[stateKey(log)];
  if (!saved) return;

  log.statusMessageId = saved.statusMessageId || null;
  log.statusPinnedMessageId = saved.statusPinnedMessageId || null;
  log.alertMessageId = saved.alertMessageId || null;
  log.liveThreadId = saved.liveThreadId || null;
  log.liveThreadMessageCount = Number(saved.liveThreadMessageCount || 0);
  log.autoClashObservedProcess = saved.autoClashObservedProcess || null;
  log.autoClashPendingUpdate = saved.autoClashPendingUpdate || null;
}

function rememberLogState(log, state) {
  state[stateKey(log)] = {
    statusMessageId: log.statusMessageId,
    statusPinnedMessageId: log.statusPinnedMessageId,
    alertMessageId: log.alertMessageId,
    liveThreadId: log.liveThreadId,
    liveThreadMessageCount: log.liveThreadMessageCount || 0,
    autoClashObservedProcess: log.autoClashObservedProcess || null,
    autoClashPendingUpdate: log.autoClashPendingUpdate || null,
  };
  saveState(state);
}

function hasWildcard(value) {
  return value.includes("*") || value.includes("?");
}

function wildcardToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "i");
}

function findNewestMatchingFile(logPath) {
  const normalized = logPath.replace(/^"|"$/g, "");

  if (hasWildcard(normalized)) {
    const directory = path.dirname(normalized);
    const filePattern = wildcardToRegExp(path.basename(normalized));
    return findNewestFileInDirectory(directory, filePattern);
  }

  if (!fs.existsSync(normalized)) return null;

  const stats = fs.statSync(normalized);
  if (stats.isDirectory()) {
    return findNewestFileInDirectory(normalized, /\.txt$/i);
  }

  return normalized;
}

function findNewestFileInDirectory(directory, filePattern) {
  if (!fs.existsSync(directory)) return null;

  const candidates = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && filePattern.test(entry.name))
    .map((entry) => {
      const fullPath = path.join(directory, entry.name);
      return { fullPath, mtimeMs: fs.statSync(fullPath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  return candidates.length > 0 ? candidates[0].fullPath : null;
}

async function sendDiscordMessage(token, channelId, content, allowedMentions = undefined) {
  const { text } = await fetchDiscordWithRetry(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content, allowed_mentions: allowedMentions }),
  }, "send message");

  return parseDiscordJson(text);
}

async function sendDiscordPayload(token, channelId, payload) {
  const { text } = await fetchDiscordWithRetry(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  }, "send payload");

  return parseDiscordJson(text);
}

async function createDiscordThread(token, channelId, name) {
  return discordRequest(token, `/channels/${channelId}/threads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      type: 11,
      auto_archive_duration: 1440,
    }),
  });
}

async function editDiscordPayload(token, channelId, messageId, payload) {
  const { text } = await fetchDiscordWithRetry(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  }, "edit payload");

  return parseDiscordJson(text);
}

async function deleteDiscordMessage(token, channelId, messageId) {
  try {
    await fetchDiscordWithRetry(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bot ${token}`,
      },
    }, "delete message");
  } catch (error) {
    if (!String(error.message).includes("Discord responded with 404")) {
      throw error;
    }
  }
}

async function pinDiscordMessage(token, channelId, messageId) {
  await discordRequest(token, `/channels/${channelId}/pins/${messageId}`, {
    method: "PUT",
  });
}

async function deleteDiscordChannel(token, channelId) {
  await discordRequest(token, `/channels/${channelId}`, {
    method: "DELETE",
  });
}

async function sendDiscordFile(token, channelId, content, filePath, options = {}) {
  const form = new FormData();
  form.append("payload_json", JSON.stringify({ content }));
  requireReadableFile(filePath, "Discord upload file");
  const bytes = fs.readFileSync(filePath);
  form.append("file", new Blob([bytes], { type: "image/png" }), path.basename(filePath));

  try {
    const { text } = await fetchDiscordWithRetry(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${token}`,
      },
      body: form,
    }, "send file");

    return parseDiscordJson(text);
  } finally {
    if (options.deleteAfterSend) deleteFileQuietly(filePath);
  }
}

async function discordRequest(token, route, options = {}) {
  const { text } = await fetchDiscordWithRetry(`https://discord.com/api/v10${route}`, {
    ...options,
    headers: {
      Authorization: `Bot ${token}`,
      ...(options.headers || {}),
    },
  }, route);

  return parseDiscordJson(text);
}

async function renameDiscordChannel(token, channelId, name) {
  const { text } = await fetchDiscordWithRetry(`https://discord.com/api/v10/channels/${channelId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name }),
  }, "rename channel");

  return parseDiscordJson(text);
}

async function updateChannelName(log, config) {
  const emoji =
    log.status === "stalled"
      ? "\u{1F534}"
      : log.status === "paused"
        ? "\u{1F7E1}"
        : log.status === "finished"
          ? "\u{26AA}"
          : "\u{1F7E2}";
  const nextName = `${emoji}-${log.channelBaseName}`;

  if (log.lastChannelName === nextName) return;

  await config.renameChannel(log.channelId, nextName);
  log.lastChannelName = nextName;
}

async function deleteAlertMessage(log, config) {
  if (!log.alertMessageId) return;

  try {
    await config.deleteMessage(log.channelId, log.alertMessageId);
  } catch (error) {
    console.error(`[${log.name}] Could not delete the previous alert: ${error.message}`);
  } finally {
    log.alertMessageId = null;
    rememberLogState(log, config.state);
  }
}

function initializeLog(log) {
  log.lastActivity = Date.now();
  log.activePath = findNewestMatchingFile(log.path);

  if (log.activePath) {
    log.position = fs.statSync(log.activePath).size;
    log.existedBefore = true;
  } else {
    log.position = 0;
    log.existedBefore = false;
  }
}

function readNewLines(log, currentSize, maxLinesPerCheck) {
  const bytesToRead = currentSize - log.position;
  const buffer = Buffer.alloc(bytesToRead);
  const fd = fs.openSync(log.activePath, "r");

  try {
    fs.readSync(fd, buffer, 0, bytesToRead, log.position);
  } finally {
    fs.closeSync(fd);
  }

  const lines = buffer
    .toString("utf8")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);

  return lines.slice(-maxLinesPerCheck);
}

function normalizeKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function lineContains(lines, pattern) {
  return lines.some((line) => pattern.test(line));
}

function analyzeLogLines(lines) {
  if (lineContains(lines, /bot end condition met,\s*stopping bot/i)) {
    return "completed";
  }

  if (lineContains(lines, /outside active hours,\s*sleeping bot until start time/i)) {
    return "sleeping";
  }

  if (lineContains(lines, /humanized break started/i)) {
    return "humanized-break";
  }

  if (
    lineContains(lines, /\[LOG\]\s*Session log ended/i) ||
    lineContains(lines, /Session log ended/i) ||
    lineContains(lines, /\b(bot\s+)?stopped\b/i)
  ) {
    return "ended";
  }

  return null;
}

function recentPauseReason(log) {
  const recent = log.recentLines.slice(-12);
  return analyzeLogLines(recent);
}

function findControlInstanceForLog(log, config) {
  const control = config.control;
  if (!control?.instances?.length) return null;

  const logKeys = [
    normalizeKey(log.name),
    normalizeKey(log.channelBaseName),
    normalizeKey(path.basename(log.path || "")),
  ].filter(Boolean);

  return (
    control.instances.find((instance) => {
      const instanceKeys = [
        normalizeKey(instance.id),
        normalizeKey(instance.label),
        normalizeKey(instance.exePath),
        normalizeKey(resolveAutoClashExePath(instance)),
      ].filter(Boolean);
      return logKeys.some((logKey) => instanceKeys.some((instanceKey) => instanceKey === logKey || instanceKey.includes(logKey)));
    }) ||
    control.instances[log.index] ||
    (control.instances.length === 1 ? control.instances[0] : null)
  );
}

function findLogForControlInstance(instance, logs, config) {
  return logs.find((log) => findControlInstanceForLog(log, config)?.id === instance.id) || null;
}

function automaticControlEnabled(instance) {
  return Boolean(instance?.active);
}

function snapshotLogFile(log) {
  const activePath = findNewestMatchingFile(log.path);
  if (!activePath || !fs.existsSync(activePath)) {
    return { activePath: null, size: -1, lastActivity: log.lastActivity };
  }

  return {
    activePath,
    size: fs.statSync(activePath).size,
    lastActivity: log.lastActivity,
  };
}

async function waitForNewLogActivity(log, snapshot, startedAt, timeoutSeconds) {
  const deadline = Date.now() + timeoutSeconds * 1000;

  while (Date.now() < deadline) {
    const activePath = findNewestMatchingFile(log.path);

    if (activePath && fs.existsSync(activePath)) {
      const currentSize = fs.statSync(activePath).size;
      if (!snapshot.activePath && currentSize > 0) return true;
      if (snapshot.activePath && activePath !== snapshot.activePath && currentSize > 0) return true;
      if (snapshot.activePath === activePath && currentSize > snapshot.size) return true;
    }

    if (log.lastActivity > startedAt && log.status === "active") return true;
    await sleep(2000);
  }

  return false;
}

function restartKeyForLog(log) {
  return Buffer.from(log.name).toString("base64url").slice(0, 80);
}

async function sendLogEvent(log, config, message) {
  await config.send(log.channelId, message);
}

function recentLogLinesText(log, count = 10) {
  return log.recentLines.length > 0
    ? log.recentLines.slice(-count).join("\n").replace(/```/g, "'''").slice(-1800)
    : "No recent lines saved yet.";
}

async function sendRecentLogLines(log, config, reason = "Recent log lines") {
  await config.send(log.channelId, `**${log.name} last 10 lines - ${reason}**\n\`\`\`text\n${recentLogLinesText(log, 10)}\n\`\`\``);
}

async function sendBeforeRecoveryScreenshot(log, config, instance, reason, existingFile = null) {
  try {
    const file = existingFile || await captureAdbScreen(config.control, instance);
    await config.sendFile(log.channelId, `**Before recovery** - \`${instance.label}\`\n${reason}`, file, { deleteAfterSend: true });
  } catch (error) {
    console.error(`[${log.name}] Could not send before-recovery screenshot: ${error.message}`);
  }
}

async function notifySleeping(log, config) {
  if (log.sleepingNotified) return;
  log.sleepingNotified = true;
  log.restartHandled = true;
  await sendLogEvent(log, config, `\`${log.name}\` is sleeping because it is outside active hours.`);
}

async function notifyCompleted(log, config) {
  if (log.restartHandled) return;
  log.status = "finished";
  log.pausedReason = "completed";
  log.restartHandled = true;
  await updateChannelName(log, config);
  await upsertStatusEmbed(log, config);
  await sendLogEvent(log, config, `\`${log.name}\` finished its work and stopped normally.`);
}

async function handleRestartCandidate(log, config, reason) {
  if (config.autoRestartMode === "off" || log.restartHandled) return;

  const instance = findControlInstanceForLog(log, config);
  if (!automaticControlEnabled(instance)) return;
  if (!instance) {
    log.restartHandled = true;
    await sendLogEvent(log, config, `\`${log.name}\` stopped, but no matching AutoClash exe was found for restart.`);
    return;
  }

  if (config.autoRestartMode === "auto") {
    log.restartHandled = true;
    await sendRecentLogLines(log, config, reason);
    await executeExeActionWithRetry(config.control, "stop", instance, { attempts: 6, delayMs: 5000 });
    await sleep(1200);
    await closeEmulator(config.control, instance);
    await sleep(config.adbRecoveryStartDelaySeconds * 1000);
    await executeExeActionWithRetry(config.control, "start", instance, { attempts: 6, delayMs: 5000 });
    await sendLogEvent(log, config, `\`${log.name}\` stopped (${reason}). Emulator was closed and Auto-restart was sent to \`${instance.label}\`.`);
    return;
  }
}

function countClashRestartTriggerLines(lines) {
  return lines.filter((line) =>
    /\[STATUS\]\s*Gold still below threshold,\s*waiting for next check/i.test(line)
  ).length;
}

function hasAdbScreencapError(lines) {
  return lines.some((line) =>
    /\bADB\b.*exec-out screencap timed out,\s*using fallback screencap/i.test(line) ||
    /\bADB\b.*exec-out failed,\s*using fallback screencap/i.test(line)
  );
}

function countDeviceOfflineReconnectLines(lines) {
  return lines.filter((line) => /Device offline\s*-\s*waiting for reconnect/i.test(line)).length;
}

async function runAdb(control, instance, args) {
  if (!instance?.device) {
    throw new Error(`${instance?.label || "AutoClash"} does not have an ADB device configured`);
  }

  await execFileText(control.adbPath, ["connect", instance.device], { cwd: process.cwd() }).catch(() => "");
  return execFileText(control.adbPath, ["-s", instance.device, ...args], { cwd: process.cwd() });
}

async function restartClashOfClans(control, instance) {
  const packageName = "com.supercell.clashofclans";
  const stopOutput = await runAdb(control, instance, ["shell", "am", "force-stop", packageName]);
  await sleep(2500);
  const startOutput = await runAdb(control, instance, [
    "shell",
    "monkey",
    "-p",
    packageName,
    "-c",
    "android.intent.category.LAUNCHER",
    "1",
  ]);

  return [`force-stop: ${stopOutput.trim()}`, `start: ${startOutput.trim()}`].join("\n").trim();
}

async function detectCocConnectionLost(control, instance) {
  const dir = SCREENSHOT_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${instance.id}-connection-lost-${new Date().toISOString().replace(/[:.]/g, "-")}.png`);
  const output = await execFileText("powershell", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    path.join(process.cwd(), "detect-coc-connection-lost.ps1"),
    "-AdbPath",
    control.adbPath,
    "-Device",
    instance.device,
    "-OutputPath",
    file,
  ], { cwd: process.cwd(), timeout: 20000 });

  return {
    detected: /detected=True/i.test(output),
    output: output.trim(),
    file,
  };
}

async function handleCocConnectionLostVisual(log, config) {
  if (!config.visualCheckEnabled) return;

  const now = Date.now();
  if (now - log.lastVisualCheckAt < config.visualCheckIntervalSeconds * 1000) return;
  log.lastVisualCheckAt = now;

  const instance = findControlInstanceForLog(log, config);
  if (!automaticControlEnabled(instance)) return;
  if (!instance?.device) return;

  let result;
  try {
    result = await detectCocConnectionLost(config.control, instance);
  } catch (error) {
    console.error(`[${log.name}] visual CoC check failed: ${error.message}`);
    return;
  }

  if (!result.detected) return;
  if (now - log.lastVisualRecoveryAt < 120000) return;
  log.lastVisualRecoveryAt = now;

  try {
    await sendBeforeRecoveryScreenshot(
      log,
      config,
      instance,
      "CoC Connection lost popup detected before restarting Clash of Clans.",
      result.file
    );
    await sendRecentLogLines(log, config, "CoC Connection lost popup");
    await restartClashOfClans(config.control, instance);
    await sendLogEvent(
      log,
      config,
      `\`${log.name}\` detected the CoC Connection lost popup. Clash of Clans was restarted on \`${instance.label}\`.`
    );
  } catch (error) {
    const details = [result.output, error.message, error.stderr, error.stdout].filter(Boolean).join("\n").trim().slice(0, 1800);
    await sendLogEvent(log, config, `\`${log.name}\` detected the CoC Connection lost popup, but Clash restart failed:\n\`\`\`text\n${details}\n\`\`\``);
  }
}

async function closeLdPlayer(control, instance) {
  if (!instance?.device) {
    throw new Error(`${instance?.label || "AutoClash"} does not have an ADB device configured`);
  }

  await execFileText(control.adbPath, ["connect", instance.device], { cwd: process.cwd() }).catch(() => "");
  try {
    return await execFileText(control.adbPath, ["-s", instance.device, "emu", "kill"], { cwd: process.cwd() });
  } catch (error) {
    const fallbackOutput = await closeLdPlayerByConsole(control, instance).catch(async (consoleError) => {
      const windowOutput = await closeLdPlayerByWindow(instance);
      return [
        `LDConsole fallback failed: ${consoleError.message}`,
        windowOutput.trim() ? `Windows fallback: ${windowOutput.trim()}` : "Windows fallback: Done",
      ].join("\n");
    });
    return [
      `ADB emu kill failed: ${error.message}`,
      fallbackOutput.trim() ? `LDPlayer fallback: ${fallbackOutput.trim()}` : "LDPlayer fallback: Done",
    ].join("\n");
  }
}

async function closeLdPlayerByWindow(instance) {
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    path.join(process.cwd(), "close-ldplayer-instance.ps1"),
    "-Label",
    instance.label,
  ];
  return execFileText("powershell", args, { cwd: process.cwd() });
}

function ldPlayerIndexForInstance(instance) {
  const match = String(instance?.device || "").match(/:(\d+)$/);
  const port = match ? Number(match[1]) : NaN;
  if (!Number.isInteger(port)) return null;

  const index = (port - 5555) / 2;
  return Number.isInteger(index) && index >= 0 ? index : null;
}

function ldConsolePath(control) {
  return process.env.LDPLAYER_CONSOLE_PATH || control.ldConsolePath || "C:\\LDPlayer\\LDPlayer9\\ldconsole.exe";
}

function emulatorIndexForInstance(instance, fallbackFromAdb = true) {
  const configuredText = String(instance?.emulatorIndex || "").trim();
  const configured = Number(configuredText);
  if (configuredText && Number.isInteger(configured) && configured >= 0) return configured;
  if (!fallbackFromAdb) return null;

  const match = String(instance?.device || "").match(/:(\d+)$/);
  const port = match ? Number(match[1]) : NaN;
  if (!Number.isInteger(port)) return null;
  const index = (port - 5555) / 2;
  return Number.isInteger(index) && index >= 0 ? index : null;
}

function emulatorTypeForInstance(instance) {
  return normalizeEmulatorType(instance?.emulator);
}

function mumuCliPath(control) {
  const candidates = [
    process.env.MUMU_CLI_PATH,
    control.mumuCliPath,
    "C:\\Program Files\\Netease\\MuMuPlayer\\nx_main\\mumu-cli.exe",
    "C:\\Program Files\\Netease\\MuMuPlayer\\nx_main\\MuMuManager.exe",
    "C:\\Program Files\\Netease\\MuMuPlayerGlobal-12.0\\shell\\MuMuManager.exe",
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function adbPortForInstance(instance) {
  const match = String(instance?.device || "").match(/:(\d+)$/);
  return match ? Number(match[1]) : null;
}

async function mumuIndexForInstance(control, instance) {
  const configured = emulatorIndexForInstance(instance, false);
  if (configured !== null) return configured;

  const cliPath = mumuCliPath(control);
  if (!fs.existsSync(cliPath)) {
    throw new Error(`MuMu CLI was not found: ${cliPath}`);
  }

  const adbPort = adbPortForInstance(instance);
  if (!adbPort) {
    throw new Error(`Could not derive MuMu index. Set Emulator index for ${instance?.label || "selected window"}.`);
  }

  const output = await execFileText(cliPath, ["info", "--vmindex", "all"], { cwd: path.dirname(cliPath), timeout: 12000 });
  const info = JSON.parse(output);
  const match = Object.values(info).find((item) => Number(item?.adb_port) === adbPort);
  if (!match?.index && match?.index !== 0) {
    throw new Error(`No MuMu instance found for ADB port ${adbPort}. Set Emulator index manually.`);
  }
  return Number(match.index);
}

async function runMumuControl(control, instance, command) {
  const cliPath = mumuCliPath(control);
  if (!fs.existsSync(cliPath)) {
    throw new Error(`MuMu CLI was not found: ${cliPath}`);
  }
  const index = await mumuIndexForInstance(control, instance);
  const androidVersion = process.env.MUMU_ANDROID_VERSION || control.mumuAndroidVersion || "12";
  const output = await execFileText(cliPath, ["control", "--vmindex", String(index), "--version", String(androidVersion), command], {
    cwd: path.dirname(cliPath),
    timeout: 25000,
  });
  const expectedRunning = command === "launch";
  const confirmed = await waitForMumuState(control, index, expectedRunning, 20000).catch(() => null);
  if (confirmed) {
    return `MuMu index ${index} ${command} confirmed.\n${String(output || "").trim()}`;
  }
  return `MuMu index ${index} ${command} command sent, but state was not confirmed yet.\n${String(output || "").trim()}`;
}

async function waitForMumuState(control, index, expectedRunning, timeoutMs) {
  const cliPath = mumuCliPath(control);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(1000);
    const output = await execFileText(cliPath, ["info", "--vmindex", String(index)], { cwd: path.dirname(cliPath), timeout: 8000 });
    const parsed = JSON.parse(output);
    const info = parsed[String(index)] || parsed;
    if (Boolean(info?.is_process_started) === expectedRunning) return true;
  }
  return false;
}

async function closeLdPlayerByConsole(control, instance) {
  const consolePath = ldConsolePath(control);
  if (!fs.existsSync(consolePath)) {
    throw new Error(`LDPlayer console was not found: ${consolePath}`);
  }

  const index = emulatorIndexForInstance(instance);
  if (index === null) {
    throw new Error(`Could not derive LDPlayer index from ADB device: ${instance?.device || "empty"}`);
  }

  return execFileText(consolePath, ["quit", "--index", String(index)], { cwd: path.dirname(consolePath), timeout: 20000 });
}

async function openLdPlayer(control, instance) {
  const consolePath = ldConsolePath(control);
  if (!fs.existsSync(consolePath)) {
    throw new Error(`LDPlayer console was not found: ${consolePath}`);
  }

  const index = emulatorIndexForInstance(instance);
  if (index === null) {
    throw new Error(`Could not derive LDPlayer index from ADB device: ${instance?.device || "empty"}`);
  }

  return execFileText(consolePath, ["launch", "--index", String(index)], { cwd: path.dirname(consolePath), timeout: 20000 });
}

async function openEmulator(control, instance) {
  const emulatorType = emulatorTypeForInstance(instance);

  if (emulatorType === "ldplayer") return openLdPlayer(control, instance);
  if (emulatorType === "mumu") return runMumuControl(control, instance, "launch");

  const index = emulatorIndexForInstance(instance);
  const attempts = [];

  const ldPath = ldConsolePath(control);
  if (fs.existsSync(ldPath) && index !== null) {
    attempts.push(async () => ({
      name: "LDPlayer",
      output: await execFileText(ldPath, ["launch", "--index", String(index)], { cwd: path.dirname(ldPath), timeout: 20000 }),
    }));
  }

  const mumuPath = mumuCliPath(control);
  if (fs.existsSync(mumuPath)) {
    attempts.push(async () => ({
      name: "MuMu",
      output: await runMumuControl(control, instance, "launch"),
    }));
  }

  const knownLaunchers = [
    {
      name: "MEmu",
      path: process.env.MEMU_CONSOLE_PATH || "C:\\Program Files\\Microvirt\\MEmu\\MEmuConsole.exe",
      args: ["start", "-i", String(index ?? 0)],
    },
    {
      name: "BlueStacks",
      path: process.env.BLUESTACKS_PLAYER_PATH || "C:\\Program Files\\BlueStacks_nxt\\HD-Player.exe",
      args: [],
    },
  ];

  for (const launcher of knownLaunchers) {
    if (!fs.existsSync(launcher.path)) continue;
    attempts.push(async () => ({
      name: launcher.name,
      output: await execFileText(launcher.path, launcher.args, { cwd: path.dirname(launcher.path), timeout: 20000 }),
    }));
  }

  const errors = [];
  for (const attempt of attempts) {
    try {
      const result = await attempt();
      return `${result.name} open command sent.\n${String(result.output || "").trim()}`;
    } catch (error) {
      errors.push(error.message);
    }
  }

  throw new Error(`Could not detect a supported emulator launcher for ${instance?.label || "selected window"}. Supported auto-detect: LDPlayer, MEmu, MuMu, BlueStacks. ${errors.join(" | ")}`);
}

async function closeEmulator(control, instance) {
  const emulatorType = emulatorTypeForInstance(instance);
  if (emulatorType === "ldplayer") return closeLdPlayer(control, instance);
  if (emulatorType === "mumu") return runMumuControl(control, instance, "shutdown");

  if (instance?.device) {
    await execFileText(control.adbPath, ["connect", instance.device], { cwd: process.cwd() }).catch(() => "");
    try {
      const output = await execFileText(control.adbPath, ["-s", instance.device, "emu", "kill"], { cwd: process.cwd(), timeout: 12000 });
      return output.trim() || "ADB emulator close command sent.";
    } catch (error) {
      const fallbackOutput = await runMumuControl(control, instance, "shutdown")
        .catch(async (mumuError) => closeLdPlayerByConsole(control, instance).catch(async (consoleError) => {
          const windowOutput = await closeLdPlayerByWindow(instance).catch((windowError) => `Windows fallback failed: ${windowError.message}`);
          return [
            `MuMu fallback failed: ${mumuError.message}`,
            `LDPlayer fallback failed: ${consoleError.message}`,
            windowOutput.trim() ? `Windows fallback: ${windowOutput.trim()}` : "Windows fallback: Done",
          ].join("\n");
        }));
      return [
        `ADB emu kill failed: ${error.message}`,
        fallbackOutput.trim() ? `Fallback: ${fallbackOutput.trim()}` : "Fallback: Done",
      ].join("\n");
    }
  }

  return closeLdPlayerByWindow(instance);
}

function activeOrAllInstances(control) {
  const active = control.instances.filter((item) => item.active);
  return active.length ? active : control.instances;
}

async function runForInstances(instances, actionLabel, task) {
  const outputs = [];
  for (const item of instances) {
    try {
      const output = await task(item);
      outputs.push(`${item.label}: ${String(output || "Done").trim()}`);
    } catch (error) {
      const details = [error.message, error.stderr, error.stdout].filter(Boolean).join("\n").trim().split(/\r?\n/)[0];
      outputs.push(`${item.label}: failed - ${details}`);
    }
  }
  return `${actionLabel}\n${outputs.join("\n")}`.slice(0, 1900);
}

async function restartAutoClashAfterDeviceOffline(log, config, instance) {
  await executeExeActionWithRetry(config.control, "stop", instance, { attempts: 6, delayMs: 5000 });
  await sleep(1200);
  await executeExeActionWithRetry(config.control, "start", instance, { attempts: 6, delayMs: 5000 });
  await sendLogEvent(
    log,
    config,
    `\`${log.name}\` detected "Device offline - waiting for reconnect" more than 4 times. AutoClash Stop/Start was sent to \`${instance.label}\`.`
  );
}

async function handleDeviceOfflineReconnect(log, config, lines) {
  const matches = countDeviceOfflineReconnectLines(lines);
  if (matches === 0) return;

  log.deviceOfflineReconnectCount += matches;
  if (log.deviceOfflineReconnectCount <= 4) return;

  const instance = findControlInstanceForLog(log, config);
  if (!automaticControlEnabled(instance)) {
    log.deviceOfflineReconnectCount = 0;
    return;
  }
  if (!instance) {
    log.deviceOfflineReconnectCount = 0;
    await sendLogEvent(log, config, `\`${log.name}\` detected repeated Device offline reconnects, but no matching AutoClash instance was found.`);
    return;
  }

  try {
    log.deviceOfflineReconnectCount = 0;
    await sendRecentLogLines(log, config, "Device offline reconnect");
    await restartAutoClashAfterDeviceOffline(log, config, instance);
  } catch (error) {
    const details = [error.message, error.stderr, error.stdout].filter(Boolean).join("\n").trim().slice(0, 1800);
    await sendLogEvent(log, config, `\`${log.name}\` detected repeated Device offline reconnects, but AutoClash restart failed:\n\`\`\`text\n${details}\n\`\`\``);
  }
}

async function handleAdbScreencapRecovery(log, config, lines) {
  if (!hasAdbScreencapError(lines)) return;

  const now = Date.now();
  if (now - log.lastAdbRecoveryAt < 120000) return;
  log.lastAdbRecoveryAt = now;

  const instance = findControlInstanceForLog(log, config);
  if (!automaticControlEnabled(instance)) return;
  if (!instance) {
    await sendLogEvent(log, config, `\`${log.name}\` detected an ADB screencap error, but no matching AutoClash instance was found.`);
    return;
  }

  try {
    await sleep(config.adbRecoveryStopDelaySeconds * 1000);
    await sendRecentLogLines(log, config, "ADB screencap error");
    await executeExeActionWithRetry(config.control, "stop", instance, { attempts: 6, delayMs: 5000 });
    await sleep(1200);
    await closeEmulator(config.control, instance);
    await sleep(config.adbRecoveryStartDelaySeconds * 1000);
    await executeExeActionWithRetry(config.control, "start", instance, { attempts: 6, delayMs: 5000 });

    await sendLogEvent(
      log,
      config,
      `\`${log.name}\` detected an ADB screencap error. AutoClash was stopped, the emulator was closed, and AutoClash was started again on \`${instance.label}\`.`
    );
  } catch (error) {
    const details = [error.message, error.stderr, error.stdout].filter(Boolean).join("\n").trim().slice(0, 1800);
    await sendLogEvent(log, config, `\`${log.name}\` detected an ADB screencap error, but recovery failed:\n\`\`\`text\n${details}\n\`\`\``);
  }
}

async function handleClashRestartTriggers(log, config, lines) {
  const matches = countClashRestartTriggerLines(lines);
  if (matches === 0) return;

  log.goldBelowThresholdCount += matches;
  if (log.goldBelowThresholdCount < 1) return;

  const now = Date.now();
  if (now - log.lastGoldRestartAt < 120000) return;

  log.lastGoldRestartAt = now;
  log.goldBelowThresholdCount = 0;

  const instance = findControlInstanceForLog(log, config);
  if (!automaticControlEnabled(instance)) return;
  if (!instance) {
    await sendLogEvent(log, config, `\`${log.name}\` detected a Clash restart trigger, but no matching AutoClash instance was found.`);
    return;
  }

  try {
    await sendBeforeRecoveryScreenshot(
      log,
      config,
      instance,
      "Clash restart trigger detected before restarting Clash of Clans."
    );
    await sendRecentLogLines(log, config, "Clash restart trigger");
    await restartClashOfClans(config.control, instance);
    await sendLogEvent(
      log,
      config,
      `\`${log.name}\` detected a Clash restart trigger. Clash of Clans was restarted on \`${instance.label}\`.`
    );
  } catch (error) {
    const details = [error.message, error.stderr, error.stdout].filter(Boolean).join("\n").trim().slice(0, 1800);
    await sendLogEvent(log, config, `\`${log.name}\` detected a Clash restart trigger, but Clash restart failed:\n\`\`\`text\n${details}\n\`\`\``);
  }
}

function buildStatusEmbed(log, config) {
  const activeFile = log.activePath ? path.basename(log.activePath) : "No file detected";
  const secondsWithoutActivity = Math.floor((Date.now() - log.lastActivity) / 1000);
  const lineLimit = log.status === "stalled" ? 10 : 5;
  const isStalled = log.status === "stalled";
  const isPaused = log.status === "paused";
  const isFinished = log.status === "finished";
  const recentLines =
    log.recentLines.length > 0
      ? log.recentLines.slice(-lineLimit).join("\n").replace(/```/g, "'''").slice(-3800)
      : log.status === "stalled"
        ? "No recent lines saved."
        : isPaused
          ? "Humanized break active. Waiting before continuing."
          : isFinished
            ? "Finished normally. Waiting for the next run."
            : "Working. Discord updates only when the status changes.";
  const statusText = isStalled
    ? "Stopped / no new lines"
    : isPaused
      ? "Waiting / humanized break"
      : isFinished
        ? "Finished normally"
        : "Working";
  const color = isStalled ? 0xff3b30 : isPaused ? 0xf1c40f : isFinished ? 0x95a5a6 : 0x2ecc71;

  return {
    title: `${log.name} log`,
    description: `\`\`\`text\n${recentLines || " "}\n\`\`\``,
    color,
    fields: [
      {
        name: "Status",
        value: statusText,
        inline: true,
      },
      {
        name: "Last activity",
        value: `${secondsWithoutActivity}s`,
        inline: true,
      },
      {
        name: "File",
        value: `\`${activeFile}\``,
        inline: false,
      },
    ],
    footer: {
      text: log.activePath || log.path,
    },
    timestamp: new Date().toISOString(),
  };
}

async function upsertStatusEmbed(log, config) {
  const payload = {
    content: "",
    embeds: [buildStatusEmbed(log, config)],
    components: logStatusComponents(log),
  };

  if (!log.statusMessageId) {
    const newMessage = await config.sendPayload(log.channelId, payload);
    log.statusMessageId = newMessage.id;
    rememberLogState(log, config.state);
    await pinStatusEmbed(log, config);
    return;
  }

  try {
    await config.editPayload(log.channelId, log.statusMessageId, payload);
    await pinStatusEmbed(log, config);
  } catch (error) {
    const message = String(error.message);
    const shouldCreateNewMessage =
      message.includes("10008") ||
      message.includes("50005") ||
      message.includes("Cannot edit a message authored by another user") ||
      message.includes("30046") ||
      message.includes("Maximum number of edits") ||
      message.includes("Discord responded with 429");

    if (!shouldCreateNewMessage) {
      throw error;
    }

    const newMessage = await config.sendPayload(log.channelId, payload);
    log.statusMessageId = newMessage.id;
    log.statusPinnedMessageId = null;
    rememberLogState(log, config.state);
    await pinStatusEmbed(log, config);
  }
}

async function pinStatusEmbed(log, config) {
  if (!config.pinMessage || !log.statusMessageId || log.statusPinnedMessageId === log.statusMessageId) return;

  try {
    await config.pinMessage(log.channelId, log.statusMessageId);
    log.statusPinnedMessageId = log.statusMessageId;
    rememberLogState(log, config.state);
  } catch (error) {
    console.error(`[${log.name}] Could not pin the status panel: ${error.message}`);
  }
}

function logStatusComponents(log) {
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 2, label: "Last 10 lines", custom_id: `loglines:${restartKeyForLog(log)}` },
      ],
    },
  ];
}

function isUnknownDiscordChannelError(error) {
  const message = String(error?.message || "");
  return message.includes("10003") || message.includes("Unknown Channel");
}

function liveThreadMessageLimit(config) {
  const value = Number(config.liveLogMaxThreadMessages || 10000);
  return Number.isFinite(value) && value > 0 ? Math.max(1, Math.floor(value)) : 10000;
}

async function ensureLiveThread(log, config) {
  if (log.liveThreadId) return log.liveThreadId;

  const thread = await config.createThread(log.channelId, `${log.name} live log`);
  log.liveThreadId = thread.id;
  log.liveThreadMessageCount = 0;
  rememberLogState(log, config.state);
  return log.liveThreadId;
}

async function rotateLiveThread(log, config, reason) {
  if (log.liveThreadId) {
    try {
      await config.deleteChannel(log.liveThreadId);
    } catch (error) {
      if (!isUnknownDiscordChannelError(error)) {
        console.error(`[${log.name}] Could not delete live thread: ${error.message}`);
      }
    }
  }

  log.liveThreadId = null;
  log.liveThreadMessageCount = 0;
  rememberLogState(log, config.state);

  const threadId = await ensureLiveThread(log, config);
  if (reason) {
    await config.send(threadId, `Live thread rotated: ${reason}.`);
    log.liveThreadMessageCount += 1;
    rememberLogState(log, config.state);
  }

  return threadId;
}

async function sendLiveThreadMessage(log, config, message) {
  const sendAndCount = async () => {
    const threadId = await ensureLiveThread(log, config);
    await config.send(threadId, message);
    log.liveThreadMessageCount = (log.liveThreadMessageCount || 0) + 1;
    rememberLogState(log, config.state);
  };

  try {
    const limit = liveThreadMessageLimit(config);
    if (log.liveThreadId && (log.liveThreadMessageCount || 0) >= limit) {
      await rotateLiveThread(log, config, `message limit ${limit}`);
    }

    await sendAndCount();
  } catch (error) {
    if (!isUnknownDiscordChannelError(error)) {
      throw error;
    }

    log.liveThreadId = null;
    log.liveThreadMessageCount = 0;
    rememberLogState(log, config.state);
    await sendAndCount();
  }
}

async function flushLiveLog(log, config) {
  if (!config.liveLogEnabled || log.livePendingLines.length === 0) return;

  const lines = log.livePendingLines.splice(0, 35);
  const content = lines.join("\n").replace(/```/g, "'''").slice(-1850);

  try {
    await sendLiveThreadMessage(log, config, `**${log.name} live log**\n\`\`\`text\n${content}\n\`\`\``);
  } catch (error) {
    log.livePendingLines.unshift(...lines);
    throw error;
  }
}

async function checkLog(log, config) {
  await handleAutoClashUpdate(log, config);
  await handleCocConnectionLostVisual(log, config);

  const newestPath = findNewestMatchingFile(log.path);

  if (!newestPath) {
    if (log.existedBefore !== false) {
      await config.send(log.channelId, `Alert: \`${log.name}\` does not exist or cannot be read: \`${log.path}\``);
      log.existedBefore = false;
      log.status = "stalled";
      await updateChannelName(log, config);
      await upsertStatusEmbed(log, config);
    }
    return;
  }

  log.existedBefore = true;

  if (log.activePath !== newestPath) {
    log.activePath = newestPath;
    log.position = fs.statSync(newestPath).size;
    log.recentLines = [];
    log.lastActivity = Date.now();
    log.status = "active";
    log.alertedStalled = false;
    log.restartHandled = false;
    log.sleepingNotified = false;
    log.pausedReason = null;
    await deleteAlertMessage(log, config);
    await updateChannelName(log, config);
    await upsertStatusEmbed(log, config);
    return;
  }

  const currentSize = fs.statSync(log.activePath).size;

  if (currentSize < log.position) {
    log.position = 0;
    await sendLogEvent(log, config, `\`${log.name}\` appears to have restarted or rotated.`);
  }

  if (currentSize > log.position) {
    const lines = readNewLines(log, currentSize, config.maxLinesPerCheck);
    const wasStalled = log.status === "stalled";
    const wasPaused = log.status === "paused";
    const wasFinished = log.status === "finished";
    const pauseReason = analyzeLogLines(lines);
    log.position = currentSize;
    log.recentLines.push(...lines);
    log.recentLines = log.recentLines.slice(-config.maxStoredLines);
    if (config.liveLogEnabled && lines.length > 0) {
      log.livePendingLines.push(...lines);
      log.livePendingLines = log.livePendingLines.slice(-200);
    }
    await handleAdbScreencapRecovery(log, config, lines);
    await handleDeviceOfflineReconnect(log, config, lines);
    await handleClashRestartTriggers(log, config, lines);
    log.lastActivity = Date.now();
    log.status = "active";

    await updateChannelName(log, config);

    if (pauseReason === "sleeping") {
      log.pausedReason = "sleeping";
      await notifySleeping(log, config);
      return;
    }

    if (pauseReason === "completed") {
      log.pausedReason = "completed";
      await notifyCompleted(log, config);
      return;
    }

    if (pauseReason === "humanized-break") {
      log.pausedReason = "humanized-break";
      log.status = "paused";
      log.restartHandled = true;
      await updateChannelName(log, config);
      await upsertStatusEmbed(log, config);
      return;
    }

    if (pauseReason === "ended") {
      log.pausedReason = "ended";
      await handleRestartCandidate(log, config, "session log ended");
      return;
    }

    log.pausedReason = null;
    log.sleepingNotified = false;

    if ((wasStalled || wasPaused || wasFinished) && lines.length > 0) {
      log.alertedStalled = false;
      log.restartHandled = false;
      await deleteAlertMessage(log, config);
      await upsertStatusEmbed(log, config);
    }
    return;
  }

  const secondsWithoutActivity = Math.floor((Date.now() - log.lastActivity) / 1000);
  if (secondsWithoutActivity >= config.stalledAfterSeconds && !log.alertedStalled) {
    const pauseReason = log.pausedReason || recentPauseReason(log);
    if (pauseReason === "humanized-break") {
      log.alertedStalled = true;
      log.restartHandled = true;
      log.status = "paused";
      await updateChannelName(log, config);
      await upsertStatusEmbed(log, config);
      return;
    }

    if (pauseReason === "sleeping") {
      log.alertedStalled = true;
      await notifySleeping(log, config);
      return;
    }

    if (pauseReason === "completed") {
      log.alertedStalled = true;
      await notifyCompleted(log, config);
      return;
    }

    log.alertedStalled = true;
    log.status = "stalled";
    await updateChannelName(log, config);
    await upsertStatusEmbed(log, config);
    await deleteAlertMessage(log, config);
    await handleRestartCandidate(log, config, pauseReason === "ended" ? "session log ended" : "no new log lines");
    const alertMessage = await config.send(
      log.channelId,
      `@everyone Alert: \`${log.name}\` has had no new lines for ${secondsWithoutActivity} seconds. ` +
        "The application may have stopped.",
      { parse: ["everyone"] }
    );
    log.alertMessageId = alertMessage.id;
    rememberLogState(log, config.state);
  }
}

function parseBooleanEnv(name, fallback = false) {
  const value = String(process.env[name] || "").trim().toLowerCase();
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value);
}

function parseAutoControlInstances(rawValue) {
  const fallback = [
    {
      id: "main",
      label: "AutoClash",
      exePath: "C:\\Users\\PC\\Desktop\\AUTOCOCBOT\\AutoClash\\AutoClash-1.5.3.exe",
      device: "127.0.0.1:5556",
      version: "pro",
      active: false,
      emulator: "auto",
      emulatorIndex: "",
    },
    {
      id: "ld9",
      label: "LD9",
      exePath: "C:\\Users\\PC\\Desktop\\AUTOCOCBOT\\AutoClash - LD9\\AutoClash-1.5.3.exe",
      device: "127.0.0.1:5555",
      version: "pro",
      active: false,
      emulator: "auto",
      emulatorIndex: "",
    },
  ];

  const raw = String(rawValue || "").trim();
  if (!raw) return fallback;

  const instances = [];
  for (const item of raw.split(";")) {
    const parts = item.split("|").map((part) => part.trim());
    if (parts.length < 3) continue;
    instances.push({
      id: parts[0],
      label: parts[1],
      exePath: parts[2],
      device: parts[3] || "",
      version: normalizeAutoControlVersion(parts[4]),
      active: parseBooleanValue(parts[5], false),
      emulator: normalizeEmulatorType(parts[6]),
      emulatorIndex: String(parts[7] || "").replace(/[^0-9]/g, ""),
    });
  }

  return instances.length ? instances : fallback;
}

function parseBooleanValue(value, fallback = false) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "on", "active"].includes(normalized);
}

function normalizeAutoControlVersion(value) {
  return String(value || "").trim().toLowerCase() === "basic" ? "basic" : "pro";
}

function normalizeEmulatorType(value) {
  const normalized = String(value || "auto").trim().toLowerCase();
  return ["auto", "ldplayer", "mumu", "memu", "bluestacks"].includes(normalized) ? normalized : "auto";
}

function statsPointForInstance(instance) {
  if (normalizeAutoControlVersion(instance?.version) === "basic") {
    return { x: 118, y: 202 };
  }

  return { x: 78, y: 355 };
}

function processHintsForInstance(control, instance) {
  if (normalizeAutoControlVersion(instance?.version) === "basic") {
    return {
      processName: "AutoClash Basic",
      windowTitle: "AutoClash Basic",
    };
  }

  return {
    processName: control.exeProcessName,
    windowTitle: control.exeWindowTitle,
  };
}

function resolveAutoClashExePath(instance) {
  const configuredPath = String(instance?.exePath || "").trim();
  if (!configuredPath) return "";

  if (fs.existsSync(configuredPath)) {
    const stat = fs.statSync(configuredPath);
    if (stat.isFile()) return configuredPath;
    if (stat.isDirectory()) {
      const candidates = fs.readdirSync(configuredPath, { withFileTypes: true })
        .filter((entry) => entry.isFile() && /\.exe$/i.test(entry.name))
        .map((entry) => path.join(configuredPath, entry.name))
        .filter((filePath) => {
          const name = path.basename(filePath).toLowerCase();
          if (!/autoclash|acbot/i.test(name)) return false;
          return !/(adb|unins|uninstall|setup|installer|update|crash|helper|elevate)/i.test(name);
        })
        .map((filePath) => ({ filePath, mtimeMs: fs.statSync(filePath).mtimeMs }))
        .sort((a, b) => b.mtimeMs - a.mtimeMs);

      return candidates[0]?.filePath || "";
    }
  }

  const parentDir = path.dirname(configuredPath);
  if (parentDir && parentDir !== configuredPath && fs.existsSync(parentDir)) {
    const fileName = path.basename(configuredPath).replace(/[-_. ]?v?\d+(?:\.\d+)+(?:[-_. ]?\d+)?/ig, "").toLowerCase();
    const candidates = fs.readdirSync(parentDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.exe$/i.test(entry.name))
      .map((entry) => path.join(parentDir, entry.name))
      .filter((filePath) => {
        const name = path.basename(filePath).toLowerCase();
        return /autoclash|acbot/i.test(name) || (fileName && name.includes(fileName));
      })
      .filter((filePath) => !/(adb|unins|uninstall|setup|installer|update|crash|helper|elevate)/i.test(path.basename(filePath)))
      .map((filePath) => ({ filePath, mtimeMs: fs.statSync(filePath).mtimeMs }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    return candidates[0]?.filePath || configuredPath;
  }

  return configuredPath;
}

function autoControlConfig(token, fallbackChannelId) {
  const instances = parseAutoControlInstances(process.env.AUTOCONTROL_INSTANCES);
  return {
    enabled: parseBooleanEnv("AUTOCONTROL_ENABLED", false),
    sendPanelOnStart: parseBooleanEnv("AUTOCONTROL_SEND_PANEL_ON_START", true),
    autoUpdateEnabled: parseBooleanEnv("AUTOCONTROL_AUTO_UPDATE_ENABLED", false),
    token,
    channelId: optionalChannelId("AUTOCONTROL_CHANNEL_ID") || fallbackChannelId,
    adbPath: process.env.AUTOCONTROL_ADB_PATH || "C:\\Users\\PC\\Desktop\\AUTOCOCBOT\\AutoClash\\adb\\adb.exe",
    statsCrop: process.env.AUTOCONTROL_STATS_CROP || "227,31,781,590",
    ldConsolePath: process.env.LDPLAYER_CONSOLE_PATH || "C:\\LDPlayer\\LDPlayer9\\ldconsole.exe",
    mumuCliPath: process.env.MUMU_CLI_PATH || "C:\\Program Files\\Netease\\MuMuPlayer\\nx_main\\mumu-cli.exe",
    mumuAndroidVersion: process.env.MUMU_ANDROID_VERSION || "12",
    buttonBottomOffset: Number(process.env.AUTOCONTROL_BUTTON_BOTTOM_OFFSET || 32),
    exeProcessName: process.env.AUTOCONTROL_EXE_PROCESS_NAME || "AutoClash-1.5.3",
    exeWindowTitle: process.env.AUTOCONTROL_EXE_WINDOW_TITLE || "AutoClash Pro",
    instances,
  };
}

function truncateDiscordText(value, maxLength) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function controlPanelPayload(control) {
  const options = control.instances.slice(0, 25).map((instance, index) => ({
    label: truncateDiscordText(instance.label || `AutoClash ${index + 1}`, 80),
    value: truncateDiscordText(instance.id || `auto${index + 1}`, 100),
    description: truncateDiscordText(instance.device ? `ADB ${instance.device}` : "No ADB device set", 100),
  }));

  const instanceLines = control.instances
    .slice(0, 10)
    .map((instance, index) => {
      const device = instance.device || "no ADB device";
      const version = normalizeAutoControlVersion(instance.version).toUpperCase();
      const active = instance.active ? "yes" : "no";
      return `**${index + 1}. ${instance.label}**\nID: \`${instance.id}\` | Version: \`${version}\` | AutoStart: \`${active}\` | ADB: \`${device}\``;
    })
    .join("\n\n");

  const rows = [
    {
      type: 1,
      components: [
        {
          type: 3,
          custom_id: "autoclash:select",
          placeholder: "Choose AutoClash window",
          min_values: 1,
          max_values: 1,
          options,
        },
      ],
    },
    {
      type: 1,
      components: [
        { type: 2, style: 3, label: "Start", custom_id: "autoclash:selected:start" },
        { type: 2, style: 2, label: "Pause", custom_id: "autoclash:selected:pause" },
        { type: 2, style: 4, label: "Stop", custom_id: "autoclash:selected:stop" },
        { type: 2, style: 1, label: "⚙ Configuration", custom_id: "profile-config:open" },
      ],
    },
    {
      type: 1,
      components: [
        { type: 2, style: 1, label: "Screen", custom_id: "autoclash:selected:screen" },
        { type: 2, style: 1, label: "Full Screen", custom_id: "autoclash:global:fullscreen" },
        { type: 2, style: 1, label: "Session Stats", custom_id: "autoclash:selected:sessionstats" },
        { type: 2, style: 1, label: "Daily Stats", custom_id: "autoclash:selected:dailystats" },
      ],
    },
    {
      type: 1,
      components: [
        { type: 2, style: 3, label: "Open Exe", custom_id: "autoclash:selected:openexe" },
        { type: 2, style: 4, label: "Close Exe", custom_id: "autoclash:selected:closeexe" },
        { type: 2, style: 3, label: "Open Active Exes", custom_id: "autoclash:global:openexe" },
        { type: 2, style: 4, label: "Close Active Exes", custom_id: "autoclash:global:closeexe" },
      ],
    },
    {
      type: 1,
      components: [
        { type: 2, style: 3, label: "Open Emulator", custom_id: "autoclash:selected:openemulator" },
        { type: 2, style: 4, label: "Close Emulator", custom_id: "autoclash:selected:closeemulator" },
        { type: 2, style: 4, label: "Close All Emulators", custom_id: "autoclash:global:closeemulator" },
        { type: 2, style: 2, label: "Show All", custom_id: "autoclash:global:show" },
        { type: 2, style: 2, label: "Hide All", custom_id: "autoclash:global:hide" },
      ],
    },
  ];

  return {
    embeds: [
      {
        title: "AutoClash Control Panel",
        description: "Select a window, then run an action.",
        color: 5869055,
        fields: [
          {
            name: "Configured windows",
            value: truncateDiscordText(instanceLines || "No AutoClash windows configured.", 1024),
          },
        ],
        footer: { text: "Discord Log Monitor" },
      },
    ],
    components: rows,
  };
}

function execFileText(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 30000, ...options }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

function withTimeout(promise, ms, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function executeExeAction(control, action, instance) {
  const hints = processHintsForInstance(control, instance);
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    path.join(process.cwd(), "control-autoclash-window.ps1"),
    "-Action",
    action,
    "-ProcessName",
    hints.processName,
    "-WindowTitle",
    hints.windowTitle,
  ];
  const exePath = resolveAutoClashExePath(instance);
  if (exePath) args.push("-ExePath", exePath);
  if (["start", "pause", "stop"].includes(action)) {
    args.push("-ControlButtonBottomOffset", String(control.buttonBottomOffset || 32));
  }
  args.push("-RestoreMinimized");
  return execFileText("powershell", args, { cwd: process.cwd() });
}

async function executeExeActionWithRetry(control, action, instance, options = {}) {
  const attempts = Math.max(1, options.attempts || 3);
  const delayMs = Math.max(250, options.delayMs || 5000);
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await executeExeAction(control, action, instance);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      console.warn(`[control] ${instance.label} ${action} attempt ${attempt} failed: ${error.message}`);
      await sleep(delayMs);
    }
  }

  throw lastError;
}

function openAutoClashExe(instance) {
  const exePath = resolveAutoClashExePath(instance);
  if (!exePath || !fs.existsSync(exePath) || !fs.statSync(exePath).isFile()) {
    throw new Error(`No AutoClash exe found for ${instance?.label || "selected window"}. Saved path: ${instance?.exePath || "empty"}`);
  }

  const child = spawn(exePath, [], {
    cwd: path.dirname(exePath),
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();
  return exePath;
}

async function closeAutoClashExe(instance) {
  const exePath = resolveAutoClashExePath(instance);
  if (!exePath || !fs.existsSync(exePath) || !fs.statSync(exePath).isFile()) {
    throw new Error(`No AutoClash exe found for ${instance?.label || "selected window"}. Saved path: ${instance?.exePath || "empty"}`);
  }

  const output = await execFileText("powershell", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    path.join(process.cwd(), "close-autoclash-exe.ps1"),
    "-ExePath",
    exePath,
  ], {
    cwd: process.cwd(),
    timeout: 15000,
  });
  return { exePath, output };
}

async function restartAutoClashAfterConfigSave(control, instance, afterClose) {
  const result = await withAutoClashUpdateLock(`Apply profile settings: ${instance.label}`, false, async () => {
    await closeAutoClashExe(instance);
    let closed = false;
    for (let attempt = 0; attempt < 15; attempt++) {
      if (!await getRunningAutoClashWindow(instance)) { closed = true; break; }
      await sleep(1000);
    }
    if (!closed) throw new Error("AutoClash did not close; it was not reopened to avoid a duplicate instance");
    await afterClose();
    openAutoClashExe(instance);
    await activateAutoClashLaunchWindow(instance);
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      const running = await getRunningAutoClashWindow(instance);
      if (running && !/activation/i.test(running.title)) { ready = true; break; }
      await sleep(1000);
    }
    if (!ready) throw new Error("The AutoClash main window did not become ready after activation");
    const log = findLogForControlInstance(instance, [...restartLogsByKey.values()], { control });
    const snapshot = log ? snapshotLogFile(log) : null;
    const startedAt = Date.now();
    await executeExeActionWithRetry(control, "start", instance, { attempts: 6, delayMs: 5000 });
    if (log && await waitForNewLogActivity(log, snapshot, startedAt, 60)) {
      log.autoClashObservedProcess = await getRunningAutoClashWindow(instance);
      log.autoClashPendingUpdate = null;
      return "AutoClash restarted, Start was clicked and new log activity was confirmed.";
    }
    return "AutoClash restarted and Start was clicked. New log activity has not been confirmed; check the instance status.";
  });
  if (result?.busy) throw new Error("Another AutoClash operation is in progress. Wait for it to finish and retry");
  return result;
}

async function activateAutoClashLaunchWindow(instance) {
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    path.join(process.cwd(), "activate-autoclash-launch.ps1"),
  ];
  if (instance) args.push("-ExePath", resolveAutoClashExePath(instance));
  return execFileText("powershell", args, { cwd: process.cwd(), timeout: 90000 });
}

async function inspectAutoClashUpdaters() {
  const output = await execFileText("powershell", [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(process.cwd(), "inspect-autoclash-updaters.ps1"),
  ], { cwd: process.cwd(), timeout: 20000 });
  return JSON.parse(output.trim());
}

function autoClashRecoveryPlan(snapshot, control, failure) {
  const byFolder = new Map();
  for (const item of [...snapshot.running, { exePath: failure.targetExe }]) {
    const folder = path.dirname(item.exePath);
    const key = folder.toLowerCase();
    if (byFolder.has(key)) continue;
    const configured = control.instances.find(instance =>
      path.dirname(resolveAutoClashExePath(instance)).toLowerCase() === key);
    byFolder.set(key, configured
      ? { ...configured, exePath: folder }
      : { id: key, label: path.basename(folder), exePath: folder, active: false });
  }
  return [...byFolder.values()];
}

async function closeAutoClashRecoverySnapshot(snapshot) {
  const file = path.join(process.cwd(), "autoclash-update-recovery-snapshot.json");
  fs.writeFileSync(file, JSON.stringify(snapshot), "utf8");
  return execFileText("powershell", [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(process.cwd(), "close-autoclash-recovery.ps1"), "-SnapshotPath", file,
  ], { cwd: process.cwd(), timeout: 20000 });
}

async function retryFailedAutoClashUpdater(failure) {
  if (!fs.existsSync(failure.exePath)) throw new Error("The failed updater executable is no longer available.");
  const args = [...failure.arguments];
  args[1] = failure.targetExe;
  const child = spawn(failure.exePath, args, {
    cwd: path.dirname(failure.targetExe), stdio: "ignore", windowsHide: false,
  });
  let launchError = null;
  let exited = false;
  let exitCode = null;
  child.on("error", error => { launchError = error; });
  child.on("exit", code => { exited = true; exitCode = code; });
  const root = path.dirname(failure.targetExe).toLowerCase();
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    await sleep(4000);
    if (launchError) throw launchError;
    const snapshot = await inspectAutoClashUpdaters();
    const related = snapshot.updaters.filter(item => path.dirname(item.targetExe).toLowerCase() === root);
    const blocked = related.find(item => item.blocked);
    if (blocked) throw new Error(`Updater still failed: ${blocked.text.slice(-800)}`);
    if (exited && related.length === 0) {
      if (exitCode !== 0) throw new Error(`Updater exited with code ${exitCode}.`);
      return;
    }
  }
  throw new Error("Updater has not finished after 4 minutes. Its AutoClash will stay closed until updating finishes.");
}

async function restoreAutoClashAfterUpdateFailure(plan, config, updatingRoots = []) {
  const remaining = [];
  for (const instance of plan) {
    const root = path.dirname(resolveAutoClashExePath(instance)).toLowerCase();
    if (updatingRoots.includes(root)) { remaining.push(instance); continue; }
    try {
      let running = await getRunningAutoClashWindow(instance);
      const processes = await inspectAutoClashUpdaters();
      const launching = processes.running.some(item => path.dirname(item.exePath).toLowerCase() === root);
      if (!running && !launching) {
        openAutoClashExe(instance);
      }
      for (let attempt = 0; !running && attempt < 10; attempt++) {
        await sleep(2000);
        running = await getRunningAutoClashWindow(instance);
      }
      if (!running) throw new Error("AutoClash has not opened a window yet. Will retry without launching a duplicate.");
      if (/activation/i.test(running.title)) {
        await activateAutoClashLaunchWindow(instance);
        await sleep(8000);
      }
      const log = findLogForControlInstance(instance, [...restartLogsByKey.values()], config);
      if (instance.active && log) {
        const snapshot = snapshotLogFile(log);
        const startedAt = Date.now();
        await executeExeActionWithRetry(config.control, "start", instance, { attempts: 6, delayMs: 5000 });
        if (!await waitForNewLogActivity(log, snapshot, startedAt, 60)) {
          throw new Error("Start was sent, but no new log activity was confirmed.");
        }
        log.autoClashObservedProcess = await getRunningAutoClashWindow(instance);
        log.autoClashPendingUpdate = null;
        rememberLogState(log, config.state);
      }
      await config.send(config.control.channelId, `${instance.label}: reopened after updater recovery${instance.active && log ? "; Start and new log activity confirmed" : ""}.`);
    } catch (error) {
      remaining.push(instance);
      await config.send(config.control.channelId, `${instance.label}: could not restore AutoClash after the update: ${error.message}`);
    }
  }
  return remaining;
}

async function handleAutoClashUpdateFailure(config) {
  if (!config.control?.autoUpdateEnabled) return false;
  if (autoClashUpdateRecoveryRunning) return true;
  if (Date.now() - lastAutoClashUpdaterScanAt < 15000) return false;
  lastAutoClashUpdaterScanAt = Date.now();
  const snapshot = await inspectAutoClashUpdaters();
  const failure = snapshot.updaters.find(item => item.blocked && config.control.instances.some(instance =>
    path.dirname(resolveAutoClashExePath(instance)).toLowerCase() === path.dirname(item.targetExe).toLowerCase()));
  const pending = config.state.autoClashUpdateRecovery;
  if (!failure && !pending?.plan?.length) return false;
  const key = failure ? `${failure.targetExe.toLowerCase()}:${failure.arguments[3]}` : "";
  const attempts = config.state.autoClashUpdateRecoveryAttempts ||= {};
  if (failure && (attempts[key]?.count >= 2 || Date.now() - (attempts[key]?.at || 0) < 600000)) return false;

  const result = await withAutoClashUpdateLock("Updater recovery", false, async () => {
    autoClashUpdateRecoveryRunning = true;
    try {
      let plan = pending?.plan || [];
      if (failure) {
        plan = [...new Map([...plan, ...autoClashRecoveryPlan(snapshot, config.control, failure)]
          .map(instance => [instance.exePath.toLowerCase(), instance])).values()];
        attempts[key] = { count: (attempts[key]?.count || 0) + 1, at: Date.now() };
        config.state.autoClashUpdateRecovery = { plan };
        saveState(config.state);
        await config.send(config.control.channelId, "AutoClash update is blocked by an old executable. Closing all AutoClash processes, including background workers, and retrying the update.");
        const failedRoots = new Set(snapshot.updaters.filter(item => item.blocked).map(item => path.dirname(item.targetExe).toLowerCase()));
        await closeAutoClashRecoverySnapshot({
          running: snapshot.running,
          updaters: snapshot.updaters.filter(item => failedRoots.has(path.dirname(item.targetExe).toLowerCase())),
        });
        try {
          await retryFailedAutoClashUpdater(failure);
        } catch (error) {
          await config.send(config.control.channelId, `AutoClash updater recovery: ${error.message}`);
        }
      }
      const after = await inspectAutoClashUpdaters();
      const failed = after.updaters.filter(item => item.blocked);
      if (failed.length) {
        const roots = new Set(failed.map(item => path.dirname(item.targetExe).toLowerCase()));
        await closeAutoClashRecoverySnapshot({ running: [], updaters: after.updaters.filter(item => roots.has(path.dirname(item.targetExe).toLowerCase())) });
      }
      const updatingRoots = after.updaters.filter(item => !failed.some(f => path.dirname(f.targetExe).toLowerCase() === path.dirname(item.targetExe).toLowerCase()))
        .map(item => path.dirname(item.targetExe).toLowerCase());
      const remaining = await restoreAutoClashAfterUpdateFailure(plan, config, updatingRoots);
      config.state.autoClashUpdateRecovery = remaining.length ? { plan: remaining } : null;
      saveState(config.state);
      return true;
    } finally {
      autoClashUpdateRecoveryRunning = false;
    }
  });
  return result === true || Boolean(result?.busy);
}

async function getRunningAutoClashWindow(instance) {
  const output = await execFileText("powershell", [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(process.cwd(), "detect-autoclash-process.ps1"),
    "-ExePath", resolveAutoClashExePath(instance),
  ], { cwd: process.cwd(), timeout: 15000 });
  const windows = JSON.parse(output.trim() || "[]");
  windows.sort((a, b) => Number(/activation/i.test(a.title)) - Number(/activation/i.test(b.title)) || Date.parse(b.startedAt) - Date.parse(a.startedAt));
  const current = windows[0] || null;
  if (current) current.version = current.title?.match(/(?:AutoClash|ACBot).*?\bv([\d.]+)/i)?.[1] || "";
  if (current && fs.existsSync(current.exePath)) {
    const stat = fs.statSync(current.exePath);
    current.fingerprint = `${stat.size}:${stat.mtimeMs}`;
  }
  return current;
}

function observeAutoClashReplacement(log, instance, current) {
  if (!current) return false;
  const observed = log.autoClashObservedProcess;
  const previous = observed && path.dirname(observed.exePath).toLowerCase() === path.dirname(current.exePath).toLowerCase() ? observed : null;
  if (observed && !previous) log.autoClashPendingUpdate = null;
  const savedPath = path.resolve(instance.exePath).toLowerCase();
  const changed = previous
    ? previous.exePath.toLowerCase() !== current.exePath.toLowerCase() ||
      (previous.startedAt !== current.startedAt && previous.fingerprint !== current.fingerprint)
      || (previous.startedAt !== current.startedAt && previous.version !== current.version)
    : /\.exe$/i.test(savedPath) && !fs.existsSync(instance.exePath) && savedPath !== current.exePath.toLowerCase();
  log.autoClashObservedProcess = current;
  instance.exePath = current.exePath;
  if (changed) log.autoClashPendingUpdate = current;
  return changed;
}

async function handleAutoClashUpdate(log, config) {
  const now = Date.now();
  if (now - log.lastAutoUpdateCheckAt < 15000) return;
  log.lastAutoUpdateCheckAt = now;
  const instance = findControlInstanceForLog(log, config);
  if (!instance?.exePath) return;

  await withAutoClashUpdateLock(instance.label, false, async () => {
    const current = await getRunningAutoClashWindow(instance);
    const previous = log.autoClashObservedProcess;
    observeAutoClashReplacement(log, instance, current);
    if (config.state && current && JSON.stringify(previous) !== JSON.stringify(current)) rememberLogState(log, config.state);
    if (!current || !config.control?.autoUpdateEnabled || !automaticControlEnabled(instance)) return;
    if (!log.autoClashPendingUpdate) return;
    if (Date.now() - Date.parse(current.startedAt) < 10000) return;
    if (now - (log.lastAutoUpdateHandledAt || 0) < 180000) return;
    log.lastAutoUpdateHandledAt = now;
    await sendLogEvent(log, config, `\`${instance.label}\` reopened after an automatic update (${path.basename(current.exePath)}). Sending Start.`);

    const snapshot = snapshotLogFile(log);
    const startedAt = Date.now();
    const maxAttempts = Math.max(1, Number(process.env.APP_AUTOSTART_MAX_ATTEMPTS || 2));
    const waitSeconds = Math.max(20, Number(process.env.APP_AUTOSTART_LOG_WAIT_SECONDS || 90));
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await executeExeActionWithRetry(config.control, "start", instance, { attempts: 6, delayMs: 5000 });
      if (await waitForNewLogActivity(log, snapshot, startedAt, waitSeconds)) {
        log.autoClashPendingUpdate = null;
        if (config.state) rememberLogState(log, config.state);
        await sendLogEvent(log, config, `\`${instance.label}\` resumed after the update. New log activity confirmed.`);
        return;
      }
    }
    await sendLogEvent(log, config, `\`${instance.label}\`: Start was sent after the update, but new log activity was not confirmed. Will retry in 3 minutes.`);
  }).catch((error) => {
    console.error(`[${log.name}] AutoClash update recovery failed: ${error.message}`);
  });
}

async function startAutoClashInstanceAndWaitForLogCore(instance, log, config, progressSend = config.send) {
  const snapshot = snapshotLogFile(log);
  const startedAt = Date.now();
  const running = await getRunningAutoClashWindow(instance);
  const exePath = running?.exePath || openAutoClashExe(instance);
  if (running) {
    instance.exePath = running.exePath;
  } else {
    const activationOutput = (await activateAutoClashLaunchWindow(instance)).trim();
    console.log(`[autostart] ${instance.label}: ${activationOutput || "AutoClash opened."}`);
  }
  if (running && /activation/i.test(running.title)) await activateAutoClashLaunchWindow(instance);
  await sleep(8000);

  const maxAttempts = Math.max(1, Number(process.env.APP_AUTOSTART_MAX_ATTEMPTS || 2));
  const waitSeconds = Math.max(20, Number(process.env.APP_AUTOSTART_LOG_WAIT_SECONDS || 90));

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await executeExeActionWithRetry(config.control, "stop", instance, { attempts: 6, delayMs: 5000 });
    } catch (error) {
      console.warn(`[autostart] ${instance.label}: stop before start failed: ${error.message}`);
    }

    await sleep(1200);
    await executeExeActionWithRetry(config.control, "start", instance, { attempts: 6, delayMs: 5000 });
    await progressSend(
      config.control.channelId,
      `AutoStart: Start clicked for \`${instance.label}\`. Waiting for new log lines from \`${log.name}\`.`
    );

    const hasNewLines = await waitForNewLogActivity(log, snapshot, startedAt, waitSeconds);
    if (hasNewLines) {
      return { exePath, attempts: attempt };
    }

    if (attempt < maxAttempts) {
      await progressSend(
        config.control.channelId,
        `AutoStart: \`${instance.label}\` did not write new log lines after attempt ${attempt}. Sending Stop/Start again.`
      );
    }
  }

  throw new Error(`No new log lines were detected for ${log.name} after ${maxAttempts} start attempt(s).`);
}

async function startAutoClashInstanceAndWaitForLog(instance, log, config, progressSend = config.send) {
  return withAutoClashUpdateLock(instance.label, true, async () => {
    return startAutoClashInstanceAndWaitForLogCore(instance, log, config, progressSend);
  });
}

async function runAutoStartSequence(logs, config) {
  if (!parseBooleanEnv("APP_AUTOSTART_SEQUENCE", false)) return;
  if (!config.control?.instances?.length) return;

  const tempMessages = [];
  const succeeded = [];
  const skipped = [];
  const failed = [];
  const progressSend = async (channelId, message, allowedMentions) => {
    const sent = await config.send(channelId, message, allowedMentions);
    if (sent?.id) tempMessages.push({ channelId, messageId: sent.id });
    return sent;
  };

  const activeInstances = config.control.instances.filter((instance) => instance.active);
  if (activeInstances.length === 0) {
    await config.send(config.control.channelId, "AutoStart is enabled, but no AutoClash exe is marked Active.");
    return;
  }

  await progressSend(
    config.control.channelId,
    `AutoStart sequence started for ${activeInstances.length} active AutoClash exe(s).`
  );

  for (const instance of activeInstances) {
    const log = findLogForControlInstance(instance, logs, config);
    if (!log) {
      skipped.push(`${instance.label}: no matching log`);
      await progressSend(
        config.control.channelId,
        `AutoStart: \`${instance.label}\` was skipped because no matching log was found.`
      );
      continue;
    }

    try {
      await progressSend(config.control.channelId, `AutoStart: opening \`${instance.label}\` and starting \`${log.name}\`.`);
      const result = await startAutoClashInstanceAndWaitForLog(instance, log, config, progressSend);
      succeeded.push(`${instance.label}: ${log.name} (${result.attempts} attempt${result.attempts === 1 ? "" : "s"})`);
      await progressSend(
        config.control.channelId,
        `AutoStart: \`${instance.label}\` is running. New log lines detected for \`${log.name}\` after ${result.attempts} attempt(s).`
      );
    } catch (error) {
      const details = [error.message, error.stderr, error.stdout].filter(Boolean).join("\n").trim().slice(0, 1500);
      failed.push(`${instance.label}: ${error.message}`);
      await progressSend(
        config.control.channelId,
        `AutoStart: \`${instance.label}\` failed:\n\`\`\`text\n${details}\n\`\`\``
      );
    }
  }

  for (const item of tempMessages) {
    try {
      await config.deleteMessage(item.channelId, item.messageId);
      await sleep(250);
    } catch (error) {
      console.warn(`[autostart] Could not delete temporary message ${item.messageId}: ${error.message}`);
    }
  }

  const statusLine =
    failed.length === 0 && skipped.length === 0
      ? "AutoStart finished. All active AutoClash exe(s) are running."
      : "AutoStart finished with notes.";
  const parts = [statusLine];
  if (succeeded.length > 0) parts.push(`Running:\n${succeeded.map((item) => `- ${item}`).join("\n")}`);
  if (skipped.length > 0) parts.push(`Skipped:\n${skipped.map((item) => `- ${item}`).join("\n")}`);
  if (failed.length > 0) parts.push(`Failed:\n${failed.map((item) => `- ${item}`).join("\n")}`);

  await config.send(config.control.channelId, parts.join("\n\n").slice(0, 1900));
}

async function captureStats(control, instance) {
  const dir = SCREENSHOT_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${instance.id}-stats-${new Date().toISOString().replace(/[:.]/g, "-")}.png`);
  const statsPoint = statsPointForInstance(instance);
  const hints = processHintsForInstance(control, instance);
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    path.join(process.cwd(), "capture-autoclash-window.ps1"),
    "-OutputPath",
    file,
    "-ProcessName",
    hints.processName,
    "-WindowTitle",
    hints.windowTitle,
  ];
  const exePath = resolveAutoClashExePath(instance);
  if (exePath) args.push("-ExePath", exePath);
  args.push("-Crop", control.statsCrop, "-EnsureStatsTab", "-StatsX", String(statsPoint.x), "-StatsY", String(statsPoint.y));
  await execFileText("powershell", args, { cwd: process.cwd() });
  requireReadableFile(file, "AutoClash stats screenshot");
  return file;
}

function autoClashRootDir(instance) {
  const exePath = resolveAutoClashExePath(instance);
  if (exePath && fs.existsSync(exePath) && fs.statSync(exePath).isFile()) {
    return path.dirname(exePath);
  }

  const configuredPath = String(instance?.exePath || "").trim();
  if (configuredPath && fs.existsSync(configuredPath)) {
    const stat = fs.statSync(configuredPath);
    return stat.isDirectory() ? configuredPath : path.dirname(configuredPath);
  }

  return "";
}

function statsDirForInstance(instance) {
  const rootDir = autoClashRootDir(instance);
  return rootDir ? path.join(rootDir, "logs", "stats") : "";
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function newestSessionStatsFile(instance) {
  const statsDir = statsDirForInstance(instance);
  if (!statsDir || !fs.existsSync(statsDir)) return "";

  const candidates = fs.readdirSync(statsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^session-\d+.*\.json$/i.test(entry.name))
    .map((entry) => path.join(statsDir, entry.name))
    .map((filePath) => ({ filePath, mtimeMs: fs.statSync(filePath).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  return candidates[0]?.filePath || "";
}

function statsDbFile(instance) {
  const statsDir = statsDirForInstance(instance);
  const file = statsDir ? path.join(statsDir, "stats.db") : "";
  return file && fs.existsSync(file) ? file : "";
}

const SESSION_STATS_COLUMNS = [
  "session_key",
  "day_key",
  "timestamp",
  "runtime",
  "runtime_seconds",
  "total_attacks",
  "gold_gained",
  "elixir_gained",
  "dark_gained",
  "donations_completed",
  "bb_attacks",
  "bb_walls_upgraded",
  "stars_0",
  "stars_1",
  "stars_2",
  "stars_3",
  "walls_upgraded",
  "obstacles_removed",
  "upgrades_done",
  "research_done",
];

function sqliteVarint(buffer, offset) {
  let value = 0;
  for (let i = 0; i < 9; i += 1) {
    const byte = buffer[offset + i];
    if (i === 8) return { value: value * 256 + byte, offset: offset + 9 };
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return { value, offset: offset + i + 1 };
  }
  return { value, offset: offset + 9 };
}

function signedNumber(value, bits) {
  const sign = 2 ** (bits - 1);
  const full = 2 ** bits;
  return value >= sign ? value - full : value;
}

function sqliteRecordValue(buffer, offset, serialType) {
  if (serialType === 0) return { value: null, offset };
  if (serialType === 1) return { value: buffer.readInt8(offset), offset: offset + 1 };
  if (serialType === 2) return { value: buffer.readInt16BE(offset), offset: offset + 2 };
  if (serialType === 3) return { value: signedNumber(buffer.readUIntBE(offset, 3), 24), offset: offset + 3 };
  if (serialType === 4) return { value: buffer.readInt32BE(offset), offset: offset + 4 };
  if (serialType === 5) return { value: signedNumber(buffer.readUIntBE(offset, 6), 48), offset: offset + 6 };
  if (serialType === 6) return { value: Number(buffer.readBigInt64BE(offset)), offset: offset + 8 };
  if (serialType === 7) return { value: buffer.readDoubleBE(offset), offset: offset + 8 };
  if (serialType === 8) return { value: 0, offset };
  if (serialType === 9) return { value: 1, offset };

  const length = Math.floor((serialType - 12) / 2);
  const bytes = buffer.subarray(offset, offset + length);
  return {
    value: serialType % 2 === 1 ? bytes.toString("utf8") : bytes,
    offset: offset + length,
  };
}

function sqliteParseRecord(buffer, offset) {
  const header = sqliteVarint(buffer, offset);
  const headerEnd = offset + header.value;
  const serialTypes = [];
  let cursor = header.offset;
  while (cursor < headerEnd) {
    const serial = sqliteVarint(buffer, cursor);
    serialTypes.push(serial.value);
    cursor = serial.offset;
  }

  const values = [];
  cursor = headerEnd;
  for (const serialType of serialTypes) {
    const parsed = sqliteRecordValue(buffer, cursor, serialType);
    values.push(parsed.value);
    cursor = parsed.offset;
  }
  return values;
}

function sqliteReadTableRows(dbPath, tableName, columns) {
  const buffer = fs.readFileSync(dbPath);
  if (buffer.subarray(0, 16).toString("ascii") !== "SQLite format 3\u0000") {
    throw new Error(`Invalid SQLite database: ${dbPath}`);
  }

  const pageSizeValue = buffer.readUInt16BE(16);
  const pageSize = pageSizeValue === 1 ? 65536 : pageSizeValue;
  const readPageRows = (pageNo, visited = new Set()) => {
    if (!pageNo || visited.has(pageNo)) return [];
    visited.add(pageNo);

    const pageOffset = (pageNo - 1) * pageSize;
    const headerOffset = pageOffset + (pageNo === 1 ? 100 : 0);
    const pageType = buffer[headerOffset];
    const cellCount = buffer.readUInt16BE(headerOffset + 3);
    const rows = [];

    if (pageType === 0x0d) {
      for (let i = 0; i < cellCount; i += 1) {
        const cellOffset = pageOffset + buffer.readUInt16BE(headerOffset + 8 + i * 2);
        const payload = sqliteVarint(buffer, cellOffset);
        const rowid = sqliteVarint(buffer, payload.offset);
        rows.push({ rowid: rowid.value, values: sqliteParseRecord(buffer, rowid.offset) });
      }
      return rows;
    }

    if (pageType === 0x05) {
      for (let i = 0; i < cellCount; i += 1) {
        const cellOffset = pageOffset + buffer.readUInt16BE(headerOffset + 12 + i * 2);
        rows.push(...readPageRows(buffer.readUInt32BE(cellOffset), visited));
      }
      rows.push(...readPageRows(buffer.readUInt32BE(headerOffset + 8), visited));
      return rows;
    }

    throw new Error(`Unsupported SQLite page type ${pageType} in ${dbPath}`);
  };

  const masterRows = readPageRows(1).map((row) => {
    const [type, name, tblName, rootpage, sql] = row.values;
    return { type, name, tblName, rootpage, sql };
  });
  const table = masterRows.find((row) => row.type === "table" && row.name === tableName);
  if (!table?.rootpage) throw new Error(`SQLite table not found: ${tableName}`);

  return readPageRows(Number(table.rootpage)).map((row) => {
    const record = {};
    columns.forEach((column, index) => {
      record[column] = row.values[index] ?? null;
    });
    return record;
  });
}

function readSessionStatsRowsFromDb(instance) {
  const dbPath = statsDbFile(instance);
  return dbPath ? sqliteReadTableRows(dbPath, "session_stats", SESSION_STATS_COLUMNS) : [];
}

function latestSessionStats(instance) {
  const dbPath = statsDbFile(instance);
  if (dbPath) {
    const stats = readSessionStatsRowsFromDb(instance).sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))[0];
    if (stats) return { stats, source: "stats.db" };
  }

  const file = newestSessionStatsFile(instance);
  if (!file) return null;
  return { stats: readJsonFile(file), source: path.basename(file) };
}

function dailyStatsFromDb(instance) {
  const dbPath = statsDbFile(instance);
  if (!dbPath) return null;

  const rows = readSessionStatsRowsFromDb(instance);
  const dates = [...new Set(rows.map((row) => row.day_key).filter(Boolean))].sort();
  const date = dates[dates.length - 1];
  if (!date) return null;

  const stats = { day_key: date };
  for (const column of SESSION_STATS_COLUMNS) {
    if (["session_key", "day_key", "timestamp", "runtime"].includes(column)) continue;
    stats[column] = rows
      .filter((row) => row.day_key === date)
      .reduce((sum, row) => sum + Number(row[column] || 0), 0);
  }
  return { date, stats, source: "stats.db" };
}

function compactNumber(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "0";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(number);
}

function fullNumber(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "0";
  return new Intl.NumberFormat("en-US").format(number);
}

function formatDuration(seconds, fallback = "") {
  if (fallback) return String(fallback);
  const total = Math.max(0, Number(seconds || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = Math.floor(total % 60);
  return [hours, minutes, secs].map((part) => String(part).padStart(2, "0")).join(":");
}

function statLine(label, value, formatter = fullNumber) {
  return `${label}: **${formatter(value)}**`;
}

function embedValue(label, value, formatter = fullNumber) {
  return `**${formatter(value)}**\n${label}`;
}

function starsValue(stats) {
  return [
    `0 stars: **${fullNumber(stats.stars_0)}**`,
    `1 star: **${fullNumber(stats.stars_1)}**`,
    `2 stars: **${fullNumber(stats.stars_2)}**`,
    `3 stars: **${fullNumber(stats.stars_3)}**`,
  ].join("\n");
}

function sessionStatsEmbed(instance) {
  const result = latestSessionStats(instance);
  if (!result) {
    throw new Error(`No session stats were found for ${instance.label}. Expected stats.db or session JSON under: ${statsDirForInstance(instance) || "unknown stats folder"}`);
  }

  const { stats, source } = result;
  return {
    title: `${instance.label} Session Stats`,
    description: `Runtime **${formatDuration(stats.runtime_seconds, stats.runtime)}** - **${fullNumber(stats.total_attacks)}** attacks`,
    color: 5763719,
    fields: [
      { name: "Gold", value: embedValue("gained", stats.gold_gained, compactNumber), inline: true },
      { name: "Elixir", value: embedValue("gained", stats.elixir_gained, compactNumber), inline: true },
      { name: "Dark", value: embedValue("gained", stats.dark_gained, compactNumber), inline: true },
      { name: "Donations", value: embedValue("completed", stats.donations_completed), inline: true },
      { name: "Walls", value: embedValue("upgraded", stats.walls_upgraded), inline: true },
      { name: "Builder Base", value: `Attacks: **${fullNumber(stats.bb_attacks)}**\nWalls: **${fullNumber(stats.bb_walls_upgraded)}**`, inline: true },
      { name: "Progress", value: `Obstacles: **${fullNumber(stats.obstacles_removed)}**\nUpgrades: **${fullNumber(stats.upgrades_done)}**\nResearch: **${fullNumber(stats.research_done)}**`, inline: true },
      { name: "Stars", value: starsValue(stats), inline: false },
    ],
    footer: { text: `Source: ${source}` },
  };
}

function dailyStatsEmbed(instance) {
  let result = dailyStatsFromDb(instance);
  if (!result) {
    const statsDir = statsDirForInstance(instance);
    const file = statsDir ? path.join(statsDir, "daily_totals.json") : "";
    if (!file || !fs.existsSync(file)) {
      throw new Error(`No daily stats were found for ${instance.label}. Expected stats.db or daily_totals.json under: ${statsDir || "unknown stats folder"}`);
    }

    const daily = readJsonFile(file);
    const dates = Object.keys(daily).sort();
    const date = dates[dates.length - 1];
    result = { date, stats: daily[date] || {}, source: "daily_totals.json" };
  }

  const { date, stats, source } = result;
  return {
    title: `${instance.label} Daily Stats - ${date || "latest"}`,
    description: `Runtime **${formatDuration(stats.runtime_seconds)}** - **${fullNumber(stats.total_attacks)}** attacks`,
    color: 3447003,
    fields: [
      { name: "Gold", value: embedValue("gained", stats.gold_gained, compactNumber), inline: true },
      { name: "Elixir", value: embedValue("gained", stats.elixir_gained, compactNumber), inline: true },
      { name: "Dark", value: embedValue("gained", stats.dark_gained, compactNumber), inline: true },
      { name: "Donations", value: embedValue("completed", stats.donations_completed), inline: true },
      { name: "Builder Base", value: `Attacks: **${fullNumber(stats.bb_attacks)}**\nWalls: **${fullNumber(stats.bb_walls_upgraded)}**`, inline: true },
      { name: "Progress", value: `Walls: **${fullNumber(stats.walls_upgraded)}**\nObstacles: **${fullNumber(stats.obstacles_removed)}**\nUpgrades: **${fullNumber(stats.upgrades_done)}**\nResearch: **${fullNumber(stats.research_done)}**`, inline: true },
    ],
    footer: { text: `Source: ${source}` },
  };
}
async function editInteractionEmbed(token, interaction, embed) {
  await discordRequest(token, `/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "", embeds: [embed] }),
  });
}

function safeFileName(value) {
  return String(value || "capture").replace(/[<>:"/\\|?*\x00-\x1F]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 80) || "capture";
}

async function captureAdbScreen(control, instance, options = {}) {
  if (!instance.device) {
    throw new Error(`${instance.label} does not have an ADB device configured`);
  }

  const dir = options.dir || path.join(process.cwd(), "control-screenshots");
  fs.mkdirSync(dir, { recursive: true });
  const prefix = options.prefix || `${instance.id}-screen`;
  const file = path.join(dir, `${safeFileName(prefix)}-${new Date().toISOString().replace(/[:.]/g, "-")}.png`);
  await execFileText(control.adbPath, ["connect", instance.device], { cwd: process.cwd() }).catch(() => "");
  const bytes = await new Promise((resolve, reject) => {
    execFile(control.adbPath, ["-s", instance.device, "exec-out", "screencap", "-p"], {
      cwd: process.cwd(),
      encoding: "buffer",
      maxBuffer: 64 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
  fs.writeFileSync(file, bytes);
  return file;
}

async function adbScreenSize(control, instance) {
  const output = await runAdb(control, instance, ["shell", "wm", "size"]);
  const match = output.match(/Physical size:\s*(\d+)x(\d+)/i) || output.match(/Override size:\s*(\d+)x(\d+)/i);
  if (!match) {
    throw new Error(`Could not read screen size for ${instance.label}: ${output.trim()}`);
  }

  return { width: Number(match[1]), height: Number(match[2]) };
}

async function adbTapRatio(control, instance, size, xRatio, yRatio) {
  const x = Math.round(size.width * xRatio);
  const y = Math.round(size.height * yRatio);
  await runAdb(control, instance, ["shell", "input", "tap", String(x), String(y)]);
}

async function captureFullScreen() {
  const dir = SCREENSHOT_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `full-screen-${new Date().toISOString().replace(/[:.]/g, "-")}.png`);
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    path.join(process.cwd(), "capture-fullscreen.ps1"),
    "-OutputPath",
    file,
  ];
  await execFileText("powershell", args, { cwd: process.cwd() });
  return file;
}

async function respondInteraction(token, interaction, content) {
  await discordRequest(token, `/interactions/${interaction.id}/${interaction.token}/callback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: 4, data: { content, flags: 64 } }),
  });
}

async function deferInteraction(token, interaction) {
  await discordRequest(token, `/interactions/${interaction.id}/${interaction.token}/callback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: 5, data: { flags: 64 } }),
  });
}

async function editInteraction(token, interaction, content) {
  await discordRequest(token, `/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
}

async function followupFile(token, interaction, content, filePath, options = {}) {
  const form = new FormData();
  form.append("payload_json", JSON.stringify({ content, flags: 64 }));
  requireReadableFile(filePath, "Discord upload file");
  const bytes = fs.readFileSync(filePath);
  form.append("file", new Blob([bytes], { type: "image/png" }), path.basename(filePath));
  try {
    await withTimeout(discordRequest(token, `/webhooks/${interaction.application_id}/${interaction.token}`, {
      method: "POST",
      body: form,
    }), 30000, "Discord file upload");
  } finally {
    if (options.deleteAfterSend) deleteFileQuietly(filePath);
  }
}

function interactionUserId(interaction) {
  return interaction.member?.user?.id || interaction.user?.id || "default";
}

function selectedControlInstance(control, interaction) {
  const selectedId = selectedAutoControlInstances.get(interactionUserId(interaction));
  return resolveControlInstance(control, selectedId) || control.instances[0] || null;
}

function requiredSelectedControlInstance(control, interaction) {
  const selectedId = selectedAutoControlInstances.get(interactionUserId(interaction));
  return selectedId ? resolveControlInstance(control, selectedId) : null;
}

function resolveControlInstance(control, value) {
  const selected = String(value || "").trim();
  if (!selected) return null;

  const exact = control.instances.find((item) => item.id === selected);
  if (exact) return exact;

  const selectedKey = normalizeKey(selected);
  const fuzzy = control.instances.find((item) => {
    const keys = [
      item.id,
      item.label,
      item.device,
      path.basename(resolveAutoClashExePath(item) || item.exePath || ""),
    ].map(normalizeKey).filter(Boolean);
    return keys.some((key) => key === selectedKey || key.includes(selectedKey) || selectedKey.includes(key));
  });
  if (fuzzy) return fuzzy;

  const activeInstances = control.instances.filter((item) => item.active);
  if (activeInstances.length === 1) return activeInstances[0];
  if (control.instances.length === 1) return control.instances[0];

  return null;
}

async function handleControlInteraction(control, interaction) {
  const id = interaction.data?.custom_id || "";
  if (!id.startsWith("autoclash:")) return;
  if (autoClashUpdateRecoveryRunning && id !== "autoclash:select") {
    await respondInteraction(control.token, interaction, "AutoClash updater recovery is in progress. Please wait until the instances have reopened.");
    return;
  }

  if (id === "autoclash:select") {
    const selectedId = interaction.data?.values?.[0] || "";
    const instance = resolveControlInstance(control, selectedId);
    if (!instance) {
      const knownIds = control.instances.map((item) => item.id).join(", ") || "none";
      await respondInteraction(control.token, interaction, `Unknown AutoClash window: ${selectedId || "empty"}. Known: ${knownIds}.`);
      return;
    }

    selectedAutoControlInstances.set(interactionUserId(interaction), instance.id);
    await respondInteraction(control.token, interaction, `Selected: ${instance.label}`);
    return;
  }

  let [, instanceId, action] = id.split(":");
  if (!action) {
    action = instanceId;
    instanceId = control.instances[0]?.id || "main";
  }

  if (action === "label") {
    await respondInteraction(control.token, interaction, "This button only labels the row.");
    return;
  }

  await deferInteraction(control.token, interaction);

  const instance =
    instanceId === "selected"
      ? requiredSelectedControlInstance(control, interaction)
      : resolveControlInstance(control, instanceId);
  try {
    if (instanceId === "selected" && !instance && action !== "fullscreen") {
      await editInteraction(control.token, interaction, "Choose an AutoClash window from the dropdown first.");
      return;
    }

    if (["start", "pause", "stop", "show", "hide"].includes(action)) {
      if (instanceId === "global") {
        const outputs = [];
        const targetInstances = control.instances.some((item) => item.active)
          ? control.instances.filter((item) => item.active)
          : control.instances;

        for (const item of targetInstances) {
          try {
            const output = await executeExeAction(control, action, item);
            outputs.push(`${item.label}: ${output.trim()}`);
          } catch (error) {
            const details = [error.message, error.stderr, error.stdout].filter(Boolean).join("\n").trim().split(/\r?\n/)[0];
            outputs.push(`${item.label}: failed - ${details}`);
          }
        }
        await editInteraction(control.token, interaction, `Done: \`${action}\`\n${outputs.join("\n")}`);
        return;
      }

      if (!instance) throw new Error(`Unknown instance: ${instanceId}`);
      const output = await executeExeAction(control, action, instance);
      await editInteraction(control.token, interaction, `Done: \`${instance.label} ${action}\`\n${output.trim()}`);
      return;
    }

    if (action === "openexe") {
      if (instanceId === "global") {
        const targetInstances = activeOrAllInstances(control);
        const message = await runForInstances(targetInstances, "Open active AutoClash exe(s):", async (item) => {
          const exePath = openAutoClashExe(item);
          await activateAutoClashLaunchWindow(item);
          return exePath;
        });
        await editInteraction(control.token, interaction, message);
        return;
      }
      if (!instance) throw new Error(`Unknown instance: ${instanceId}`);
      const exePath = openAutoClashExe(instance);
      const activationOutput = await activateAutoClashLaunchWindow(instance);
      const cleanOutput = activationOutput.trim() || "AutoClash opened.";
      await editInteraction(control.token, interaction, `${instance.label}: ${cleanOutput}\n\`${exePath}\``);
      return;
    }

    if (action === "closeexe") {
      if (instanceId === "global") {
        const targetInstances = activeOrAllInstances(control);
        const message = await runForInstances(targetInstances, "Close active AutoClash exe(s):", async (item) => {
          const result = await closeAutoClashExe(item);
          return result.output.trim() || result.exePath;
        });
        await editInteraction(control.token, interaction, message);
        return;
      }
      if (!instance) throw new Error(`Unknown instance: ${instanceId}`);
      const result = await closeAutoClashExe(instance);
      const cleanOutput = result.output.trim() || "AutoClash exe closed.";
      await editInteraction(control.token, interaction, `${instance.label}: ${cleanOutput}\n\`${result.exePath}\``);
      return;
    }

    if (action === "openemulator" || action === "openldplayer") {
      if (!instance) throw new Error(`Unknown instance: ${instanceId}`);
      const output = action === "openldplayer" ? await openLdPlayer(control, instance) : await openEmulator(control, instance);
      await editInteraction(control.token, interaction, `${instance.label}: Emulator open command sent.\n${output.trim()}`);
      return;
    }

    if (action === "closeemulator" || action === "closeldplayer") {
      if (instanceId === "global") {
        const targetInstances = activeOrAllInstances(control);
        const message = await runForInstances(targetInstances, "Close emulator(s):", (item) => closeEmulator(control, item));
        await editInteraction(control.token, interaction, message);
        return;
      }
      if (!instance) throw new Error(`Unknown instance: ${instanceId}`);
      const output = action === "closeldplayer" ? await closeLdPlayer(control, instance) : await closeEmulator(control, instance);
      await editInteraction(control.token, interaction, `${instance.label}: Emulator close command sent.\n${output.trim()}`);
      return;
    }

    if (action === "stats") {
      if (!instance) throw new Error(`Unknown instance: ${instanceId}`);
      console.log(`[control] stats requested for ${instance.label}`);
      const file = await captureStats(control, instance);
      console.log(`[control] stats captured for ${instance.label}: ${file}`);
      await editInteraction(control.token, interaction, `${instance.label} stats captured.`);
      await followupFile(control.token, interaction, `**${instance.label} stats**`, file, { deleteAfterSend: true });
      console.log(`[control] stats sent for ${instance.label}`);
      return;
    }

    if (action === "sessionstats") {
      if (!instance) throw new Error(`Unknown instance: ${instanceId}`);
      await editInteractionEmbed(control.token, interaction, sessionStatsEmbed(instance));
      return;
    }

    if (action === "dailystats") {
      if (!instance) throw new Error(`Unknown instance: ${instanceId}`);
      await editInteractionEmbed(control.token, interaction, dailyStatsEmbed(instance));
      return;
    }

    if (action === "screen") {
      if (!instance) throw new Error(`Unknown instance: ${instanceId}`);
      const file = await captureAdbScreen(control, instance);
      await editInteraction(control.token, interaction, `${instance.label} screen captured.`);
      await followupFile(control.token, interaction, `**${instance.label} screen**`, file, { deleteAfterSend: true });
      return;
    }

    if (action === "fullscreen") {
      const file = await captureFullScreen();
      await editInteraction(control.token, interaction, "Full screen captured.");
      await followupFile(control.token, interaction, "**Full screen**", file, { deleteAfterSend: true });
      return;
    }

    await editInteraction(control.token, interaction, `Unknown action: ${action}`);
  } catch (error) {
    const details = [error.message, error.stderr, error.stdout]
      .filter(Boolean)
      .join("\n")
      .trim()
      .slice(0, 1800);
    await editInteraction(control.token, interaction, `Error running \`${action}\`:\n\`\`\`text\n${details}\n\`\`\``);
  }
}

async function handleLogLinesInteraction(control, interaction) {
  const id = interaction.data?.custom_id || "";
  if (!id.startsWith("loglines:")) return false;

  const [, key] = id.split(":");
  const log = restartLogsByKey.get(key);
  if (!log) {
    await respondInteraction(control.token, interaction, "This log is no longer active.");
    return true;
  }

  await control.send(log.channelId, `**${log.name} last 10 lines**\n\`\`\`text\n${recentLogLinesText(log, 10)}\n\`\`\``);
  await respondInteraction(control.token, interaction, `Sent last 10 lines for ${log.name}.`);
  return true;
}

function uploadCommandPayload() {
  return {
    name: "autoclash-upload", type: 1,
    description: "Save an attached file to a selected AutoClash folder (up to 25 MB).",
    default_member_permissions: "8",
    options: [
      { name: "instance", type: 3, description: "Choose the AutoClash instance", required: true, autocomplete: true, max_length: 100 },
      { name: "file", type: 11, description: "Image or file to save", required: true },
      { name: "folder", type: 3, description: "Subfolder, e.g. profiles/account. Omit to use the AutoClash folder", autocomplete: true, max_length: 500 },
      { name: "filename", type: 3, description: "Optional new filename, including extension", max_length: 200 },
      { name: "replace", type: 5, description: "Replace an existing file and save a backup first (default: false)" },
    ],
  };
}

async function registerUploadCommand(control, applicationId) {
  const channel = await discordRequest(control.token, `/channels/${control.channelId}`);
  if (!channel.guild_id) throw new Error("The control panel channel must belong to a Discord server.");
  control.uploadGuildId = channel.guild_id;
  const command = await discordRequest(control.token, `/applications/${applicationId}/guilds/${channel.guild_id}/commands`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(uploadCommandPayload()),
  });
  control.uploadCommandId = command.id;
  await discordRequest(control.token, `/applications/${applicationId}/guilds/${channel.guild_id}/commands`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "autoclash-config", description: "Edit configuration options for an AutoClash profile", type: 1, default_member_permissions: "8" }),
  });
  console.log("[config] /autoclash-config ready. Profile editor available to administrators.");
  if (androidApkMonitor?.config.enabled) {
    await discordRequest(control.token, `/applications/${applicationId}/guilds/${channel.guild_id}/commands`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "acbot-android", description: "View ACBot Android APK status and observed activity", type: 1, default_member_permissions: "8" }),
    });
    console.log("[android] /acbot-android ready. APK panels include Status, Recent Logs and Screenshot.");
  }
  console.log(`[upload] /autoclash-upload ready. Choose instance and file; folder, filename and replace are optional. Limit: 25 MB. Administrators only.`);
}

function uploadAuthorized(control, interaction) {
  if (!control.uploadGuildId || interaction.guild_id !== control.uploadGuildId) return false;
  try { return (BigInt(interaction.member?.permissions || "0") & 8n) !== 0n; }
  catch { return false; }
}

async function handleUploadInteraction(control, interaction) {
  if (![2, 4].includes(interaction.type) || interaction.data?.name !== "autoclash-upload") return false;
  const options = interaction.data.options || [];
  const value = name => options.find(option => option.name === name)?.value;
  const authorized = uploadAuthorized(control, interaction);
  if (interaction.type === 4) {
    let choices = [];
    if (authorized) {
      const focused = options.find(option => option.focused);
      const search = String(focused?.value || "").toLowerCase();
      if (focused?.name === "instance") {
        choices = control.instances.filter(instance => `${instance.label} ${instance.id}`.toLowerCase().includes(search))
          .slice(0, 25).map(instance => ({ name: `${instance.label} (${instance.id})`.slice(0, 100), value: instance.id }));
      } else if (focused?.name === "folder") {
        const instance = control.instances.find(item => item.id === value("instance"));
        try { choices = folderChoices(instance ? autoClashRootDir(instance) : "", search); }
        catch { choices = []; }
      }
    }
    await discordRequest(control.token, `/interactions/${interaction.id}/${interaction.token}/callback`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: 8, data: { choices } }),
    });
    return true;
  }
  if (!authorized) {
    await respondInteraction(control.token, interaction, "File uploads are available only to administrators in the configured Discord server.");
    return true;
  }
  if (autoClashUpdateRecoveryRunning) {
    await respondInteraction(control.token, interaction, "AutoClash updater recovery is in progress. Upload the file after it finishes.");
    return true;
  }
  await deferInteraction(control.token, interaction);
  try {
    const instance = control.instances.find(item => item.id === value("instance"));
    if (!instance) throw new Error("Choose an AutoClash instance from the instance list.");
    const attachment = interaction.data.resolved?.attachments?.[value("file")];
    if (!attachment) throw new Error("Attach a file using the file option.");
    const saved = await saveAttachment({
      rootDir: autoClashRootDir(instance), folder: value("folder") || "", attachment,
      filename: value("filename"), replace: value("replace") === true,
    });
    const backup = saved.backup ? `\nPrevious file backed up to: ${saved.backup}` : "";
    await editInteraction(control.token, interaction,
      `Saved to ${instance.label}: ${saved.relative}\nSize: ${saved.size.toLocaleString("en-US")} bytes${backup}`);
    console.log(`[upload] ${instance.label}: saved ${saved.relative} (${saved.size} bytes).`);
  } catch (error) {
    await editInteraction(control.token, interaction, `File was not saved: ${error.message}`);
  }
  return true;
}

async function handleGatewayInteraction(control, interaction) {
  if (androidApkMonitor && await androidApkMonitor.handle(control, interaction)) return;
  if (await profileEditor.handle(control, interaction)) return;
  if (await handleUploadInteraction(control, interaction)) return;
  if (await handleLogLinesInteraction(control, interaction)) return;
  await handleControlInteraction(control, interaction);
}

async function startControlGateway(control) {
  if (control.gatewayConnection) return;
  let panelSent = false;
  control.gatewayConnection = createControlGateway({
    token: control.token, request: discordRequest, WebSocketClient,
    onInteraction: interaction => handleGatewayInteraction(control, interaction),
    onReady: async data => {
      registerUploadCommand(control, data.application?.id || data.user.id)
        .catch(error => console.error('[upload] Could not register commands: ' + error.message));
      if (control.sendPanelOnStart && !panelSent) {
        await sendDiscordPayload(control.token, control.channelId, controlPanelPayload(control));
        panelSent = true;
        console.log('AutoClash control panel sent to channel ' + control.channelId + '.');
      }
    },
  });
  control.gatewayConnection.start();
}

async function main() {
  loadEnv();
  console.log("Bot main started.");

  const token = requiredEnv("DISCORD_TOKEN");
  const fallbackChannelId = requiredEnv("DISCORD_CHANNEL_ID");
  const androidSettings = androidApkConfigFromEnv(process.env);
  const logs = String(process.env.LOG_FILES || "").trim() ? parseLogFiles(process.env.LOG_FILES) : [];
  if (!logs.length && !(androidSettings.enabled && androidSettings.instances.length)) throw new Error("Configure a Windows log or an Android APK instance before starting the bot.");
  const state = loadState();
  const control = autoControlConfig(token, fallbackChannelId);

  for (const log of logs) {
    log.channelId = optionalChannelId(envKeyForLog(log.name, "CHANNEL_ID")) || fallbackChannelId;
    log.channelBaseName =
      process.env[envKeyForLog(log.name, "CHANNEL_NAME")] || defaultChannelName(log.name);
    applySavedState(log, state);
    restartLogsByKey.set(restartKeyForLog(log), log);
  }

  const config = {
    checkIntervalSeconds: Number(process.env.CHECK_INTERVAL_SECONDS || 5),
    stalledAfterSeconds: Number(process.env.STALLED_AFTER_SECONDS || 120),
    maxLinesPerCheck: Number(process.env.MAX_LINES_PER_CHECK || 20),
    maxStoredLines: Number(process.env.MAX_STORED_LINES || 40),
    liveLogEnabled: parseBooleanEnv("LIVE_LOG_ENABLED", false),
    liveLogIntervalSeconds: Math.max(10, Number(process.env.LIVE_LOG_INTERVAL_SECONDS || 10)),
    liveLogMaxThreadMessages: Number.isFinite(Number(process.env.LIVE_LOG_MAX_THREAD_MESSAGES))
      ? Math.max(100, Number(process.env.LIVE_LOG_MAX_THREAD_MESSAGES))
      : 10000,
    visualCheckEnabled: parseBooleanEnv("COC_VISUAL_CHECK_ENABLED", true),
    visualCheckIntervalSeconds: Number.isFinite(Number(process.env.COC_VISUAL_CHECK_INTERVAL_SECONDS))
      ? Math.max(15, Number(process.env.COC_VISUAL_CHECK_INTERVAL_SECONDS))
      : 30,
    adbRecoveryStopDelaySeconds: Number.isFinite(Number(process.env.ADB_RECOVERY_STOP_DELAY_SECONDS))
      ? Math.max(0, Number(process.env.ADB_RECOVERY_STOP_DELAY_SECONDS))
      : 8,
    adbRecoveryStartDelaySeconds: Number.isFinite(Number(process.env.ADB_RECOVERY_START_DELAY_SECONDS))
      ? Math.max(0, Number(process.env.ADB_RECOVERY_START_DELAY_SECONDS))
      : 5,
    autoRestartMode: ["off", "auto"].includes(String(process.env.AUTO_RESTART_MODE || "").toLowerCase())
      ? String(process.env.AUTO_RESTART_MODE).toLowerCase()
      : "off",
    control,
    state,
    send: async (channelId, message, allowedMentions) => {
      const sent = await sendDiscordMessage(token, channelId, message, allowedMentions);
      const source = logs.find((log) => String(log.channelId) === String(channelId))?.name || "AutoClash";
      recordMobileNotification(source, message);
      return sent;
    },
    sendFile: (channelId, content, filePath, options) => sendDiscordFile(token, channelId, content, filePath, options),
    createThread: (channelId, name) => createDiscordThread(token, channelId, name),
    sendPayload: (channelId, payload) => sendDiscordPayload(token, channelId, payload),
    editPayload: (channelId, messageId, payload) => editDiscordPayload(token, channelId, messageId, payload),
    deleteMessage: (channelId, messageId) => deleteDiscordMessage(token, channelId, messageId),
    pinMessage: (channelId, messageId) => pinDiscordMessage(token, channelId, messageId),
    deleteChannel: (channelId) => deleteDiscordChannel(token, channelId),
    renameChannel: (channelId, name) => renameDiscordChannel(token, channelId, name),
  };

  if (control.enabled && control.sendPanelOnStart) {
    try {
      await sendDiscordPayload(control.token, control.channelId, controlPanelPayload(control));
      console.log(`AutoClash control panel sent to channel ${control.channelId}.`);
    } catch (error) {
      console.error("[control]", `Could not send control panel: ${error.message}`);
    }
  }

  const gatewayControl = { ...control, sendPanelOnStart: false };
  androidApkMonitor = createAndroidApkMonitor({
    env: process.env,
    request: discordRequest,
    guildId: () => gatewayControl.uploadGuildId,
    sendPayload: config.sendPayload,
    createThread: config.createThread,
    editPayload: config.editPayload,
    sendAlert: (channelId, message) => config.send(channelId, message, { parse: [] }),
  });
  androidApkMonitor.start().then(() => {
    if (androidApkMonitor.config.enabled) console.log(`[android] Monitoring ${androidApkMonitor.config.instances.length} APK instance(s). No automatic restarts.`);
  }).catch(error => console.error("[android] Could not start monitoring:", error.message));
  gatewayControl.send = (channelId, message, allowedMentions) => sendDiscordMessage(token, channelId, message, allowedMentions);
  startControlGateway(gatewayControl).catch((error) => console.error("[control]", error.message));

  logs.forEach(initializeLog);

  cleanupScreenshots();
  setInterval(() => cleanupScreenshots(), 30 * 60 * 1000);

  for (const log of logs) {
    try {
      await updateChannelName(log, config);
      await upsertStatusEmbed(log, config);
    } catch (error) {
      console.error(`[${log.name}] Startup Discord update failed: ${error.message}`);
    }
  }

  console.log("Bot connected. Watching:");
  logs.forEach((log) => console.log(`- ${log.name}: ${log.path} -> channel ${log.channelId}`));

  let checkingLogs = false;
  async function checkAllLogs() {
    if (checkingLogs) return;
    checkingLogs = true;
    try {
    if (await handleAutoClashUpdateFailure(config).catch(error => {
      console.error(`[update-recovery] ${error.message}`);
      return false;
    })) return;
    for (const log of logs) {
      try {
        await checkLog(log, config);
      } catch (error) {
        console.error(`[${log.name}]`, error.message);
      }
    }
    } finally {
      checkingLogs = false;
    }
  }

  setInterval(checkAllLogs, config.checkIntervalSeconds * 1000);

  (async () => {
    if (!await handleAutoClashUpdateFailure(config)) await runAutoStartSequence(logs, config);
  })().catch((error) => {
    console.error("[autostart]", error.message);
  });

  if (config.liveLogEnabled) {
    console.log(`Live log thread mode enabled. Interval=${config.liveLogIntervalSeconds}s. Max thread messages=${config.liveLogMaxThreadMessages}.`);
    setInterval(async () => {
      for (const log of logs) {
        try {
          await flushLiveLog(log, config);
        } catch (error) {
          console.error(`[${log.name}] live log`, error.message);
        }
      }
    }, config.liveLogIntervalSeconds * 1000);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
