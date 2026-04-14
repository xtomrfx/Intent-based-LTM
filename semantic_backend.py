#!/usr/bin/env python3
import json
import os
import time
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib import request, error


ROLE = os.environ.get("ROLE", "default")
PORT = int(os.environ.get("PORT", "9003"))
CONFIG_PATH = os.environ.get("ADAPTER_CONFIG_PATH", os.path.join(os.path.dirname(__file__), "adapter-config.json"))
DEFAULT_TIMEOUT = int(os.environ.get("UPSTREAM_TIMEOUT", "45"))


DEFAULT_CONFIG = {
    "provider": {
        "api_base": "https://api.deepseek.com",
        "api_key": "",
        "model": "deepseek-chat",
        "timeout": 45
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
            "system_prompt": "You are an F5 AI gateway demo assistant. Your primary scope is F5 BIG-IP, iRules, LTM, pool, virtual server, monitor, DNS, ASM, APM, GTM, and closely related network or infrastructure topics. When the user asks what you can do, explain that you mainly support F5-related technical questions and gateway demo scenarios. If the request is outside F5, answer briefly and steer the conversation back to F5 or enterprise infrastructure topics. Answer in Chinese unless the user explicitly asks for another language.",
            "max_tokens": 256,
            "temperature": 0.2
        }
    }
}

LOCAL_TAG_RESPONSES = {
    "chat": "工作时间请不要闲聊",
    "bad": "您的请求违规"
}

TAG_PROFILE_MAP = {
    "f5": "f5_expert",
    "unknown": "general_assistant"
}


def load_config():
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH) as handle:
            return json.load(handle)
    return DEFAULT_CONFIG


def get_provider(config):
    provider = config.get("provider", {})
    return {
        "api_base": provider.get("api_base", DEFAULT_CONFIG["provider"]["api_base"]),
        "api_key": provider.get("api_key") or os.environ.get("DEEPSEEK_API_KEY", ""),
        "model": provider.get("model", DEFAULT_CONFIG["provider"]["model"]),
        "timeout": int(provider.get("timeout", DEFAULT_TIMEOUT)),
        "accept_client_model": bool(provider.get("accept_client_model", False)),
        "model_aliases": provider.get("model_aliases", {})
    }


def get_role_settings(config, role_name):
    roles = config.get("roles", {})
    if role_name in roles:
        return roles[role_name]
    return roles.get("default", DEFAULT_CONFIG["roles"]["default"])


def merge_dicts(base, override):
    result = dict(base or {})
    result.update(override or {})
    return result


def get_effective_role_settings(config, role_name, headers):
    settings = get_role_settings(config, role_name)
    profile_name = headers.get("X-Gateway-Profile", "").strip()
    if not profile_name:
        profile_name = TAG_PROFILE_MAP.get(headers.get("X-Semantic-Tag", "").strip().lower(), "")
    gateway_profiles = config.get("gateway_profiles", {})

    if profile_name and profile_name in gateway_profiles:
        settings = merge_dicts(settings, gateway_profiles[profile_name])

    override_prompt = headers.get("X-Gateway-System-Prompt", "").strip()
    if override_prompt:
        settings = merge_dicts(settings, {"system_prompt": override_prompt})

    return settings


def text_from_content(content):
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts = []
        for item in content:
            parts.append(text_from_content(item))
        return " ".join([part for part in parts if part]).strip()
    if isinstance(content, dict):
        if isinstance(content.get("text"), str):
            return content.get("text")
        if isinstance(content.get("content"), str):
            return content.get("content")
        if content.get("type") in ("text", "input_text", "output_text") and isinstance(content.get("text"), str):
            return content.get("text")
        if isinstance(content.get("content"), list):
            return text_from_content(content.get("content"))
    return ""


def normalize_role(role_value):
    if role_value in ("assistant", "system", "tool"):
        return role_value
    return "user"


def messages_from_responses_input(input_value):
    messages = []
    if isinstance(input_value, str):
        text = input_value.strip()
        if text:
            return [{"role": "user", "content": text}]
        return []
    if isinstance(input_value, list):
        for item in input_value:
            if isinstance(item, dict) and item.get("role"):
                messages.append({
                    "role": normalize_role(item.get("role")),
                    "content": text_from_content(item.get("content", item.get("input", "")))
                })
            elif isinstance(item, dict) and item.get("type") == "message":
                messages.append({
                    "role": normalize_role(item.get("role")),
                    "content": text_from_content(item.get("content", ""))
                })
            elif isinstance(item, dict):
                text = text_from_content(item)
                if text:
                    messages.append({"role": "user", "content": text})
            elif isinstance(item, str):
                messages.append({"role": "user", "content": item})
    elif isinstance(input_value, dict):
        text = text_from_content(input_value)
        if text:
            messages.append({"role": "user", "content": text})
    return [msg for msg in messages if msg.get("content")]


