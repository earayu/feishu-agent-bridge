# feishu-agent-bridge

A lightweight bridge that subscribes to [Feishu (Lark)](https://www.feishu.cn) IM events via WebSocket and forwards them to any AI agent framework — Claude Code, Hermes, custom webhooks, or anything that can read JSON from stdin.

## How it works

```
Feishu User
    │ sends message
    ▼
Feishu Open Platform (WebSocket)
    │
bridge.mjs (always running)
    │ normalizes event → JSON payload
    │ calls your handler
    ▼
AGENT_HANDLER_CMD   ← runs a shell command (message JSON on stdin)
  OR
AGENT_HANDLER_WEBHOOK ← POSTs JSON to your server
    │
    ▼
Your AI agent processes the message
    │ optionally replies
    ▼
send.mjs → Feishu (reply threaded under original message)
```

## Quick start

### 1. Create a Feishu app

1. Go to [Feishu Open Platform](https://open.feishu.cn/app) → **Create custom app**
2. Under **Add features**, enable **Bot**
3. Under **Permissions & Scopes**, add:
   - `im:message` (send messages)
   - `im:message.receive_v1` (receive messages) — optional for contact lookup: `contact:user.base:readonly`
4. Under **Event subscriptions** → set **Connection method** to **WebSocket (long connection)**
5. Subscribe to the event: `im.message.receive_v1`
6. Copy your **App ID** and **App Secret**

### 2. Install and configure

```bash
git clone https://github.com/earayu/feishu-agent-bridge.git
cd feishu-agent-bridge
npm install
npm run register
# Follow the prompts to enter your App ID and App Secret
```

### 3. Set your handler

**Option A — shell command** (message JSON delivered on stdin):
```bash
export AGENT_HANDLER_CMD="bash /path/to/my-handler.sh"
```

**Option B — webhook** (bridge POSTs JSON to your server):
```bash
export AGENT_HANDLER_WEBHOOK="http://localhost:3456/feishu"
```

**Option C — stdout** (no env var set, prints JSON to stdout — useful for testing):
```bash
npm run bridge | jq .
```

### 4. Run the bridge

```bash
npm run bridge
```

The bridge reconnects automatically on disconnect.

---

## Message payload format

Your handler receives this JSON (via stdin or HTTP POST body):

```json
{
  "event": "message",
  "target": "my-team-channel",
  "chat_id": "oc_xxxxxxxxxxxxxxxxxxxx",
  "chat_type": "group",
  "message_id": "om_xxxxxxxxxxxxxxxxxxxx",
  "sender_open_id": "ou_xxxxxxxxxxxxxxxxxxxx",
  "sender_name": "张三",
  "text": "Hello, what is the weather today?",
  "attachments": [
    {
      "kind": "image",
      "local_path": "/tmp/feishu-bridge-attachments/1234567890-img_v2_xxx.jpg",
      "filename": "img_v2_xxx.jpg",
      "file_key": "img_v2_xxx"
    }
  ],
  "timestamp": "2026-05-02T14:00:00.000Z",
  "raw": { ... }
}
```

**Attachment note**: Local files in `attachments[].local_path` are cleaned up after your handler exits unless `KEEP_ATTACHMENTS=1` is set.

---

## Sending replies

Use `send.mjs` to reply to Feishu from inside your handler:

```bash
# Reply in the same thread (recommended — keeps context visible)
node send.mjs --reply-to <om_message_id> --text "Here is your answer"

# Or pipe from stdin
echo "Here is your answer" | node send.mjs --reply-to <om_message_id> --stdin

# Send to a specific chat
node send.mjs --chat-id <oc_xxx> --text "Hello group"

# DM a specific user
node send.mjs --open-id <ou_xxx> --text "Hello"
```

---

## Routing

Create `routing.json` to map Feishu chat IDs to logical target names. The bridge passes the resolved target to your handler so you can route messages differently based on which chat they came from.

```json
{
  "oc_xxxxxxxxxxxxxxxxxxxx": "engineering",
  "oc_yyyyyyyyyyyyyyyyyyyy": "support"
}
```

Chats not in `routing.json` get the value of `BRIDGE_DEFAULT_TARGET` (default: `"default"`).

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `AGENT_HANDLER_CMD` | — | Shell command to run for each message (JSON on stdin) |
| `AGENT_HANDLER_WEBHOOK` | — | URL to POST message JSON to |
| `BRIDGE_DEFAULT_TARGET` | `default` | Fallback target for unmapped chat IDs |
| `KEEP_ATTACHMENTS` | — | Set to `1` to skip auto-cleanup of downloaded attachment files |

---

## Examples

See the [`examples/`](./examples) directory:

- [`examples/claude-code/handler.sh`](./examples/claude-code/handler.sh) — Handler for [Claude Code](https://docs.anthropic.com/claude-code) CLI
- [`examples/webhook/server.js`](./examples/webhook/server.js) — HTTP webhook server template (customize for any agent)

---

## Running as a background service

### macOS (launchd)

Create `~/Library/LaunchAgents/com.feishu-agent-bridge.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>             <string>com.feishu-agent-bridge</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/path/to/feishu-agent-bridge/bridge.mjs</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>AGENT_HANDLER_CMD</key> <string>bash /path/to/handler.sh</string>
  </dict>
  <key>RunAtLoad</key>          <true/>
  <key>KeepAlive</key>          <true/>
  <key>StandardErrorPath</key>  <string>/path/to/feishu-agent-bridge/logs/bridge.log</string>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.feishu-agent-bridge.plist
```

### Linux (systemd)

```ini
[Unit]
Description=Feishu Agent Bridge
After=network.target

[Service]
ExecStart=/usr/bin/node /path/to/feishu-agent-bridge/bridge.mjs
Environment=AGENT_HANDLER_CMD=bash /path/to/handler.sh
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

---

## License

MIT
