#!/usr/bin/env bash
# handler.sh — Claude Code (claude / Codex CC) handler for feishu-agent-bridge.
#
# Set AGENT_HANDLER_CMD="bash /path/to/handler.sh" in your bridge environment.
#
# This script reads the JSON message payload from stdin and wakes a Claude Code
# agent by appending the message to a FIFO or named pipe that your agent watches,
# OR by calling "claude" CLI directly.
#
# Prerequisites:
#   - Claude Code CLI installed: https://docs.anthropic.com/claude-code
#   - This script executable: chmod +x handler.sh
#
# Environment variables:
#   CLAUDE_PROJECT_DIR   Directory of the Claude Code project/agent (default: $HOME/.claude)
#   CLAUDE_MODEL         Model to use (default: claude-opus-4-5)
#   FEISHU_SEND_CMD      Path to send.mjs for replying (default: node /path/to/send.mjs)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRIDGE_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

CLAUDE_PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$HOME/.claude}"
CLAUDE_MODEL="${CLAUDE_MODEL:-claude-opus-4-5}"
FEISHU_SEND_CMD="${FEISHU_SEND_CMD:-node $BRIDGE_DIR/send.mjs}"

# Read message JSON from stdin
PAYLOAD="$(cat)"

# Extract fields using node (already a dependency)
MESSAGE_ID=$(node -e "const p=JSON.parse(process.argv[1]); process.stdout.write(p.message_id||'');" "$PAYLOAD")
TEXT=$(node -e "const p=JSON.parse(process.argv[1]); process.stdout.write(p.text||'');" "$PAYLOAD")
SENDER=$(node -e "const p=JSON.parse(process.argv[1]); process.stdout.write(p.sender_name||p.sender_open_id||'unknown');" "$PAYLOAD")
TARGET=$(node -e "const p=JSON.parse(process.argv[1]); process.stdout.write(p.target||'default');" "$PAYLOAD")

echo "[handler] message_id=$MESSAGE_ID sender=$SENDER target=$TARGET" >&2
echo "[handler] text: $TEXT" >&2

if [ -z "$TEXT" ]; then
  echo "[handler] empty text, skipping" >&2
  exit 0
fi

# --- Option A: Write to a named pipe (if your agent watches a pipe) ---
# AGENT_PIPE="${CLAUDE_PROJECT_DIR}/inbox.pipe"
# if [ -p "$AGENT_PIPE" ]; then
#   echo "$PAYLOAD" > "$AGENT_PIPE"
#   exit 0
# fi

# --- Option B: Run claude CLI directly (non-interactive, one-shot response) ---
PROMPT="You are an AI assistant connected to Feishu (Lark).
Message from ${SENDER}: ${TEXT}
Feishu message ID: ${MESSAGE_ID} (use this with send.mjs --reply-to to respond)
Target/channel context: ${TARGET}"

RESPONSE=$(echo "$PROMPT" | claude --model "$CLAUDE_MODEL" --no-interactive 2>/dev/null || echo "")

if [ -n "$RESPONSE" ] && [ -n "$MESSAGE_ID" ]; then
  echo "$RESPONSE" | $FEISHU_SEND_CMD --reply-to "$MESSAGE_ID" --stdin
fi