def build_messages(endpoint, body, role_settings):
    messages = []
    system_prompt = role_settings.get("system_prompt")
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})

    if endpoint == "chat":
        for item in body.get("messages", []):
            if isinstance(item, dict):
                messages.append({
                    "role": normalize_role(item.get("role")),
                    "content": text_from_content(item.get("content", ""))
                })
    else:
        instructions = body.get("instructions")
        if isinstance(instructions, str) and instructions.strip():
            messages.append({"role": "system", "content": instructions.strip()})
        messages.extend(messages_from_responses_input(body.get("input")))

    return [msg for msg in messages if msg.get("content")]


def resolve_upstream_model(body, provider):
    client_model = body.get("model")
    aliases = provider.get("model_aliases", {})
    if client_model and client_model in aliases:
        return aliases[client_model]
    if client_model and provider.get("accept_client_model"):
        return client_model
    return provider["model"]


def build_upstream_payload(messages, body, provider, role_settings, stream):
    payload = {
        "model": resolve_upstream_model(body, provider),
        "messages": messages,
        "stream": stream,
        "temperature": body.get("temperature", role_settings.get("temperature", 0.2)),
        "max_tokens": body.get("max_tokens", role_settings.get("max_tokens", 256))
    }
    return payload


def has_user_prompt(messages):
    for item in messages:
        if item.get("role") != "system" and item.get("content"):
            return True
    return False


def upstream_request(payload, provider, stream):
    req = request.Request(
        provider["api_base"].rstrip("/") + "/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + provider["api_key"]
        },
        method="POST"
    )
    return request.urlopen(req, timeout=provider["timeout"])


def error_payload(message, error_type, code, detail=None):
    payload = {
        "error": {
            "message": message,
            "type": error_type,
            "param": None,
            "code": code
        }
    }
    if detail:
        payload["error"]["detail"] = detail
    return payload


def chat_response_from_upstream(upstream_json, public_model, provider, demo_meta):
    content = ""
    finish_reason = "stop"
    if upstream_json.get("choices"):
        choice = upstream_json["choices"][0]
        content = choice.get("message", {}).get("content", "")
        finish_reason = choice.get("finish_reason", "stop")
    return {
        "id": upstream_json.get("id", "chatcmpl-" + uuid.uuid4().hex[:24]),
        "object": "chat.completion",
        "created": upstream_json.get("created", int(time.time())),
        "model": public_model,
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": content
                },
                "finish_reason": finish_reason
            }
        ],
        "usage": upstream_json.get("usage", {}),
        "demo": demo_meta
    }


def responses_api_response_from_upstream(upstream_json, public_model, provider, demo_meta):
    content = ""
    if upstream_json.get("choices"):
        content = upstream_json["choices"][0].get("message", {}).get("content", "")
    response_id = "resp_" + uuid.uuid4().hex[:24]
    item_id = "msg_" + uuid.uuid4().hex[:24]
    return {
        "id": response_id,
        "object": "response",
        "created_at": int(time.time()),
        "status": "completed",
        "model": public_model,
        "output": [
            {
                "id": item_id,
                "type": "message",
                "role": "assistant",
                "content": [
                    {
                        "type": "output_text",
                        "text": content,
                        "annotations": []
                    }
                ]
            }
        ],
        "usage": upstream_json.get("usage", {}),
        "demo": demo_meta
    }


def chat_delta_from_chunk(chunk_json):
    choices = chunk_json.get("choices", [])
    if not choices:
        return ""
    delta = choices[0].get("delta", {})
    if isinstance(delta.get("content"), str):
        return delta["content"]
    return ""


