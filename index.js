'use strict';

var f5 = require('f5-nodejs');
var fs = require('fs');
var path = require('path');
var http = require('http');
var https = require('https');

var ilx = new f5.ILXServer();

var DEFAULT_CONFIG = {
  mode: 'openai_compatible_chat',
  timeoutMs: 3000,
  rulesFirst: true,
  candidateTags: ['chat', 'f5', 'bad', 'unknown'],
  provider: {
    type: 'openai_compatible_chat',
    protocol: 'https',
    hostname: 'api.deepseek.com',
    port: 443,
    path: '/chat/completions',
    method: 'POST',
    model: 'deepseek-chat',
    apiKeyEnv: 'SEMANTIC_ROUTER_API_KEY',
    systemPrompt: 'You are a routing classifier inside an AI gateway. Classify the user input into exactly one tag from: chat, f5, bad, unknown. Return only compact JSON like {"tag":"f5","confidence":0.92}. Use bad for violence, sexual content, or abusive/harmful requests. Use f5 for BIG-IP, iRule, LTM, pool, node, monitor, virtual server, ASM, APM, WAF, DNS, GTM, or other F5 questions. Use chat for casual conversation. Use unknown when unsure.',
    headers: {
      'Content-Type': 'application/json'
    }
  },
  decisions: {
    default: {
      action: 'route',
      pool: 'pool_semantic_demo_default_direct',
      profile: 'general_assistant'
    },
    tags: {
      chat: {
        action: 'respond',
        message: '工作时间请不要闲聊'
      },
      bad: {
        action: 'respond',
        message: '您的请求违规'
      },
      f5: {
        action: 'route',
        pool: 'pool_semantic_demo_big_direct',
        profile: 'f5_expert'
      },
      unknown: {
        action: 'route',
        pool: 'pool_semantic_demo_default_direct',
        profile: 'general_assistant'
      }
    }
  },
  backend: {
    protocol: 'https',
    hostname: 'api.deepseek.com',
    port: 443,
    path: '/chat/completions',
    method: 'POST',
    model: 'deepseek-chat',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    headers: {
      'Content-Type': 'application/json'
    }
  },
  routeProfiles: {
    f5_expert: {
      systemPrompt: 'You are an F5 BIG-IP expert. Answer F5 questions accurately with concrete tmsh, iRules, virtual server, pool, node, monitor, and operational guidance when useful. Answer in Chinese unless the user explicitly asks for another language.',
      maxTokens: 512,
      temperature: 0.2
    },
    general_assistant: {
      systemPrompt: 'You are an F5 AI gateway demo assistant. Your primary scope is F5 BIG-IP, iRules, LTM, pool, virtual server, monitor, DNS, ASM, APM, GTM, and closely related network or infrastructure topics. When the user asks what you can do, explain that you mainly support F5-related technical questions and gateway demo scenarios. If the request is outside F5, answer briefly and steer the conversation back to F5 or enterprise infrastructure topics. Answer in Chinese unless the user explicitly asks for another language.',
      maxTokens: 256,
      temperature: 0.2
    }
  }
};

function loadConfig() {
  var configPath = path.join(__dirname, 'classifier-config.json');
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    console.log('Using default classifier config: ' + err.message);
    return DEFAULT_CONFIG;
  }
}

function mergeObjects(base, override) {
  var result = {};
  var key;

  base = base || {};
  override = override || {};

  for (key in base) {
    if (Object.prototype.hasOwnProperty.call(base, key)) {
      if (base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])) {
        result[key] = mergeObjects(base[key], {});
      } else {
        result[key] = base[key];
      }
    }
  }

  for (key in override) {
    if (Object.prototype.hasOwnProperty.call(override, key)) {
      if (override[key] && typeof override[key] === 'object' && !Array.isArray(override[key]) && result[key] && typeof result[key] === 'object') {
        result[key] = mergeObjects(result[key], override[key]);
      } else {
        result[key] = override[key];
      }
    }
  }

  return result;
}

