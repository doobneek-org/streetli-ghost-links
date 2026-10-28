import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createFixtureServer } from '../apps/agent/fixture-server.mjs';
import { gmailRaw, oneStatus, teamTicketText } from '../apps/agent/one-actions.mjs';

const config = {
  discordMessage: { connectionKey: 'live::discord::default::abc', actionId: 'conn_mod_def::discord', method: 'POST', path: '/channels/{channelId}/messages' },
  gmailSend: { connectionKey: 'live::gmail::default::abc', actionId: 'conn_mod_def::gmail', method: 'POST', path: '/gmail/v1/users/{userId}/messages/send' },
  sheetsAppend: { connectionKey: 'live::google-sheets::default::abc', actionId: 'conn_mod_def::sheets', method: 'POST', path: '/v4/spreadsheets/{spreadsheetId}/values/{range}:append' }
};
const env = { ONE_SECRET: 'sk_test_secret_value', DISCORD_CHANNEL_ID: '1564842098740695100', GHOST_LINKS_SHEET_ID: 'sheet123' };

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
    assert.deepEqual(status, { configured: false, discord: false, gmail: false, sheets: false });
  });
  await withServer({ loadConfig: async () => config, fetchImpl, env }, async base => {
    assert.equal((await fetch(`${base}/api/one/email-list`, { method: 'POST', body: '{"to":"not-an-email"}' })).status, 400);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal((await fetch(`${base}/api/one/email-list`, { method: 'POST', body: '{"to":"me@example.org"}' })).status, 409);
  });
});

test('message builders stay bounded and plain', () => {
  const item = { organization: { name: 'Pantry', locality: 'Brooklyn' }, identifier: { kind: 'phone', value: '+12125550123' }, internal: { state: 'flagged', reasonCode: 'phone_disconnected' } };
  const text = teamTicketText({ item, note: 'x'.repeat(5000) });
  assert.ok(text.length <= 1900); assert.match(text, /not a confirmed error/);
  const raw = Buffer.from(gmailRaw({ to: 'me@example.org', subject: 'Hi', text: 'Body' }), 'base64url').toString();
  assert.match(raw, /^To: me@example.org/); assert.match(raw, /Content-Type: text\/plain/);
  assert.equal(oneStatus(config, env).sheets, true);
});
