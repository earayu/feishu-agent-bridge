#!/usr/bin/env node
// server.js — example webhook server for feishu-agent-bridge.
//
// Set AGENT_HANDLER_WEBHOOK=http://localhost:3456/feishu in your bridge environment.
// Then run: node server.js
//
// Customize the `handleFeishuMessage` function to integrate with your agent framework.

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_DIR = path.join(__dirname, '../..');
const PORT = process.env.PORT || 3456;

// --- Your agent logic goes here ---
async function handleFeishuMessage(payload) {
  const { message_id, sender_name, sender_open_id, text, target, chat_id, chat_type, attachments } = payload;

  console.log(`[webhook] message from ${sender_name || sender_open_id}: ${text}`);
  console.log(`[webhook] target=${target} chat=${chat_id} (${chat_type})`);
  if (attachments.length) {
    console.log(`[webhook] ${attachments.length} attachment(s):`, attachments.map(a => a.local_path));
  }

  // TODO: pass to your agent here.
  // Example: call OpenAI / Anthropic API, run a local LLM, etc.
  const response = `Echo: ${text}`;

  // Reply back to Feishu using send.mjs
  if (message_id && response) {
    await sendToFeishu({ replyTo: message_id, text: response });
  }
}

// --- Send a message back to Feishu ---
function sendToFeishu({ replyTo, chatId, openId, text }) {
  return new Promise((resolve, reject) => {
    const args = ['send.mjs'];
    if (replyTo)  { args.push('--reply-to', replyTo); }
    else if (chatId)  { args.push('--chat-id', chatId); }
    else if (openId)  { args.push('--open-id', openId); }
    else { return reject(new Error('sendToFeishu: must provide replyTo, chatId, or openId')); }

    const child = spawn('node', [path.join(BRIDGE_DIR, 'send.mjs'), ...args.slice(1)], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => stdout += d);
    child.stderr.on('data', d => stderr += d);
    child.on('close', code => code === 0 ? resolve(stdout.trim()) : reject(new Error(`send exit=${code}: ${stderr}`)));
    child.stdin.end(text);
  });
}

// --- HTTP server ---
const server = createServer(async (req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405);
    return res.end('Method Not Allowed');
  }

  let body = '';
  for await (const chunk of req) body += chunk;

  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    res.writeHead(400);
    return res.end('Bad JSON');
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));

  // Handle async (don't block the response)
  handleFeishuMessage(payload).catch(e => console.error('[webhook] handler error:', e.message));
});

server.listen(PORT, () => {
  console.log(`Webhook server listening on http://localhost:${PORT}`);
  console.log(`Set AGENT_HANDLER_WEBHOOK=http://localhost:${PORT} in your bridge environment`);
});