function normalizeText(value) {
  var i;
  var nested;

  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(function (item) {
      return normalizeText(item);
    }).join(' ').replace(/\s+/g, ' ').trim();
  }
  if (typeof value === 'object') {
    if (value.role === 'user') {
      nested = normalizeText(value.content);
      if (nested) {
        return nested;
      }
      nested = normalizeText(value.input);
      if (nested) {
        return nested;
      }
    }
    if (typeof value.text === 'string') {
      return value.text;
    }
    if (typeof value.content === 'string') {
      return value.content;
    }
    if (Array.isArray(value.content)) {
      return normalizeText(value.content);
    }
    if (Array.isArray(value.input)) {
      return normalizeText(value.input);
    }
    if (typeof value.input_text === 'string') {
      return value.input_text;
    }
    if (value.type === 'text' && typeof value.text === 'string') {
      return value.text;
    }
    if (value.type === 'input_text' && typeof value.text === 'string') {
      return value.text;
    }
  }
  return '';
}

function extractPrompt(jsonObj) {
  var i;
  var content;
  var item;

  if (!jsonObj || typeof jsonObj !== 'object') {
    return '';
  }

  if (Array.isArray(jsonObj.messages)) {
    for (i = jsonObj.messages.length - 1; i >= 0; i -= 1) {
      if (jsonObj.messages[i] && jsonObj.messages[i].role === 'user') {
        content = jsonObj.messages[i].content;
        return normalizeText(content);
      }
    }
  }

  if (typeof jsonObj.prompt === 'string') {
    return jsonObj.prompt;
  }

  if (Array.isArray(jsonObj.input)) {
    for (i = jsonObj.input.length - 1; i >= 0; i -= 1) {
      item = jsonObj.input[i];
      if (item && item.role === 'user') {
        content = normalizeText(item.content || item.input || item);
        if (content) {
          return content;
        }
      }
    }
    return normalizeText(jsonObj.input);
  }

  if (typeof jsonObj.input === 'string') {
    return jsonObj.input;
  }

  if (typeof jsonObj.question === 'string') {
    return jsonObj.question;
  }

  if (typeof jsonObj.query === 'string') {
    return jsonObj.query;
  }

  if (typeof jsonObj.text === 'string') {
    return jsonObj.text;
  }

  if (Array.isArray(jsonObj.contents)) {
    return normalizeText(jsonObj.contents);
  }

  return '';
}

function extractPublicModel(jsonObj) {
  if (!jsonObj || typeof jsonObj !== 'object') {
    return '';
  }
  if (typeof jsonObj.model === 'string') {
    return jsonObj.model.trim();
  }
  return '';
}

function normalizeTag(tag) {
  var normalized = String(tag || 'unknown').toLowerCase();
  if (normalized === 'nsfw' || normalized === 'violence' || normalized === 'harmful') {
    return 'bad';
  }
  if (normalized === 'development' || normalized === 'query') {
    return 'unknown';
  }
  if (normalized !== 'chat' && normalized !== 'f5' && normalized !== 'bad' && normalized !== 'unknown') {
    return 'unknown';
  }
  return normalized;
}

function classifyWithLocalRules(promptText) {
  var text;
  if (!promptText) {
    return { tag: 'unknown', confidence: 0.10, source: 'empty' };
  }

  text = promptText.toLowerCase();

  if (/(杀人|自杀|炸弹|恐怖袭击|强奸|qj|porn|sex|nude|hentai|成人视频|色情|裸聊|约炮|fuck you|操你|靠你|去死|教我方法)/.test(text)) {
    return { tag: 'bad', confidence: 0.99, source: 'rules' };
  }

  if (/(f5|big-ip|bigip|ltm|gtm|dns|asm|apm|afm|irule|i-rule|virtual server|pool|pool member|node|monitor|wide ip|snat|fastl4|oneconnect|tmsh|as3|do declaration|icontrol|hostname|ssl profile|persistence|health monitor)/.test(text)) {
    return { tag: 'f5', confidence: 0.96, source: 'rules' };
  }

  if (/(what can you do|what do you support|what work do you support|你可以做什么|你能做什么|你会什么|你可以帮我做什么|你支持什么|你支持哪些|你支持什么功能|你支持什么工作|你能帮我什么)/.test(text)) {
    return { tag: 'unknown', confidence: 0.88, source: 'rules_terminal' };
  }

  if (/(hello|hi|hey|你好|在吗|闲聊|聊聊|哈哈|谢谢|thanks|靠$|卧槽)/.test(text)) {
    return { tag: 'chat', confidence: 0.82, source: 'rules' };
  }

  return { tag: 'unknown', confidence: 0.20, source: 'rules' };
}

