"use strict";

var http = require("http");
var https = require("https");

function TestBackendWorker() {
    this.WORKER_URI_PATH = "iapps/AITrafficOrchestrator/test-backend";
    this.isPublic = true;
    this.isPassThrough = true;
}

function bufferFromBase64(value) {
    if (typeof Buffer.from === "function") {
        return Buffer.from(value, "base64");
    }
    return new Buffer(value, "base64");
}

function readRequestBody(restOperation) {
    var body = typeof restOperation.getBody === "function" ? restOperation.getBody() : null;
    if (typeof body === "string") {
        body = JSON.parse(body);
    }

    if (body && body.encoding === "base64-json-v1" && typeof body.payload === "string") {
        return JSON.parse(bufferFromBase64(body.payload).toString("utf8"));
    }

    return body || {};
}

function writeJson(restOperation, statusCode, payload) {
    if (typeof restOperation.setHeaders === "function") {
        restOperation.setHeaders({
            "Content-Type": "application/json; charset=UTF-8"
        });
    }
    restOperation.setStatusCode(statusCode);
    restOperation.setBody(payload);
    if (typeof this.completeRestOperation === "function") {
        this.completeRestOperation(restOperation);
    } else if (typeof restOperation.complete === "function") {
        restOperation.complete();
    }
}

function parseEndpointUrl(endpointUrl) {
    var original = String(endpointUrl || "").trim();
    var protocol = "https";
    var remainder = original;
    var slashIndex;
    var hostPort;
    var colonIndex;
    var pathValue = "/v1/chat/completions";

    if (remainder.indexOf("http://") === 0) {
        protocol = "http";
        remainder = remainder.slice(7);
    } else if (remainder.indexOf("https://") === 0) {
        protocol = "https";
        remainder = remainder.slice(8);
    }

    slashIndex = remainder.indexOf("/");
    hostPort = slashIndex >= 0 ? remainder.slice(0, slashIndex) : remainder;
    if (slashIndex >= 0) {
        pathValue = remainder.slice(slashIndex) || pathValue;
    }

    colonIndex = hostPort.lastIndexOf(":");
    return {
        protocol: protocol,
        hostname: colonIndex > 0 ? hostPort.slice(0, colonIndex) : hostPort,
        port: Number(colonIndex > 0 ? hostPort.slice(colonIndex + 1) : (protocol === "http" ? 80 : 443)),
        path: pathValue
    };
}

function parseProviderErrorBody(rawBody) {
    var parsed;
    var message;

    try {
        parsed = JSON.parse(rawBody || "{}");
    } catch (ignore) {
        return String(rawBody || "").trim();
    }

    if (parsed && parsed.error) {
        if (typeof parsed.error === "string") {
            message = parsed.error;
        } else {
            message = parsed.error.message || parsed.error.code || parsed.error.type;
        }
    }

    return message || parsed.message || parsed.detail || String(rawBody || "").trim();
}

function resolveApiKey(backend) {
    return String(backend.api_key || backend.apiKey || "").trim();
}

function normalizeTextValue(value) {
    if (!value) {
        return "";
    }
    if (typeof value === "string") {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map(normalizeTextValue).join("");
    }
    if (typeof value === "object") {
        var text;
        if (typeof value.text === "string") {
            text = value.text;
            if (text.trim()) {
                return text;
            }
        }
        if (typeof value.output_text === "string") {
            text = value.output_text;
            if (text.trim()) {
                return text;
            }
        }
        if (typeof value.content === "string" || Array.isArray(value.content) || (value.content && typeof value.content === "object")) {
            text = normalizeTextValue(value.content);
            if (text.trim()) {
                return text;
            }
        }
        if (typeof value.reasoning_content === "string") {
            return value.reasoning_content;
        }
        if (typeof value.message === "string" || (value.message && typeof value.message === "object")) {
            text = normalizeTextValue(value.message);
            if (text.trim()) {
                return text;
            }
        }
    }
    return "";
}

function extractOutputText(outputItems) {
    var index;
    var text;

    if (!Array.isArray(outputItems)) {
        return "";
    }

    for (index = 0; index < outputItems.length; index += 1) {
        text = normalizeTextValue(outputItems[index]);
        if (text.trim()) {
            return text.trim();
        }
    }

    return "";
}

function extractAssistantText(parsed) {
    var choice = parsed && parsed.choices && parsed.choices[0];
    var text;

    text = normalizeTextValue(parsed && parsed.output_text);
    if (text.trim()) {
        return text.trim();
    }
    text = extractOutputText(parsed && parsed.output);
    if (text.trim()) {
        return text.trim();
    }
    text = normalizeTextValue(parsed && parsed.message);
    if (text.trim()) {
        return text.trim();
    }
    text = normalizeTextValue(parsed && parsed.response);
    if (text.trim()) {
        return text.trim();
    }
    if (choice && choice.message) {
        text = normalizeTextValue(choice.message.content);
        if (text.trim()) {
            return text.trim();
        }
        text = normalizeTextValue(choice.message.reasoning_content);
        if (text.trim()) {
            return text.trim();
        }
    }
    if (choice && choice.delta) {
        text = normalizeTextValue(choice.delta.content);
        if (text.trim()) {
            return text.trim();
        }
    }
    text = normalizeTextValue(choice && choice.text);
    if (text.trim()) {
        return text.trim();
    }
    return "";
}

