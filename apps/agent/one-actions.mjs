// One integration: real actions in connected apps through One's passthrough API.
// Connection keys and action ids are resolved once by scripts/one-setup.mjs (One CLI:
// list -> find) and saved to ignored data/one-actions.json. The ONE_SECRET key stays on
// the server. Every action here runs only after a deliberate click in the UI, and the
// message content is built on the server from case/result data, not from browser text.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const CONFIG = fileURLToPath(new URL('../../data/one-actions.json', import.meta.url));
const BASE = 'https://api.withone.ai/v1/passthrough';
export const ONE_ACTIONS = ['discordMessage', 'gmailSend', 'sheetsAppend', 'twilioSms'];

// A Secret Manager file mount can supply connection metadata without baking it into an image.
export const oneConfigPath = (env = process.env) => env.ONE_ACTIONS_FILE || CONFIG;

export async function loadOneConfig(path = oneConfigPath()) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return {}; }
}

export function oneStatus(config, env = process.env) {
  const ready = name => Boolean(env.ONE_SECRET && config?.[name]?.actionId && config[name].connectionKey && config[name].path);
  return {
    configured: Boolean(env.ONE_SECRET),
    discord: ready('discordMessage') && Boolean(env.DISCORD_CHANNEL_ID),
    gmail: ready('gmailSend'),
    sheets: ready('sheetsAppend') && Boolean(env.GHOST_LINKS_SHEET_ID),
    sms: ready('twilioSms') && Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_FROM)
  };
}

