import {acbotLogTemplates} from './acbot-log-templates.js';

const tagPrefix = /^(\[[^\]\r\n]+\])\s*/;
const templateField = /\{[^{}]+\}/g;
const escapeRegExp = text => text.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&');
const normalize = text => text.replace(/\uFE0F/g, '');
const acbotRulesByTag = new Map();

for (const [severity, templates] of Object.entries(acbotLogTemplates)) {
  for (const template of templates) {
    const normalized = normalize(template);
    const tag = tagPrefix.exec(normalized);
    const key = tag?.[1].toLowerCase() || '';
    const body = normalized.slice(tag?.[0].length || 0);
    const expression = body.split(templateField).map(escapeRegExp).join('.*?');
    const suffix = body.endsWith(':') ? '.*' : '';
    if (!acbotRulesByTag.has(key)) acbotRulesByTag.set(key, []);
    acbotRulesByTag.get(key).push({severity, pattern: new RegExp('^' + expression + suffix + '$', 'i')});
  }
}

function monitorConsoleSeverity(message, type) {
  if (/^\s*\[(?:[\w -]+ )?(?:error|fatal)\]|^\s*(?:(?:[\w]+)?Error|Exception|Fatal)\s*:/i.test(message)) return 'error';
  if (/\b(?:timed? out|timeout|uncaught exception|unhandled rejection|failed|cannot|could not|unable to|connection (?:lost|refused)|device (?:offline|unauthorized))\b/i.test(message)) return 'error';
  if (/\bbot stopped\. code=[1-9]\d*\b|^missing [A-Z_]+ in the \.env/i.test(message)) return 'error';
  if (type === 'error' || type === 'stderr') return 'error';
  if (type === 'warn' || type === 'warning' || /\b(?:not found|not available|retrying|triggering recovery)\b|^\s*(?:\[warn(?:ing)?\]|warning:)/i.test(message)) return 'warning';
  return 'info';
}

export function logSeverity(text, type = '') {
  const message = normalize(String(text).replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/^\s*(?:\d{2}:\d{2}:\d{2}\s*\||\[[\d: .APMapm]+\])/, '').trim());
  const tag = tagPrefix.exec(message);
  const rules = acbotRulesByTag.get(tag?.[1].toLowerCase() || '');
  const body = message.slice(tag?.[0].length || 0);
  const match = rules?.find(({pattern}) => pattern.test(body));
  return match?.severity ?? (type ? monitorConsoleSeverity(message, type) : 'info');
}
