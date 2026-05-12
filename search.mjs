#!/usr/bin/env node
// search.mjs — keyword search within a Feishu chat's history.
//
// Usage:
//   search.mjs --chat-id <oc_xxx> --query "<keyword>" [--limit 50] [--days 7]
//
// Implementation: Feishu has no bot-side full-text search API. We page through
// `client.im.v1.message.list` over the chosen window, filter client-side
// (case-insensitive substring), and emit JSONL of matches (oldest-first).
//
// Caveats:
//   - Group chats need the `im:message.group_msg` scope (admin-approved).
//   - Each list page is up to 50 messages; we cap pages to avoid runaway calls.

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
const MAX_PAGES = 20; // 20 × 50 = 1000 messages cap per search

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

function plainText(m) {
  const t = m.msg_type;
  let body = {};
  try {
    body = JSON.parse(m.body?.content || '{}');
  } catch {}
  if (t === 'text') return body.text || '';
  if (t === 'post') {
    const blocks = Object.values(body)[0]?.content || [];
    return blocks.flat().map((b) => b?.text || '').filter(Boolean).join(' ');
  }
  if (t === 'image') return `[image ${body.image_key || ''}]`;
  if (t === 'file') return `[file ${body.file_name || body.file_key || ''}]`;
  return `[${t}]`;
}

function summarize(m, matchedText) {
  return {
    message_id: m.message_id,
    time: m.create_time ? new Date(Number(m.create_time)).toISOString() : null,
    sender: m.sender?.id || null,
    type: m.msg_type,
    text: matchedText,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h || !args['chat-id'] || !args.query) {
    process.stderr.write(
      'Usage: search.mjs --chat-id <oc_xxx> --query "<keyword>" [--limit 50] [--days 7]\n',
    );
    process.exit(args.help || args.h ? 0 : 2);
  }
  const chatId = args['chat-id'];
  const needle = String(args.query).toLowerCase();
  const limit = Math.min(Number(args.limit || 50), 200);
  const days = Number(args.days || 7);

  if (!existsSync(APP_FILE)) {
    process.stderr.write('error: app.json missing\n');
    process.exit(1);
  }
  const { app_id, app_secret } = JSON.parse(await readFile(APP_FILE, 'utf8'));
  const client = new lark.Client({ appId: app_id, appSecret: app_secret, loggerLevel: lark.LoggerLevel.warn });

  const startTime = String(Math.floor((Date.now() - days * 86400_000) / 1000));
  const matches = [];
  let pageToken = '';
  let pages = 0;

  while (matches.length < limit && pages < MAX_PAGES) {
    pages += 1;
    const params = {
      container_id_type: 'chat',
      container_id: chatId,
      sort_type: 'ByCreateTimeDesc',
      page_size: 50,
      start_time: startTime,
    };
    if (pageToken) params.page_token = pageToken;
    const res = await client.im.v1.message.list({ params });
    if (res?.code && res.code !== 0) {
      process.stderr.write(`feishu API error code=${res.code} msg=${res.msg}\n`);
      process.exit(1);
    }
    const items = res?.data?.items || [];
    for (const m of items) {
      const text = plainText(m);
      if (text && text.toLowerCase().includes(needle)) {
        matches.push(summarize(m, text));
        if (matches.length >= limit) break;
      }
    }
    pageToken = res?.data?.page_token || '';
    if (!res?.data?.has_more || !pageToken) break;
  }

  // Print oldest-first for natural reading
  for (const m of matches.slice().reverse()) {
    process.stdout.write(JSON.stringify(m) + '\n');
  }
  process.stderr.write(`scanned ${pages} page(s), ${matches.length} match(es) in last ${days}d\n`);
}

main().catch((e) => {
  process.stderr.write('search failed: ' + (e?.message || e) + '\n');
  process.exit(1);
});
