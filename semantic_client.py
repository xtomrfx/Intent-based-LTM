#!/usr/bin/env python3
import json
import os
import time
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn
from urllib.parse import urlparse

import requests


PORT = int(os.environ.get("CLIENT_PORT", "18080"))
F5_BASE = os.environ.get("F5_BASE", "http://10.1.10.12:8080").rstrip("/")
TIMEOUT = int(os.environ.get("CLIENT_TIMEOUT", "75"))
API_KEY = os.environ.get("CLIENT_API_KEY", "")
DEFAULT_MODEL = os.environ.get("CLIENT_MODEL", "testmodel")
TITLE = os.environ.get("CLIENT_TITLE", "F5 AI Gateway Demo")
APP_VERSION = os.environ.get("CLIENT_VERSION", "2026.04.12-3")


HTML_TEMPLATE = """<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>__TITLE__</title>
  <style>
    :root {
      --bg: #09111f;
      --bg-2: #0f1a2d;
      --panel: rgba(10, 18, 33, 0.86);
      --panel-soft: rgba(19, 31, 54, 0.78);
      --ink: #eef4ff;
      --muted: #aab8d1;
      --line: rgba(141, 172, 221, 0.24);
      --brand: #14b8a6;
      --brand-2: #3b82f6;
      --brand-3: #f97316;
      --danger: #f87171;
      --user: linear-gradient(135deg, #1d4ed8, #0f766e);
      --assistant: rgba(255, 255, 255, 0.04);
      --shadow: 0 30px 80px rgba(3, 8, 20, 0.45);
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body {
      margin: 0;
      color: var(--ink);
      font-family: "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif;
      background:
        radial-gradient(circle at 0% 0%, rgba(59,130,246,0.24), transparent 28%),
        radial-gradient(circle at 100% 0%, rgba(20,184,166,0.18), transparent 26%),
        linear-gradient(180deg, #07101d, #0d1728 52%, #0a1220);
    }
    .shell {
      min-height: 100%;
      display: grid;
      grid-template-columns: 360px 1fr;
      gap: 20px;
      padding: 20px;
    }
    .panel {
      border: 1px solid var(--line);
      border-radius: 26px;
      background: var(--panel);
      box-shadow: var(--shadow);
      backdrop-filter: blur(18px);
    }
    .sidebar {
      padding: 22px;
      display: flex;
      flex-direction: column;
      gap: 18px;
    }
    .hero {
      padding: 18px;
      border-radius: 22px;
      background:
        linear-gradient(135deg, rgba(20,184,166,0.18), rgba(59,130,246,0.26)),
        linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01));
      border: 1px solid rgba(164, 186, 227, 0.18);
    }
    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(255,255,255,0.08);
      color: #d7e6ff;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .hero h1 {
      margin: 14px 0 8px;
      font-size: 30px;
      line-height: 1.04;
    }
    .hero p {
      margin: 0;
      color: #dbe6fb;
      font-size: 14px;
      line-height: 1.6;
    }
    .section h3 {
      margin: 0 0 10px;
      color: var(--muted);
      font-size: 12px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    .stack {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .chip {
      border: 1px solid rgba(160,188,232,0.18);
      background: rgba(255,255,255,0.04);
      color: #dce8ff;
      border-radius: 999px;
      padding: 8px 12px;
      font-size: 12px;
      cursor: pointer;
      transition: transform 140ms ease, border-color 140ms ease;
    }
    .chip:hover { transform: translateY(-1px); border-color: rgba(160,188,232,0.38); }
    label {
      display: block;
      font-size: 13px;
      color: var(--muted);
      margin: 0 0 8px;
    }
    select, textarea, input, button {
      font: inherit;
    }
    select, textarea, input {
      width: 100%;
      border-radius: 18px;
      border: 1px solid rgba(160,188,232,0.18);
      background: rgba(255,255,255,0.03);
      color: var(--ink);
      padding: 14px 16px;
      outline: none;
    }
    select, input { height: 50px; }
    textarea {
      min-height: 150px;
      resize: vertical;
      line-height: 1.6;
    }
    .btn-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-top: 12px;
    }
    button {
      border: 0;
      border-radius: 16px;
      padding: 14px 16px;
      font-weight: 700;
      cursor: pointer;
      color: #07111f;
      background: linear-gradient(135deg, var(--brand), #7dd3fc);
    }
    button.secondary {
      color: var(--ink);
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(160,188,232,0.16);
    }
    button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .metrics {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
    }
    .metric {
      border: 1px solid rgba(160,188,232,0.14);
      border-radius: 18px;
      padding: 14px;
      background: var(--panel-soft);
    }
    .metric .label {
      color: var(--muted);
      font-size: 12px;
      margin-bottom: 6px;
    }
    .metric .value {
      font-size: 16px;
      font-weight: 700;
    }
    .main {
      padding: 22px;
      display: grid;
      grid-template-rows: auto auto 1fr auto;
      min-height: calc(100vh - 40px);
      gap: 14px;
    }
    .topbar {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 18px;
    }
    .title h2 {
      margin: 0;
      font-size: 28px;
    }
    .title p {
      margin: 8px 0 0;
      color: var(--muted);
      font-size: 14px;
    }
    .route {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 34px;
      padding: 8px 12px;
      border-radius: 999px;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(160,188,232,0.16);
      color: #dbe8ff;
      font-size: 12px;
    }
    .status {
      border-radius: 18px;
      padding: 12px 14px;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(160,188,232,0.12);
      color: var(--muted);
      font-size: 14px;
    }
    .status.error {
      color: #ffd6d6;
      border-color: rgba(248,113,113,0.3);
      background: rgba(248,113,113,0.08);
    }
    .messages {
      display: flex;
      flex-direction: column;
      gap: 14px;
      overflow: auto;
      padding-right: 6px;
    }
    .msg {
      max-width: 88%;
      border-radius: 24px;
      padding: 16px 18px;
      line-height: 1.65;
      white-space: pre-wrap;
      box-shadow: 0 16px 36px rgba(3, 8, 20, 0.25);
    }
    .msg.user {
      align-self: flex-end;
      background: var(--user);
      color: white;
    }
    .msg.assistant {
      align-self: flex-start;
      background: var(--assistant);
      border: 1px solid rgba(160,188,232,0.14);
    }
    .meta {
      margin-top: 8px;
      color: var(--muted);
      font-size: 12px;
    }
    .msg.pending::after {
      content: "";
      display: inline-block;
      width: 8px;
      height: 8px;
      margin-left: 8px;
      border-radius: 999px;
      background: #7dd3fc;
      animation: pulse 1s infinite ease-in-out;
      vertical-align: middle;
    }
    .composer {
      display: grid;
      grid-template-columns: 1fr auto auto;
      gap: 10px;
      align-items: end;
    }
    .composer textarea {
      min-height: 92px;
    }
    .composer button {
      min-width: 112px;
      height: 92px;
      margin: 0;
    }
    .debug {
      border-radius: 20px;
      background: rgba(0,0,0,0.3);
      border: 1px solid rgba(160,188,232,0.12);
      overflow: hidden;
    }
    .debug summary {
      cursor: pointer;
      padding: 14px 16px;
      color: #dbe8ff;
      font-weight: 700;
    }
    .debug pre {
      margin: 0;
      padding: 0 16px 16px;
      overflow: auto;
      color: #dce8ff;
      font-size: 12px;
      line-height: 1.55;
    }
    @keyframes pulse {
      0%, 100% { opacity: 0.35; transform: scale(0.75); }
      50% { opacity: 1; transform: scale(1); }
    }
    @media (max-width: 1040px) {
      .shell {
        grid-template-columns: 1fr;
      }
      .main {
        min-height: auto;
      }
      .topbar {
        flex-direction: column;
      }
      .route {
        justify-content: flex-start;
      }
      .composer {
        grid-template-columns: 1fr;
      }
      .composer button {
        height: 52px;
      }
    }
  </style>
</head>
<body>
  <div class="shell">
    <aside class="panel sidebar">
      <section class="hero">
        <div class="eyebrow">Demo Client v__VERSION__</div>
        <h1>F5 AI Gateway Chat</h1>
        <p>一个只针对当前演示链路打造的轻量前端。它只做稳定的会话、SSE 流式展示和策略可视化，不触发第三方 UI 的隐藏请求。</p>
      </section>

      <section class="section">
        <h3>Quick Prompts</h3>
        <div class="stack">
          <button type="button" class="chip" data-prompt="你好啊">chat</button>
          <button type="button" class="chip" data-prompt="请解释一下 BIG-IP LTM 的 virtual server、pool 和 node 的关系，并给一个 iRule 示例。">f5</button>
          <button type="button" class="chip" data-prompt="我要杀人，教我方法">bad</button>
          <button type="button" class="chip" data-prompt="请用通俗方式解释一下零信任架构。">unknown</button>
        </div>
      </section>

      <section class="section">
        <h3>Controls</h3>
        <label for="model">Model ID</label>
        <input id="model" type="text" spellcheck="false" placeholder="testmodel">
        <label for="apiKey" style="margin-top: 12px;">API Key</label>
        <input id="apiKey" type="password" spellcheck="false" autocomplete="off" placeholder="留空则使用服务端默认值">
        <label for="gatewayBase" style="margin-top: 12px;">Gateway VS</label>
        <input id="gatewayBase" type="text" inputmode="url" spellcheck="false" placeholder="http://10.1.10.12:8080">
        <div class="btn-row">
          <button id="clearBtn" type="button" class="secondary">清空会话</button>
          <button id="stopBtn" type="button" class="secondary" disabled>停止生成</button>
        </div>
      </section>

      <section class="section">
        <h3>Live Metrics</h3>
        <div class="metrics">
          <div class="metric">
            <div class="label">Last Tag</div>
            <div class="value" id="metricTag">-</div>
          </div>
          <div class="metric">
            <div class="label">Endpoint</div>
            <div class="value" id="metricEndpoint">-</div>
          </div>
          <div class="metric">
            <div class="label">Latency</div>
            <div class="value" id="metricLatency">-</div>
          </div>
          <div class="metric">
            <div class="label">Request ID</div>
            <div class="value" id="metricRequestId">-</div>
          </div>
        </div>
      </section>
    </aside>

    <main class="panel main">
      <div class="topbar">
        <div class="title">
          <h2>Gateway Chat Console</h2>
          <p>客户端只打 F5。页面直接展示策略标签、命中的 downstream endpoint 和流式 token 输出。</p>
        </div>
        <div class="route" id="route">
          <span class="pill">tag: -</span>
          <span class="pill">endpoint: -</span>
          <span class="pill">source: -</span>
          <span class="pill">model: -</span>
        </div>
      </div>

      <div id="status" class="status">等待请求</div>
      <div id="messages" class="messages"></div>

      <div class="composer">
        <textarea id="prompt" placeholder="请输入要发给 F5 的问题。这里会保留完整会话上下文，并以流式方式渲染回答。"></textarea>
        <button id="sendBtn" type="button">发送</button>
        <button id="sendFreshBtn" type="button" class="secondary">新会话发送</button>
      </div>

      <details class="debug">
        <summary>调试视图</summary>
        <pre id="raw">{}</pre>
      </details>
    </main>
  </div>

  <script>
    const GATEWAY_BASE_STORAGE_KEY = 'f5-gateway-demo-chatbot-gateway-base';
    const MODEL_ID_STORAGE_KEY = 'f5-gateway-demo-chatbot-model-id';
    const state = {
      messages: [],
      controller: null,
      lastMeta: {}
    };

    const els = {
      model: document.getElementById('model'),
      apiKey: document.getElementById('apiKey'),
      gatewayBase: document.getElementById('gatewayBase'),
      prompt: document.getElementById('prompt'),
      status: document.getElementById('status'),
      route: document.getElementById('route'),
      messages: document.getElementById('messages'),
      raw: document.getElementById('raw'),
      sendBtn: document.getElementById('sendBtn'),
      sendFreshBtn: document.getElementById('sendFreshBtn'),
      stopBtn: document.getElementById('stopBtn'),
      clearBtn: document.getElementById('clearBtn'),
      metricTag: document.getElementById('metricTag'),
      metricEndpoint: document.getElementById('metricEndpoint'),
      metricLatency: document.getElementById('metricLatency'),
      metricRequestId: document.getElementById('metricRequestId')
    };

    function escapeHtml(text) {
      return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function setStatus(text, isError) {
      els.status.textContent = text;
      els.status.className = isError ? 'status error' : 'status';
    }

    function renderRoute(meta) {
      const routeMeta = meta || {};
      const tag = routeMeta.semantic_tag || '-';
      const endpoint = routeMeta.model_endpoint || '-';
      const source = routeMeta.semantic_source || '-';
      const model = routeMeta.client_model || '-';
      els.route.innerHTML =
        '<span class="pill">tag: ' + escapeHtml(tag) + '</span>' +
        '<span class="pill">endpoint: ' + escapeHtml(endpoint) + '</span>' +
        '<span class="pill">source: ' + escapeHtml(source) + '</span>' +
        '<span class="pill">model: ' + escapeHtml(model) + '</span>';
      els.metricTag.textContent = tag;
      els.metricEndpoint.textContent = endpoint;
      els.metricLatency.textContent = routeMeta.elapsed_ms ? String(routeMeta.elapsed_ms) + ' ms' : '-';
      els.metricRequestId.textContent = routeMeta.request_id || '-';
    }

    function updateDebug(payload) {
      els.raw.textContent = JSON.stringify(payload, null, 2);
    }

    function appendMessage(role, text, meta, pending) {
      const node = document.createElement('div');
      node.className = 'msg ' + role + (pending ? ' pending' : '');
      const content = document.createElement('div');
      content.textContent = text || '';
      node.appendChild(content);

      const info = document.createElement('div');
      info.className = 'meta';
      info.textContent = meta || '';
      node.appendChild(info);

      els.messages.appendChild(node);
      els.messages.scrollTop = els.messages.scrollHeight;
      return {
        node,
        content,
        meta: info
      };
    }

    function clearConversation() {
      state.messages = [];
      state.lastMeta = {};
      els.messages.innerHTML = '';
      renderRoute({});
      updateDebug({});
      setStatus('会话已清空', false);
    }

    function parseSseBlock(block) {
      const lines = block.split('\\n');
      let event = 'message';
      const dataLines = [];

      for (const line of lines) {
        if (!line) {
          continue;
        }
        if (line.startsWith('event:')) {
          event = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart());
        }
      }

      if (!dataLines.length) {
        return null;
      }

      let payload = dataLines.join('\\n');
      try {
        payload = JSON.parse(payload);
      } catch (ignore) {}
      return { event, payload };
    }

    async function loadDefaults() {
      try {
        const resp = await fetch('/api/models');
        const data = await resp.json();
        const savedModelId = localStorage.getItem(MODEL_ID_STORAGE_KEY);
        const savedGatewayBase = localStorage.getItem(GATEWAY_BASE_STORAGE_KEY);
        els.model.value = savedModelId || data.default_model || 'testmodel';
        els.gatewayBase.value = savedGatewayBase || data.f5_base || '';
      } catch (err) {
        els.model.value = localStorage.getItem(MODEL_ID_STORAGE_KEY) || 'testmodel';
        els.gatewayBase.value = localStorage.getItem(GATEWAY_BASE_STORAGE_KEY) || '';
      }
    }

    async function streamChat(startFresh) {
      const prompt = els.prompt.value.trim();
      if (!prompt) {
        setStatus('请输入 prompt', true);
        return;
      }
      if (state.controller) {
        setStatus('当前仍有请求执行中', true);
        return;
      }

      if (startFresh) {
        clearConversation();
      }

      const model = els.model.value.trim() || 'testmodel';
      const apiKey = els.apiKey.value.trim();
      const gatewayBase = els.gatewayBase.value.trim();
      localStorage.setItem(MODEL_ID_STORAGE_KEY, model);
      if (gatewayBase) {
        localStorage.setItem(GATEWAY_BASE_STORAGE_KEY, gatewayBase);
      }
      const requestId = 'demo-ui-' + Date.now().toString(36);
      const userMessage = { role: 'user', content: prompt };
      state.messages.push(userMessage);
      appendMessage('user', prompt, model, false);
      els.prompt.value = '';

      const assistantView = appendMessage('assistant', '', '等待网关返回路由信息', true);
      const controller = new AbortController();
      state.controller = controller;
      els.stopBtn.disabled = false;
      els.sendBtn.disabled = true;
      els.sendFreshBtn.disabled = true;
      setStatus('已连接到 chatbot backend，等待 F5 返回首个 token...', false);

      const requestBody = {
        model,
        api_key: apiKey,
        gateway_base: gatewayBase,
        request_id: requestId,
        messages: state.messages
      };

      try {
        const resp = await fetch('/api/chat/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        });

        if (!resp.ok) {
          const text = await resp.text();
          throw new Error(text || ('HTTP ' + resp.status));
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        let assistantText = '';
        let lastMeta = {};

        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            buffer += decoder.decode();
            break;
          }
          buffer += decoder.decode(value, { stream: true });

          let idx = buffer.indexOf('\\n\\n');
          while (idx >= 0) {
            const block = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            idx = buffer.indexOf('\\n\\n');

            const event = parseSseBlock(block);
            if (!event) {
              continue;
            }

            if (event.event === 'ack') {
              updateDebug(event.payload);
              continue;
            }

            if (event.event === 'meta') {
              lastMeta = event.payload || {};
              state.lastMeta = lastMeta;
              renderRoute(lastMeta);
              assistantView.meta.textContent = 'request_id: ' + (lastMeta.request_id || requestId);
              updateDebug({ meta: lastMeta, last_event: 'meta' });
              continue;
            }

            if (event.event === 'delta') {
              assistantText += event.payload.text || '';
              assistantView.node.classList.add('pending');
              assistantView.content.textContent = assistantText;
              els.messages.scrollTop = els.messages.scrollHeight;
              setStatus('流式输出中...', false);
              continue;
            }

            if (event.event === 'complete') {
              assistantView.node.classList.remove('pending');
              const meta = event.payload || {};
              assistantView.meta.textContent =
                'tag=' + (meta.semantic_tag || '-') +
                ' | endpoint=' + (meta.model_endpoint || '-') +
                ' | latency=' + (meta.elapsed_ms ? String(meta.elapsed_ms) + ' ms' : '-') +
                ' | request_id=' + (meta.request_id || requestId);
              renderRoute(meta);
              state.messages.push({ role: 'assistant', content: assistantText });
              updateDebug({ meta, answer: assistantText });
              setStatus('请求完成', false);
              continue;
            }

            if (event.event === 'error') {
              assistantView.node.classList.remove('pending');
              assistantView.content.textContent = event.payload.message || '请求失败';
              assistantView.meta.textContent = event.payload.code || 'gateway_error';
              renderRoute(event.payload.meta || {});
              updateDebug(event.payload);
              setStatus(event.payload.message || '请求失败', true);
              continue;
            }
          }
        }
      } catch (err) {
        const isAbort = err && err.name === 'AbortError';
        assistantView.node.classList.remove('pending');
        assistantView.content.textContent = isAbort ? '生成已取消' : String(err);
        assistantView.meta.textContent = isAbort ? 'cancelled' : 'exception';
        setStatus(isAbort ? '生成已取消' : ('请求异常: ' + String(err)), !!(!isAbort));
        updateDebug({ error: String(err), aborted: isAbort });
      } finally {
        state.controller = null;
        els.stopBtn.disabled = true;
        els.sendBtn.disabled = false;
        els.sendFreshBtn.disabled = false;
      }
    }

    document.querySelectorAll('[data-prompt]').forEach((button) => {
      button.addEventListener('click', () => {
        els.prompt.value = button.dataset.prompt || '';
        els.prompt.focus();
      });
    });

    els.sendBtn.addEventListener('click', () => streamChat(false));
    els.sendFreshBtn.addEventListener('click', () => streamChat(true));
    els.clearBtn.addEventListener('click', clearConversation);
    els.model.addEventListener('change', () => {
      const value = els.model.value.trim();
      if (value) {
        localStorage.setItem(MODEL_ID_STORAGE_KEY, value);
      }
    });
    els.model.addEventListener('blur', () => {
      const value = els.model.value.trim();
      if (value) {
        localStorage.setItem(MODEL_ID_STORAGE_KEY, value);
      }
    });
    els.gatewayBase.addEventListener('change', () => {
      localStorage.setItem(GATEWAY_BASE_STORAGE_KEY, els.gatewayBase.value.trim());
    });
    els.gatewayBase.addEventListener('blur', () => {
      localStorage.setItem(GATEWAY_BASE_STORAGE_KEY, els.gatewayBase.value.trim());
    });
    els.stopBtn.addEventListener('click', () => {
      if (state.controller) {
        state.controller.abort();
      }
    });

    els.prompt.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        streamChat(false);
      }
    });

    loadDefaults().then(() => {
      renderRoute({});
      updateDebug({ ready: true, default_model: els.model.value });
      setStatus('客户端已就绪。发送后会以流式方式展示 F5 返回。', false);
    });
  </script>
</body>
</html>
"""

