const { app, BrowserWindow, Menu, dialog, ipcMain } = require("../../runtime-host");
const { spawn } = require("child_process");
const { createAndroidAutostart } = require("../android-autostart");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");

const sourceRootDir = path.resolve(__dirname, "..");
const sourceEnvPath = path.join(sourceRootDir, ".env");
const sourceBotPath = path.join(sourceRootDir, "bot.js");
const sourceControlScriptPath = path.join(sourceRootDir, "control-autoclash-window.ps1");
const sourceCaptureScriptPath = path.join(sourceRootDir, "capture-autoclash-window.ps1");
const sourceFullScreenScriptPath = path.join(sourceRootDir, "capture-fullscreen.ps1");
const sourceCloseLdPlayerScriptPath = path.join(sourceRootDir, "close-ldplayer-instance.ps1");
const sourceCocConnectionLostScriptPath = path.join(sourceRootDir, "detect-coc-connection-lost.ps1");
const sourceActivateAutoClashLaunchScriptPath = path.join(sourceRootDir, "activate-autoclash-launch.ps1");
const sourceCloseAutoClashExeScriptPath = path.join(sourceRootDir, "close-autoclash-exe.ps1");
const sourceHandleAutoClashUpdateScriptPath = path.join(sourceRootDir, "handle-autoclash-update.ps1");
const windowIconPath = path.join(__dirname, "assets", "icon.ico");

let mainWindow = null;
let botProcess = null;
let mobileServer = null;
const mobileLogTimeCache = new Map();

function mobileNotificationsPath() {
  return path.join(runtimeDir(), "mobile-notifications.json");
}

function fallbackLogPath() {
  return path.join(app.getPath("userData"), "startup-error.log");
}

function writeStartupError(error) {
  try {
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    fs.appendFileSync(
      fallbackLogPath(),
      `[${new Date().toISOString()}]\n${error.stack || error.message || String(error)}\n\n`,
      "utf8"
    );
  } catch {
    // Last-resort crash logging should never cause another crash.
  }
}

function showStartupError(error) {
  writeStartupError(error);
  dialog.showErrorBox(
    "Discord Log Monitor failed to start",
    `${error.stack || error.message || String(error)}\n\nError log:\n${fallbackLogPath()}`
  );
}

function runtimeDir() {
  return app.getPath("userData");
}

function runtimeEnvPath() {
  return path.join(runtimeDir(), ".env");
}

function runtimeBotPath() {
  return path.join(runtimeDir(), "bot.js");
}

function runtimeControlScriptPath() {
  return path.join(runtimeDir(), "control-autoclash-window.ps1");
}

function runtimeCaptureScriptPath() {
  return path.join(runtimeDir(), "capture-autoclash-window.ps1");
}

function runtimeFullScreenScriptPath() {
  return path.join(runtimeDir(), "capture-fullscreen.ps1");
}

function runtimeCloseLdPlayerScriptPath() {
  return path.join(runtimeDir(), "close-ldplayer-instance.ps1");
}

function runtimeCocConnectionLostScriptPath() {
  return path.join(runtimeDir(), "detect-coc-connection-lost.ps1");
}

function runtimeActivateAutoClashLaunchScriptPath() {
  return path.join(runtimeDir(), "activate-autoclash-launch.ps1");
}

function runtimeCloseAutoClashExeScriptPath() {
  return path.join(runtimeDir(), "close-autoclash-exe.ps1");
}

function runtimeHandleAutoClashUpdateScriptPath() {
  return path.join(runtimeDir(), "handle-autoclash-update.ps1");
}

function ensureRuntimeFiles() {
  fs.mkdirSync(runtimeDir(), { recursive: true });

  if (!fs.existsSync(runtimeEnvPath()) && fs.existsSync(sourceEnvPath)) {
    fs.copyFileSync(sourceEnvPath, runtimeEnvPath());
  }

  if (!fs.existsSync(sourceBotPath)) {
    throw new Error(`bot.js was not found at ${sourceBotPath}`);
  }

  fs.copyFileSync(sourceBotPath, runtimeBotPath());
  fs.copyFileSync(path.join(sourceRootDir, "autoclash-upload.js"), path.join(runtimeDir(), "autoclash-upload.js"));
  fs.copyFileSync(path.join(sourceRootDir, "profile-config.js"), path.join(runtimeDir(), "profile-config.js"));
  fs.copyFileSync(path.join(sourceRootDir, "profile-slot-options.json"), path.join(runtimeDir(), "profile-slot-options.json"));
  fs.copyFileSync(path.join(sourceRootDir, "android-apk-monitor.js"), path.join(runtimeDir(), "android-apk-monitor.js"));
  fs.copyFileSync(path.join(sourceRootDir, "control-gateway.js"), path.join(runtimeDir(), "control-gateway.js"));
  for (const name of ["autoclash-process.ps1", "detect-autoclash-process.ps1", "inspect-autoclash-updaters.ps1", "close-autoclash-recovery.ps1"]) {
    fs.copyFileSync(path.join(sourceRootDir, name), path.join(runtimeDir(), name));
  }

  if (fs.existsSync(sourceControlScriptPath)) {
    fs.copyFileSync(sourceControlScriptPath, runtimeControlScriptPath());
  }

  if (fs.existsSync(sourceCaptureScriptPath)) {
    fs.copyFileSync(sourceCaptureScriptPath, runtimeCaptureScriptPath());
  }

  if (fs.existsSync(sourceFullScreenScriptPath)) {
    fs.copyFileSync(sourceFullScreenScriptPath, runtimeFullScreenScriptPath());
  }

  if (fs.existsSync(sourceCloseLdPlayerScriptPath)) {
    fs.copyFileSync(sourceCloseLdPlayerScriptPath, runtimeCloseLdPlayerScriptPath());
  }

  if (fs.existsSync(sourceCocConnectionLostScriptPath)) {
    fs.copyFileSync(sourceCocConnectionLostScriptPath, runtimeCocConnectionLostScriptPath());
  }

  if (fs.existsSync(sourceActivateAutoClashLaunchScriptPath)) {
    fs.copyFileSync(sourceActivateAutoClashLaunchScriptPath, runtimeActivateAutoClashLaunchScriptPath());
  }

  if (fs.existsSync(sourceCloseAutoClashExeScriptPath)) {
    fs.copyFileSync(sourceCloseAutoClashExeScriptPath, runtimeCloseAutoClashExeScriptPath());
  }

  if (fs.existsSync(sourceHandleAutoClashUpdateScriptPath)) {
    fs.copyFileSync(sourceHandleAutoClashUpdateScriptPath, runtimeHandleAutoClashUpdateScriptPath());
  }

}

function createWindow() {
  app.setAppUserModelId("local.discord-log-monitor");
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1294,
    height: 1027,
    minWidth: 1120,
    minHeight: 760,
    center: true,
    title: "Discord Log Monitor",
    icon: windowIconPath,
    frame: false,
    backgroundColor: "#0f1217",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));
}

function parseEnvFile() {
  ensureRuntimeFiles();
  const envPath = runtimeEnvPath();
  if (!fs.existsSync(envPath)) return {};

  const values = {};
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) continue;

    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed.slice(equalsIndex + 1).trim().replace(/^"|"$/g, "");
    values[key] = value;
  }

  return values;
}

function envKeyForLog(logName, suffix) {
  return `${String(logName).toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_${suffix}`;
}

function defaultChannelName(logName) {
  return String(logName).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "log";
}

