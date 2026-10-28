import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createFixtureServer } from '../apps/agent/fixture-server.mjs';
import { gmailRaw, normalizePhone, oneStatus, runOneAction, serviceListSms, teamTicketText } from '../apps/agent/one-actions.mjs';

const config = {
  discordMessage: { connectionKey: 'live::discord::default::abc', actionId: 'conn_mod_def::discord', method: 'POST', path: '/channels/{channelId}/messages' },
  gmailSend: { connectionKey: 'live::gmail::default::abc', actionId: 'conn_mod_def::gmail', method: 'POST', path: '/gmail/v1/users/{userId}/messages/send' },
  sheetsAppend: { connectionKey: 'live::google-sheets::default::abc', actionId: 'conn_mod_def::sheets', method: 'POST', path: '/v4/spreadsheets/{spreadsheetId}/values/{range}:append' },
  twilioSms: { connectionKey: 'live::twilio::default::abc', actionId: 'conn_mod_def::twilio', method: 'POST', path: '/2010-04-01/Accounts/{{TWILIO_ACCOUNT_SID}}/Messages.json' }
};
const env = { ONE_SECRET: 'sk_test_secret_value', DISCORD_CHANNEL_ID: '1564842098740695100', GHOST_LINKS_SHEET_ID: 'sheet123', TWILIO_ACCOUNT_SID: 'AC123', TWILIO_FROM: '+15005550006' };

async function withServer(one, run) {
  const server = await createFixtureServer({ one });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try { await run(`http://127.0.0.1:${server.address().port}`); } finally { await new Promise(resolve => server.close(resolve)); }
}

test('team ticket posts to Discord through One with the three passthrough headers', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => { calls.push({ url: String(url), options }); return new Response('{"id":"msg1"}', { status: 200 }); };
  await withServer({ loadConfig: async () => config, fetchImpl, env }, async base => {
    const response = await fetch(`${base}/api/one/team-ticket`, { method: 'POST', body: JSON.stringify({ caseId: 'demo-website-001', by: 'Van Helsing' }) });
    const text = await response.text();
    assert.equal(response.status, 200); assert.doesNotMatch(text, /sk_test_secret_value/);
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.withone.ai/v1/passthrough/channels/1564842098740695100/messages');
  assert.equal(calls[0].options.headers['x-one-secret'], 'sk_test_secret_value');
  assert.equal(calls[0].options.headers['x-one-action-id'], 'conn_mod_def::discord');
  assert.match(JSON.parse(calls[0].options.body).content, /Example Harbor Pantry/);
});

test('One actions refuse when unconfigured, on bad input, or before a service search', async () => {
  const fetchImpl = async () => { throw new Error('must not be called'); };
  await withServer({ loadConfig: async () => ({}), fetchImpl, env: {} }, async base => {
    assert.equal((await fetch(`${base}/api/one/team-ticket`, { method: 'POST', body: '{"caseId":"demo-website-001"}' })).status, 503);
    const status = await (await fetch(`${base}/api/one/status`)).json();
    assert.deepEqual(status, { configured: false, discord: false, gmail: false, sheets: false, sms: false });
  });
  await withServer({ loadConfig: async () => config, fetchImpl, env }, async base => {
    assert.equal((await fetch(`${base}/api/one/email-list`, { method: 'POST', body: '{"to":"not-an-email"}' })).status, 400);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal((await fetch(`${base}/api/one/email-list`, { method: 'POST', body: '{"to":"me@example.org"}' })).status, 409);
    assert.equal((await fetch(`${base}/api/one/text-list`, { method: 'POST', body: '{"to":"call me"}' })).status, 400);
    assert.equal((await fetch(`${base}/api/one/text-list`, { method: 'POST', body: '{"to":"212-555-0123"}' })).status, 409);
  });
});

test('message builders stay bounded and plain', () => {
  const item = { organization: { name: 'Pantry', locality: 'Brooklyn' }, identifier: { kind: 'phone', value: '+12125550123' }, internal: { state: 'flagged', reasonCode: 'phone_disconnected' } };
  const text = teamTicketText({ item, note: 'x'.repeat(5000) });
  assert.ok(text.length <= 1900); assert.match(text, /not a confirmed error/);
  const raw = Buffer.from(gmailRaw({ to: 'me@example.org', subject: 'Hi', text: 'Body' }), 'base64url').toString();
  assert.match(raw, /^To: me@example.org/); assert.match(raw, /Content-Type: text\/plain/);
  assert.equal(oneStatus(config, env).sheets, true);
  assert.equal(oneStatus(config, env).sms, true);
  assert.equal(oneStatus(config, { ...env, TWILIO_FROM: '' }).sms, false);
});

test('text list normalizes the number and stays within one Twilio message', () => {
  assert.equal(normalizePhone('(212) 555-0123'), '+12125550123');
  assert.equal(normalizePhone('1 212 555 0123'), '+12125550123');
  assert.equal(normalizePhone('+44 20 7946 0958'), '+442079460958');
  assert.equal(normalizePhone('555-0123'), ''); assert.equal(normalizePhone('call me'), '');
  const services = Array.from({ length: 12 }, (_, index) => ({ name: `Pantry ${index} ${'x'.repeat(400)}`, address: 'a'.repeat(400), phone: '+12125550123' }));
  const sms = serviceListSms({ services, area: 'Harlem' });
  assert.ok(sms.length <= 1600); assert.match(sms, /^Ghost Links: services near Harlem/); assert.match(sms, /911/);
});

test('Twilio action fills {{double-brace}} paths and sends a form body', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => { calls.push({ url: String(url), options }); return new Response('{"sid":"SM1"}', { status: 201 }); };
  await runOneAction(config, 'twilioSms', { pathVariables: { TWILIO_ACCOUNT_SID: 'AC123' }, form: { To: '+12125550123', From: '+15005550006', Body: 'Hi & bye' } }, { env, fetchImpl });
  assert.equal(calls[0].url, 'https://api.withone.ai/v1/passthrough/2010-04-01/Accounts/AC123/Messages.json');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(new URLSearchParams(calls[0].options.body).get('Body'), 'Hi & bye');
});