function parseModelText(content) {
  var parsed;
  if (!content || typeof content !== 'string') {
    return null;
  }

  try {
    parsed = JSON.parse(content);
    if (parsed && parsed.tag) {
      return parsed;
    }
  } catch (ignore) {
  }

  parsed = content.match(/"(tag|category|label)"\s*:\s*"([^"]+)"/i);
  if (parsed && parsed[2]) {
    return { tag: parsed[2] };
  }

  return null;
}

function parseProviderResponse(rawBody) {
  var parsed;
  var modelResult;
  try {
    parsed = JSON.parse(rawBody);
  } catch (err) {
    return { tag: 'unknown', confidence: 0.01, source: 'provider_parse_error', error: err.message };
  }

  if (parsed.tag || parsed.category || parsed.label) {
    return {
      tag: normalizeTag(parsed.tag || parsed.category || parsed.label),
      confidence: Number(parsed.confidence || 0.50),
      source: 'provider'
    };
  }

  if (parsed.choices && parsed.choices[0] && parsed.choices[0].message) {
    modelResult = parseModelText(parsed.choices[0].message.content);
    if (modelResult && modelResult.tag) {
      return {
        tag: normalizeTag(modelResult.tag),
        confidence: Number(modelResult.confidence || 0.50),
        source: 'provider_model'
      };
    }
  }

  return { tag: 'unknown', confidence: 0.05, source: 'provider_unknown' };
}

function buildProviderRequestBody(config, promptText, metadata) {
  if (config.provider.type === 'classifier_http') {
    return JSON.stringify({
      text: promptText,
      candidate_tags: config.candidateTags || DEFAULT_CONFIG.candidateTags,
      metadata: metadata
    });
  }

  return JSON.stringify({
    model: config.provider.model,
    temperature: 0,
    max_tokens: 32,
    messages: [
      { role: 'system', content: config.provider.systemPrompt },
      { role: 'user', content: promptText }
    ]
  });
}

function buildProviderOptions(config, body) {
  var headers = mergeObjects(config.provider.headers || {}, {});
  var apiKeyEnv;
  var apiKey;

  headers['Content-Length'] = Buffer.byteLength(body);
  headers.Connection = 'close';

  apiKeyEnv = config.provider.apiKeyEnv;
  if (config.provider.apiKey) {
    apiKey = config.provider.apiKey;
  } else if (apiKeyEnv && process.env[apiKeyEnv]) {
    apiKey = process.env[apiKeyEnv];
  }

  if (apiKey && !headers.Authorization) {
    headers.Authorization = 'Bearer ' + apiKey;
  }

  return {
    protocol: config.provider.protocol === 'http' ? 'http:' : 'https:',
    hostname: config.provider.hostname,
    port: config.provider.port,
    path: config.provider.path,
    method: config.provider.method || 'POST',
    headers: headers,
    timeout: config.timeoutMs || DEFAULT_CONFIG.timeoutMs
  };
}

function callProvider(config, promptText, metadata, callback) {
  var body = buildProviderRequestBody(config, promptText, metadata);
  var options = buildProviderOptions(config, body);
  var transport = options.protocol === 'http:' ? http : https;
  var req = transport.request(options, function (res) {
    var raw = '';
    res.on('data', function (chunk) {
      raw += chunk;
    });
    res.on('end', function () {
      callback(parseProviderResponse(raw));
    });
  });

  req.on('error', function (err) {
    callback({ tag: 'unknown', confidence: 0.01, source: 'provider_error', error: err.message });
  });

  req.on('timeout', function () {
    req.destroy();
    callback({ tag: 'unknown', confidence: 0.01, source: 'provider_timeout' });
  });

  req.write(body);
  req.end();
}

function formatReply(result) {
  var tag = normalizeTag(result.tag || 'unknown');
  var confidence = result.confidence || 0;
  var source = result.source || 'unknown';
  return [tag, confidence, source].join('|');
}

function resolveApiKey(section) {
  if (!section || typeof section !== 'object') {
    return '';
  }
  if (section.apiKey) {
    return section.apiKey;
  }
  if (section.apiKeyEnv && process.env[section.apiKeyEnv]) {
    return process.env[section.apiKeyEnv];
  }
  return '';
}

function getRouteProfile(config, profileName) {
  var profiles = config.routeProfiles || {};
  if (profileName && profiles[profileName]) {
    return profiles[profileName];
  }
  if (profiles.general_assistant) {
    return profiles.general_assistant;
  }
  return {};
}

function normalizeChatRole(role) {
  if (role === 'assistant' || role === 'system' || role === 'user') {
    return role;
  }
  return 'user';
}