function parseLogFiles(logFiles, env) {
  const result = [];
  for (const item of String(logFiles || "").split(";")) {
    const trimmed = item.trim();
    if (!trimmed) continue;

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) continue;

    const name = trimmed.slice(0, equalsIndex).trim();
    const logPath = trimmed.slice(equalsIndex + 1).trim();
    const keyBase = envKeyForLog(name, "");
    const channelIdKey = `${keyBase}CHANNEL_ID`;
    const channelNameKey = `${keyBase}CHANNEL_NAME`;

    result.push({
      name,
      path: logPath,
      channelId: env[channelIdKey] || "",
      channelName: env[channelNameKey] || defaultChannelName(name),
    });
  }
  return result;
}

function configFromEnv() {
  const env = parseEnvFile();
  const logs = parseLogFiles(env.LOG_FILES, env);

  return {
    discordToken: env.DISCORD_TOKEN || "",
    fallbackChannelId: env.DISCORD_CHANNEL_ID || "",
    logs:
      logs.length > 0
        ? logs
        : [
            { name: "LD9", path: "", channelId: env.LD9_CHANNEL_ID || "", channelName: "ld9" },
            { name: "BlueStacks", path: "", channelId: env.BLUESTACKS_CHANNEL_ID || "", channelName: "bluestacks" },
          ],
    checkIntervalSeconds: env.CHECK_INTERVAL_SECONDS || "5",
    stalledAfterSeconds: env.STALLED_AFTER_SECONDS || "180",
    maxLinesPerCheck: env.MAX_LINES_PER_CHECK || "10",
    maxStoredLines: env.MAX_STORED_LINES || "20",
    liveLogEnabled: env.LIVE_LOG_ENABLED || "false",
    liveLogIntervalSeconds: env.LIVE_LOG_INTERVAL_SECONDS || "10",
    liveLogMaxThreadMessages: env.LIVE_LOG_MAX_THREAD_MESSAGES || "10000",
    cocVisualCheckEnabled: env.COC_VISUAL_CHECK_ENABLED || "true",
    cocVisualCheckIntervalSeconds: env.COC_VISUAL_CHECK_INTERVAL_SECONDS || "30",
    adbRecoveryStopDelaySeconds: env.ADB_RECOVERY_STOP_DELAY_SECONDS || "8",
    adbRecoveryStartDelaySeconds: env.ADB_RECOVERY_START_DELAY_SECONDS || "5",
    screenshotRetentionHours: env.SCREENSHOT_RETENTION_HOURS || "24",
    screenshotMaxSizeMb: env.SCREENSHOT_MAX_SIZE_MB || "1500",
    autoRestartMode: env.AUTO_RESTART_MODE || "off",
    autoStartBot: env.APP_AUTOSTART_BOT || "false",
    autoStartMaxAttempts: env.APP_AUTOSTART_MAX_ATTEMPTS || "2",
    autoStartLogWaitSeconds: env.APP_AUTOSTART_LOG_WAIT_SECONDS || "90",
    autoControlEnabled: env.AUTOCONTROL_ENABLED || "false",
    autoControlChannelId: env.AUTOCONTROL_CHANNEL_ID || env.DISCORD_CHANNEL_ID || "",
    autoControlSendPanelOnStart: env.AUTOCONTROL_SEND_PANEL_ON_START || "true",
    autoControlAutoUpdateEnabled: env.AUTOCONTROL_AUTO_UPDATE_ENABLED || "false",
    autoControlAdbPath:
      env.AUTOCONTROL_ADB_PATH || "C:\\Users\\PC\\Desktop\\AUTOCOCBOT\\AutoClash\\adb\\adb.exe",
    autoControlStatsCrop: env.AUTOCONTROL_STATS_CROP || "227,31,781,590",
    autoControlInstances:
      env.AUTOCONTROL_INSTANCES ||
      "main|AutoClash|C:\\Users\\PC\\Desktop\\AUTOCOCBOT\\AutoClash\\AutoClash-1.5.3.exe|127.0.0.1:5556|pro|false;ld9|LD9|C:\\Users\\PC\\Desktop\\AUTOCOCBOT\\AutoClash - LD9\\AutoClash-1.5.3.exe|127.0.0.1:5555|pro|false",
    mobileControlEnabled: env.MOBILE_CONTROL_ENABLED || "true",
    mobileControlHost: env.MOBILE_CONTROL_HOST || "0.0.0.0",
    mobileControlPort: env.MOBILE_CONTROL_PORT || "17891",
    androidApkEnabled: env.ANDROID_APK_ENABLED || "false",
    androidApkAlertsEnabled: env.ANDROID_APK_ALERTS_ENABLED || "true",
    androidApkCheckSeconds: env.ANDROID_APK_CHECK_SECONDS || "15",
    androidApkIdleMinutes: env.ANDROID_APK_IDLE_MINUTES || "10",
    androidApkInstances: env.ANDROID_APK_INSTANCES || "[]",
    botRunning: Boolean(botProcess),
  };
}

function envFromConfig(config) {
  const logs = Array.isArray(config.logs) ? config.logs : [];
  const env = {
    DISCORD_TOKEN: config.discordToken || "",
    DISCORD_CHANNEL_ID: config.fallbackChannelId || "",
    LOG_FILES: logs
      .filter((log) => String(log.name || "").trim() && String(log.path || "").trim())
      .map((log) => `${String(log.name).trim()}=${String(log.path).trim()}`)
      .join(";"),
    CHECK_INTERVAL_SECONDS: String(config.checkIntervalSeconds || "5"),
    STALLED_AFTER_SECONDS: String(config.stalledAfterSeconds || "180"),
    MAX_LINES_PER_CHECK: String(config.maxLinesPerCheck || "10"),
    MAX_STORED_LINES: String(config.maxStoredLines || "20"),
    LIVE_LOG_ENABLED: String(config.liveLogEnabled || "false"),
    LIVE_LOG_INTERVAL_SECONDS: String(config.liveLogIntervalSeconds || "10"),
    LIVE_LOG_MAX_THREAD_MESSAGES: String(config.liveLogMaxThreadMessages || "10000"),
    COC_VISUAL_CHECK_ENABLED: String(config.cocVisualCheckEnabled || "true"),
    COC_VISUAL_CHECK_INTERVAL_SECONDS: String(config.cocVisualCheckIntervalSeconds || "30"),
    ADB_RECOVERY_STOP_DELAY_SECONDS: String(config.adbRecoveryStopDelaySeconds || "8"),
    ADB_RECOVERY_START_DELAY_SECONDS: String(config.adbRecoveryStartDelaySeconds || "5"),
    SCREENSHOT_RETENTION_HOURS: String(config.screenshotRetentionHours || "24"),
    SCREENSHOT_MAX_SIZE_MB: String(config.screenshotMaxSizeMb || "1500"),
    AUTO_RESTART_MODE: String(config.autoRestartMode || "off"),
    APP_AUTOSTART_BOT: String(config.autoStartBot || "false"),
    APP_AUTOSTART_MAX_ATTEMPTS: String(config.autoStartMaxAttempts || "2"),
    APP_AUTOSTART_LOG_WAIT_SECONDS: String(config.autoStartLogWaitSeconds || "90"),
    AUTOCONTROL_ENABLED: String(config.autoControlEnabled || "false"),
    AUTOCONTROL_CHANNEL_ID: String(config.autoControlChannelId || ""),
    AUTOCONTROL_SEND_PANEL_ON_START: String(config.autoControlSendPanelOnStart || "true"),
    AUTOCONTROL_AUTO_UPDATE_ENABLED: String(config.autoControlAutoUpdateEnabled || "false"),
    AUTOCONTROL_ADB_PATH: String(config.autoControlAdbPath || ""),
    AUTOCONTROL_STATS_CROP: String(config.autoControlStatsCrop || "227,31,781,590"),
    AUTOCONTROL_INSTANCES: String(config.autoControlInstances || ""),
    MOBILE_CONTROL_ENABLED: String(config.mobileControlEnabled || "true"),
    MOBILE_CONTROL_HOST: String(config.mobileControlHost || "0.0.0.0"),
    MOBILE_CONTROL_PORT: String(config.mobileControlPort || "17891"),
    ANDROID_APK_ENABLED: String(config.androidApkEnabled || "false"),
    ANDROID_APK_ALERTS_ENABLED: String(config.androidApkAlertsEnabled || "true"),
    ANDROID_APK_CHECK_SECONDS: String(config.androidApkCheckSeconds || "15"),
    ANDROID_APK_IDLE_MINUTES: String(config.androidApkIdleMinutes || "10"),
    ANDROID_APK_INSTANCES: String(config.androidApkInstances || "[]"),
  };

  for (const log of logs) {
    const name = String(log.name || "").trim();
    if (!name) continue;

    env[envKeyForLog(name, "CHANNEL_ID")] = String(log.channelId || "").trim();
    env[envKeyForLog(name, "CHANNEL_NAME")] = String(log.channelName || defaultChannelName(name)).trim();
  }

  return env;
}