test('progress report uses One\'s field-based Gmail Send Email action', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => { calls.push({ url: String(url), options }); return new Response('{"email":{"messageId":"m1"}}', { status: 200 }); };
  const oneGmail = { ...config, gmailSend: { connectionKey: 'live::gmail::default::abc', actionId: 'conn_mod_def::gmail2', method: 'POST', path: '/v1/gmail/send-email' } };
  await withServer({ loadConfig: async () => oneGmail, fetchImpl, env }, async base => {
    assert.equal((await fetch(`${base}/api/one/ghost-report`, { method: 'POST', body: '{"to":"me@example.org"}' })).status, 200);
  });
  assert.equal(calls[0].url, 'https://api.withone.ai/v1/passthrough/v1/gmail/send-email');
  const sent = JSON.parse(calls[0].options.body);
  assert.equal(sent.to, 'me@example.org'); assert.equal(sent.connectionKey, 'live::gmail::default::abc');
  assert.match(sent.subject, /Ghost Links report/); assert.equal(sent.raw, undefined);
});

test('demo mode returns saved results labeled as saved, and misses cleanly', async () => {
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const cacheFile = pathToFileURL(join(await mkdtemp(join(tmpdir(), 'gl-cache-')), 'route-cache.json'));
  const python = async payload => payload.stage === 'route-request' ? { output: { route: 'find_services', reason: 'test' } } : { kind: 'find', stopped: null, services: [{ name: 'Pantry', status: 'no_notice_found', checks: [] }], news: [] };
  // The route gate asks whether a real interpreter exists on disk, so without this stub the
  // test needs a provisioned apps/agent/.venv and fails on a clean checkout. Python itself is
  // already stubbed above, so nothing here depends on a local install.
  const server = await createFixtureServer({ python, one: { cacheFile }, discovery: { available: () => true, busy: false } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/api/route/cached`, { method: 'POST', body: '{"request":"food pantry in Harlem"}' })).status, 404);
    await (await fetch(`${base}/api/route`, { method: 'POST', body: '{"request":"Food pantry in   Harlem"}' })).text();
    const saved = await (await fetch(`${base}/api/route/cached`, { method: 'POST', body: '{"request":"food pantry in harlem"}' })).json();
    assert.equal(saved.cached, true); assert.ok(saved.savedAt); assert.equal(saved.services[0].name, 'Pantry');
  } finally { await new Promise(resolve => server.close(resolve)); }
});
