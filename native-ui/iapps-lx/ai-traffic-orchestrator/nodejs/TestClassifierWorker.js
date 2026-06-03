"use strict";

var http = require("http");
var https = require("https");

function TestClassifierWorker() {
    this.WORKER_URI_PATH = "iapps/AITrafficOrchestrator/test-classifier";
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
    var pathValue = "/chat/completions";

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

function normalizeTags(tags) {
    var result = [];
    var seen = {};
    var index;
    var tag;

    for (index = 0; index < (tags || []).length; index += 1) {
        tag = String(tags[index] || "").trim().toLowerCase();
        if (!tag || seen[tag]) {
            continue;
        }
        seen[tag] = true;
        result.push(tag);
    }

    return result.length ? result : ["unknown"];
}

function normalizeTag(tag, candidateTags, fallbackTag) {
    var normalized = String(tag || "").trim().toLowerCase();
    var fallback = String(fallbackTag || "unknown").trim().toLowerCase();
    if (candidateTags.indexOf(normalized) >= 0) {
        return normalized;
    }
    if (candidateTags.indexOf(fallback) >= 0) {
        return fallback;
    }
    return candidateTags[0] || "unknown";
}

function extractModelText(content) {
    var parsed;
    var match;
    var trimmed;
    var jsonStart;
    var jsonEnd;

    if (!content) {
        return null;
    }

    if (typeof content === "object") {
        return normalizeModelResult(content);
    }

    if (typeof content !== "string") {
        return null;
    }

    trimmed = content.trim();
    if (trimmed.indexOf("```") === 0) {
        trimmed = trimmed.replace(/^```[a-zA-Z]*\s*/, "").replace(/\s*```$/, "").trim();
    }

    parsed = parseJsonCandidate(trimmed);
    if (parsed) {
        return parsed;
    }

    jsonStart = trimmed.indexOf("{");
    jsonEnd = trimmed.lastIndexOf("}");
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
        parsed = parseJsonCandidate(trimmed.slice(jsonStart, jsonEnd + 1));
        if (parsed) {
            return parsed;
        }
    }

    match = trimmed.match(/"(tag|category|label)"\s*:\s*"([^"]+)"/i);
    if (match && match[2]) {
        return { tag: match[2] };
    }

    return null;
}

function getCaseInsensitiveValue(object, names) {
    var keys;
    var index;
    var lookup;

    if (!object || typeof object !== "object") {
        return undefined;
    }

    keys = Object.keys(object);
    for (index = 0; index < keys.length; index += 1) {
        lookup = keys[index].toLowerCase();
        if (names.indexOf(lookup) >= 0) {
            return object[keys[index]];
        }
    }

    return undefined;
}

function normalizeModelResult(object) {
    var tagValue = getCaseInsensitiveValue(object, ["tag", "category", "label"]);
    var confidenceValue = getCaseInsensitiveValue(object, ["confidence", "score", "probability"]);

    if (typeof tagValue === "undefined") {
        return null;
    }

    return {
        tag: tagValue,
        confidence: typeof confidenceValue === "undefined" ? undefined : confidenceValue
    };
}

function parseJsonCandidate(content) {
    var parsed;

    try {
        parsed = JSON.parse(content);
    } catch (ignore) {
        return null;
    }

    return normalizeModelResult(parsed);
}

function isChoiceTokenTruncated(choice) {
    var finishReason = String((choice && choice.finish_reason) || (choice && choice.finishReason) || "").toLowerCase();
    return finishReason === "length" || finishReason === "max_tokens";
}