function writeEnv(config) {
  ensureRuntimeFiles();
  const env = envFromConfig(config);
  require(path.join(sourceRootDir, "android-apk-monitor.js")).configFromEnv(env);
  const content = [
    "# Discord bot token.",
    `DISCORD_TOKEN=${env.DISCORD_TOKEN}`,
    "",
    "# Fallback channel.",
    `DISCORD_CHANNEL_ID=${env.DISCORD_CHANNEL_ID}`,
    "",
    "# Configured logs.",
    `LOG_FILES=${env.LOG_FILES}`,
    "",
    "# Channel ID and base channel name per log.",
    ...Object.keys(env)
      .filter((key) => key.endsWith("_CHANNEL_ID") || key.endsWith("_CHANNEL_NAME"))
      .sort()
      .map((key) => `${key}=${env[key]}`),
    "",
    "# Options.",
    `CHECK_INTERVAL_SECONDS=${env.CHECK_INTERVAL_SECONDS}`,
    `STALLED_AFTER_SECONDS=${env.STALLED_AFTER_SECONDS}`,
    `MAX_LINES_PER_CHECK=${env.MAX_LINES_PER_CHECK}`,
    `MAX_STORED_LINES=${env.MAX_STORED_LINES}`,
    `LIVE_LOG_ENABLED=${env.LIVE_LOG_ENABLED}`,
    `LIVE_LOG_INTERVAL_SECONDS=${env.LIVE_LOG_INTERVAL_SECONDS}`,
    `LIVE_LOG_MAX_THREAD_MESSAGES=${env.LIVE_LOG_MAX_THREAD_MESSAGES}`,
    `COC_VISUAL_CHECK_ENABLED=${env.COC_VISUAL_CHECK_ENABLED}`,
    `COC_VISUAL_CHECK_INTERVAL_SECONDS=${env.COC_VISUAL_CHECK_INTERVAL_SECONDS}`,
    `ADB_RECOVERY_STOP_DELAY_SECONDS=${env.ADB_RECOVERY_STOP_DELAY_SECONDS}`,
    `ADB_RECOVERY_START_DELAY_SECONDS=${env.ADB_RECOVERY_START_DELAY_SECONDS}`,
    `SCREENSHOT_RETENTION_HOURS=${env.SCREENSHOT_RETENTION_HOURS}`,
    `SCREENSHOT_MAX_SIZE_MB=${env.SCREENSHOT_MAX_SIZE_MB}`,
    `AUTO_RESTART_MODE=${env.AUTO_RESTART_MODE}`,
    `APP_AUTOSTART_BOT=${env.APP_AUTOSTART_BOT}`,
    `APP_AUTOSTART_MAX_ATTEMPTS=${env.APP_AUTOSTART_MAX_ATTEMPTS}`,
    `APP_AUTOSTART_LOG_WAIT_SECONDS=${env.APP_AUTOSTART_LOG_WAIT_SECONDS}`,
    "",
    "# AutoClash Discord control panel.",
    `AUTOCONTROL_ENABLED=${env.AUTOCONTROL_ENABLED}`,
    `AUTOCONTROL_CHANNEL_ID=${env.AUTOCONTROL_CHANNEL_ID}`,
    `AUTOCONTROL_SEND_PANEL_ON_START=${env.AUTOCONTROL_SEND_PANEL_ON_START}`,
    `AUTOCONTROL_AUTO_UPDATE_ENABLED=${env.AUTOCONTROL_AUTO_UPDATE_ENABLED}`,
    `AUTOCONTROL_ADB_PATH=${env.AUTOCONTROL_ADB_PATH}`,
    `AUTOCONTROL_STATS_CROP=${env.AUTOCONTROL_STATS_CROP}`,
    `AUTOCONTROL_INSTANCES=${env.AUTOCONTROL_INSTANCES}`,
    "",
    "# Mobile control server for the APK/web panel.",
    `MOBILE_CONTROL_ENABLED=${env.MOBILE_CONTROL_ENABLED}`,
    `MOBILE_CONTROL_HOST=${env.MOBILE_CONTROL_HOST}`,
    `MOBILE_CONTROL_PORT=${env.MOBILE_CONTROL_PORT}`,
    "",
    "# ACBot Android APK monitoring (read-only; no automatic restarts).",
    `ANDROID_APK_ENABLED=${env.ANDROID_APK_ENABLED}`,
    `ANDROID_APK_ALERTS_ENABLED=${env.ANDROID_APK_ALERTS_ENABLED}`,
    `ANDROID_APK_CHECK_SECONDS=${env.ANDROID_APK_CHECK_SECONDS}`,
    `ANDROID_APK_IDLE_MINUTES=${env.ANDROID_APK_IDLE_MINUTES}`,
    `ANDROID_APK_INSTANCES=${env.ANDROID_APK_INSTANCES}`,
    "",
  ].join("\n");

  fs.writeFileSync(runtimeEnvPath(), content, "utf8");
}

function sendLog(type, text) {
  require("../../runtime-host").recordLog(type, text);
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("bot-log", {
    type,
    text: String(text).trimEnd(),
    time: new Date().toLocaleTimeString(),
  });
}

function bundledNodePath() {
  return process.execPath;
}

function bundledNodePathEnv() {
  const modulePaths = [
    path.join(sourceRootDir, "node_modules"),
    process.env.NODE_PATH || "",
  ].filter(Boolean);

  return {
    ELECTRON_RUN_AS_NODE: "1",
    NODE_PATH: modulePaths.join(path.delimiter),
  };
}

