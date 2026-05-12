#!/usr/bin/env node
import * as lark from '@larksuiteoapi/node-sdk';
import { readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['http_proxy','https_proxy','HTTP_PROXY','HTTPS_PROXY','all_proxy','ALL_PROXY']) {
  const v = process.env[k];
  if (v && /127\.0\.0\.1|localhost|::1/.test(v)) delete process.env[k];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { app_id, app_secret } = JSON.parse(await readFile(path.join(__dirname,'app.json'),'utf8'));
const client = new lark.Client({ appId: app_id, appSecret: app_secret, loggerLevel: lark.LoggerLevel.warn });

const [filePath, chatId, fileType] = process.argv.slice(2);
const fileName = path.basename(filePath);

const uploadRes = await client.im.v1.file.create({
  data: { file_type: fileType || 'stream', file_name: fileName, file: createReadStream(filePath) }
});
const fileKey = uploadRes?.data?.file_key ?? uploadRes?.file_key;
if (!fileKey) { console.error('Upload failed:', uploadRes); process.exit(1); }
console.log('Uploaded file_key:', fileKey);

const res = await client.im.v1.message.create({
  params: { receive_id_type: 'chat_id' },
  data: { receive_id: chatId, msg_type: 'file', content: JSON.stringify({ file_key: fileKey }) }
});
console.log('Sent! message_id:', res?.data?.message_id);