function normalizeMessageList(messages) {
  var normalized = [];
  var i;
  var message;
  var role;
  var content;

  if (!Array.isArray(messages)) {
    return normalized;
  }

  for (i = 0; i < messages.length; i += 1) {
    message = messages[i];
    if (!message || typeof message !== 'object') {
      continue;
    }
    role = normalizeChatRole(message.role);
    content = normalizeText(message.content);
    if (!content) {
      continue;
    }
    normalized.push({
      role: role,
      content: content
    });
  }

  return normalized;
}

function buildRouteMessages(routeProfile, originalMessages) {
  var systemParts = [];
  var routed = [];
  var i;
  var message;

  if (routeProfile.systemPrompt) {
    systemParts.push(routeProfile.systemPrompt);
  }

  for (i = 0; i < originalMessages.length; i += 1) {
    message = originalMessages[i];
    if (message.role === 'system') {
      systemParts.push('Client system instructions:\n' + message.content);
      continue;
    }
    routed.push(message);
  }

  if (systemParts.length > 0) {
    routed.unshift({
      role: 'system',
      content: systemParts.join('\n\n')
    });
  }

  return routed;
}

function stringifyAsciiJson(obj) {
  return JSON.stringify(obj).replace(/[\u007f-\uffff]/g, function(ch) {
    return '\\u' + ('0000' + ch.charCodeAt(0).toString(16)).slice(-4);
  });
}

function isChatCompletionsPath(requestPath) {
  return !!requestPath && (
    requestPath.indexOf('/v1/chat/completions') === 0 ||
    requestPath.indexOf('/chat/completions') === 0
  );
}

function isResponsesPath(requestPath) {
  return !!requestPath && (
    requestPath.indexOf('/v1/responses') === 0 ||
    requestPath.indexOf('/responses') === 0
  );
}

function buildDirectRoute(config, jsonObj, requestPath, publicModel, decision) {
  var backend = config.backend || {};
  var routeProfile = getRouteProfile(config, decision.profile);
  var apiKey = resolveApiKey(backend);
  var originalMessages;
  var directPayload = {};

  if (!isChatCompletionsPath(requestPath)) {
    return {
      supported: false,
      reason: 'unsupported_path'
    };
  }

  if (!backend.hostname || !backend.path || !backend.model) {
    return {
      supported: false,
      reason: 'backend_not_configured'
    };
  }

  originalMessages = normalizeMessageList(jsonObj.messages);
  if (!originalMessages.length) {
    return {
      supported: false,
      reason: 'empty_messages'
    };
  }

  directPayload.model = backend.acceptClientModel && publicModel ? publicModel : backend.model;
  directPayload.messages = buildRouteMessages(routeProfile, originalMessages);
  directPayload.stream = Boolean(jsonObj.stream);

  if (jsonObj.stream_options) {
    directPayload.stream_options = jsonObj.stream_options;
  }
  if (jsonObj.top_p !== undefined) {
    directPayload.top_p = jsonObj.top_p;
  }
  if (jsonObj.presence_penalty !== undefined) {
    directPayload.presence_penalty = jsonObj.presence_penalty;
  }
  if (jsonObj.frequency_penalty !== undefined) {
    directPayload.frequency_penalty = jsonObj.frequency_penalty;
  }

  if (routeProfile.maxTokens !== undefined && routeProfile.maxTokens !== null) {
    directPayload.max_tokens = routeProfile.maxTokens;
  } else if (jsonObj.max_tokens !== undefined) {
    directPayload.max_tokens = jsonObj.max_tokens;
  }

  if (routeProfile.temperature !== undefined && routeProfile.temperature !== null) {
    directPayload.temperature = routeProfile.temperature;
  } else if (jsonObj.temperature !== undefined) {
    directPayload.temperature = jsonObj.temperature;
  }

  return {
    supported: true,
    upstreamHost: backend.hostname,
    upstreamPath: backend.path,
    authHeader: apiKey ? ('Bearer ' + apiKey) : '',
    payloadB64: Buffer.from(stringifyAsciiJson(directPayload)).toString('base64')
  };
}

function encodeDecision(decision) {
  return [
    decision.action || '',
    normalizeTag(decision.tag || 'unknown'),
    String(decision.confidence || 0),
    decision.source || 'unknown',
    decision.pool || '',
    decision.profile || '',
    decision.message || '',
    decision.publicModel || '',
    decision.upstreamHost || '',
    decision.upstreamPath || '',
    decision.authHeader || '',
    decision.payloadB64 || ''
  ].join('\t');
}