function buildTokenTruncationResult(classifier, fallbackTag, choice) {
    var configuredMaxTokens = Number(classifier.max_tokens || classifier.maxTokens || 0);
    var recommendedMaxTokens = Math.max(128, configuredMaxTokens || 0);

    return {
        tag: fallbackTag,
        confidence: 0,
        source: "provider_truncated",
        error: true,
        finish_reason: (choice && (choice.finish_reason || choice.finishReason)) || "length",
        recommended_max_tokens: recommendedMaxTokens,
        message: "Classifier provider returned no final tag because Max Tokens was exhausted. Increase Max Tokens to at least " + recommendedMaxTokens + " and test again."
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

function parseClassifierResponse(classifier, rawBody, candidateTags, fallbackTag) {
    var parsed;
    var content;
    var modelResult;
    var choice;
    var labels;
    var scores;
    var candidates = [];
    var index;
    var top1;
    var top2;
    var minConfidence;
    var minMargin;

    try {
        parsed = JSON.parse(rawBody);
    } catch (error) {
        return {
            tag: fallbackTag,
            confidence: 0.01,
            source: "provider_parse_error",
            message: error.message
        };
    }

    modelResult = normalizeModelResult(parsed);
    if (modelResult) {
        return {
            tag: normalizeTag(modelResult.tag, candidateTags, fallbackTag),
            confidence: Number(modelResult.confidence || 0.5),
            source: "provider"
        };
    }

    choice = parsed.choices && parsed.choices[0];
    if (choice && choice.message) {
        content = choice.message.content;
        modelResult = extractModelText(content);
        if (modelResult && (modelResult.tag || modelResult.category || modelResult.label)) {
            return {
                tag: normalizeTag(modelResult.tag || modelResult.category || modelResult.label, candidateTags, fallbackTag),
                confidence: Number(modelResult.confidence || 0.5),
                source: "provider_model"
            };
        }
        if (isChoiceTokenTruncated(choice) && !String(content || "").trim()) {
            return buildTokenTruncationResult(classifier, fallbackTag, choice);
        }
    }
    if (choice && choice.text) {
        modelResult = extractModelText(choice.text);
        if (modelResult && (modelResult.tag || modelResult.category || modelResult.label)) {
            return {
                tag: normalizeTag(modelResult.tag || modelResult.category || modelResult.label, candidateTags, fallbackTag),
                confidence: Number(modelResult.confidence || 0.5),
                source: "provider_text"
            };
        }
        if (isChoiceTokenTruncated(choice) && !String(choice.text || "").trim()) {
            return buildTokenTruncationResult(classifier, fallbackTag, choice);
        }
    }

    labels = parsed.labels || [];
    scores = parsed.scores || [];
    if (Array.isArray(labels) && Array.isArray(scores)) {
        for (index = 0; index < labels.length; index += 1) {
            candidates.push({
                tag: normalizeTag(labels[index], candidateTags, fallbackTag),
                confidence: Number(scores[index] || 0)
            });
        }
    } else if (Array.isArray(parsed) && parsed.length) {
        for (index = 0; index < parsed.length; index += 1) {
            if (parsed[index] && (parsed[index].label || parsed[index].tag)) {
                candidates.push({
                    tag: normalizeTag(parsed[index].label || parsed[index].tag, candidateTags, fallbackTag),
                    confidence: Number(parsed[index].score || parsed[index].confidence || 0)
                });
            }
        }
    }

    if (candidates.length) {
        candidates.sort(function (left, right) {
            return right.confidence - left.confidence;
        });
        top1 = candidates[0];
        top2 = candidates[1] || { confidence: 0 };
        minConfidence = Number(classifier.min_confidence || 0);
        minMargin = Number(classifier.min_margin || 0);

        if (minConfidence && top1.confidence < minConfidence) {
            return { tag: fallbackTag, confidence: top1.confidence, source: "provider_nli_threshold", candidates: candidates };
        }
        if (minMargin && (top1.confidence - top2.confidence) < minMargin) {
            return { tag: fallbackTag, confidence: top1.confidence, source: "provider_nli_margin", candidates: candidates };
        }
        return {
            tag: top1.tag,
            confidence: top1.confidence,
            source: "provider_nli",
            candidates: candidates
        };
    }

    return {
        tag: fallbackTag,
        confidence: 0.05,
        source: "provider_unknown"
    };
}

function resolveApiKey(classifier) {
    var value = String(classifier.api_key || classifier.apiKey || "").trim();

    return {
        value: value,
        source: value ? "direct" : "none"
    };
}

function buildRequest(classifier, inputText, apiKey) {
    var endpoint = parseEndpointUrl(classifier.endpoint_url || classifier.endpointUrl || "");
    var type = classifier.classifier_type || classifier.classifierType || "classifier_llm";
    var schema = classifier.schema_family || classifier.schemaFamily || "";
    var modelId = classifier.model_id || classifier.modelId || "";
    var maxTokens;
    var body;
    var headers;
    var bodyString;

    if (!endpoint.hostname) {
        return {
            supported: false,
            reason: "endpoint URL is missing or invalid"
        };
    }

    if (type === "classifier_nli") {
        body = {
            inputs: inputText,
            parameters: {
                candidate_labels: normalizeTags(classifier.candidate_tags || classifier.candidateTags),
                hypothesis_template: classifier.hypothesis_template || classifier.hypothesisTemplate || "This text is about {}.",
                multi_label: Boolean(classifier.multi_label || classifier.multiLabel)
            }
        };
    } else {
        if (!modelId) {
            return {
                supported: false,
                reason: "model ID is required for LLM classifiers"
            };
        }
        if (schema && schema !== "openai_chat_compatible" && schema !== "ollama_chat" && schema !== "ollama_openai_compatible") {
            return {
                supported: false,
                reason: "unsupported classifier schema family: " + schema
            };
        }
        maxTokens = Number(classifier.max_tokens || classifier.maxTokens || 32);
        if (!maxTokens || maxTokens < 1) {
            maxTokens = 32;
        }
        if (String(modelId).toLowerCase().indexOf("deepseek") >= 0 && maxTokens < 128) {
            maxTokens = 128;
        }
        body = {
            model: modelId,
            temperature: Number(classifier.temperature || 0),
            max_tokens: maxTokens,
            messages: [
                {
                    role: "system",
                    content: classifier.classifier_prompt || classifier.classifierPrompt || ""
                },
                {
                    role: "user",
                    content: inputText
                }
            ]
        };
    }

    bodyString = JSON.stringify(body);
    headers = {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(bodyString),
        "Connection": "close"
    };
    if (apiKey.value) {
        headers.Authorization = "Bearer " + apiKey.value;
    }

    return {
        supported: true,
        protocol: endpoint.protocol === "http" ? "http:" : "https:",
        hostname: endpoint.hostname,
        port: endpoint.port,
        path: endpoint.path,
        method: "POST",
        timeout: Number(classifier.timeout_ms || classifier.timeoutMs || 3000),
        headers: headers,
        body: bodyString,
        auth_source: apiKey.source
    };
}

function dispatch(requestDescriptor, callback) {
    var transport = requestDescriptor.protocol === "http:" ? http : https;
    var completed = false;
    function finish(error, raw) {
        if (completed) {
            return;
        }
        completed = true;
        callback(error, raw);
    }
    var request = transport.request({
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
                    message: "Classifier endpoint returned HTTP " + response.statusCode + ": " + parseProviderErrorBody(raw),
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
            message: "classifier request timeout"
        });
    });
    request.write(requestDescriptor.body);
    request.end();
}