// Runs one resolved action. pathVariables fill {placeholders} (or {{placeholders}}) in the action's path.
// `form` sends an application/x-www-form-urlencoded body (Twilio) instead of JSON.
export async function runOneAction(config, name, { pathVariables = {}, query = {}, body, form } = {}, { env = process.env, fetchImpl = fetch } = {}) {
  const action = config?.[name];
  if (!env.ONE_SECRET || !action?.actionId || !action.connectionKey || !action.path) throw Object.assign(new Error('one_not_configured'), { status: 503 });
  const path = action.path.replace(/\{\{?(\w+)\}?\}/g, (_, key) => {
    if (pathVariables[key] === undefined) throw Object.assign(new Error(`missing_path_variable:${key}`), { status: 500 });
    return encodeURIComponent(String(pathVariables[key]));
  });
  const url = new URL(BASE + path);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
  const response = await fetchImpl(url, {
    method: action.method || 'POST',
    headers: { 'x-one-secret': env.ONE_SECRET, 'x-one-connection-key': action.connectionKey, 'x-one-action-id': action.actionId,
      ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: form ? new URLSearchParams(form).toString() : body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000)
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  // Platform errors pass through unchanged; never log or return the secret.
  if (!response.ok) throw Object.assign(new Error(`one_action_failed:${response.status}`), { status: 502, platformStatus: response.status });
  return data;
}

// ---- Message builders (server-side; inputs are bounded case/result data) ----
const clip = (value, max) => String(value ?? '').replace(/[\u0000-\u0008\u000b-\u001f]/g, ' ').slice(0, max);

export function teamTicketText({ item, finding, note, by }) {
  const lines = [
    `👻 Ghost Links review ticket${by ? ` from ${clip(by, 40)}` : ''}`,
    `Provider: ${clip(item.organization.name, 120)} (${clip(item.organization.locality || 'locality unknown', 80)})`,
    `Old ${item.identifier.kind}: ${clip(item.identifier.value, 200)}`,
    `Streetli: ${item.internal.state} · ${clip(item.internal.reasonCode, 60)}`
  ];
  if (finding) {
    lines.push(`Discovery: ${clip(finding.verdict, 40)}${finding.checkedAt ? ` (checked ${clip(finding.checkedAt, 25)})` : ''}`);
    for (const evidence of (finding.evidence || []).slice(0, 2)) lines.push(`> "${clip(evidence.quote, 200)}" ${clip(evidence.url, 200)}`);
  }
  if (note) lines.push(`Note: ${clip(note, 300)}`);
  lines.push('Review needed. No report has been sent; a finding is a lead, not a confirmed error.');
  return lines.join('\n').slice(0, 1900);
}

export function serviceListEmail({ services, area, event }) {
  const rows = services.slice(0, 10).map((service, index) => [
    `${index + 1}. ${clip(service.name, 120)}${typeof service.distanceMiles === 'number' ? ` (≈${service.distanceMiles} mi)` : ''}`,
    service.address ? `   ${clip(service.address, 160)}` : '',
    service.phone ? `   ${clip(service.phone, 40)}` : '',
    `   Status: ${clip(String(service.status || 'no_notice_found').replace(/_/g, ' '), 60)}`
  ].filter(Boolean).join('\n'));
  return {
    subject: clip(`Services near ${area || 'you'}${event ? ` after the ${event}` : ''} (Ghost Links)`, 150),
    text: [`Here are the services Ghost Links found${area ? ` near ${clip(area, 80)}` : ''}, closest first:`, '', ...rows, '',
      'Call ahead to confirm hours and availability. "No closure notice found" is not proof a service is open.',
      'In an emergency call 911. For crisis support call or text 988. For city services call 311.'].join('\n')
  };
}

// One SMS (Twilio caps Body at 1,600 characters): top services, shortest form.
export function serviceListSms({ services, area }) {
  const head = `Ghost Links: services${area ? ` near ${clip(area, 60)}` : ''}, closest first.`;
  const tail = 'Call ahead to confirm. Emergency 911, crisis 988, city 311.';
  const lines = [];
  for (const [index, service] of services.slice(0, 5).entries()) {
    const line = [`${index + 1}. ${clip(service.name, 80)}`, service.address && clip(service.address, 100), service.phone && clip(service.phone, 30)].filter(Boolean).join(', ');
    if ([head, ...lines, line, tail].join('\n').length > 1600) break;
    lines.push(line);
  }
  return [head, ...lines, tail].join('\n');
}

export function ghostReportEmail({ decisions = {}, findings = {}, mode }) {
  const values = Object.values(decisions);
  const count = decision => values.filter(action => action.decision === decision).length;
  const haunting = Object.values(findings).filter(finding => finding.verdict === 'stale_reference').length;
  return {
    subject: `Ghost Links report: ${count('resolved')} busted, ${haunting} still haunting`,
    text: [`Ghost Links report (${mode} data)`, '',
      `Busted (resolved by reviewers): ${count('resolved')}`, `False alarms: ${count('not_an_issue')}`, `Keep watching: ${count('follow_up')}`,
      `Links still shown online (discovery): ${haunting}`, '',
      'Counts are reviewer decisions recorded in Ghost Links, not verified external corrections.'].join('\n')
  };
}

// RFC 822 message, base64url-encoded, as Gmail's send endpoint expects in body.raw.
export function gmailRaw({ to, subject, text }) {
  const header = [`To: ${to}`, `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64'];
  return Buffer.from(`${header.join('\r\n')}\r\n\r\n${Buffer.from(text).toString('base64')}`).toString('base64url');
}

export const validEmail = value => typeof value === 'string' && value.length <= 254 && /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[A-Za-z]{2,}$/.test(value);

// US numbers may omit +1; anything else must already be E.164. Returns '' when invalid.
export function normalizePhone(value) {
  if (typeof value !== 'string' || value.length > 32) return '';
  const digits = value.replace(/[\s().-]/g, '');
  if (/^\d{10}$/.test(digits)) return `+1${digits}`;
  if (/^1\d{10}$/.test(digits)) return `+${digits}`;
  return /^\+[1-9]\d{7,14}$/.test(digits) ? digits : '';
}

export function eventRows(result, now = new Date().toISOString()) {
  const event = result.event || {};
  const services = (result.services || []).slice(0, 25);
  const disrupted = services.filter(service => ['reported_closed', 'reported_relocated', 'reported_changed_hours'].includes(service.status));
  const eventRow = [now, clip(event.event_type || 'service search', 60), clip(event.area, 80), services.length, disrupted.length, clip(result.text, 200)];
  const actionRows = services.map(service => [now, clip(event.area, 80), clip(service.name, 120), clip(service.address, 160),
    clip(service.status, 40), disrupted.includes(service) ? `Confirm status and update listings: ${clip(service.quote, 150)}` : 'Call to confirm open hours', clip(service.url || service.listedOn, 300), 'open']);
  return { eventRow, actionRows };
}
