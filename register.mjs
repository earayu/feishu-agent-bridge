#!/usr/bin/env node
// register.mjs — interactive setup: save app_id + app_secret to app.json.
//
// Run this once to configure your Feishu app credentials.
// You can get app_id and app_secret from the Feishu Open Platform developer console:
//   https://open.feishu.cn/app
//
// After running this, start the bridge with: npm run bridge

import { writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_FILE = path.join(__dirname, 'app.json');

function prompt(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stderr });

  console.error('\n=== Feishu Agent Bridge — Setup ===\n');
  console.error('You need a Feishu custom app with:');
  console.error('  • im:message:receive_v1 event subscription (WebSocket)');
  console.error('  • im:message (send message) permission');
  console.error('  • Bot added to the target chat(s)\n');
  console.error('Get your credentials at: https://open.feishu.cn/app\n');

  const app_id     = (await prompt(rl, 'App ID     (cli_xxx): ')).trim();
  const app_secret = (await prompt(rl, 'App Secret:          ')).trim();

  rl.close();

  if (!app_id || !app_secret) {
    console.error('Error: both App ID and App Secret are required.');
    process.exit(1);
  }

  const data = { app_id, app_secret };
  await writeFile(APP_FILE, JSON.stringify(data, null, 2) + '\n');
  console.error(`\nSaved to ${APP_FILE}`);
  console.error('\nNext steps:');
  console.error('  1. Set AGENT_HANDLER_CMD or AGENT_HANDLER_WEBHOOK (see README)');
  console.error('  2. Optionally create routing.json (see routing.example.json)');
  console.error('  3. Run: npm run bridge');
}

main().catch((e) => {
  console.error('Registration failed:', e.message);
  process.exit(1);
});