function startBot(options = {}) {
  if (botProcess) return { running: true };
  ensureRuntimeFiles();
  const config = configFromEnv();
  const shouldRunAutoStartSequence =
    options.autoStartSequence || String(config.autoStartBot || "false") === "true";

  const env = {
    ...process.env,
    ...bundledNodePathEnv(),
    ...envFromConfig(config),
    APP_AUTOSTART_SEQUENCE: shouldRunAutoStartSequence ? "true" : "false",
  };

  const child = spawn(bundledNodePath(), [runtimeBotPath()], {
    cwd: runtimeDir(),
    env,
    windowsHide: true,
  });

  botProcess = child;
  child.on("error", (error) => {
    sendLog("stderr", `Failed to start bot: ${error.message}`);
    writeStartupError(error);
    if (botProcess === child) {
      botProcess = null;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("bot-status", { running: false });
    }
  });

  sendLog("info", "Bot started with bundled Node.");

  child.stdout.on("data", (chunk) => sendLog("stdout", chunk.toString()));
  child.stderr.on("data", (chunk) => sendLog("stderr", chunk.toString()));
  child.on("exit", (code, signal) => {
    sendLog("info", `Bot stopped. code=${code ?? "null"} signal=${signal ?? "null"}`);
    if (botProcess === child) {
      botProcess = null;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("bot-status", { running: false });
    }
  });

  return { running: true };
}

function stopBot() {
  if (!botProcess) return { running: false };

  botProcess.kill();
  botProcess = null;
  sendLog("info", "Bot stopped by the user.");
  return { running: false };
}

function stopMobileServer() {
  if (!mobileServer) return Promise.resolve();
  const server = mobileServer;
  mobileServer = null;
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
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

function parseAutoControlInstances(rawValue) {
  const fallback = [];

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

function mobileConfig() {
  const env = parseEnvFile();
  return {
    enabled: parseBooleanValue(env.MOBILE_CONTROL_ENABLED, true),
    host: env.MOBILE_CONTROL_HOST || "0.0.0.0",
    port: Number(env.MOBILE_CONTROL_PORT || 17891),
    adbPath: env.AUTOCONTROL_ADB_PATH || "C:\\Users\\PC\\Desktop\\AUTOCOCBOT\\AutoClash\\adb\\adb.exe",
    instances: parseAutoControlInstances(env.AUTOCONTROL_INSTANCES),
    buttonBottomOffset: Number(env.AUTOCONTROL_BUTTON_BOTTOM_OFFSET || 32),
    exeProcessName: env.AUTOCONTROL_EXE_PROCESS_NAME || "AutoClash-1.5.3",
    exeWindowTitle: env.AUTOCONTROL_EXE_WINDOW_TITLE || "AutoClash Pro",
    ldConsolePath: env.LDPLAYER_CONSOLE_PATH || "C:\\LDPlayer\\LDPlayer9\\ldconsole.exe",
  };
}

function localNetworkUrls(port) {
  const urls = [`http://127.0.0.1:${port}`];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) urls.push(`http://${entry.address}:${port}`);
    }
  }
  return urls;
}

function readMobileNotifications(afterId = "") {
  try {
    const file = mobileNotificationsPath();
    if (!fs.existsSync(file)) return [];
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const items = Array.isArray(parsed) ? parsed : [];
    if (!afterId) return items.slice(-50);
    const index = items.findIndex((item) => String(item.id) === String(afterId));
    return index >= 0 ? items.slice(index + 1) : items.slice(-20);
  } catch {
    return [];
  }
}

function jsonResponse(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function textResponse(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) {
        reject(new Error("Request body is too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function execFileText(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: runtimeDir(),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });
    let stdout = "";
    let stderr = "";
    const timeoutMs = options.timeout || 30000;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${path.basename(command)} timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      error.stderr = stderr;
      error.stdout = stdout;
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
        return;
      }
      const error = new Error(stderr.trim() || stdout.trim() || `${path.basename(command)} exited with code ${code}`);
      error.stderr = stderr;
      error.stdout = stdout;
      reject(error);
    });
  });
}

function processHintsForInstance(config, instance) {
  if (normalizeAutoControlVersion(instance?.version) === "basic") {
    return { processName: "AutoClash Basic", windowTitle: "AutoClash Basic" };
  }
  return { processName: config.exeProcessName, windowTitle: config.exeWindowTitle };
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
        .filter((filePath) => /autoclash|acbot/i.test(path.basename(filePath)) && !/(adb|unins|uninstall|setup|installer|update|crash|helper|elevate)/i.test(path.basename(filePath)))
        .map((filePath) => ({ filePath, mtimeMs: fs.statSync(filePath).mtimeMs }))
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
      return candidates[0]?.filePath || "";
    }
  }

  const parentDir = path.dirname(configuredPath);
  if (parentDir && parentDir !== configuredPath && fs.existsSync(parentDir)) {
    const candidates = fs.readdirSync(parentDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.exe$/i.test(entry.name))
      .map((entry) => path.join(parentDir, entry.name))
      .filter((filePath) => /autoclash|acbot/i.test(path.basename(filePath)) && !/(adb|unins|uninstall|setup|installer|update|crash|helper|elevate)/i.test(path.basename(filePath)))
      .map((filePath) => ({ filePath, mtimeMs: fs.statSync(filePath).mtimeMs }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    return candidates[0]?.filePath || configuredPath;
  }

  return configuredPath;
}

function resolveAutoClashRootPath(instance) {
  const configuredPath = String(instance?.exePath || "").trim();
  if (!configuredPath) return "";
  if (fs.existsSync(configuredPath) && fs.statSync(configuredPath).isDirectory()) return configuredPath;
  const exePath = resolveAutoClashExePath(instance);
  return exePath ? path.dirname(exePath) : configuredPath;
}

function mobileProfilesDir(instance) {
  const root = resolveAutoClashRootPath(instance);
  if (!root) throw new Error(`No AutoClash folder found for ${instance?.label || "selected window"}`);
  const profilesDir = path.join(root, "profiles");
  if (!fs.existsSync(profilesDir) || !fs.statSync(profilesDir).isDirectory()) {
    throw new Error(`Profiles folder was not found: ${profilesDir}`);
  }
  return profilesDir;
}

function safeProfileName(value) {
  const name = String(value || "").trim();
  if (!name || name === "__global__") return "__global__";
  if (!/^[a-zA-Z0-9._ -]+$/.test(name) || name.includes("..") || name.includes("/") || name.includes("\\")) {
    throw new Error("Invalid profile name");
  }
  return name;
}

function mobileProfileConfigPath(instance, profileName) {
  const profilesDir = mobileProfilesDir(instance);
  const safeName = safeProfileName(profileName);
  const target = safeName === "__global__"
    ? path.join(profilesDir, "config.json")
    : path.join(profilesDir, safeName, "config.json");
  const resolvedProfiles = path.resolve(profilesDir).toLowerCase();
  const resolvedTarget = path.resolve(target).toLowerCase();
  if (resolvedTarget !== resolvedProfiles && !resolvedTarget.startsWith(resolvedProfiles + path.sep.toLowerCase())) {
    throw new Error("Profile path is outside profiles folder");
  }
  return { profileName: safeName, filePath: target };
}

function listMobileProfiles(instance) {
  const profilesDir = mobileProfilesDir(instance);
  const globalConfig = path.join(profilesDir, "config.json");
  const profiles = [{
    id: "__global__",
    name: "Global",
    type: "global",
    configPath: globalConfig,
    available: fs.existsSync(globalConfig),
  }];
  const orderPath = path.join(profilesDir, "order.txt");
  const orderedNames = fs.existsSync(orderPath)
    ? fs.readFileSync(orderPath, "utf8").split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    : [];
  const found = new Set();
  for (const name of orderedNames) {
    const dir = path.join(profilesDir, name);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
    const configPath = path.join(dir, "config.json");
    profiles.push({ id: name, name, type: "profile", configPath, available: fs.existsSync(configPath) });
    found.add(name.toLowerCase());
  }
  for (const entry of fs.readdirSync(profilesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || found.has(entry.name.toLowerCase())) continue;
    const configPath = path.join(profilesDir, entry.name, "config.json");
    profiles.push({ id: entry.name, name: entry.name, type: "profile", configPath, available: fs.existsSync(configPath) });
  }
  return profiles;
}

function readMobileProfileConfig(instance, profileName) {
  const target = mobileProfileConfigPath(instance, profileName);
  if (!fs.existsSync(target.filePath)) throw new Error(`Config not found: ${target.filePath}`);
  const text = fs.readFileSync(target.filePath, "utf8");
  return {
    profile: target.profileName,
    filePath: target.filePath,
    config: JSON.parse(text),
    text,
  };
}

function writeMobileProfileConfig(instance, profileName, text) {
  const target = mobileProfileConfigPath(instance, profileName);
  const parsed = JSON.parse(String(text || ""));
  fs.mkdirSync(path.dirname(target.filePath), { recursive: true });
  if (fs.existsSync(target.filePath)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.copyFileSync(target.filePath, `${target.filePath}.bak-${stamp}`);
  }
  const formatted = `${JSON.stringify(parsed, null, 2)}\n`;
  fs.writeFileSync(target.filePath, formatted, "utf8");
  return {
    ok: true,
    profile: target.profileName,
    filePath: target.filePath,
    text: formatted,
  };
}

function findMobileInstance(config, id) {
  const normalized = String(id || "").trim().toLowerCase();
  return config.instances.find((instance) => String(instance.id || "").toLowerCase() === normalized) || null;
}

async function getMobileInstanceRuntimeStatus(config, instance) {
  const status = {
    adbConnected: false,
    ldPlayerRunning: false,
  };

  if (!instance?.device || !fs.existsSync(config.adbPath)) return status;

  await execFileText(config.adbPath, ["connect", instance.device], { timeout: 5000 }).catch(() => "");
  try {
    const state = await execFileText(config.adbPath, ["-s", instance.device, "get-state"], { timeout: 5000 });
    status.adbConnected = /\bdevice\b/i.test(state);
    status.ldPlayerRunning = status.adbConnected;
  } catch {
    status.adbConnected = false;
    status.ldPlayerRunning = false;
  }

  return status;
}

async function getMobileInstancesStatus(config) {
  return Promise.all(config.instances.map(async (instance) => {
    const runtimeStatus = await getMobileInstanceRuntimeStatus(config, instance);
    return {
      id: instance.id,
      label: instance.label,
      device: instance.device,
      version: instance.version,
      active: instance.active,
      exePath: resolveAutoClashExePath(instance),
      ...runtimeStatus,
    };
  }));
}

function mobileLogsConfig() {
  const env = parseEnvFile();
  return parseLogFiles(env.LOG_FILES, env).map((log) => ({
    name: log.name,
    path: log.path,
    channelName: log.channelName,
    channelId: log.channelId,
  }));
}

function wildcardToRegExp(pattern) {
  const escaped = String(pattern || "").replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

function listFilesRecursiveLimited(directory, limit = 1500) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  const stack = [directory];
  while (stack.length && files.length < limit) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      if (entry.isFile()) files.push(fullPath);
      if (files.length >= limit) break;
    }
  }
  return files;
}