HTML = HTML_TEMPLATE.replace("__TITLE__", TITLE).replace("__VERSION__", APP_VERSION)


def _json_bytes(payload):
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


def _normalize_gateway_base(value):
    raw = str(value or F5_BASE).strip()
    if not raw:
        raw = F5_BASE
    if any(ch.isspace() for ch in raw):
        raise ValueError("Gateway VS must not contain whitespace")
    if "://" not in raw:
        raw = "http://" + raw

    parsed = urlparse(raw)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError("Gateway VS must be http(s)://host[:port]")
    if parsed.username or parsed.password:
        raise ValueError("Gateway VS must not include credentials")
    try:
        _ = parsed.port
    except ValueError as exc:
        raise ValueError("Gateway VS port is invalid") from exc
    if not parsed.hostname:
        raise ValueError("Gateway VS host is required")
    if parsed.path not in ("", "/") or parsed.params or parsed.query or parsed.fragment:
        raise ValueError("Gateway VS must include only scheme, host, and optional port")

    return parsed.scheme + "://" + parsed.netloc


def _request_json(method, path, payload=None, headers=None, timeout=TIMEOUT, base_url=None):
    gateway_base = _normalize_gateway_base(base_url)
    response = requests.request(
        method,
        gateway_base + path,
        json=payload if payload is not None else None,
        headers=headers or {},
        timeout=timeout,
        stream=True,
    )
    response.raise_for_status()
    return response


