#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/semantic-routing-demo}"
LOG_DIR="$APP_DIR/logs"
mkdir -p "$LOG_DIR"

export DEEPSEEK_API_BASE="${DEEPSEEK_API_BASE:-https://api.deepseek.com}"
export DEEPSEEK_MODEL="${DEEPSEEK_MODEL:-deepseek-chat}"

cat > "$APP_DIR/adapter-config.json" <<EOF
{
  "provider": {
    "api_base": "${DEEPSEEK_API_BASE}",
    "api_key": "${DEEPSEEK_API_KEY:-}",
    "model": "${DEEPSEEK_MODEL}",
    "timeout": 45,
    "accept_client_model": false,
    "model_aliases": {
      "demo-client": "${DEEPSEEK_MODEL}"
    }
  },
  "roles": {
    "small": {
      "system_prompt": "You are a concise assistant. Reply briefly in 1-3 short paragraphs and minimize token usage.",
      "max_tokens": 96,
      "temperature": 0.2
    },
    "big": {
      "system_prompt": "You are a detailed technical assistant. Provide thorough, structured answers with clear steps when useful.",
      "max_tokens": 512,
      "temperature": 0.2
    },
    "default": {
      "system_prompt": "You are a balanced helpful assistant. Be accurate and reasonably concise.",
      "max_tokens": 256,
      "temperature": 0.2
    }
  },
  "gateway_profiles": {
    "f5_expert": {
      "system_prompt": "You are an F5 BIG-IP expert. Answer F5 questions accurately, with concrete commands, iRules, tmsh examples, and operational caveats when useful. If the question is not about F5, still answer helpfully but keep the response professional and concise.",
      "max_tokens": 512,
      "temperature": 0.2
    },
    "general_assistant": {
      "system_prompt": "You are a professional enterprise assistant. Answer clearly, accurately, and concisely in Chinese unless the user explicitly asks for another language.",
      "max_tokens": 256,
      "temperature": 0.2
    }
  }
}
EOF

nohup env ROLE=small PORT=9001 ADAPTER_CONFIG_PATH="$APP_DIR/adapter-config.json" python3 "$APP_DIR/semantic_backend.py" > "$LOG_DIR/backend-small.log" 2>&1 &
echo $! > "$APP_DIR/backend-small.pid"

nohup env ROLE=big PORT=9002 ADAPTER_CONFIG_PATH="$APP_DIR/adapter-config.json" python3 "$APP_DIR/semantic_backend.py" > "$LOG_DIR/backend-big.log" 2>&1 &
echo $! > "$APP_DIR/backend-big.pid"

nohup env ROLE=default PORT=9003 ADAPTER_CONFIG_PATH="$APP_DIR/adapter-config.json" python3 "$APP_DIR/semantic_backend.py" > "$LOG_DIR/backend-default.log" 2>&1 &
echo $! > "$APP_DIR/backend-default.pid"

nohup env CLIENT_PORT=18080 F5_BASE="${F5_BASE:-http://10.1.10.12:8080}" python3 "$APP_DIR/semantic_client.py" > "$LOG_DIR/client.log" 2>&1 &
echo $! > "$APP_DIR/client.pid"

echo "started"
