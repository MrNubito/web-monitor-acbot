const fs = require('node:fs/promises');
const path = require('node:path');
const {logSeverity} = require('../web/log-severity.js');
const {redact} = require('./agent/android-apk-monitor');

const maxFiles = 20;
const maxBytes = 512 * 1024;
const maxPerSeverity = 150;
const dayMs = 24 * 60 * 60 * 1000;

function fileIssues(text, file, modified, partial) {
  const parts = /^log-(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})/i.exec(file);
  let date = parts && !partial ? new Date(+parts[1], +parts[2] - 1, +parts[3]) : null;
  let previous = parts ? +parts[4] * 3600 + +parts[5] * 60 : undefined;
  const result = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const clock = /^(\d{2}):(\d{2}):(\d{2})\s*\|\s*/.exec(line);
    let time = null;
    if (date && clock) {
      const seconds = +clock[1] * 3600 + +clock[2] * 60 + +clock[3];
      if (previous - seconds > 12 * 3600) date.setDate(date.getDate() + 1);
      previous = seconds;
      const timestamp = new Date(date);
      timestamp.setHours(+clock[1], +clock[2], +clock[3], 0);
      time = timestamp.toISOString();
    }
    const message = line.slice(clock?.[0].length || 0).trim().replace(/\x1b\[[0-9;]*m/g, '');
    const severity = logSeverity(message);
    if (severity !== 'info') result.push({severity, text: redact(message).slice(0, 1000), time, clock: clock?.[0].slice(0, 8) || null, sortAt: time ? Date.parse(time) : modified, file});
  }
  return result;
}

function latestIssues(rows) {
  const seen = {warning: 0, error: 0};
  const issues = [];
  for (const row of rows) {
    seen[row.severity]++;
    if (seen[row.severity] <= maxPerSeverity) {
      const {sortAt, ...issue} = row;
      issues.push(issue);
    }
  }
  return {issues, limited: seen.warning > maxPerSeverity || seen.error > maxPerSeverity};
}

function consoleIssues(logs) {
  const rows = [];
  for (const line of [...logs].reverse()) {
    const severity = logSeverity(line.text, line.type);
    if (severity !== 'info') rows.push({severity, text: line.text.slice(0, 1000), time: line.time, file: null});
  }
  return {...latestIssues(rows), console: true, available: true};
}

function createLogIssueReader(listFiles) {
  const cache = new Map();
  async function readFile(file) {
    const previous = cache.get(file.path);
    if (previous && previous.modified === file.modified && previous.size === file.size) return previous.entries;
    const handle = await fs.open(file.path, 'r');
    let entries;
    try {
      const start = Math.max(0, file.size - maxBytes);
      const buffer = Buffer.alloc(file.size - start);
      const {bytesRead} = await handle.read(buffer, 0, buffer.length, start);
      let text = buffer.toString('utf8', 0, bytesRead);
      if (start) {
        const boundary = text.indexOf('\n');
        text = boundary < 0 ? '' : text.slice(boundary + 1);
      }
      const rows = fileIssues(text, path.basename(file.path), file.modified, start > 0);
      const counts = {warning: 0, error: 0};
      entries = rows.reverse().filter(row => ++counts[row.severity] <= maxPerSeverity + 1);
    } finally { await handle.close(); }
    cache.delete(file.path);
    if (cache.size >= 24) cache.delete(cache.keys().next().value);
    cache.set(file.path, {modified: file.modified, size: file.size, entries});
    return entries;
  }

  return async function readIssues(logPath, now = Date.now()) {
    const cutoff = now - 7 * dayMs;
    const files = [];
    for (const file of listFiles(logPath)) {
      try {
        const stat = await fs.stat(file);
        if (stat.isFile()) files.push({path: file, size: stat.size, modified: stat.mtimeMs});
      } catch { /* Logs may rotate between listing and reading. */ }
    }
    const recent = files.filter(file => file.modified >= cutoff).sort((a, b) => b.modified - a.modified);
    const rows = [];
    let limited = recent.length > maxFiles, unreadable = 0;
    for (const file of recent.slice(0, maxFiles)) {
      if (file.size > maxBytes) limited = true;
      try { rows.push(...await readFile(file)); }
      catch { unreadable++; }
    }
    const result = latestIssues(rows.filter(row => row.sortAt >= cutoff).sort((a, b) => b.sortAt - a.sortAt));
    return {...result, limited: result.limited || limited, unreadable, available: files.length > 0, windowDays: 7};
  };
}

module.exports = {createLogIssueReader, consoleIssues};