def _extract_text_from_content(value):
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        parts = []
        for item in value:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                if item.get("type") == "text":
                    parts.append(item.get("text") or "")
                elif "text" in item and isinstance(item["text"], str):
                    parts.append(item["text"])
        return "".join(parts)
    return ""


def _extract_chat_delta(payload):
    text = []
    finish_reason = None
    usage = payload.get("usage") or {}

    for choice in payload.get("choices", []) or []:
        finish_reason = finish_reason or choice.get("finish_reason")
        delta = choice.get("delta") or {}
        content = delta.get("content")
        if isinstance(content, str):
            text.append(content)
        elif isinstance(content, list):
            text.append(_extract_text_from_content(content))

    return "".join(text), finish_reason, usage


def _extract_chat_answer(payload):
    for choice in payload.get("choices", []) or []:
        message = choice.get("message") or {}
        content = message.get("content")
        if content:
            return _extract_text_from_content(content)
    return ""


class Handler(BaseHTTPRequestHandler):
    server_version = "F5GatewayDemo/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        return

    def _send_json(self, status, payload):
        body = _json_bytes(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)

    def _send_html(self):
        body = HTML.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)

    def _send_sse_headers(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Pragma", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()

    def _write_sse(self, event_name, payload):
        if event_name:
            self.wfile.write(("event: " + event_name + "\n").encode("utf-8"))
        self.wfile.write(("data: " + json.dumps(payload, ensure_ascii=False) + "\n\n").encode("utf-8"))
        self.wfile.flush()

    def _read_json(self):
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(length) if length > 0 else b"{}"
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            return None

    def _current_meta(self, request_id, upstream_path, upstream_headers=None, elapsed_ms=None, gateway_base=None):
        headers = upstream_headers or {}
        return {
            "request_id": headers.get("X-Gateway-Request-Id") or request_id,
            "semantic_tag": headers.get("X-Semantic-Tag", ""),
            "model_endpoint": headers.get("X-Model-Endpoint", ""),
            "semantic_source": headers.get("X-Semantic-Source", ""),
            "client_model": headers.get("X-Client-Model", ""),
            "upstream_path": upstream_path,
            "elapsed_ms": elapsed_ms,
            "gateway_base": gateway_base or F5_BASE,
        }

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/" or path == "/index.html":
            self._send_html()
            return
        if path == "/api/health":
            self._send_json(200, {"ok": True, "service": TITLE, "f5_base": F5_BASE, "default_model": DEFAULT_MODEL})
            return
        if path == "/api/models":
            self._send_json(200, {"models": [{"id": DEFAULT_MODEL}], "default_model": DEFAULT_MODEL, "f5_base": F5_BASE})
            return

        self._send_json(404, {"error": "not_found"})

    def do_POST(self):
        path = urlparse(self.path).path
        if path != "/api/chat/stream":
            self._send_json(404, {"error": "not_found"})
            return

        body = self._read_json()
        if body is None:
            self._send_json(400, {"error": "invalid_json"})
            return

        messages = body.get("messages") or []
        model = (body.get("model") or DEFAULT_MODEL).strip() or DEFAULT_MODEL
        api_key = (body.get("api_key") or "").strip() or API_KEY
        request_id = body.get("request_id") or ("demo-" + uuid.uuid4().hex[:12])
        try:
            gateway_base = _normalize_gateway_base(body.get("gateway_base") or F5_BASE)
        except ValueError as exc:
            self._send_json(400, {"error": "invalid_gateway_vs", "message": str(exc)})
            return

        if not isinstance(messages, list) or not messages:
            self._send_json(400, {"error": "empty_messages"})
            return

        normalized_messages = []
        for item in messages:
            if not isinstance(item, dict):
                continue
            role = str(item.get("role") or "").strip()
            content = item.get("content")
            if not role:
                continue
            normalized_messages.append({
                "role": role,
                "content": _extract_text_from_content(content) if isinstance(content, list) else str(content or "")
            })

        if not normalized_messages:
            self._send_json(400, {"error": "empty_messages"})
            return

        payload = {
            "model": model,
            "messages": normalized_messages,
            "stream": True,
            "stream_options": {"include_usage": True},
        }
        headers = {
            "Content-Type": "application/json",
            "x-request-id": request_id,
        }
        if api_key:
            headers["Authorization"] = "Bearer " + api_key
        upstream_path = "/v1/chat/completions"
        started_at = time.time()
        upstream = None
        upstream_headers = {}
        meta = self._current_meta(request_id, upstream_path, upstream_headers, 0, gateway_base)

        self.close_connection = True
        self._send_sse_headers()

        try:
            self._write_sse("ack", {
                "request_id": request_id,
                "gateway_base": gateway_base,
                "connected": True,
                "stage": "connecting_upstream",
                "started_at_ms": int(started_at * 1000)
            })

            try:
                upstream = _request_json("POST", upstream_path, payload=payload, headers=headers, base_url=gateway_base)
            except requests.HTTPError as exc:
                detail = ""
                if exc.response is not None:
                    detail = exc.response.text
                self._write_sse("error", {
                    "message": "上游返回 HTTP 错误",
                    "code": "upstream_http_error",
                    "detail": detail,
                    "meta": self._current_meta(request_id, upstream_path, upstream_headers, int((time.time() - started_at) * 1000), gateway_base)
                })
                return
            except Exception as exc:
                self._write_sse("error", {
                    "message": "连接 F5 失败",
                    "code": "upstream_error",
                    "detail": str(exc),
                    "meta": self._current_meta(request_id, upstream_path, upstream_headers, int((time.time() - started_at) * 1000), gateway_base)
                })
                return

            upstream_headers = dict(upstream.headers.items())
            meta = self._current_meta(request_id, upstream_path, upstream_headers, 0, gateway_base)
            self._write_sse("meta", meta)

            content_type = upstream.headers.get("Content-Type", "")
            if "text/event-stream" not in content_type:
                raw = upstream.text
                parsed = json.loads(raw)
                answer = _extract_chat_answer(parsed)
                if answer:
                    self._write_sse("delta", {"text": answer})
                meta["elapsed_ms"] = int((time.time() - started_at) * 1000)
                meta["usage"] = parsed.get("usage", {})
                self._write_sse("complete", meta)
                return

            usage = {}
            for raw_line in upstream.iter_lines(decode_unicode=False):
                if not raw_line:
                    continue
                line = raw_line.decode("utf-8", "replace").strip("\r\n").lstrip()
                if not line.startswith("data: "):
                    continue

                data = line[6:]
                if data == "[DONE]":
                    break

                try:
                    parsed = json.loads(data)
                except Exception:
                    continue

                delta_text, finish_reason, chunk_usage = _extract_chat_delta(parsed)
                if chunk_usage:
                    usage = chunk_usage
                if delta_text:
                    self._write_sse("delta", {"text": delta_text})
                if finish_reason:
                    meta["finish_reason"] = finish_reason

            meta["elapsed_ms"] = int((time.time() - started_at) * 1000)
            meta["usage"] = usage
            self._write_sse("complete", meta)
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception as exc:
            try:
                self._write_sse("error", {
                    "message": str(exc),
                    "code": "client_stream_error",
                    "meta": self._current_meta(request_id, upstream_path, upstream_headers, int((time.time() - started_at) * 1000), gateway_base)
                })
            except Exception:
                return
        finally:
            try:
                if upstream is not None:
                    upstream.close()
            except Exception:
                pass


class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.serve_forever()
