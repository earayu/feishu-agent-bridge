#!/usr/bin/env node
// send.mjs — outbound: agent -> Feishu.
// Usage:
//   node send.mjs --chat-id  <oc_xxx>  --text "hello"
//   node send.mjs --open-id  <ou_xxx>  --text "hello"
//   node send.mjs --user-id  <user_xxx> --text "hello"
//   node send.mjs --email    me@x.com  --text "hello"
//   node send.mjs --reply-to <om_xxx>  --text "hello"  ← reply chain on the original
//
// --reply-to threads the message under the original (Feishu's "回复" feature)
// and is exclusive with --chat-id / --open-id / etc — Feishu derives the chat
// from the parent message.
//
// Reads ./app.json and uses the SDK Client (which auto-manages tenant_access_token).
// Returns JSON { ok, message_id } on stdout, exits non-zero on failure.

// Strip localhost-only proxies — axios + Feishu API hits redirect loops.
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
const CONTACTS_FILE = path.join(__dirname, 'contacts.json');

// Load contacts map (name -> open_id) for @-mention rewriting.
// Returns {} if file missing or unreadable (graceful degradation).
async function loadContacts() {
  if (!existsSync(CONTACTS_FILE)) return {};
  try {
    const raw = JSON.parse(await readFile(CONTACTS_FILE, 'utf8'));
    // Strip metadata keys starting with `_`.
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
      if (typeof k === 'string' && !k.startsWith('_') && typeof v === 'string' && v.startsWith('ou_')) {
        out[k] = v;
      }
    }
    return out;
  } catch (e) {
    process.stderr.write(`warn: failed to parse contacts.json: ${e.message}\n`);
    return {};
  }
}

// Rewrite "@name" tokens in text body to Feishu at-mention syntax
// <at user_id="ou_xxx">@name</at>. Only replaces names present in the
// contacts map. Greedy longest-match so "@张一鸣" wins over "@张".
//
// Strategy: scan text for all "@<word>" patterns where <word> is a run of
// CJK / latin word chars (no spaces). For each candidate, look up exact key
// in contacts. If multiple keys could match (e.g. "@LucyChen" vs "@Lucy"),
// prefer the longest matching key.
function rewriteAtMentions(text, contacts) {
  if (!text || Object.keys(contacts).length === 0) return { text, mentions: [] };
  // Sort keys by length desc so longest matches win.
  const keys = Object.keys(contacts).sort((a, b) => b.length - a.length);
  const mentions = [];
  // We do iterative matching: walk text, find next '@', try to match a key.
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '@') {
      out += text[i];
      i++;
      continue;
    }
    // Try to match a contact key starting at i+1, with a tail-boundary check
    // so "@LucyChen" doesn't wrongly partial-match "@Lucy" when only "Lucy"
    // is in the map. Tail char (after matched name) must be: end-of-string,
    // whitespace, common CJK/Latin punctuation, another '@', or a CJK char
    // that is NOT a name-continuation in latin context. Practically: reject
    // if next char is ASCII letter or digit (name-continuation in Latin).
    // CJK names are atomic — once a CJK key matches, immediately following
    // CJK is treated as separate content (works because CJK names in our map
    // are full real names, not prefixes of other names; if collisions arise
    // add longer alias to the map).
    let matched = null;
    for (const k of keys) {
      if (!text.startsWith(k, i + 1)) continue;
      const tailIdx = i + 1 + k.length;
      const tail = text[tailIdx]; // undefined at end-of-string
      if (tail === undefined) { matched = k; break; }
      // Reject if tail is ASCII letter/digit (Latin name continuation)
      if (/[A-Za-z0-9_]/.test(tail)) continue;
      matched = k;
      break;
    }
    if (matched) {
      const openId = contacts[matched];
      out += `<at user_id="${openId}">@${matched}</at>`;
      mentions.push({ name: matched, open_id: openId });
      i += 1 + matched.length; // skip "@" + key
    } else {
      out += text[i];
      i++;
    }
  }
  return { text: out, mentions };
}

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

function pickReceive(args) {
  if (args['chat-id']) return ['chat_id', args['chat-id']];
  if (args['open-id']) return ['open_id', args['open-id']];
  if (args['user-id']) return ['user_id', args['user-id']];
  if (args['union-id']) return ['union_id', args['union-id']];
  if (args.email) return ['email', args.email];
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
      '  send.mjs --chat-id|--open-id|--user-id|--union-id|--email <id> (--text "..." | --stdin)\n' +
      '  send.mjs --reply-to <om_xxx> (--text "..." | --stdin)\n' +
      '\n' +
      'Optional:\n' +
      '  --no-at   Disable @-mention rewriting (keeps @name as literal text).\n' +
      '\n' +
      'By default, "@name" tokens in the body are rewritten to Feishu @-mention\n' +
      'syntax using contacts.json (name -> open_id map). Add new contacts to\n' +
      'contacts.json. Longest-match wins for overlapping aliases.\n',
    );
    process.exit(0);
  }

  const replyTo = args['reply-to'];
  const recv = pickReceive(args);
  if (!replyTo && !recv) {
    process.stderr.write('error: must provide --reply-to OR a receiver (--chat-id / --open-id / --user-id / --union-id / --email)\n');
    process.exit(2);
  }
  if (replyTo && recv) {
    process.stderr.write('warn: --reply-to overrides --chat-id/etc; chat is derived from the parent message.\n');
  }
  const text = await readBody(args);
  if (text === null || text === '') {
    process.stderr.write('error: must provide --text "..." or --stdin\n');
    process.exit(2);
  }

  if (!existsSync(APP_FILE)) {
    process.stderr.write(`error: ${APP_FILE} missing. Run register first.\n`);
    process.exit(1);
  }
  const { app_id, app_secret } = JSON.parse(await readFile(APP_FILE, 'utf8'));

  // Rewrite @name -> <at user_id="ou_xxx">@name</at> using contacts.json.
  // --no-at disables rewriting (e.g. for messages where @ should remain literal).
  let finalText = text;
  let mentions = [];
  if (!args['no-at']) {
    const contacts = await loadContacts();
    const rewritten = rewriteAtMentions(text, contacts);
    finalText = rewritten.text;
    mentions = rewritten.mentions;
  }

  const client = new lark.Client({
    appId: app_id,
    appSecret: app_secret,
    loggerLevel: lark.LoggerLevel.warn,
  });

  let res;
  if (replyTo) {
    res = await client.im.v1.message.reply({
      path: { message_id: replyTo },
      data: {
        msg_type: 'text',
        content: JSON.stringify({ text: finalText }),
      },
    });
  } else {
    const [receiveType, receiveId] = recv;
    res = await client.im.v1.message.create({
      params: { receive_id_type: receiveType },
      data: {
        receive_id: receiveId,
        msg_type: 'text',
        content: JSON.stringify({ text: finalText }),
      },
    });
  }

  if (res?.code && res.code !== 0) {
    process.stderr.write(`feishu API error code=${res.code} msg=${res.msg}\n`);
    process.exit(1);
  }
  process.stdout.write(
    JSON.stringify({
      ok: true,
      message_id: res?.data?.message_id ?? null,
      replied_to: replyTo || null,
      mentions: mentions.length ? mentions : undefined,
    }) + '\n',
  );
}

main().catch((e) => {
  process.stderr.write('send failed: ' + (e?.message || e) + '\n');
  process.exit(1);
});
