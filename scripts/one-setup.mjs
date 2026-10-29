// Resolves One connection keys and action ids once, using the One CLI
// (list -> find, as the event guide requires), and saves them to ignored
// data/one-actions.json. Makes no writes to any connected app.
//   npm run one:setup
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { loadLocalEnv } from '../apps/agent/fixture-server.mjs';
import { oneConfigPath } from '../apps/agent/one-actions.mjs';

await loadLocalEnv();
if (!process.env.ONE_SECRET) throw new Error('Set ONE_SECRET (sk_live_...) in .env first: https://app.withone.ai/settings/api-keys');
// npx is a .cmd shim on Windows, which execFileSync cannot launch directly. Run the
// actual npm CLI with Node, preserving argument boundaries without a command shell.
const npxCli = [
  process.env.npm_execpath && resolve(dirname(process.env.npm_execpath), 'npx-cli.js'),
  resolve(dirname(process.execPath), 'node_modules/npm/bin/npx-cli.js'),
  resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npx-cli.js'),
].filter(Boolean).find(path => existsSync(path));
if (!npxCli) throw new Error('Cannot find npm\'s npx CLI. Install npm and run npm run one:setup.');
const one = args => JSON.parse(execFileSync(process.execPath, [npxCli, '-y', '@withone/cli', '--agent', ...args], { encoding: 'utf8', env: process.env, maxBuffer: 32 * 1024 * 1024 }));

const WANTED = {
  discordMessage: { platform: 'discord', intent: 'send a message to a channel', method: 'POST' },
  gmailSend: { platform: 'gmail', intent: 'send an email', method: 'POST' },
  sheetsAppend: { platform: 'google-sheets', intent: 'append rows to a spreadsheet', method: 'POST' },
  twilioSms: { platform: 'twilio', intent: 'send an sms message', method: 'POST' }
};

const listed = one(['list']);
const connections = (listed.connections || listed.data || listed || []).filter?.(row => row.status !== 'failed') || [];
const config = {};
for (const [name, want] of Object.entries(WANTED)) {
  const connection = connections.find(row => row.platform === want.platform);
  if (!connection) { console.log(`${want.platform}: not connected (run: npx @withone/cli add ${want.platform})`); continue; }
  const found = one(['actions', 'find', want.platform, want.intent, '--task', 'Ghost Links reviewer actions', '--no-knowledge']);
  const answer = found.answers?.[0] || {};
  const candidates = [...(answer.selected || []), ...(answer.alsoSelected || []), ...(answer.alternatives || [])];
  const action = candidates.find(item => item.method === want.method) || candidates[0];
  if (!action) { console.log(`${want.platform}: no action found for "${want.intent}"`); continue; }
  config[name] = { platform: want.platform, connectionKey: connection.key, actionId: action.actionId, method: action.method, path: action.path, title: action.title };
  // Print ids and titles only; never the secret.
  console.log(`${want.platform}: ${action.title} · ${action.method} ${action.path}`);
}
const outputPath = resolve(oneConfigPath());
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
console.log(`Saved ${Object.keys(config).length} action(s) to ${outputPath}`);