function buildRequest(backend, apiKey) {
    var endpoint = parseEndpointUrl(backend.endpoint_url || backend.endpointUrl || "");
    var schema = backend.schema_family || backend.schemaFamily || "";
    var modelId = backend.model_id || backend.modelId || "";
    var body;
    var bodyString;
    var headers;

    if (!endpoint.hostname) {
        return {
            supported: false,
            reason: "Endpoint URL is missing or invalid."
        };
    }
    if (!modelId) {
        return {
            supported: false,
            reason: "Model ID is required."
        };
    }
    if (schema && schema !== "openai_chat_compatible") {
        return {
            supported: false,
            reason: "Unsupported backend schema family: " + schema
        };
    }

    body = {
        model: modelId,
        stream: false,
        temperature: 0,
        max_tokens: 128,
        messages: [
            {
                role: "user",
                content: "你好"
            }
        ]
    };

    bodyString = JSON.stringify(body);
    headers = {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(bodyString),
        "Connection": "close"
    };
    if (apiKey) {
        headers.Authorization = "Bearer " + apiKey;
    }

    return {
        supported: true,
        protocol: endpoint.protocol === "http" ? "http:" : "https:",
        hostname: endpoint.hostname,
        port: endpoint.port,
        path: endpoint.path,
        method: "POST",
        timeout: 10000,
        headers: headers,
        body: bodyString
    };
}

function dispatch(requestDescriptor, callback) {
    var transport = requestDescriptor.protocol === "http:" ? http : https;
    var completed = false;
    var request;

    function finish(error, raw) {
        if (completed) {
            return;
        }
        completed = true;
        callback(error, raw);
    }

    request = transport.request({
        protocol: requestDescriptor.protocol,
        hostname: requestDescriptor.hostname,
        port: requestDescriptor.port,
        path: requestDescriptor.path,
        method: requestDescriptor.method,
        headers: requestDescriptor.headers,
        timeout: requestDescriptor.timeout
    }, function (response) {
        var raw = "";
        response.on("data", function (chunk) {
            raw += chunk;
        });
        response.on("end", function () {
            if (response.statusCode >= 400) {
                finish({
                    message: "Backend endpoint returned HTTP " + response.statusCode + ": " + parseProviderErrorBody(raw),
                    status_code: response.statusCode,
                    provider_message: parseProviderErrorBody(raw),
                    raw: raw.slice(0, 480)
                });
                return;
            }
            finish(null, raw);
        });
    });

    request.on("error", function (error) {
        finish({
            message: error.message
        });
    });
    request.on("timeout", function () {
        request.destroy();
        finish({
            message: "Backend model probe timeout."
        });
    });
    request.write(requestDescriptor.body);
    request.end();
}

TestBackendWorker.prototype.onPost = function(restOperation) {
    var startedAt = Date.now();
    var body;
    var backend;
    var apiKey;
    var requestDescriptor;
    var self = this;

    try {
        body = readRequestBody(restOperation);
        backend = body.backend || {};
        apiKey = resolveApiKey(backend);

        if (!apiKey) {
            writeJson.call(self, restOperation, 400, {
                ok: false,
                message: "API Key is required. Paste the API key in the UI; ENV/Secret Ref is not supported."
            });
            return;
        }

        requestDescriptor = buildRequest(backend, apiKey);
        if (!requestDescriptor.supported) {
            writeJson.call(self, restOperation, 400, {
                ok: false,
                message: requestDescriptor.reason
            });
            return;
        }

        dispatch(requestDescriptor, function (error, rawResponse) {
            var parsed;
            var assistantText;

            if (error) {
                writeJson.call(self, restOperation, 502, {
                    ok: false,
                    message: error.message || "Backend model probe failed.",
                    status_code: error.status_code,
                    provider_message: error.provider_message,
                    details: error.raw || ""
                });
                return;
            }

            try {
                parsed = JSON.parse(rawResponse || "{}");
            } catch (parseError) {
                writeJson.call(self, restOperation, 502, {
                    ok: false,
                    message: "Backend endpoint returned non-JSON response.",
                    details: String(rawResponse || "").slice(0, 480)
                });
                return;
            }

            assistantText = extractAssistantText(parsed);
            if (!assistantText) {
                writeJson.call(self, restOperation, 422, {
                    ok: false,
                    message: "Backend endpoint responded but no assistant message was returned.",
                    elapsed_ms: Date.now() - startedAt
                });
                return;
            }

            writeJson.call(self, restOperation, 200, {
                ok: true,
                message: "Backend model responded.",
                backend_name: backend.backend_target_name || backend.backendTargetName || body.backend_id || "",
                elapsed_ms: Date.now() - startedAt
            });
        });
    } catch (error) {
        restOperation.fail(new Error("Test Backend Worker Error: " + error.message));
    }
};

module.exports = TestBackendWorker;