def local_chat_stream(message, public_model):
    chunk_id = "chatcmpl-" + uuid.uuid4().hex[:24]
    created = int(time.time())
    return [
        'data: ' + json.dumps({
            "id": chunk_id,
            "object": "chat.completion.chunk",
            "created": created,
            "model": public_model,
            "choices": [{"index": 0, "delta": {"role": "assistant", "content": ""}, "finish_reason": None}]
        }, ensure_ascii=False),
        'data: ' + json.dumps({
            "id": chunk_id,
            "object": "chat.completion.chunk",
            "created": created,
            "model": public_model,
            "choices": [{"index": 0, "delta": {"content": message}, "finish_reason": None}]
        }, ensure_ascii=False),
        'data: ' + json.dumps({
            "id": chunk_id,
            "object": "chat.completion.chunk",
            "created": created,
            "model": public_model,
            "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]
        }, ensure_ascii=False),
        "data: [DONE]"
    ]


def local_responses_stream(message, public_model):
    response_id = "resp_" + uuid.uuid4().hex[:24]
    item_id = "msg_" + uuid.uuid4().hex[:24]
    return [
        'event: response.created',
        'data: ' + json.dumps({
            "type": "response.created",
            "response": {"id": response_id, "object": "response", "model": public_model, "status": "in_progress"}
        }, ensure_ascii=False),
        '',
        'event: response.output_text.delta',
        'data: ' + json.dumps({
            "type": "response.output_text.delta",
            "response_id": response_id,
            "item_id": item_id,
            "output_index": 0,
            "content_index": 0,
            "delta": message
        }, ensure_ascii=False),
        '',
        'event: response.completed',
        'data: ' + json.dumps({
            "type": "response.completed",
            "response": {"id": response_id, "object": "response", "model": public_model, "status": "completed"}
        }, ensure_ascii=False),
        '',
        'data: [DONE]'
    ]


