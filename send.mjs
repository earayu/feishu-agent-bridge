#!/usr/bin/env node
// send.mjs — outbound: agent -> Feishu.
//
// Usage:
//   node send.mjs --chat-id  <oc_xxx>  --text "hello"
//   node send.mjs --open-id  <ou_xxx>  --text "hello"
//   node send.mjs --user-id  <user_xxx> --text "hello"
//   node send.mjs --email    me@x.com  --text "hello"
//   node send.mjs --reply-to <om_xxx>  --text "hello"
//   echo "hello" | node send.mjs --chat-id <oc_xxx> --stdin
//
// --reply-to threads the message under the original (Feishu reply chain)
// and is exclusive with --chat-id / --open-id / etc.
//
// Reads ./app.json for credentials.
// Prints JSON { ok, message_id } to stdout. Exits non-zero on failure.

for (const k of ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY']) {
  const v = process.env[k];
  if (v && /127\.0\.0\.1|localhost|::1/.test(v)) delete process.env[k];
}

import * as lark from '@larksuiteoapi/node-sdk';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_FILE = path.join(__dirname, 'app.json');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const val = argv[i + 1];
    if (val === undefined || val.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = val;
      i++;
    }
  }
  return out;
}

function pickReceiver(args) {
  if (args['chat-id'])   return ['chat_id',   args['chat-id']];
  if (args['open-id'])   return ['open_id',   args['open-id']];
  if (args['user-id'])   return ['user_id',   args['user-id']];
  if (args['union-id'])  return ['union_id',  args['union-id']];
  if (args.email)        return ['email',     args.email];
  return null;
}

async function readBody(args) {
  if (args.text !== undefined && args.text !== true) return String(args.text);
  if (args.stdin) {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    return Buffer.concat(chunks).toString('utf8').trimEnd();
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    process.stderr.write(
      'Usage:\n' +
      '  send.mjs --reply-to <om_xxx> (--text "..." | --stdin)\n' +
      '  send.mjs --chat-id|--open-id|--user-id|--union-id|--email <id> (--text "..." | --stdin)\n',
    );
    process.exit(0);
  }

  const replyTo = args['reply-to'];
  const recv    = pickReceiver(args);
  if (!replyTo && !recv) {
    process.stderr.write('error: must provide --reply-to OR a receiver flag\n');
    process.exit(2);
  }

  const text = await readBody(args);
  if (!text) {
    process.stderr.write('error: must provide --text "..." or --stdin\n');
    process.exit(2);
  }

  if (!existsSync(APP_FILE)) {
    process.stderr.write(`error: ${APP_FILE} missing. Run npm run register first.\n`);
    process.exit(1);
  }
  const { app_id, app_secret } = JSON.parse(await readFile(APP_FILE, 'utf8'));

  const client = new lark.Client({
    appId: app_id,
    appSecret: app_secret,
    loggerLevel: lark.LoggerLevel.warn,
  });

  let res;
  if (replyTo) {
    res = await client.im.v1.message.reply({
      path: { message_id: replyTo },
      data: { msg_type: 'text', content: JSON.stringify({ text }) },
    });
  } else {
    const [receiveType, receiveId] = recv;
    res = await client.im.v1.message.create({
      params: { receive_id_type: receiveType },
      data: { receive_id: receiveId, msg_type: 'text', content: JSON.stringify({ text }) },
    });
  }

  if (res?.code && res.code !== 0) {
    process.stderr.write(`feishu API error code=${res.code} msg=${res.msg}\n`);
    process.exit(1);
  }
  process.stdout.write(
    JSON.stringify({ ok: true, message_id: res?.data?.message_id ?? null, replied_to: replyTo || null }) + '\n',
  );
}

main().catch((e) => {
  process.stderr.write('send failed: ' + (e?.message || e) + '\n');
  process.exit(1);
});