function newestFile(files) {
  return files
    .map((filePath) => {
      try {
        const stat = fs.statSync(filePath);
        return stat.isFile() ? { filePath, mtimeMs: stat.mtimeMs, size: stat.size } : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0] || null;
}

function resolveMobileLogFile(logPath) {
  const value = String(logPath || "").trim();
  if (!value) return null;

  if (fs.existsSync(value)) {
    const stat = fs.statSync(value);
    if (stat.isFile()) return { filePath: value, mtimeMs: stat.mtimeMs, size: stat.size };
    if (stat.isDirectory()) {
      return newestFile(listFilesRecursiveLimited(value).filter((filePath) => /\.txt$/i.test(filePath)));
    }
  }

  if (/[*?]/.test(value)) {
    const directory = path.dirname(value);
    const filePattern = path.basename(value);
    const matcher = wildcardToRegExp(filePattern);
    if (fs.existsSync(directory)) {
      return newestFile(listFilesRecursiveLimited(directory).filter((filePath) => matcher.test(path.basename(filePath))));
    }
  }

  return null;
}

function tailTextFile(filePath, maxLines = 120, maxBytes = 512 * 1024) {
  const stat = fs.statSync(filePath);
  const start = Math.max(0, stat.size - maxBytes);
  const fd = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    return buffer
      .toString("utf8")
      .replace(/\u0000/g, "")
      .split(/\r?\n/)
      .slice(-maxLines)
      .join("\n")
      .trimEnd();
  } finally {
    fs.closeSync(fd);
  }
}

function formatMobileLogTime(date = new Date()) {
  return [
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0"),
  ].join(":");
}

function timestampMobileLogLines(filePath, maxLines = 10) {
  const rawLines = tailTextFile(filePath, 1000)
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim());
  const stat = fs.statSync(filePath);
  const cacheKey = path.resolve(filePath).toLowerCase();
  const now = formatMobileLogTime();
  let cache = mobileLogTimeCache.get(cacheKey);

  if (!cache || stat.size < cache.size) {
    cache = {
      size: stat.size,
      lines: rawLines.slice(),
      times: rawLines.map(() => now),
    };
  } else {
    let overlap = Math.min(cache.lines.length, rawLines.length);
    while (overlap > 0) {
      const oldStart = cache.lines.length - overlap;
      let matches = true;
      for (let index = 0; index < overlap; index += 1) {
        if (cache.lines[oldStart + index] !== rawLines[index]) {
          matches = false;
          break;
        }
      }
      if (matches) break;
      overlap -= 1;
    }

    if (overlap > 0) {
      const carriedTimes = cache.times.slice(cache.times.length - overlap);
      const newTimes = rawLines.slice(overlap).map(() => now);
      cache.lines = rawLines.slice();
      cache.times = carriedTimes.concat(newTimes);
    } else if (cache.lines.length === rawLines.length && cache.lines.every((line, index) => line === rawLines[index])) {
      cache.lines = rawLines.slice();
    } else {
      cache.lines = rawLines.slice();
      cache.times = rawLines.map(() => now);
    }
    cache.size = stat.size;
  }

  if (cache.lines.length > 1200) {
    cache.lines = cache.lines.slice(-1000);
    cache.times = cache.times.slice(-1000);
  }

  mobileLogTimeCache.set(cacheKey, cache);

  const start = Math.max(0, cache.lines.length - maxLines);
  return cache.lines.slice(start).map((line, index) => {
    if (/^\d{2}:\d{2}:\d{2}\s*\|/.test(line)) return line;
    return `${cache.times[start + index] || now} |${line}`;
  }).join("\n");
}

function mobileLogSummary(log) {
  const file = resolveMobileLogFile(log.path);
  return {
    name: log.name,
    configuredPath: log.path,
    channelName: log.channelName,
    filePath: file?.filePath || "",
    size: file?.size || 0,
    lastModified: file?.mtimeMs ? new Date(file.mtimeMs).toISOString() : "",
    available: Boolean(file),
  };
}

async function executeMobileExeAction(config, action, instance) {
  const hints = processHintsForInstance(config, instance);
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    runtimeControlScriptPath(),
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
    args.push("-ControlButtonBottomOffset", String(config.buttonBottomOffset || 32));
  }
  args.push("-RestoreMinimized");
  return execFileText("powershell", args, { timeout: 30000 });
}