class Handler(BaseHTTPRequestHandler):
    server_version = "SemanticModelAdapter/0.2"

    def _write_json(self, status, body):
        encoded = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def _demo_meta(self, provider, started):
        gateway_profile = self.headers.get("X-Gateway-Profile", "").strip()
        if not gateway_profile:
            gateway_profile = TAG_PROFILE_MAP.get(self.headers.get("X-Semantic-Tag", "").strip().lower(), "")
        return {
            "backend_role": ROLE,
            "adapter_layer": "linux-model-adapter",
            "upstream_model": provider["model"],
            "public_model": self.headers.get("X-Public-Model", ""),
            "gateway_profile": gateway_profile,
            "elapsed_ms": int((time.time() - started) * 1000),
            "semantic_tag": self.headers.get("X-Semantic-Tag", ""),
            "semantic_action": self.headers.get("X-Semantic-Action", ""),
            "semantic_confidence": self.headers.get("X-Semantic-Confidence", ""),
            "semantic_source": self.headers.get("X-Semantic-Source", "")
        }

    def _stream_chat(self, upstream_resp):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        while True:
            line = upstream_resp.readline()
            if not line:
                break
            self.wfile.write(line)
            self.wfile.flush()

    def _stream_local_lines(self, lines):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()
        for line in lines:
            self.wfile.write((line + "\n").encode("utf-8"))
            if line:
                self.wfile.write(b"\n")
        self.wfile.flush()

    def _stream_responses(self, upstream_resp, provider):
        response_id = "resp_" + uuid.uuid4().hex[:24]
        item_id = "msg_" + uuid.uuid4().hex[:24]
        public_model = self.headers.get("X-Public-Model", provider["model"])
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()

        created = {
            "type": "response.created",
            "response": {
                "id": response_id,
                "object": "response",
                "model": public_model,
                "status": "in_progress"
            }
        }
        self.wfile.write(("event: response.created\n" + "data: " + json.dumps(created) + "\n\n").encode("utf-8"))
        self.wfile.flush()

        while True:
            line = upstream_resp.readline()
            if not line:
                break
            decoded = line.decode("utf-8", "ignore").strip()
            if not decoded:
                continue
            if decoded == "data: [DONE]":
                completed = {
                    "type": "response.completed",
                    "response": {
                        "id": response_id,
                        "object": "response",
                        "model": public_model,
                        "status": "completed"
                    }
                }
                self.wfile.write(("event: response.completed\n" + "data: " + json.dumps(completed) + "\n\n").encode("utf-8"))
                self.wfile.write(b"data: [DONE]\n\n")
                self.wfile.flush()
                break
            if not decoded.startswith("data: "):
                continue
            try:
                chunk_json = json.loads(decoded[6:])
            except Exception:
                continue
            delta = chat_delta_from_chunk(chunk_json)
            if delta:
                event = {
                    "type": "response.output_text.delta",
                    "response_id": response_id,
                    "item_id": item_id,
                    "output_index": 0,
                    "content_index": 0,
                    "delta": delta
                }
                self.wfile.write(("event: response.output_text.delta\n" + "data: " + json.dumps(event) + "\n\n").encode("utf-8"))
                self.wfile.flush()

    def _handle_model_call(self, endpoint):
        config = load_config()
        provider = get_provider(config)
        role_settings = get_effective_role_settings(config, ROLE, self.headers)
        started = time.time()

        if not provider["api_key"]:
            self._write_json(500, error_payload("Upstream API key is not configured.", "adapter_error", "missing_api_key"))
            return

        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length > 0 else b"{}"
        try:
            body = json.loads(raw.decode("utf-8"))
        except Exception:
            self._write_json(400, error_payload("Request body is not valid JSON.", "invalid_request_error", "invalid_json"))
            return

        stream = bool(body.get("stream"))
        messages = build_messages(endpoint, body, role_settings)
        public_model = self.headers.get("X-Public-Model") or body.get("model") or provider["model"]
        semantic_tag = self.headers.get("X-Semantic-Tag", "").strip().lower()
        if not has_user_prompt(messages):
            self._write_json(400, error_payload("No usable prompt content found in the request.", "invalid_request_error", "empty_prompt"))
            return

        if semantic_tag in LOCAL_TAG_RESPONSES:
            local_message = LOCAL_TAG_RESPONSES[semantic_tag]
            demo_meta = self._demo_meta(provider, started)
            if stream:
                if endpoint == "chat":
                    self._stream_local_lines(local_chat_stream(local_message, public_model))
                else:
                    self._stream_local_lines(local_responses_stream(local_message, public_model))
                return
            if endpoint == "chat":
                self._write_json(200, {
                    "id": "chatcmpl-" + uuid.uuid4().hex[:24],
                    "object": "chat.completion",
                    "created": int(time.time()),
                    "model": public_model,
                    "choices": [{
                        "index": 0,
                        "message": {"role": "assistant", "content": local_message},
                        "finish_reason": "stop"
                    }],
                    "usage": {},
                    "demo": demo_meta
                })
            else:
                self._write_json(200, {
                    "id": "resp_" + uuid.uuid4().hex[:24],
                    "object": "response",
                    "created_at": int(time.time()),
                    "status": "completed",
                    "model": public_model,
                    "output": [{
                        "id": "msg_" + uuid.uuid4().hex[:24],
                        "type": "message",
                        "role": "assistant",
                        "content": [{
                            "type": "output_text",
                            "text": local_message,
                            "annotations": []
                        }]
                    }],
                    "usage": {},
                    "demo": demo_meta
                })
            return

        payload = build_upstream_payload(messages, body, provider, role_settings, stream)

        try:
            upstream_resp = upstream_request(payload, provider, stream)
            if stream:
                if endpoint == "chat":
                    self._stream_chat(upstream_resp)
                else:
                    self._stream_responses(upstream_resp, provider)
                return

            upstream_json = json.loads(upstream_resp.read().decode("utf-8"))
            demo_meta = self._demo_meta(provider, started)
            if endpoint == "chat":
                self._write_json(200, chat_response_from_upstream(upstream_json, public_model, provider, demo_meta))
            else:
                self._write_json(200, responses_api_response_from_upstream(upstream_json, public_model, provider, demo_meta))
        except error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "ignore")
            self._write_json(exc.code, error_payload("Upstream model returned an error.", "upstream_http_error", "upstream_http_error", detail))
        except Exception as exc:
            self._write_json(502, error_payload("Failed to reach upstream model.", "upstream_error", "upstream_error", str(exc)))

    def do_GET(self):
        if self.path == "/health":
            self._write_json(200, {"status": "ok", "role": ROLE, "port": PORT, "config": CONFIG_PATH})
            return
        self._write_json(404, error_payload("Resource not found.", "not_found_error", "not_found"))

    def do_POST(self):
        if self.path == "/v1/chat/completions":
            self._handle_model_call("chat")
            return
        if self.path == "/v1/responses":
            self._handle_model_call("responses")
            return
        self._write_json(404, error_payload("Resource not found.", "not_found_error", "not_found"))

    def log_message(self, fmt, *args):
        return


if __name__ == "__main__":
    HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