function decisionForTag(config, classification, publicModel) {
  var normalized = normalizeTag(classification.tag || 'unknown');
  var ruleSet = (config.decisions && config.decisions.tags) || {};
  var fallback = (config.decisions && config.decisions.default) || DEFAULT_CONFIG.decisions.default;
  var selected = ruleSet[normalized] || fallback || {};

  return {
    action: selected.action || 'route',
    tag: normalized,
    confidence: classification.confidence || 0,
    source: classification.source || 'unknown',
    pool: selected.pool || '',
    profile: selected.profile || '',
    message: selected.message || '',
    publicModel: publicModel || ''
  };
}

function classifyPayload(config, payload, requestPath, contentType, callback) {
  var jsonObj;
  var promptText;
  var metadata;
  var localResult;
  var publicModel;

  try {
    jsonObj = JSON.parse(payload);
  } catch (err) {
    callback({
      classification: { tag: 'unknown', confidence: 0.01, source: 'json_parse_error' },
      publicModel: '',
      jsonObj: null
    });
    return;
  }

  promptText = extractPrompt(jsonObj);
  publicModel = extractPublicModel(jsonObj);
  if (!promptText || !promptText.replace(/\s+/g, '')) {
    callback({
      classification: { tag: 'unknown', confidence: 0.01, source: 'empty_prompt' },
      publicModel: publicModel,
      jsonObj: jsonObj
    });
    return;
  }

  metadata = {
    path: requestPath,
    contentType: contentType,
    promptLength: promptText.length
  };

  if (config.rulesFirst) {
    localResult = classifyWithLocalRules(promptText);
    if (localResult.tag !== 'unknown' || config.mode === 'local_only' || localResult.source === 'rules_terminal') {
      callback({ classification: localResult, publicModel: publicModel, jsonObj: jsonObj });
      return;
    }
  }

  if (config.mode === 'mock') {
    callback({ classification: classifyWithLocalRules(promptText), publicModel: publicModel, jsonObj: jsonObj });
    return;
  }

  callProvider(config, promptText, metadata, function (providerResult) {
    callback({ classification: providerResult, publicModel: publicModel, jsonObj: jsonObj });
  });
}

ilx.addMethod('health', function (req, res) {
  var config = mergeObjects(DEFAULT_CONFIG, loadConfig());
  res.reply(JSON.stringify({
    status: 'ok',
    mode: config.mode,
    providerType: config.provider.type,
    candidateTags: config.candidateTags,
    backendHost: (config.backend && config.backend.hostname) || '',
    backendPath: (config.backend && config.backend.path) || ''
  }));
});

ilx.addMethod('classifyIntent', function (req, res) {
  var params = req.params();
  var payload = params[0] || '';
  var requestPath = params[1] || '';
  var contentType = params[2] || '';
  var config = mergeObjects(DEFAULT_CONFIG, loadConfig());

  classifyPayload(config, payload, requestPath, contentType, function (result) {
    res.reply(formatReply(result.classification));
  });
});

ilx.addMethod('decideRoute', function (req, res) {
  var params = req.params();
  var payload = params[0] || '';
  var requestPath = params[1] || '';
  var contentType = params[2] || '';
  var config = mergeObjects(DEFAULT_CONFIG, loadConfig());

  classifyPayload(config, payload, requestPath, contentType, function (result) {
    var decision = decisionForTag(config, result.classification, result.publicModel);
    var directRoute;

    if (decision.action === 'route') {
      directRoute = buildDirectRoute(config, result.jsonObj || {}, requestPath, result.publicModel, decision);
      if (!directRoute.supported) {
        decision.action = 'respond';
        if (isResponsesPath(requestPath)) {
          decision.message = '当前直连模式暂仅支持 chat completions 的 routed 请求，请改用 /v1/chat/completions 或 /chat/completions。';
        } else {
          decision.message = '当前直连模式暂仅支持 chat completions 的 routed 请求，请改用 /v1/chat/completions 或 /chat/completions。';
        }
      } else {
        decision.upstreamHost = directRoute.upstreamHost;
        decision.upstreamPath = directRoute.upstreamPath;
        decision.authHeader = directRoute.authHeader;
        decision.payloadB64 = directRoute.payloadB64;
      }
    }

    res.reply(encodeDecision(decision));
  });
});

ilx.listen();