function openMobileAutoClashExe(instance) {
  const exePath = resolveAutoClashExePath(instance);
  if (!exePath || !fs.existsSync(exePath) || !fs.statSync(exePath).isFile()) {
    throw new Error(`No AutoClash exe found for ${instance?.label || "selected window"}`);
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

async function closeMobileAutoClashExe(instance) {
  const exePath = resolveAutoClashExePath(instance);
  if (!exePath || !fs.existsSync(exePath) || !fs.statSync(exePath).isFile()) {
    throw new Error(`No AutoClash exe found for ${instance?.label || "selected window"}`);
  }
  const output = await execFileText("powershell", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    runtimeCloseAutoClashExeScriptPath(),
    "-ExePath",
    exePath,
  ], { timeout: 15000 });
  return { exePath, output };
}

function ldPlayerIndexForInstance(instance) {
  const match = String(instance?.device || "").match(/:(\d+)$/);
  const port = match ? Number(match[1]) : NaN;
  if (!Number.isInteger(port)) return null;
  const index = (port - 5555) / 2;
  return Number.isInteger(index) && index >= 0 ? index : null;
}

async function runLdConsole(config, instance, action) {
  if (!fs.existsSync(config.ldConsolePath)) {
    throw new Error(`LDPlayer console was not found: ${config.ldConsolePath}`);
  }
  const index = ldPlayerIndexForInstance(instance);
  if (index === null) throw new Error(`Could not derive LDPlayer index from ADB device: ${instance?.device || "empty"}`);
  return execFileText(config.ldConsolePath, [action, "--index", String(index)], {
    cwd: path.dirname(config.ldConsolePath),
    timeout: 20000,
  });
}

async function closeMobileLdPlayer(config, instance) {
  if (!instance?.device) throw new Error(`${instance?.label || "AutoClash"} does not have an ADB device configured`);
  await execFileText(config.adbPath, ["connect", instance.device], { timeout: 10000 }).catch(() => "");
  try {
    return await execFileText(config.adbPath, ["-s", instance.device, "emu", "kill"], { timeout: 12000 });
  } catch {
    return runLdConsole(config, instance, "quit");
  }
}

async function captureMobileAdbScreen(config, instance) {
  if (!instance?.device) throw new Error(`${instance?.label || "AutoClash"} does not have an ADB device configured`);
  if (!fs.existsSync(config.adbPath)) throw new Error(`ADB was not found: ${config.adbPath}`);
  await execFileText(config.adbPath, ["connect", instance.device], { timeout: 10000 }).catch(() => "");
  return new Promise((resolve, reject) => {
    const child = spawn(config.adbPath, ["-s", instance.device, "exec-out", "screencap", "-p"], {
      cwd: runtimeDir(),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks = [];
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("ADB screencap timed out after 20s"));
    }, 20000);
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      const buffer = Buffer.concat(chunks);
      if (code === 0 && buffer.length > 0) {
        resolve(buffer);
        return;
      }
      reject(new Error(stderr.trim() || `ADB screencap exited with code ${code}`));
    });
  });
}

async function streamMobileAdbScreen(config, instance, req, res) {
  const boundary = "autoclashframe";
  let closed = false;
  req.on("close", () => {
    closed = true;
  });
  res.writeHead(200, {
    "Content-Type": `multipart/x-mixed-replace; boundary=${boundary}`,
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    "Connection": "close",
    "Pragma": "no-cache",
    "Expires": "0",
  });
  while (!closed && !res.destroyed) {
    try {
      const buffer = await captureMobileAdbScreen(config, instance);
      if (closed || res.destroyed) break;
      res.write(`--${boundary}\r\n`);
      res.write("Content-Type: image/png\r\n");
      res.write(`Content-Length: ${buffer.length}\r\n\r\n`);
      res.write(buffer);
      res.write("\r\n");
    } catch (error) {
      if (!closed && !res.destroyed) {
        res.write(`--${boundary}\r\n`);
        res.write("Content-Type: text/plain\r\n\r\n");
        res.write(String(error.message || error));
        res.write("\r\n");
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 650));
  }
  if (!res.destroyed) res.end();
}

async function streamMobileAdbH264(config, instance, req, res) {
  if (!instance?.device) throw new Error(`${instance?.label || "AutoClash"} does not have an ADB device configured`);
  if (!fs.existsSync(config.adbPath)) throw new Error(`ADB was not found: ${config.adbPath}`);
  await execFileText(config.adbPath, ["connect", instance.device], { timeout: 10000 }).catch(() => "");
  const width = Math.min(1280, Math.max(320, Number(new URL(req.url, `http://${req.headers.host || "localhost"}`).searchParams.get("width") || 720)));
  const height = Math.min(1280, Math.max(320, Number(new URL(req.url, `http://${req.headers.host || "localhost"}`).searchParams.get("height") || 1280)));
  const bitrate = Math.min(8000000, Math.max(500000, Number(new URL(req.url, `http://${req.headers.host || "localhost"}`).searchParams.get("bitrate") || 2500000)));
  const child = spawn(config.adbPath, [
    "-s",
    instance.device,
    "exec-out",
    "screenrecord",
    "--output-format=h264",
    "--size",
    `${width}x${height}`,
    "--bit-rate",
    String(bitrate),
    "-",
  ], {
    cwd: runtimeDir(),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let closed = false;
  req.on("close", () => {
    closed = true;
    child.kill();
  });
  res.writeHead(200, {
    "Content-Type": "video/avc",
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    "Connection": "close",
    "Pragma": "no-cache",
    "Expires": "0",
  });
  child.stdout.on("data", (chunk) => {
    if (!closed && !res.destroyed) res.write(chunk);
  });
  child.stderr.on("data", () => {});
  child.on("error", (error) => {
    if (!closed && !res.destroyed) res.destroy(error);
  });
  child.on("exit", () => {
    if (!res.destroyed) res.end();
  });
}

async function captureMobileFullScreen() {
  const file = path.join(runtimeDir(), `mobile-full-screen-${Date.now()}.png`);
  await execFileText("powershell", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    runtimeFullScreenScriptPath(),
    "-OutputPath",
    file,
  ], { timeout: 30000 });
  const buffer = fs.readFileSync(file);
  fs.unlink(file, () => {});
  return buffer;
}

async function runMobileAction(config, instance, action) {
  if (["start", "pause", "stop", "show", "hide"].includes(action)) {
    return executeMobileExeAction(config, action, instance);
  }
  if (action === "openexe") {
    const exePath = openMobileAutoClashExe(instance);
    const activationOutput = await execFileText("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", runtimeActivateAutoClashLaunchScriptPath(), "-ExePath", exePath], { timeout: 90000 });
    return `AutoClash opened: ${exePath}\n${activationOutput.trim()}`;
  }
  if (action === "closeexe") {
    const result = await closeMobileAutoClashExe(instance);
    return result.output.trim() || `AutoClash closed: ${result.exePath}`;
  }
  if (action === "openldplayer") return runLdConsole(config, instance, "launch");
  if (action === "closeldplayer") return closeMobileLdPlayer(config, instance);
  throw new Error(`Unknown action: ${action}`);
}

