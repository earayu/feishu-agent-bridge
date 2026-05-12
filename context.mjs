#!/usr/bin/env node
// context.mjs — pull recent messages from a Feishu chat for context.
//
// Usage:
//   node context.mjs --chat-id <oc_xxx> [--limit 20]
//   node context.mjs --chat-id <oc_xxx> --before <om_xxx>     # messages before a given message
//
// Outputs JSON Lines to stdout — one message per line, oldest first:
//   {"time":"2026-04-30T18:00:00Z","sender":"ou_xxx","type":"text","text":"...","message_id":"om_xxx"}
//
// Caveats (per Feishu docs):
//   - Default permissions only let us read p2p (单聊) messages.
//   - For group (oc_xxx) messages you need the "获取群组中所有消息" permission,
//     which usually requires tenant admin approval. Without it, the API returns
//     no/empty results for group chats.

// Strip localhost-only proxies (axios + Feishu redirect loop).
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

function summarizeMsg(item) {
  const m = item || {};
  const t = m.msg_type || m.message_type;
  let text = '';
  try {
    const body = JSON.parse(m.body?.content ?? m.content ?? '{}');
    if (t === 'text') text = body.text || '';
    else if (t === 'post') {
      const blocks = Object.values(body)[0]?.content || [];
      text = blocks.flat().map((b) => b?.text || '').filter(Boolean).join(' ');
    } else if (t === 'image') text = `[image ${body.image_key}]`;
    else if (t === 'file') text = `[file ${body.file_name || body.file_key}]`;
    else text = `[${t}]`;
  } catch {
    text = `[${t}]`;
  }
  // Resolve mentions if present
  if (Array.isArray(m.mentions) && m.mentions.length) {
    for (const mn of m.mentions) {
      if (!mn?.key) continue;
      const name = mn.name || mn.id?.open_id || mn.key;
      while (text.includes(mn.key)) text = text.replace(mn.key, `@${name}`);
    }
  }
  const tsMs = Number(m.create_time || m.update_time || 0);
  return {
    message_id: m.message_id,
    time: tsMs ? new Date(tsMs).toISOString() : null,
    sender: m.sender?.id || m.sender?.sender_id?.open_id || m.sender_id?.open_id || null,
    type: t,
    text,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    process.stderr.write(
      'Usage: context.mjs --chat-id <oc_xxx> [--limit N] [--before <om_xxx>]\n',
    );
    process.exit(0);
  }
  const chatId = args['chat-id'];
  const limit = Math.min(Number(args.limit || 20), 50);
  const beforeMsg = args['before'];

  if (!chatId) {
    process.stderr.write('error: --chat-id required\n');
    process.exit(2);
  }
  if (!existsSync(APP_FILE)) {
    process.stderr.write(`error: ${APP_FILE} missing\n`);
    process.exit(1);
  }
  const { app_id, app_secret } = JSON.parse(await readFile(APP_FILE, 'utf8'));

  const client = new lark.Client({
    appId: app_id,
    appSecret: app_secret,
    loggerLevel: lark.LoggerLevel.warn,
  });

  // Determine the upper time bound. If --before <om_xxx>, fetch that message's create_time first.
  let endTime;
  if (beforeMsg) {
    const r = await client.im.v1.message.get({ path: { message_id: beforeMsg } });
    const item = r?.data?.items?.[0];
    if (item?.create_time) endTime = String(Math.floor(Number(item.create_time) / 1000));
  }

  const params = {
    container_id_type: 'chat',
    container_id: chatId,
    sort_type: 'ByCreateTimeDesc',
    page_size: limit,
  };
  if (endTime) params.end_time = endTime;

  const res = await client.im.v1.message.list({ params });
  if (res?.code && res.code !== 0) {
    process.stderr.write(`feishu API error code=${res.code} msg=${res.msg}\n`);
    process.exit(1);
  }
  const items = res?.data?.items || [];
  // API returns desc; print oldest-first for natural reading
  for (const m of items.slice().reverse()) {
    process.stdout.write(JSON.stringify(summarizeMsg(m)) + '\n');
  }

  if (!items.length) {
    process.stderr.write(
      'note: 0 messages returned. For group chats this often means the app lacks ' +
      'the "获取群组中所有消息" permission (admin-approved scope).\n',
    );
  }
}

main().catch((e) => {
  process.stderr.write('context fetch failed: ' + (e?.message || e) + '\n');
  process.exit(1);
});