TestClassifierWorker.prototype.onPost = function(restOperation) {
    var startedAt = Date.now();
    var body;
    var classifier;
    var inputText;
    var candidateTags;
    var fallbackTag;
    var apiKey;
    var requestDescriptor;
    var self = this;

    try {
        body = readRequestBody(restOperation);
        classifier = body.classifier || {};
        inputText = String(body.input_text || body.inputText || "").trim();
        candidateTags = normalizeTags(classifier.candidate_tags || classifier.candidateTags);
        fallbackTag = normalizeTag(classifier.fallback_tag || classifier.fallbackTag || "unknown", candidateTags, "unknown");

        if (!inputText) {
            writeJson.call(self, restOperation, 400, {
                ok: false,
                message: "Test input is required."
            });
            return;
        }

        apiKey = resolveApiKey(classifier);
        if (!apiKey.value) {
            writeJson.call(self, restOperation, 400, {
                ok: false,
                message: "API Key is required. Paste the API key in the UI; ENV/Secret Ref is not supported."
            });
            return;
        }

        requestDescriptor = buildRequest(classifier, inputText, apiKey);
        if (!requestDescriptor.supported) {
            writeJson.call(self, restOperation, 400, {
                ok: false,
                message: requestDescriptor.reason
            });
            return;
        }

        dispatch(requestDescriptor, function (error, rawResponse) {
            var result;
            if (error) {
                writeJson.call(self, restOperation, 502, {
                    ok: false,
                    message: error.message || "Classifier test failed.",
                    source: "provider_http_error",
                    status_code: error.status_code,
                    provider_message: error.provider_message,
                    details: error.raw || ""
                });
                return;
            }

            result = parseClassifierResponse(classifier, rawResponse, candidateTags, fallbackTag);
            if (result.error) {
                writeJson.call(self, restOperation, 422, {
                    ok: false,
                    message: result.message || "Classifier provider did not return a usable tag.",
                    tag: result.tag,
                    confidence: result.confidence,
                    source: result.source,
                    finish_reason: result.finish_reason,
                    recommended_max_tokens: result.recommended_max_tokens,
                    auth_source: requestDescriptor.auth_source,
                    elapsed_ms: Date.now() - startedAt
                });
                return;
            }
            writeJson.call(self, restOperation, 200, {
                ok: true,
                classifier_name: classifier.classifier_name || classifier.classifierName || body.classifier_id || "",
                tag: result.tag,
                confidence: result.confidence,
                source: result.source,
                candidates: result.candidates || [],
                auth_source: requestDescriptor.auth_source,
                elapsed_ms: Date.now() - startedAt
            });
        });
    } catch (error) {
        restOperation.fail(new Error("Test Classifier Worker Error: " + error.message));
    }
};

module.exports = TestClassifierWorker;