function mobileIndexHtml() {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>AutoClash Mobile</title>
<style>
:root{color-scheme:dark;--bg:#101318;--panel:#181d24;--line:#2a323d;--text:#f1f5f9;--muted:#9ba7b6;--accent:#35c27c;--danger:#ee5d5d;--blue:#5ea0ff}
*{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui,Segoe UI,Arial,sans-serif;background:var(--bg);color:var(--text)}
header{position:sticky;top:0;z-index:2;padding:14px 16px;background:#12161dcc;border-bottom:1px solid var(--line);backdrop-filter:blur(12px)}
h1{margin:0;font-size:18px}.sub{margin-top:4px;color:var(--muted);font-size:12px}
main{padding:14px;display:grid;gap:12px}.card{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:12px}
label{display:block;color:var(--muted);font-size:12px;margin-bottom:6px}input,select{width:100%;height:42px;border:1px solid var(--line);border-radius:6px;background:#0e1116;color:var(--text);padding:0 10px;font-size:15px}
.row{display:grid;grid-template-columns:1fr 1fr;gap:8px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
button{height:42px;border:0;border-radius:6px;color:#07110c;background:var(--accent);font-weight:700;font-size:14px}button.secondary{background:#d8e4f2;color:#12161d}button.blue{background:var(--blue);color:#07101f}button.danger{background:var(--danger);color:#210707}
pre{white-space:pre-wrap;margin:0;color:var(--muted);font-size:12px;max-height:130px;overflow:auto}.screen{width:100%;border:1px solid var(--line);border-radius:8px;background:#05070a;min-height:180px;object-fit:contain}
</style>
</head>
<body>
<header><h1>AutoClash Mobile</h1><div class="sub" id="status">Connecting...</div></header>
<main>
  <section class="card">
    <button id="connectBtn">Connect</button>
  </section>
  <section class="card">
    <label>Window</label>
    <select id="instance"></select>
  </section>
  <section class="card grid">
    <button data-action="start">Start</button><button class="secondary" data-action="pause">Pause</button><button class="danger" data-action="stop">Stop</button>
    <button class="blue" data-action="show">Show</button><button class="secondary" data-action="hide">Hide</button><button class="blue" id="screenBtn">Screen</button>
    <button data-action="openexe">Open EXE</button><button class="danger" data-action="closeexe">Close EXE</button><button class="secondary" id="fullBtn">Full</button>
    <button data-action="openldplayer">Open LD</button><button class="danger" data-action="closeldplayer">Close LD</button><button class="secondary" id="refreshBtn">Refresh</button>
  </section>
  <img class="screen" id="screen" alt="screen preview" />
  <section class="card"><pre id="log"></pre></section>
</main>
<script>
const instanceEl=document.getElementById('instance'), logEl=document.getElementById('log'), statusEl=document.getElementById('status'), screenEl=document.getElementById('screen');
function log(t){logEl.textContent='['+new Date().toLocaleTimeString()+'] '+t+'\\n'+logEl.textContent}
async function api(path,options={}){const res=await fetch(path,{...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});if(!res.ok)throw new Error(await res.text());return res}
async function refresh(){try{const data=await (await api('/api/status')).json();statusEl.textContent='Bot '+(data.botRunning?'running':'stopped')+' | '+data.urls.join(' | ');instanceEl.innerHTML=data.instances.map(i=>'<option value="'+i.id+'">'+i.label+' - '+(i.device||'no adb')+'</option>').join('');log('Connected')}catch(e){statusEl.textContent='Not connected';log(e.message)}}
async function action(a){const id=instanceEl.value;if(!id)return log('Choose a window');try{const data=await (await api('/api/instances/'+encodeURIComponent(id)+'/actions',{method:'POST',body:JSON.stringify({action:a})})).json();log(data.output||'Done')}catch(e){log(e.message)}}
document.getElementById('connectBtn').onclick=refresh;
document.getElementById('refreshBtn').onclick=refresh;
document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>action(b.dataset.action));
document.getElementById('screenBtn').onclick=async()=>{const id=instanceEl.value;try{screenEl.src='/api/instances/'+encodeURIComponent(id)+'/screen?t='+Date.now();log('Screen updated')}catch(e){log(e.message)}};
document.getElementById('fullBtn').onclick=()=>{screenEl.src='/api/fullscreen?t='+Date.now();log('Full screen updated')};
refresh();
</script>
</body>
</html>`;
}

async function handleMobileRequest(req, res) {
  const config = mobileConfig();
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (req.method === "OPTIONS") {
    jsonResponse(res, 204, {});
    return;
  }
  if (url.pathname === "/" || url.pathname === "/mobile") {
    textResponse(res, 200, mobileIndexHtml(), "text/html; charset=utf-8");
    return;
  }
  try {
    if (req.method === "GET" && url.pathname === "/api/status") {
      const logs = mobileLogsConfig();
      const instances = await getMobileInstancesStatus(config);
      jsonResponse(res, 200, {
        app: "Discord Log Monitor",
        botRunning: Boolean(botProcess),
        adbConnected: instances.some((instance) => instance.adbConnected),
        ldPlayerRunning: instances.some((instance) => instance.ldPlayerRunning),
        instances,
        logs: logs.map(mobileLogSummary),
        urls: localNetworkUrls(config.port),
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/logs") {
      jsonResponse(res, 200, { logs: mobileLogsConfig().map(mobileLogSummary) });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/notifications") {
      jsonResponse(res, 200, { notifications: readMobileNotifications(url.searchParams.get("after") || "") });
      return;
    }
    const logTailMatch = url.pathname.match(/^\/api\/logs\/([^/]+)\/tail$/);
    if (req.method === "GET" && logTailMatch) {
      const requestedName = decodeURIComponent(logTailMatch[1]).toLowerCase();
      const log = mobileLogsConfig().find((item) => String(item.name || "").toLowerCase() === requestedName);
      if (!log) throw new Error("Unknown log");
      const file = resolveMobileLogFile(log.path);
      if (!file) {
        jsonResponse(res, 200, {
          name: log.name,
          configuredPath: log.path,
          filePath: "",
          available: false,
          lines: "",
        });
        return;
      }
      const maxLines = Math.min(500, Math.max(1, Number(url.searchParams.get("lines") || 100)));
      jsonResponse(res, 200, {
        name: log.name,
        configuredPath: log.path,
        filePath: file.filePath,
        size: file.size,
        lastModified: new Date(file.mtimeMs).toISOString(),
        available: true,
        lines: timestampMobileLogLines(file.filePath, maxLines),
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/bot/start") {
      jsonResponse(res, 200, startBot());
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/bot/stop") {
      jsonResponse(res, 200, stopBot());
      return;
    }
    const actionMatch = url.pathname.match(/^\/api\/instances\/([^/]+)\/actions$/);
    if (req.method === "POST" && actionMatch) {
      const instance = findMobileInstance(config, decodeURIComponent(actionMatch[1]));
      if (!instance) throw new Error("Unknown AutoClash instance");
      const body = await readJsonBody(req);
      const output = await runMobileAction(config, instance, String(body.action || ""));
      jsonResponse(res, 200, { ok: true, output: String(output || "").trim() || "Done" });
      return;
    }
    const profilesMatch = url.pathname.match(/^\/api\/instances\/([^/]+)\/profiles$/);
    if (req.method === "GET" && profilesMatch) {
      const instance = findMobileInstance(config, decodeURIComponent(profilesMatch[1]));
      if (!instance) throw new Error("Unknown AutoClash instance");
      jsonResponse(res, 200, { profiles: listMobileProfiles(instance) });
      return;
    }
    const profileConfigMatch = url.pathname.match(/^\/api\/instances\/([^/]+)\/profiles\/([^/]+)\/config$/);
    if ((req.method === "GET" || req.method === "POST") && profileConfigMatch) {
      const instance = findMobileInstance(config, decodeURIComponent(profileConfigMatch[1]));
      if (!instance) throw new Error("Unknown AutoClash instance");
      const profileName = decodeURIComponent(profileConfigMatch[2]);
      if (req.method === "GET") {
        jsonResponse(res, 200, readMobileProfileConfig(instance, profileName));
        return;
      }
      const body = await readJsonBody(req);
      jsonResponse(res, 200, writeMobileProfileConfig(instance, profileName, String(body.text || "")));
      return;
    }
    const screenMatch = url.pathname.match(/^\/api\/instances\/([^/]+)\/screen$/);
    if (req.method === "GET" && screenMatch) {
      const instance = findMobileInstance(config, decodeURIComponent(screenMatch[1]));
      if (!instance) throw new Error("Unknown AutoClash instance");
      const buffer = await captureMobileAdbScreen(config, instance);
      res.writeHead(200, { "Content-Type": "image/png", "Content-Length": buffer.length, "Cache-Control": "no-store" });
      res.end(buffer);
      return;
    }
    const liveViewMatch = url.pathname.match(/^\/api\/instances\/([^/]+)\/live-view$/);
    if (req.method === "GET" && liveViewMatch) {
      const instance = findMobileInstance(config, decodeURIComponent(liveViewMatch[1]));
      if (!instance) throw new Error("Unknown AutoClash instance");
      await streamMobileAdbScreen(config, instance, req, res);
      return;
    }
    const liveH264Match = url.pathname.match(/^\/api\/instances\/([^/]+)\/live-h264$/);
    if (req.method === "GET" && liveH264Match) {
      const instance = findMobileInstance(config, decodeURIComponent(liveH264Match[1]));
      if (!instance) throw new Error("Unknown AutoClash instance");
      await streamMobileAdbH264(config, instance, req, res);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/fullscreen") {
      const buffer = await captureMobileFullScreen();
      res.writeHead(200, { "Content-Type": "image/png", "Content-Length": buffer.length, "Cache-Control": "no-store" });
      res.end(buffer);
      return;
    }
    jsonResponse(res, 404, { error: "Not found" });
  } catch (error) {
    jsonResponse(res, 500, {
      error: error.message,
      details: [error.stderr, error.stdout].filter(Boolean).join("\n").slice(0, 2000),
    });
  }
}

function startMobileServer() {
  const config = mobileConfig();
  if (!config.enabled || mobileServer) return;

  mobileServer = http.createServer((req, res) => {
    handleMobileRequest(req, res).catch((error) => jsonResponse(res, 500, { error: error.message }));
  });

  mobileServer.on("error", (error) => {
    writeStartupError(error);
    sendLog("stderr", `Mobile control failed: ${error.message}`);
  });
  mobileServer.listen(config.port, config.host, () => {
    sendLog("info", `Mobile control ready: ${localNetworkUrls(config.port).join(" | ")}`);
  });
}

function startBotIfAutoStartEnabled() {
  const config = configFromEnv();
  if (String(config.autoStartBot || "false") !== "true") return;

  setTimeout(() => {
    if (botProcess) return;
    sendLog("info", "AutoStart enabled. Starting bot.");
    startBot({ autoStartSequence: true });
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("bot-status", { running: Boolean(botProcess) });
  }, 700);
}

const androidAutostartJobs = new Map();
let androidAutostartShuttingDown = false;
async function runAndroidAutostart(instance, adbPath) {
  if (androidAutostartShuttingDown) throw Error('Monitor is closing.');
  if (androidAutostartJobs.has(instance.device)) throw Error('Android Autostart is already running for this device.');
  if (!adbPath || !fs.existsSync(adbPath)) throw Error('Select a valid ADB executable in the AutoClash tab.');
  const controller = new AbortController();
  androidAutostartJobs.set(instance.device, controller);
  const progress = (id, message) => {
    sendLog('info', '[Android Autostart] ' + instance.label + ': ' + message);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('android:autostart-progress', { id, message });
  };
  try {
    const runner = createAndroidAutostart({ adbPath, onProgress: progress });
    return await runner.start(instance, { signal: controller.signal });
  } catch (error) { progress(instance.id, error.message); throw error; }
  finally { androidAutostartJobs.delete(instance.device); }
}
function startConfiguredAndroidInstances() {
  const env = parseEnvFile();
  const config = require('../android-apk-monitor').configFromEnv(env);
  // One explicit startup sequence per enabled instance; monitoring alerts never trigger this.
  (async () => {
    for (const instance of config.instances.filter(item => item.autostart)) {
      try { await runAndroidAutostart(instance, config.adbPath); }
      catch (error) { sendLog('stderr', '[Android Autostart] ' + error.message); }
    }
  })().catch(error => sendLog('stderr', '[Android Autostart] ' + error.message));
}
ipcMain.handle('android:autostart', async (_event, settings, id) => {
  const env = envFromConfig(settings);
  const config = require('../android-apk-monitor').configFromEnv(env);
  const instance = config.instances.find(item => item.id === id);
  if (!instance) throw Error('Unknown Android APK instance.');
  return runAndroidAutostart(instance, config.adbPath);
});
ipcMain.handle('android:autostart-cancel', (_event, device) => {
  androidAutostartJobs.get(device)?.abort(); return { ok:true };
});

ipcMain.handle("android:devices", async () => {
  const adbPath = configFromEnv().autoControlAdbPath;
  if (!adbPath || !fs.existsSync(adbPath)) throw new Error("Select an ADB executable in the AutoClash tab first.");
  const output = await execFileText(adbPath, ["devices", "-l"], { timeout: 10000 });
  return output.split(/\r?\n/).map(line => line.match(/^(\S+)\s+device\b/)).filter(Boolean).map(match => match[1]);
});

ipcMain.handle("config:load", () => configFromEnv());

ipcMain.handle("config:save", async (_event, config) => {
  const wasRunning = Boolean(botProcess);
  writeEnv(config);
  await stopMobileServer();
  startMobileServer();
  if (wasRunning) {
    stopBot();
    startBot();
  }
  return configFromEnv();
});

ipcMain.handle("dialog:pick-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
  });

  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("dialog:pick-exe", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [
      { name: "Executable files", extensions: ["exe"] },
      { name: "All files", extensions: ["*"] },
    ],
  });

  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("dialog:pick-autoclash-path", async () => {
  const choice = await dialog.showMessageBox(mainWindow, {
    type: "question",
    buttons: ["Choose folder", "Choose exe", "Cancel"],
    defaultId: 0,
    cancelId: 2,
    title: "AutoClash path",
    message: "Choose the AutoClash folder or the exact .exe.",
    detail: "Folder is recommended because AutoClash updates can change the exe name.",
  });

  if (choice.response === 2) return null;

  if (choice.response === 0) {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [
      { name: "Executable files", extensions: ["exe"] },
      { name: "All files", extensions: ["*"] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("bot:start", () => startBot());
ipcMain.handle("bot:stop", () => stopBot());
ipcMain.handle("bot:status", () => ({ running: Boolean(botProcess) }));
ipcMain.handle("window:minimize", () => mainWindow?.minimize());
ipcMain.handle("window:maximize-toggle", () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});
ipcMain.handle("window:close", () => mainWindow?.close());


module.exports = { ensureRuntimeFiles, configFromEnv, envFromConfig, writeEnv, startBot, stopBot, mobileConfig, handleMobileRequest, getMobileInstancesStatus, mobileLogsConfig, mobileLogSummary, findMobileInstance, resolveAutoClashRootPath, resolveMobileLogFile, timestampMobileLogLines, listMobileProfiles, captureMobileAdbScreen, runMobileAction, runAndroidAutostart, startConfiguredAndroidInstances, stopAll: () => { androidAutostartShuttingDown = true; for (const controller of androidAutostartJobs.values()) controller.abort(); stopBot(); }, botRunning: () => Boolean(botProcess) };
