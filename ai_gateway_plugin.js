'use strict';

var f5 = require('f5-nodejs');
var fs = require('fs');
var path = require('path');
var http = require('http');
var https = require('https');
var url = require('url');
var crypto = require('crypto');
var configLib = require('./gateway_config_lib');

var plugin = new f5.ILXPlugin();
var BUNDLED_CONFIG_PATH = path.join(__dirname, 'gateway-config.json');
var SCHEMA_PATH = path.join(__dirname, 'gateway-config.schema.json');
var RUNTIME_STATE_DIR = '/tmp/llm_ai_gw_plugin';
var OVERRIDE_CONFIG_PATH = path.join(RUNTIME_STATE_DIR, 'gateway-config.json');
var VERSION_STORE_DIR = path.join(RUNTIME_STATE_DIR, 'config_versions');
var ACTIVE_CONFIG_STATE = {
  config: null,
  version: 0,
  source: 'none',
  loaded_at: 0,
  file_mtime_ms: 0,
  content_hash: null,
  last_reload_status: 'never',
  last_error: null,
  last_checked_mtime_ms: 0,
  last_checked_at: 0,
  active_path: null
};
var SCHEMA_CACHE = null;
var VERSION_LIST_CACHE = {
  versions: null,
  loaded_at: 0,
  dir_mtime_ms: 0
};
var IGNORABLE_ERROR_LOG_STATE = Object.create(null);
var TRACE_SLOW_THRESHOLD_MS = 8000;

function ensureRuntimeStateDir() {
  if (!fs.existsSync(RUNTIME_STATE_DIR)) {
    fs.mkdirSync(RUNTIME_STATE_DIR);
  }
}

function ensureVersionStoreDir() {
  ensureRuntimeStateDir();
  if (!fs.existsSync(VERSION_STORE_DIR)) {
    fs.mkdirSync(VERSION_STORE_DIR);
  }
}

function activeConfigPath() {
  if (fs.existsSync(OVERRIDE_CONFIG_PATH)) {
    return OVERRIDE_CONFIG_PATH;
  }
  return BUNDLED_CONFIG_PATH;
}

function computeContentHash(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function loadRawConfigText(configPath) {
  return fs.readFileSync(configPath || activeConfigPath(), 'utf8');
}

function loadSchemaJson() {
  if (!SCHEMA_CACHE) {
    SCHEMA_CACHE = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  }
  return SCHEMA_CACHE;
}

function writeConfigAtomically(text) {
  var tempPath;
  ensureRuntimeStateDir();
  tempPath = OVERRIDE_CONFIG_PATH + '.tmp';
  fs.writeFileSync(tempPath, text, 'utf8');
  fs.renameSync(tempPath, OVERRIDE_CONFIG_PATH);
}

function versionFilePath(versionId) {
  return path.join(VERSION_STORE_DIR, versionId + '.json');
}

function invalidateVersionListCache() {
  VERSION_LIST_CACHE.versions = null;
  VERSION_LIST_CACHE.loaded_at = 0;
  VERSION_LIST_CACHE.dir_mtime_ms = 0;
}

function listConfigVersions() {
  var files;
  var versions = [];
  var i;
  var record;
  var stat;
  var currentMtime;
  var now = Date.now();
  var ttl = configReloadIntervalMs(ACTIVE_CONFIG_STATE.config);

  ensureVersionStoreDir();
  stat = fs.statSync(VERSION_STORE_DIR);
  currentMtime = Number(stat.mtimeMs || stat.mtime.getTime());
  if (VERSION_LIST_CACHE.versions &&
      VERSION_LIST_CACHE.dir_mtime_ms === currentMtime &&
      (now - VERSION_LIST_CACHE.loaded_at) < ttl) {
    return VERSION_LIST_CACHE.versions.slice();
  }
  files = fs.readdirSync(VERSION_STORE_DIR).filter(function(name) {
    return /\.json$/.test(name);
  }).sort().reverse();

  for (i = 0; i < files.length; i += 1) {
    try {
      record = JSON.parse(fs.readFileSync(path.join(VERSION_STORE_DIR, files[i]), 'utf8'));
      versions.push({
        version_id: record.version_id,
        created_at: record.created_at,
        source: record.source,
        content_hash: record.content_hash,
        summary: record.summary || null
      });
    } catch (ignore) {
    }
  }

  VERSION_LIST_CACHE.versions = versions.slice();
  VERSION_LIST_CACHE.loaded_at = now;
  VERSION_LIST_CACHE.dir_mtime_ms = currentMtime;
  return versions;
}

function storeConfigVersion(configText, source, summary) {
  var contentHash = computeContentHash(configText);
  var versionId = String(Date.now()) + '-' + contentHash.substring(0, 12);
  var record = {
    version_id: versionId,
    created_at: new Date().toISOString(),
    source: source || 'unknown',
    content_hash: contentHash,
    summary: summary || null,
    config_text: configText
  };

  ensureVersionStoreDir();
  fs.writeFileSync(versionFilePath(versionId), JSON.stringify(record, null, 2), 'utf8');
  invalidateVersionListCache();
  return record;
}

function loadStoredVersion(versionId) {
  return JSON.parse(fs.readFileSync(versionFilePath(versionId), 'utf8'));
}

function parsePostedConfig(body) {
  if (body && typeof body.raw_config === 'string') {
    return JSON.parse(body.raw_config);
  }
  if (body && body.config && typeof body.config === 'object' && !Array.isArray(body.config)) {
    return body.config;
  }
  return body;
}

function snapshotConfigState(usingLastGood) {
  var summary = {
    fallback_tag: null,
    tags: [],
    classifiers: [],
    endpoints: [],
    actions: {},
    pipeline: []
  };

  if (ACTIVE_CONFIG_STATE.config) {
    summary = configLib.summarizeConfig(ACTIVE_CONFIG_STATE.config);
  }

  return {
    path: ACTIVE_CONFIG_STATE.active_path || activeConfigPath(),
    source: ACTIVE_CONFIG_STATE.source,
    version: ACTIVE_CONFIG_STATE.version,
    loaded_at: ACTIVE_CONFIG_STATE.loaded_at,
    file_mtime_ms: ACTIVE_CONFIG_STATE.file_mtime_ms,
    content_hash: ACTIVE_CONFIG_STATE.content_hash,
    last_reload_status: ACTIVE_CONFIG_STATE.last_reload_status,
    last_error: ACTIVE_CONFIG_STATE.last_error,
    using_last_good: !!usingLastGood,
    fallback_tag: summary.fallback_tag,
    tags: summary.tags,
    endpoints: summary.endpoints,
    pipeline: summary.pipeline,
    actions: summary.actions
  };
}

function once(fn) {
  var called = false;
  return function() {
    if (called) {
      return;
    }
    called = true;
    fn.apply(null, arguments);
  };
}

function configReloadIntervalMs(config) {
  var runtime = (config && config.runtime) || {};
  var defaults = ((configLib.DEFAULT_CONFIG || {}).runtime || {});
  var configured = runtime.config_reload_interval_ms;
  if (typeof configured === 'number' && configured > 0) {
    return configured;
  }
  if (typeof defaults.config_reload_interval_ms === 'number' && defaults.config_reload_interval_ms > 0) {
    return defaults.config_reload_interval_ms;
  }
  return 1000;
}

function requestLimits(config) {
  var runtime = (config && config.runtime) || {};
  var defaults = ((configLib.DEFAULT_CONFIG || {}).runtime || {}).request_limits || {};
  var configured = runtime.request_limits || {};
  return {
    data_plane_bytes: configured.data_plane_bytes || defaults.data_plane_bytes || 524288,
    admin_plane_bytes: configured.admin_plane_bytes || defaults.admin_plane_bytes || 262144,
    classifier_prompt_chars: configured.classifier_prompt_chars || defaults.classifier_prompt_chars || 16384
  };
}

function requestBodyLimitForPath(pathname, config) {
  var limits = requestLimits(config);
  if ((pathname || '').indexOf('/admin/') === 0) {
    return limits.admin_plane_bytes;
  }
  return limits.data_plane_bytes;
}

function truncateClassifierPrompt(config, promptText) {
  var maxChars = requestLimits(config).classifier_prompt_chars;
  if (!promptText || promptText.length <= maxChars) {
    return promptText;
  }
  return promptText.substring(0, maxChars);
}

function declaredContentLength(req) {
  var headerValue;
  var parsed;
  if (!req || !req.headers) {
    return null;
  }
  headerValue = req.headers['content-length'];
  if (!headerValue) {
    return null;
  }
  parsed = Number(headerValue);
  if (!isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function buildBodyTooLargeError(maxBytes) {
  var err = new Error('Request body exceeds the configured limit of ' + String(maxBytes) + ' bytes.');
  err.code = 'body_too_large';
  err.max_bytes = maxBytes;
  return err;
}

function refreshActiveConfig(force) {
  var rawText;
  var parsed;
  var normalized;
  var stat;
  var currentMtime;
  var sourcePath;
  var now = Date.now();
  var reloadInterval = configReloadIntervalMs(ACTIVE_CONFIG_STATE.config);

  try {
    if (!force &&
        ACTIVE_CONFIG_STATE.config &&
        ACTIVE_CONFIG_STATE.last_checked_at &&
        (now - ACTIVE_CONFIG_STATE.last_checked_at) < reloadInterval) {
      return {
        config: ACTIVE_CONFIG_STATE.config,
        state: snapshotConfigState(false)
      };
    }
    sourcePath = activeConfigPath();
    stat = fs.statSync(sourcePath);
    currentMtime = Number(stat.mtimeMs || stat.mtime.getTime());
    ACTIVE_CONFIG_STATE.last_checked_at = now;
    if (ACTIVE_CONFIG_STATE.config &&
        ACTIVE_CONFIG_STATE.last_checked_mtime_ms === currentMtime &&
        ACTIVE_CONFIG_STATE.active_path === sourcePath) {
      return {
        config: ACTIVE_CONFIG_STATE.config,
        state: snapshotConfigState(false)
      };
    }
    rawText = loadRawConfigText(sourcePath);
    parsed = JSON.parse(rawText);
    normalized = configLib.validateAndNormalizeConfig(parsed);
    ACTIVE_CONFIG_STATE.config = normalized;
    ACTIVE_CONFIG_STATE.version += 1;
    ACTIVE_CONFIG_STATE.source = sourcePath;
    ACTIVE_CONFIG_STATE.active_path = sourcePath;
    ACTIVE_CONFIG_STATE.loaded_at = Date.now();
    ACTIVE_CONFIG_STATE.file_mtime_ms = currentMtime;
    ACTIVE_CONFIG_STATE.content_hash = computeContentHash(rawText);
    ACTIVE_CONFIG_STATE.last_reload_status = 'ok';
    ACTIVE_CONFIG_STATE.last_error = null;
    ACTIVE_CONFIG_STATE.last_checked_mtime_ms = currentMtime;
    return {
      config: ACTIVE_CONFIG_STATE.config,
      state: snapshotConfigState(false)
    };
  } catch (err) {
    ACTIVE_CONFIG_STATE.last_checked_at = now;
    ACTIVE_CONFIG_STATE.last_checked_mtime_ms = currentMtime || ACTIVE_CONFIG_STATE.last_checked_mtime_ms;
    ACTIVE_CONFIG_STATE.last_reload_status = ACTIVE_CONFIG_STATE.config ? 'error_using_last_good' : 'error_no_valid_config';
    ACTIVE_CONFIG_STATE.last_error = err.message;
    if (ACTIVE_CONFIG_STATE.config) {
      return {
        config: ACTIVE_CONFIG_STATE.config,
        state: snapshotConfigState(true)
      };
    }
    throw err;
  }
}

function defaultPathForProvider(endpoint) {
  if (endpoint && endpoint.path) {
    return endpoint.path;
  }
  if (!endpoint || !endpoint.provider_type) {
    return '/v1/chat/completions';
  }
  if (endpoint.provider_type === 'openai_like') {
    return '/chat/completions';
  }
  return '/v1/chat/completions';
}

function ensureCandidateTag(config, tag) {
  var tags = ((config || {})._derived || {}).candidate_tags || [];
  var fallbackTag = ((config || {}).runtime || {}).fallback_tag || 'unknown';
  var lowered = String(tag || 'unknown').toLowerCase();
  var i;
  for (i = 0; i < tags.length; i += 1) {
    if (String(tags[i]).toLowerCase() === lowered) {
      return lowered;
    }
  }
  return fallbackTag;
}

function mergeObjects(base, override) {
  return configLib.mergeObjects(base, override);
}

function buildNorthboundHeaders(headers, defaults) {
  var finalHeaders = mergeObjects(headers || {}, defaults || {});
  finalHeaders.Connection = 'close';
  return finalHeaders;
}

function sendJson(res, status, body, headers) {
  var payload = JSON.stringify(body);
  var finalHeaders = buildNorthboundHeaders(headers, {
    'Content-Type': 'application/json'
  });
  finalHeaders['Content-Length'] = Buffer.byteLength(payload);
  res.shouldKeepAlive = false;
  res.writeHead(status, finalHeaders);
  res.end(payload);
}

function sendError(res, status, message, type, code, headers, detail) {
  var body = {
    error: {
      message: message,
      type: type || 'gateway_error',
      param: null,
      code: code || 'gateway_error'
    }
  };
  if (detail) {
    body.error.detail = detail;
  }
  sendJson(res, status, body, headers);
}

function canWriteResponse(res) {
  return !!(res && !res.writableEnded && !res.destroyed);
}

function noop() {
}

function describeError(err) {
  if (!err) {
    return 'unknown_error';
  }
  return String(err.code || err.message || err);
}

function isIgnorableTransportError(err) {
  var code = String((err && err.code) || '');
  var message = String((err && err.message) || '');
  return code === 'ETIMEDOUT' ||
    code === 'ECONNRESET' ||
    code === 'EPIPE' ||
    message.indexOf('ETIMEDOUT') !== -1 ||
    message.indexOf('ECONNRESET') !== -1 ||
    message.indexOf('EPIPE') !== -1;
}

function logIgnorableTransport(prefix, err) {
  var key = prefix + ':' + describeError(err);
  var now = Date.now();
  var bucket = IGNORABLE_ERROR_LOG_STATE[key];
  if (!bucket || (now - bucket.last_logged_at) > 30000) {
    IGNORABLE_ERROR_LOG_STATE[key] = {
      count: 1,
      last_logged_at: now
    };
    console.log(prefix + ': ' + describeError(err));
    return;
  }
  bucket.count += 1;
  if (bucket.count % 25 === 0) {
    bucket.last_logged_at = now;
    console.log(prefix + ' (repeated ' + String(bucket.count) + 'x): ' + describeError(err));
  }
}

function attachSocketErrorGuard(socket, handler) {
  if (!socket || typeof socket.on !== 'function') {
    return;
  }
  socket.on('error', handler || noop);
}

function attachServerStreamGuards(req, res) {
  if (req && typeof req.on === 'function') {
    req.on('error', noop);
    req.on('aborted', noop);
    attachSocketErrorGuard(req.socket, noop);
  }
  if (res && typeof res.on === 'function') {
    res.on('error', noop);
    attachSocketErrorGuard(res.socket, noop);
  }
}

function attachHttpServerGuards(server) {
  if (!server || typeof server.on !== 'function') {
    return;
  }
  server.on('clientError', function(err, socket) {
    if (isIgnorableTransportError(err)) {
      logIgnorableTransport('Suppressed ignorable server clientError', err);
    } else {
      console.log('HTTP server clientError: ' + describeError(err));
    }
    try {
      if (socket && !socket.destroyed) {
        socket.destroy();
      }
    } catch (ignore) {}
  });
  server.on('connection', function(socket) {
    attachSocketErrorGuard(socket, noop);
  });
}

function readRequestBody(req, maxBytes, callback) {
  var chunks = [];
  var totalBytes = 0;
  var done = once(callback);
  var overflowed = false;
  req.on('data', function(chunk) {
    if (overflowed) {
      return;
    }
    totalBytes += chunk.length;
    if (maxBytes > 0 && totalBytes > maxBytes) {
      overflowed = true;
      chunks = [];
      done(buildBodyTooLargeError(maxBytes));
      req.resume();
      return;
    }
    chunks.push(chunk);
  });
  req.on('aborted', function() {
    done(new Error('request_aborted'));
  });
  req.on('error', function(err) {
    done(err);
  });
  req.on('end', function() {
    if (overflowed) {
      return;
    }
    done(null, Buffer.concat(chunks, totalBytes).toString('utf8'));
  });
}

function normalizeText(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return value.map(function(item) {
      return normalizeText(item);
    }).join(' ').replace(/\s+/g, ' ').trim();
  }
  if (typeof value === 'object') {
    if (typeof value.text === 'string') {
      return value.text.trim();
    }
    if (typeof value.content === 'string') {
      return value.content.trim();
    }
    if (value.type && typeof value.text === 'string') {
      return value.text.trim();
    }
  }
  return '';
}

function extractPrompt(body) {
  var i;
  if (!body || typeof body !== 'object') {
    return '';
  }
  if (Array.isArray(body.messages)) {
    for (i = body.messages.length - 1; i >= 0; i -= 1) {
      if (body.messages[i] && body.messages[i].role === 'user') {
        return normalizeText(body.messages[i].content);
      }
    }
  }
  if (typeof body.input === 'string' || Array.isArray(body.input)) {
    return normalizeText(body.input);
  }
  if (typeof body.prompt === 'string') {
    return body.prompt.trim();
  }
  if (typeof body.query === 'string') {
    return body.query.trim();
  }
  return '';
}

function parseUrlBase(baseUrl) {
  return url.parse(baseUrl);
}

function doJsonRequest(endpoint, payload, callback) {
  var parsed = parseUrlBase(endpoint.base_url);
  var transport = parsed.protocol === 'http:' ? http : https;
  var headers = mergeObjects(endpoint.headers || {}, {});
  var body = JSON.stringify(payload);
  var req;
  var timeoutMs;
  var watchdog;
  var done = once(function(err, response, raw) {
    if (watchdog) {
      clearTimeout(watchdog);
      watchdog = null;
    }
    callback(err, response, raw);
  });
  headers['Content-Type'] = 'application/json';
  headers['Content-Length'] = Buffer.byteLength(body);
  headers.Connection = 'close';
  if (endpoint.api_key && !headers.Authorization) {
    headers.Authorization = 'Bearer ' + endpoint.api_key;
  }
  timeoutMs = endpoint.timeout_ms || 30000;

  var options = {
    protocol: parsed.protocol,
    hostname: parsed.hostname,
    port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
    path: defaultPathForProvider(endpoint),
    method: 'POST',
    agent: false,
    headers: headers,
    timeout: timeoutMs
  };

  req = transport.request(options, function(response) {
    var raw = '';
    response.on('error', function(err) {
      done(err);
    });
    response.on('aborted', function() {
      done(new Error('upstream_response_aborted'));
    });
    attachSocketErrorGuard(response.socket, function(err) {
      done(err);
    });
    response.on('data', function(chunk) { raw += chunk; });
    response.on('end', function() {
      done(null, response, raw);
    });
  });

  req.on('socket', function(socket) {
    attachSocketErrorGuard(socket, function(err) {
      done(err);
    });
  });
  req.on('error', function(err) {
    done(err);
  });

  req.on('timeout', function() {
    req.destroy(new Error('timeout'));
  });

  watchdog = setTimeout(function() {
    req.destroy(new Error('request_watchdog_timeout'));
    done(new Error('timeout'));
  }, timeoutMs + 1000);

  req.write(body);
  req.end();
}

function doStreamingRequest(endpoint, payload, onResponse, onError) {
  var parsed = parseUrlBase(endpoint.base_url);
  var transport = parsed.protocol === 'http:' ? http : https;
  var headers = mergeObjects(endpoint.headers || {}, {});
  var body = JSON.stringify(payload);
  var fail = once(onError || function() {});
  headers['Content-Type'] = 'application/json';
  headers['Content-Length'] = Buffer.byteLength(body);
  headers.Connection = 'close';
  if (endpoint.api_key && !headers.Authorization) {
    headers.Authorization = 'Bearer ' + endpoint.api_key;
  }

  var options = {
    protocol: parsed.protocol,
    hostname: parsed.hostname,
    port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
    path: defaultPathForProvider(endpoint),
    method: 'POST',
    agent: false,
    headers: headers,
    timeout: endpoint.timeout_ms || 30000
  };

  var req = transport.request(options, function(response) {
    response.on('error', function(err) {
      fail(err);
    });
    response.on('aborted', function() {
      fail(new Error('upstream_response_aborted'));
    });
    attachSocketErrorGuard(response.socket, function(err) {
      fail(err);
    });
    try {
      onResponse(response);
    } catch (err) {
      fail(err);
    }
  });
  req.on('socket', function(socket) {
    attachSocketErrorGuard(socket, function(err) {
      fail(err);
    });
  });
  req.on('error', fail);
  req.on('timeout', function() {
    req.destroy(new Error('timeout'));
  });
  req.write(body);
  req.end();
  return req;
}

function parseClassifierResponse(raw) {
  var parsed;
  var match;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { tag: 'unknown', confidence: 0.01, source: 'classifier_parse_error' };
  }

  if (parsed.tag || parsed.category || parsed.label) {
    return {
      tag: String(parsed.tag || parsed.category || parsed.label).toLowerCase(),
      confidence: Number(parsed.confidence || 0.5),
      source: 'classifier_provider'
    };
  }

  if (parsed.choices && parsed.choices[0] && parsed.choices[0].message && typeof parsed.choices[0].message.content === 'string') {
    try {
      parsed = JSON.parse(parsed.choices[0].message.content);
      if (parsed.tag) {
        return {
          tag: String(parsed.tag).toLowerCase(),
          confidence: Number(parsed.confidence || 0.5),
          source: 'classifier_provider_model'
        };
      }
    } catch (ignore) {
      match = parsed.choices[0].message.content.match(/"(tag|category|label)"\s*:\s*"([^"]+)"/i);
      if (match && match[2]) {
        return {
          tag: String(match[2]).toLowerCase(),
          confidence: 0.5,
          source: 'classifier_provider_model'
        };
      }
    }
  }

  return { tag: 'unknown', confidence: 0.05, source: 'classifier_unknown' };
}

function classifyPrompt(config, promptText, stage, callback) {
  var classifiers = ((config || {}).resources || {}).classifiers || {};
  var endpoint = stage && stage.classifier ? classifiers[stage.classifier] : null;
  var tags = (stage && stage.tags && stage.tags.length) ? stage.tags : (((config || {})._derived || {}).candidate_tags || []);
  var template;
  var systemPrompt;
  var classifierPromptText = truncateClassifierPrompt(config, promptText || '');
  if (!endpoint) {
    callback({ tag: 'unknown', confidence: 0.01, source: 'classifier_missing' });
    return;
  }
  template = (stage && stage.prompt_template) || endpoint.classification_prompt_template;
  systemPrompt = configLib.renderClassificationPrompt(template, tags);
  var payload = {
    model: endpoint.model,
    temperature: 0,
    max_tokens: 32,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: classifierPromptText }
    ]
  };

  doJsonRequest(endpoint, payload, function(err, response, raw) {
    var parsed;
    if (err) {
      callback({ tag: 'unknown', confidence: 0.01, source: 'classifier_error' });
      return;
    }
    if (response.statusCode >= 400) {
      callback({ tag: 'unknown', confidence: 0.01, source: 'classifier_http_error' });
      return;
    }
    parsed = parseClassifierResponse(raw);
    parsed.tag = ensureCandidateTag({ _derived: { candidate_tags: tags }, runtime: config.runtime }, parsed.tag);
    callback(parsed);
  });
}

function textFromContent(content) {
  return normalizeText(content);
}

function messagesFromResponsesInput(inputValue) {
  var messages = [];
  var i;
  var item;
  var text;
  if (typeof inputValue === 'string') {
    text = inputValue.trim();
    if (text) {
      messages.push({ role: 'user', content: text });
    }
    return messages;
  }
  if (Array.isArray(inputValue)) {
    for (i = 0; i < inputValue.length; i += 1) {
      item = inputValue[i];
      if (item && item.role) {
        text = textFromContent(item.content || item.input || '');
        if (text) {
          messages.push({ role: item.role === 'assistant' ? 'assistant' : 'user', content: text });
        }
      } else {
        text = textFromContent(item);
        if (text) {
          messages.push({ role: 'user', content: text });
        }
      }
    }
  }
  return messages;
}

function buildDownstreamMessages(endpointName, endpointConfig, northboundType, body, systemPromptOverride) {
  var messages = [];
  var systemPrompt = systemPromptOverride !== undefined ? systemPromptOverride : endpointConfig.system_prompt;
  var i;
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  if (northboundType === 'chat') {
    for (i = 0; i < (body.messages || []).length; i += 1) {
      if (body.messages[i] && body.messages[i].role) {
        messages.push({
          role: body.messages[i].role,
          content: textFromContent(body.messages[i].content || '')
        });
      }
    }
  } else {
    if (typeof body.instructions === 'string' && body.instructions.trim()) {
      messages.push({ role: 'system', content: body.instructions.trim() });
    }
    messages = messages.concat(messagesFromResponsesInput(body.input));
  }
  return messages.filter(function(item) { return item.content; });
}

function hasConfiguredValue(value) {
  return value !== undefined && value !== null;
}

function copyWhitelistedFields(target, source, fields) {
  var i;
  var field;
  for (i = 0; i < fields.length; i += 1) {
    field = fields[i];
    if (hasConfiguredValue(source[field])) {
      target[field] = source[field];
    }
  }
}

function resolveModelName(endpointName, endpointConfig, body) {
  if (endpointConfig.accept_client_model && body.model) {
    return body.model;
  }
  if (body.model && body.model === endpointName) {
    return endpointConfig.model;
  }
  if (endpointConfig.client_model_aliases && body.model && endpointConfig.client_model_aliases[body.model]) {
    return endpointConfig.client_model_aliases[body.model];
  }
  return endpointConfig.model;
}

function buildDownstreamPayload(endpointName, endpointConfig, northboundType, body, systemPromptOverride) {
  var payload = {
    model: resolveModelName(endpointName, endpointConfig, body),
    messages: buildDownstreamMessages('', endpointConfig, northboundType, body, systemPromptOverride),
    stream: !!body.stream
  };
  copyWhitelistedFields(payload, body, [
    'stream_options',
    'top_p',
    'presence_penalty',
    'frequency_penalty',
    'stop',
    'n',
    'seed',
    'tools',
    'tool_choice',
    'parallel_tool_calls',
    'response_format',
    'user',
    'logit_bias',
    'logprobs',
    'top_logprobs',
    'modalities',
    'audio',
    'metadata',
    'service_tier',
    'reasoning_effort'
  ]);
  if (hasConfiguredValue(body.temperature)) {
    payload.temperature = body.temperature;
  } else if (hasConfiguredValue(endpointConfig.temperature)) {
    payload.temperature = endpointConfig.temperature;
  } else {
    payload.temperature = 0.2;
  }
  if (hasConfiguredValue(body.max_tokens)) {
    payload.max_tokens = body.max_tokens;
  } else if (hasConfiguredValue(body.max_completion_tokens)) {
    payload.max_tokens = body.max_completion_tokens;
  } else if (hasConfiguredValue(endpointConfig.max_tokens)) {
    payload.max_tokens = endpointConfig.max_tokens;
  } else {
    payload.max_tokens = 256;
  }
  return payload;
}

function resolvePublicModelName(endpointName, body) {
  if (body && typeof body.model === 'string' && body.model.trim()) {
    return body.model.trim();
  }
  return endpointName || '';
}

function responseHeaders(tag, target, source, state, requestIdValue) {
  var headers = {
    'X-Semantic-Tag': tag,
    'X-Model-Endpoint': target,
    'X-Semantic-Source': source
  };
  if (requestIdValue) {
    headers['X-Gateway-Request-Id'] = requestIdValue;
  }
  if (state) {
    headers['X-Gateway-Config-Version'] = String(state.version);
    if (state.content_hash) {
      headers['X-Gateway-Config-Hash'] = state.content_hash.substring(0, 12);
    }
  }
  return headers;
}

function listModelsResponse(config) {
  var endpoints = (config && config.model_endpoints) || {};
  var names = Object.keys(endpoints);
  var now = Math.floor(Date.now() / 1000);
  return {
    object: 'list',
    data: names.map(function(name) {
      return {
        id: name,
        object: 'model',
        created: now,
        owned_by: 'f5-ai-gateway',
        root: endpoints[name].model || name
      };
    })
  };
}

function buildChatResponse(upstreamJson, modelName) {
  var out = mergeObjects({}, upstreamJson || {});
  if (!out.id) {
    out.id = 'chatcmpl-' + String(Date.now());
  }
  out.object = out.object || 'chat.completion';
  out.created = out.created || Math.floor(Date.now() / 1000);
  out.model = modelName || out.model || '';
  if (!Array.isArray(out.choices) || out.choices.length === 0) {
    out.choices = [
      {
        index: 0,
        message: { role: 'assistant', content: '' },
        finish_reason: 'stop'
      }
    ];
  } else {
    out.choices = out.choices.map(function(choice, index) {
      var normalizedChoice = mergeObjects({}, choice || {});
      if (normalizedChoice.index === undefined) {
        normalizedChoice.index = index;
      }
      if (!normalizedChoice.message) {
        normalizedChoice.message = { role: 'assistant', content: '' };
      }
      if (normalizedChoice.finish_reason === undefined) {
        normalizedChoice.finish_reason = 'stop';
      }
      return normalizedChoice;
    });
  }
  if (out.usage === undefined) {
    out.usage = {};
  }
  return out;
}

function buildResponsesResponse(upstreamJson, modelName) {
  var content = '';
  if (upstreamJson.choices && upstreamJson.choices[0] && upstreamJson.choices[0].message) {
    content = upstreamJson.choices[0].message.content || '';
  }
  return {
    id: 'resp_' + String(Date.now()),
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    status: 'completed',
    model: modelName || upstreamJson.model || '',
    output: [
      {
        id: 'msg_' + String(Date.now()),
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: content,
            annotations: []
          }
        ]
      }
    ],
    usage: upstreamJson.usage || {}
  };
}

function buildStaticChatResponse(message, modelName) {
  return {
    id: 'chatcmpl-' + String(Date.now()),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: modelName || '',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: message },
        finish_reason: 'stop'
      }
    ],
    usage: {}
  };
}

function buildStaticResponsesResponse(message, modelName) {
  return {
    id: 'resp_' + String(Date.now()),
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    status: 'completed',
    model: modelName || '',
    output: [
      {
        id: 'msg_' + String(Date.now() + 1),
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: message,
            annotations: []
          }
        ]
      }
    ],
    usage: {}
  };
}

function normalizeChatChunk(chunkJson, publicModelName) {
  var out = mergeObjects({}, chunkJson || {});
  if (!out.id) {
    out.id = 'chatcmpl-' + String(Date.now());
  }
  out.object = out.object || 'chat.completion.chunk';
  out.created = out.created || Math.floor(Date.now() / 1000);
  out.model = publicModelName || out.model || '';
  if (out.choices === undefined) {
    out.choices = [
      {
        index: 0,
        delta: {},
        finish_reason: null
      }
    ];
  } else if (Array.isArray(out.choices)) {
    out.choices = out.choices.map(function(choice, index) {
      var normalizedChoice = mergeObjects({}, choice || {});
      if (normalizedChoice.index === undefined) {
        normalizedChoice.index = index;
      }
      if (normalizedChoice.delta && typeof normalizedChoice.delta === 'object' && !Array.isArray(normalizedChoice.delta)) {
        normalizedChoice.delta = mergeObjects({}, normalizedChoice.delta);
      }
      return normalizedChoice;
    });
  }
  return out;
}

function respondChatStream(res, message, headers, modelName) {
  var responseId = 'chatcmpl-' + String(Date.now());
  res.shouldKeepAlive = false;
  res.writeHead(200, buildNorthboundHeaders(headers, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache'
  }));
  res.write('data: ' + JSON.stringify({
    id: responseId,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: modelName || '',
    choices: [
      { index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }
    ]
  }) + '\n\n');
  res.write('data: ' + JSON.stringify({
    id: responseId,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: modelName || '',
    choices: [
      { index: 0, delta: { content: message }, finish_reason: null }
    ]
  }) + '\n\n');
  res.write('data: ' + JSON.stringify({
    id: responseId,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: modelName || '',
    choices: [
      { index: 0, delta: {}, finish_reason: 'stop' }
    ]
  }) + '\n\n');
  res.write('data: [DONE]\n\n');
  res.end();
}

function respondResponsesStream(res, message, headers, modelName) {
  var responseId = 'resp_' + String(Date.now());
  var itemId = 'msg_' + String(Date.now() + 1);
  res.shouldKeepAlive = false;
  res.writeHead(200, buildNorthboundHeaders(headers, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache'
  }));
  res.write('event: response.created\n');
  res.write('data: ' + JSON.stringify({
    type: 'response.created',
    response: { id: responseId, object: 'response', model: modelName || '', status: 'in_progress' }
  }) + '\n\n');
  res.write('event: response.output_text.delta\n');
  res.write('data: ' + JSON.stringify({
    type: 'response.output_text.delta',
    response_id: responseId,
    item_id: itemId,
    output_index: 0,
    content_index: 0,
    delta: message
  }) + '\n\n');
  res.write('event: response.completed\n');
  res.write('data: ' + JSON.stringify({
    type: 'response.completed',
    response: { id: responseId, object: 'response', model: modelName || '', status: 'completed' }
  }) + '\n\n');
  res.write('data: [DONE]\n\n');
  res.end();
}

function proxyChatStream(res, endpointConfig, payload, headers, publicModelName) {
  var upstreamReq;
  var upstreamFinished = false;

  function handleStreamError(err) {
    upstreamFinished = true;
    if (res.headersSent) {
      if (canWriteResponse(res)) {
        res.end();
      }
      return;
    }
    sendError(res, 502, 'Failed to reach upstream model endpoint.', 'upstream_error', 'upstream_error', headers, err.message);
  }

  upstreamReq = doStreamingRequest(endpointConfig, payload, function(upstreamRes) {
    var buffer = '';
    if ((upstreamRes.statusCode || 500) >= 400) {
      var raw = '';
      upstreamRes.on('data', function(chunk) {
        raw += chunk.toString('utf8');
      });
      upstreamRes.on('end', function() {
        upstreamFinished = true;
        sendError(res, upstreamRes.statusCode || 502, 'Upstream model returned an error.', 'upstream_http_error', 'upstream_http_error', headers, raw);
      });
      return;
    }
    res.shouldKeepAlive = false;
    res.writeHead(upstreamRes.statusCode || 200, buildNorthboundHeaders(headers, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache'
    }));
    upstreamRes.on('data', function(chunk) {
      var lines;
      var i;
      var line;
      var parsed;
      buffer += chunk.toString('utf8');
      lines = buffer.split('\n');
      buffer = lines.pop();
      for (i = 0; i < lines.length; i += 1) {
        line = lines[i].replace(/\r$/, '');
        if (!line) {
          continue;
        }
        if (line === 'data: [DONE]') {
          res.write('data: [DONE]\n\n');
          continue;
        }
        if (line.indexOf('data: ') !== 0) {
          continue;
        }
        try {
          parsed = JSON.parse(line.substring(6));
        } catch (ignore) {
          continue;
        }
        res.write('data: ' + JSON.stringify(normalizeChatChunk(parsed, publicModelName)) + '\n\n');
      }
    });
    upstreamRes.on('end', function() {
      upstreamFinished = true;
      res.end();
    });
  }, handleStreamError);

  res.on('close', function() {
    if (!upstreamFinished && upstreamReq && typeof upstreamReq.destroy === 'function' && !upstreamReq.destroyed && !res.writableEnded) {
      upstreamReq.destroy();
    }
  });
}

function parseChatDelta(chunkJson) {
  var choices = chunkJson.choices || [];
  if (!choices[0] || !choices[0].delta) {
    return '';
  }
  if (typeof choices[0].delta.content === 'string') {
    return choices[0].delta.content;
  }
  return '';
}

function proxyResponsesStream(res, endpointConfig, payload, headers, publicModelName) {
  var responseId = 'resp_' + String(Date.now());
  var itemId = 'msg_' + String(Date.now() + 1);
  var upstreamReq;
  var upstreamFinished = false;

  function handleStreamError(err) {
    upstreamFinished = true;
    if (res.headersSent) {
      if (canWriteResponse(res)) {
        res.end();
      }
      return;
    }
    sendError(res, 502, 'Failed to reach upstream model endpoint.', 'upstream_error', 'upstream_error', headers, err.message);
  }

  upstreamReq = doStreamingRequest(endpointConfig, payload, function(upstreamRes) {
    var buffer = '';
    if ((upstreamRes.statusCode || 500) >= 400) {
      var raw = '';
      upstreamRes.on('data', function(chunk) {
        raw += chunk.toString('utf8');
      });
      upstreamRes.on('end', function() {
        upstreamFinished = true;
        sendError(res, upstreamRes.statusCode || 502, 'Upstream model returned an error.', 'upstream_http_error', 'upstream_http_error', headers, raw);
      });
      return;
    }
    res.shouldKeepAlive = false;
    res.writeHead(upstreamRes.statusCode || 200, buildNorthboundHeaders(headers, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache'
    }));
    res.write('event: response.created\n');
    res.write('data: ' + JSON.stringify({
      type: 'response.created',
      response: { id: responseId, object: 'response', model: publicModelName, status: 'in_progress' }
    }) + '\n\n');

    upstreamRes.on('data', function(chunk) {
      var lines;
      var i;
      var line;
      var parsed;
      var delta;
      buffer += chunk.toString('utf8');
      lines = buffer.split('\n');
      buffer = lines.pop();
      for (i = 0; i < lines.length; i += 1) {
        line = lines[i].replace(/\r$/, '');
        if (!line) {
          continue;
        }
        if (line === 'data: [DONE]') {
          res.write('event: response.completed\n');
          res.write('data: ' + JSON.stringify({
            type: 'response.completed',
            response: { id: responseId, object: 'response', model: publicModelName, status: 'completed' }
          }) + '\n\n');
          res.write('data: [DONE]\n\n');
          continue;
        }
        if (line.indexOf('data: ') !== 0) {
          continue;
        }
        try {
          parsed = JSON.parse(line.substring(6));
        } catch (ignore) {
          continue;
        }
        delta = parseChatDelta(parsed);
        if (delta) {
          res.write('event: response.output_text.delta\n');
          res.write('data: ' + JSON.stringify({
            type: 'response.output_text.delta',
            response_id: responseId,
            item_id: itemId,
            output_index: 0,
            content_index: 0,
            delta: delta
          }) + '\n\n');
        }
      }
    });
    upstreamRes.on('end', function() {
      upstreamFinished = true;
      res.end();
    });
  }, handleStreamError);

  res.on('close', function() {
    if (!upstreamFinished && upstreamReq && typeof upstreamReq.destroy === 'function' && !upstreamReq.destroyed && !res.writableEnded) {
      upstreamReq.destroy();
    }
  });
}

function requestPathname(req, body) {
  if (req && req.url) {
    return url.parse(req.url).pathname || '/';
  }
  if (body && typeof body.path === 'string' && body.path.trim()) {
    return body.path.trim();
  }
  return '/';
}

function requestHeaders(req, body) {
  var headers = {};
  var source = (req && req.headers) || (body && body.headers) || {};
  var key;

  for (key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined && source[key] !== null) {
      headers[String(key).toLowerCase()] = String(source[key]);
    }
  }

  return headers;
}

function requestTenant(req, body, headers) {
  if (body && typeof body.tenant === 'string' && body.tenant.trim()) {
    return body.tenant.trim();
  }
  if (headers['x-tenant']) {
    return headers['x-tenant'];
  }
  return '';
}

function requestId(headers) {
  if (headers['x-request-id']) {
    return headers['x-request-id'];
  }
  return 'gw-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 8);
}

function requestTraceEnabled(headers) {
  var value = String(headers['x-gateway-trace'] || headers['x-debug-trace'] || '').toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

function newIngressTraceMeta(req) {
  var headers = requestHeaders(req);
  return {
    request_id: requestId(headers),
    trace_enabled: requestTraceEnabled(headers),
    method: (req && req.method) || '',
    path: requestPathname(req),
    content_length: declaredContentLength(req),
    started_at_ms: Date.now()
  };
}

function ingressTraceHeaders(traceMeta) {
  if (!traceMeta || !traceMeta.request_id) {
    return null;
  }
  return {
    'X-Gateway-Request-Id': traceMeta.request_id
  };
}

function maybeLogIngressEvent(traceMeta, phase, extra) {
  var payload;
  var key;
  if (!traceMeta || !traceMeta.trace_enabled) {
    return;
  }
  payload = {
    request_id: traceMeta.request_id,
    phase: phase,
    method: traceMeta.method,
    path: traceMeta.path,
    content_length: traceMeta.content_length,
    elapsed_ms: Date.now() - (traceMeta.started_at_ms || Date.now())
  };
  if (extra) {
    for (key in extra) {
      if (Object.prototype.hasOwnProperty.call(extra, key)) {
        payload[key] = extra[key];
      }
    }
  }
  console.log('GW_INGRESS ' + JSON.stringify(payload));
}

function newExecutionContext(req, res, northboundType, body, config, runtimeState, dryRun) {
  var pathname = requestPathname(req, body);
  var headers = requestHeaders(req, body);
  var publicModelName = resolvePublicModelName('', body);
  return {
    req: req,
    res: res,
    northboundType: northboundType,
    body: body,
    config: config,
    runtimeState: runtimeState,
    dryRun: !!dryRun,
    publicModelName: publicModelName,
    request_meta: {
      request_id: requestId(headers),
      path: pathname,
      headers: headers,
      tenant: requestTenant(req, body, headers),
      client_model: publicModelName,
      trace_enabled: requestTraceEnabled(headers)
    },
    normalized: {
      prompt_text: '',
      northbound_type: northboundType
    },
    classification: null,
    policy: null,
    routing: {
      endpoint: null,
      downstream_model: null
    },
    overrides: {
      system_prompt: undefined
    },
    decision: {
      terminal: false,
      response_preview: null
    },
    trace: {
      request_started_at_ms: Date.now(),
      stages: [],
      operations: []
    }
  };
}

function buildEvaluationResult(ctx) {
  return {
    request_id: ctx.request_meta.request_id,
    config_version: ctx.runtimeState.version,
    config_hash: ctx.runtimeState.content_hash,
    northbound_type: ctx.northboundType,
    public_model_name: ctx.publicModelName,
    request_meta: ctx.request_meta,
    prompt_text: ctx.normalized.prompt_text,
    classification: ctx.classification,
    policy: ctx.policy,
    selected_endpoint: ctx.routing.endpoint,
    downstream_model: ctx.routing.downstream_model,
    overrides: ctx.overrides,
    terminal: ctx.decision.terminal,
    response_preview: ctx.decision.response_preview,
    trace: ctx.trace
  };
}

function completeStage(stageTrace, status, extra) {
  var key;
  stageTrace.status = status;
  if (!stageTrace.ended_at_ms) {
    stageTrace.ended_at_ms = Date.now();
  }
  if (stageTrace.started_at_ms) {
    stageTrace.duration_ms = stageTrace.ended_at_ms - stageTrace.started_at_ms;
  }
  if (extra) {
    for (key in extra) {
      if (Object.prototype.hasOwnProperty.call(extra, key)) {
        stageTrace[key] = extra[key];
      }
    }
  }
}

function maybeLogRequestTrace(ctx, phase, extra) {
  var payload;
  var elapsedMs;
  if (!ctx || !ctx.request_meta || !ctx.request_meta.trace_enabled) {
    return;
  }
  if (phase === 'start') {
    return;
  }
  elapsedMs = Date.now() - (ctx.trace.request_started_at_ms || Date.now());
  if (phase !== 'error' && elapsedMs < TRACE_SLOW_THRESHOLD_MS && !(extra && extra.force)) {
    return;
  }
  payload = {
    request_id: ctx.request_meta.request_id,
    phase: phase,
    northbound_type: ctx.northboundType,
    path: ctx.request_meta.path,
    client_model: ctx.request_meta.client_model,
    elapsed_ms: elapsedMs,
    classification: ctx.classification ? {
      tag: ctx.classification.tag,
      confidence: ctx.classification.confidence,
      source: ctx.classification.source
    } : null,
    selected_endpoint: ctx.routing.endpoint || null,
    stages: ctx.trace.stages.map(function(stage) {
      return {
        name: stage.name,
        status: stage.status,
        duration_ms: stage.duration_ms,
        error: stage.error
      };
    }),
    operations: ctx.trace.operations.map(function(operation) {
      return {
        action: operation.action,
        status: operation.status,
        duration_ms: operation.duration_ms,
        error: operation.error
      };
    })
  };
  if (extra) {
    payload.extra = extra;
  }
  console.log('GW_TRACE ' + JSON.stringify(payload));
}

function executeRespond(ctx, operation, callback) {
  var headers = responseHeaders(
    (ctx.classification && ctx.classification.tag) || ctx.config.runtime.fallback_tag,
    'respond',
    (ctx.classification && ctx.classification.source) || 'pipeline',
    ctx.runtimeState,
    ctx.request_meta.request_id
  );
  ctx.decision.response_preview = {
    action: 'respond',
    message: operation.message || ''
  };
  ctx.decision.terminal = true;
  if (ctx.dryRun) {
    callback();
    return;
  }
  if (ctx.body.stream) {
    if (ctx.northboundType === 'chat') {
      respondChatStream(ctx.res, operation.message || '', headers, ctx.publicModelName);
    } else {
      respondResponsesStream(ctx.res, operation.message || '', headers, ctx.publicModelName);
    }
  } else if (ctx.northboundType === 'chat') {
    sendJson(ctx.res, 200, buildStaticChatResponse(operation.message || '', ctx.publicModelName), headers);
  } else {
    sendJson(ctx.res, 200, buildStaticResponsesResponse(operation.message || '', ctx.publicModelName), headers);
  }
  callback();
}

function executeDrop(ctx, operation, callback) {
  ctx.decision.response_preview = {
    action: 'drop'
  };
  ctx.decision.terminal = true;
  if (ctx.dryRun) {
    callback();
    return;
  }
  sendError(
    ctx.res,
    403,
    'Request rejected due to content policy.',
    'policy_violation',
    'content_filtered',
    responseHeaders(
      (ctx.classification && ctx.classification.tag) || ctx.config.runtime.fallback_tag,
      'drop',
      (ctx.classification && ctx.classification.source) || 'pipeline',
      ctx.runtimeState,
      ctx.request_meta.request_id
    )
  );
  callback();
}

function executeRoute(ctx, operation, callback) {
  var endpointConfig;
  if (!operation.endpoint || !ctx.config.model_endpoints[operation.endpoint]) {
    callback(new Error('pipeline route operation references invalid endpoint'));
    return;
  }
  endpointConfig = ctx.config.model_endpoints[operation.endpoint];
  ctx.routing.endpoint = operation.endpoint;
  ctx.routing.downstream_model = resolveModelName(operation.endpoint, endpointConfig, ctx.body);
  callback();
}

function executeSetSystemPrompt(ctx, operation, callback) {
  ctx.overrides.system_prompt = operation.value;
  callback();
}

var OPERATION_HANDLERS = {
  respond: executeRespond,
  drop: executeDrop,
  route: executeRoute,
  set_system_prompt: executeSetSystemPrompt
};

function executeOperations(ctx, operations, callback) {
  var opList = configLib.ensureArray(operations);
  var index = 0;

  function next(err) {
    var operation;
    var operationTrace;
    var handler;
    if (err || ctx.decision.terminal || index >= opList.length) {
      callback(err);
      return;
    }
    operation = opList[index];
    operationTrace = {
      index: index,
      action: operation.action,
      status: 'running',
      started_at_ms: Date.now()
    };
    ctx.trace.operations.push(operationTrace);
    index += 1;
    handler = OPERATION_HANDLERS[operation.action];
    if (!handler) {
      operationTrace.status = 'error';
      operationTrace.error = 'unsupported_operation';
      callback(new Error('Unsupported pipeline operation: ' + operation.action));
      return;
    }
    handler(ctx, operation, function(handlerErr) {
      if (handlerErr) {
        completeStage(operationTrace, 'error', { error: handlerErr.message });
        callback(handlerErr);
        return;
      }
      completeStage(operationTrace, 'ok');
      if (operation.action === 'route') {
        operationTrace.endpoint = ctx.routing.endpoint;
        operationTrace.downstream_model = ctx.routing.downstream_model;
      }
      if (operation.action === 'set_system_prompt') {
        operationTrace.system_prompt_set = true;
      }
      if (ctx.decision.response_preview) {
        operationTrace.response_preview = ctx.decision.response_preview;
      }
      next();
    });
  }

  next();
}

function matchesPolicyRule(ctx, rule) {
  var when = (rule && rule.when) || {};
  var headerKey;
  var regex;
  if (when.tag && (!ctx.classification || when.tag !== ctx.classification.tag)) {
    return false;
  }
  if (when.confidence_gte !== undefined && (!ctx.classification || Number(ctx.classification.confidence || 0) < Number(when.confidence_gte))) {
    return false;
  }
  if (when.northbound_type && when.northbound_type !== ctx.northboundType) {
    return false;
  }
  if (when.client_model && when.client_model !== ctx.request_meta.client_model) {
    return false;
  }
  if (when.path && when.path !== ctx.request_meta.path) {
    return false;
  }
  if (when.tenant && when.tenant !== ctx.request_meta.tenant) {
    return false;
  }
  if (when.headers) {
    for (headerKey in when.headers) {
      if (Object.prototype.hasOwnProperty.call(when.headers, headerKey)) {
        if (ctx.request_meta.headers[String(headerKey).toLowerCase()] !== String(when.headers[headerKey])) {
          return false;
        }
      }
    }
  }
  if (when.prompt_regex) {
    regex = when._compiled_prompt_regex || new RegExp(when.prompt_regex);
    if (!regex.test(ctx.normalized.prompt_text || '')) {
      return false;
    }
  }
  return true;
}

function invokeModel(ctx, callback) {
  var endpointConfig;
  var payload;
  var headers;

  if (!ctx.routing.endpoint || !ctx.config.model_endpoints[ctx.routing.endpoint]) {
    callback(new Error('no downstream endpoint selected'));
    return;
  }

  endpointConfig = ctx.config.model_endpoints[ctx.routing.endpoint];
  payload = buildDownstreamPayload(ctx.routing.endpoint, endpointConfig, ctx.northboundType, ctx.body, ctx.overrides.system_prompt);
  headers = responseHeaders(
    (ctx.classification && ctx.classification.tag) || ctx.config.runtime.fallback_tag,
    ctx.routing.endpoint,
    (ctx.classification && ctx.classification.source) || 'pipeline',
    ctx.runtimeState,
    ctx.request_meta.request_id
  );
  ctx.routing.downstream_model = payload.model;
  ctx.decision.response_preview = {
    action: 'route',
    endpoint: ctx.routing.endpoint,
    downstream_model: ctx.routing.downstream_model
  };

  if (ctx.dryRun) {
    ctx.decision.terminal = true;
    callback();
    return;
  }

  if (ctx.body.stream) {
    if (ctx.northboundType === 'chat') {
      proxyChatStream(ctx.res, endpointConfig, payload, headers, ctx.publicModelName);
    } else {
      proxyResponsesStream(ctx.res, endpointConfig, payload, headers, ctx.publicModelName);
    }
    ctx.decision.terminal = true;
    callback();
    return;
  }

  doJsonRequest(endpointConfig, payload, function(err, upstreamRes, raw) {
    var parsed;
    if (err) {
      callback(err);
      return;
    }
    if (upstreamRes.statusCode >= 400) {
      callback(new Error('upstream_http_error:' + raw));
      return;
    }
    try {
      parsed = JSON.parse(raw);
    } catch (parseErr) {
      callback(parseErr);
      return;
    }
    if (ctx.northboundType === 'chat') {
      sendJson(ctx.res, 200, buildChatResponse(parsed, ctx.publicModelName), headers);
    } else {
      sendJson(ctx.res, 200, buildResponsesResponse(parsed, ctx.publicModelName), headers);
    }
    ctx.decision.terminal = true;
    callback();
  });
}

var STAGE_HANDLERS = {
  normalize: function(ctx, stage, callback) {
    ctx.normalized.prompt_text = extractPrompt(ctx.body);
    if (!ctx.normalized.prompt_text) {
      callback(new Error('empty_prompt'));
      return;
    }
    callback();
  },
  classify: function(ctx, stage, callback) {
    classifyPrompt(ctx.config, ctx.normalized.prompt_text, stage, function(classification) {
      ctx.classification = classification;
      callback();
    });
  },
  policy: function(ctx, stage, callback) {
    var rules = stage.rules || [];
    var i;
    var matchedRule = null;
    var operations;
    for (i = 0; i < rules.length; i += 1) {
      if (matchesPolicyRule(ctx, rules[i])) {
        matchedRule = rules[i];
        break;
      }
    }
    operations = matchedRule ? matchedRule.then : stage.default;
    if (!operations) {
      callback(new Error('no_policy_match'));
      return;
    }
    ctx.policy = {
      rule_id: matchedRule ? (matchedRule.id || null) : null,
      when: matchedRule ? matchedRule.when : null,
      operations: configLib.ensureArray(operations)
    };
    executeOperations(ctx, operations, callback);
  },
  invoke_model: function(ctx, stage, callback) {
    if (ctx.decision.terminal) {
      callback();
      return;
    }
    invokeModel(ctx, callback);
  },
  egress_transform: function(ctx, stage, callback) {
    callback();
  }
};

function runPipeline(ctx, callback) {
  var stages = ctx.config.pipeline || [];
  var index = 0;

  function next(err) {
    var stage;
    var handler;
    var stageTrace;
    if (err || index >= stages.length || ctx.decision.terminal) {
      callback(err, ctx);
      return;
    }
    stage = stages[index];
    stageTrace = {
      index: index,
      name: stage.name,
      status: 'running',
      started_at_ms: Date.now()
    };
    ctx.trace.stages.push(stageTrace);
    index += 1;
    handler = STAGE_HANDLERS[stage.name];
    if (!handler) {
      completeStage(stageTrace, 'error', { error: 'unsupported_stage' });
      callback(new Error('Unsupported pipeline stage: ' + stage.name), ctx);
      return;
    }
    handler(ctx, stage, function(stageErr) {
      if (stageErr) {
        completeStage(stageTrace, 'error', { error: stageErr.message });
        callback(stageErr, ctx);
        return;
      }
      completeStage(stageTrace, 'ok', {
        tag: ctx.classification ? ctx.classification.tag : undefined,
        endpoint: ctx.routing.endpoint || undefined,
        terminal: ctx.decision.terminal
      });
      next();
    });
  }

  next();
}

function sendPipelineError(res, err, ctx) {
  var code = err && err.message ? err.message : 'pipeline_error';
  var headers = ctx ? responseHeaders(
    (ctx.classification && ctx.classification.tag) || ((ctx.config || {}).runtime || {}).fallback_tag || 'unknown',
    (ctx.routing && ctx.routing.endpoint) || 'error',
    (ctx.classification && ctx.classification.source) || 'pipeline',
    ctx.runtimeState,
    ctx.request_meta && ctx.request_meta.request_id
  ) : null;
  if (code === 'empty_prompt') {
    sendError(res, 400, 'No usable prompt content found in the request.', 'invalid_request_error', 'empty_prompt', headers);
    return;
  }
  if (code === 'no_policy_match') {
    sendError(res, 500, 'No policy rule matched and no default operation is configured.', 'gateway_error', 'no_policy_match', headers, null);
    return;
  }
  if (code === 'no downstream endpoint selected' || code === 'pipeline route operation references invalid endpoint') {
    sendError(res, 502, 'Model endpoint mapping is invalid.', 'gateway_error', 'invalid_model_endpoint', headers, code);
    return;
  }
  if (String(code).indexOf('upstream_http_error:') === 0) {
    sendError(res, 502, 'Upstream model returned an error.', 'upstream_http_error', 'upstream_http_error', headers, String(code).substring(20));
    return;
  }
  sendError(res, 500, 'Pipeline execution failed.', 'gateway_error', 'pipeline_error', headers, code);
}

function handleModelRequest(req, res, northboundType, body, config, runtimeState) {
  var ctx = newExecutionContext(req, res, northboundType, body, config, runtimeState, false);
  maybeLogRequestTrace(ctx, 'start');
  runPipeline(ctx, function(err, finalCtx) {
    if (err) {
      maybeLogRequestTrace(finalCtx, 'error', { error: err.message });
      sendPipelineError(res, err, finalCtx);
      return;
    }
    if (!finalCtx.decision.terminal) {
      maybeLogRequestTrace(finalCtx, 'error', { error: 'pipeline_incomplete' });
      sendError(
        res,
        500,
        'Pipeline completed without terminal action.',
        'gateway_error',
        'pipeline_incomplete',
        responseHeaders(
          (finalCtx.classification && finalCtx.classification.tag) || finalCtx.config.runtime.fallback_tag,
          finalCtx.routing.endpoint || 'pipeline',
          (finalCtx.classification && finalCtx.classification.source) || 'pipeline',
          finalCtx.runtimeState,
          finalCtx.request_meta.request_id
        )
      );
      return;
    }
    maybeLogRequestTrace(finalCtx, 'complete', { terminal: true });
  });
}

function handleEvaluationRequest(res, northboundType, body, config, runtimeState) {
  var ctx = newExecutionContext(null, res, northboundType, body, config, runtimeState, body && body.dry_run !== false);
  runPipeline(ctx, function(err, finalCtx) {
    if (err) {
      sendJson(res, 200, {
        error: err.message,
        evaluation: buildEvaluationResult(finalCtx)
      });
      return;
    }
    sendJson(res, 200, buildEvaluationResult(finalCtx));
  });
}

function normalizePostedConfig(body) {
  var parsed = parsePostedConfig(body);
  var normalized = configLib.validateAndNormalizeConfig(parsed);
  return {
    parsed: parsed,
    normalized: normalized,
    config_text: JSON.stringify(parsed, null, 2),
    summary: configLib.summarizeConfig(normalized)
  };
}

function handleValidateConfigRequest(res, body) {
  var validated;
  try {
    validated = normalizePostedConfig(body);
    sendJson(res, 200, {
      valid: true,
      summary: validated.summary
    });
  } catch (err) {
    sendJson(res, 400, {
      valid: false,
      error: err.message,
      details: err.details || []
    });
  }
}

function handleActivateConfigRequest(res, body) {
  var validated;
  var record;
  var runtime;
  try {
    validated = normalizePostedConfig(body);
    record = storeConfigVersion(validated.config_text, 'activate_api', validated.summary);
    writeConfigAtomically(validated.config_text);
    runtime = refreshActiveConfig(true);
    sendJson(res, 200, {
      activated: true,
      version_id: record.version_id,
      content_hash: record.content_hash,
      summary: validated.summary,
      active_config: runtime.state
    });
  } catch (err) {
    sendJson(res, 400, {
      activated: false,
      error: err.message,
      details: err.details || []
    });
  }
}

function handleRollbackConfigRequest(res, body) {
  var record;
  var parsed;
  var normalized;
  var runtime;
  if (!body || typeof body.version_id !== 'string' || !body.version_id.trim()) {
    sendJson(res, 400, {
      rolled_back: false,
      error: 'version_id is required'
    });
    return;
  }
  try {
    record = loadStoredVersion(body.version_id.trim());
    parsed = JSON.parse(record.config_text);
    normalized = configLib.validateAndNormalizeConfig(parsed);
    writeConfigAtomically(JSON.stringify(parsed, null, 2));
    runtime = refreshActiveConfig(true);
    sendJson(res, 200, {
      rolled_back: true,
      version_id: record.version_id,
      content_hash: record.content_hash,
      summary: configLib.summarizeConfig(normalized),
      active_config: runtime.state
    });
  } catch (err) {
    sendJson(res, 400, {
      rolled_back: false,
      error: err.message,
      details: err.details || []
    });
  }
}

function requestHandler(req, res) {
  var runtime;
  var config;
  var state;
  var needsRuntime;
  var traceMeta = newIngressTraceMeta(req);
  var pathname = requestPathname(req);
  var isChatPath = pathname === '/v1/chat/completions' || pathname === '/chat/completions';
  var isResponsesPath = pathname === '/v1/responses' || pathname === '/responses';
  var isModelsPath = pathname === '/v1/models' || pathname === '/models';
  var isHealthPath = pathname === '/health';
  var isSchemaPath = pathname === '/admin/config/schema';
  var isConfigStatusPath = pathname === '/admin/config/status';
  var isConfigVersionsPath = pathname === '/admin/config/versions';
  var isConfigValidatePath = pathname === '/admin/config/validate';
  var isConfigActivatePath = pathname === '/admin/config/activate';
  var isConfigRollbackPath = pathname === '/admin/config/rollback';
  var isPolicyListPath = pathname === '/admin/policy/list';
  var isEvaluatePath = pathname === '/admin/evaluate';
  var bodyLimit;
  var contentLength;

  attachServerStreamGuards(req, res);
  maybeLogIngressEvent(traceMeta, 'request_received');

  needsRuntime = !(isSchemaPath || isConfigVersionsPath ||
    (req.method === 'POST' && (isConfigValidatePath || isConfigActivatePath || isConfigRollbackPath)));

  if (req.method === 'GET' && isSchemaPath) {
    sendJson(res, 200, {
      schema_version: configLib.CONFIG_SCHEMA_VERSION,
      schema_path: SCHEMA_PATH,
      schema: loadSchemaJson()
    });
    return;
  }

  if (req.method === 'GET' && isConfigVersionsPath) {
    try {
      runtime = refreshActiveConfig();
      state = runtime.state;
    } catch (ignore) {
      state = snapshotConfigState(false);
    }
    sendJson(res, 200, {
      active: {
        version: state.version,
        content_hash: state.content_hash,
        loaded_at: state.loaded_at
      },
      versions: listConfigVersions()
    });
    return;
  }

  if (needsRuntime) {
    try {
      runtime = refreshActiveConfig();
    } catch (err) {
      if (req.method === 'GET' && (isHealthPath || isConfigStatusPath || isPolicyListPath)) {
        sendJson(res, 503, {
          status: 'error',
          mode: 'ltm-ai-gateway',
          config: snapshotConfigState(false),
          error: err.message
        });
        return;
      }
      maybeLogIngressEvent(traceMeta, 'runtime_config_error', { error: err.message });
      sendError(res, 503, 'Gateway configuration is invalid and no last-known-good configuration is available.', 'gateway_config_error', 'invalid_gateway_config', ingressTraceHeaders(traceMeta), err.message);
      return;
    }

    config = runtime.config;
    state = runtime.state;
  }

  if (req.method === 'GET' && isHealthPath) {
    sendJson(res, 200, { status: 'ok', mode: 'ltm-ai-gateway', config: state });
    return;
  }

  if (req.method === 'GET' && isConfigStatusPath) {
    sendJson(res, 200, state);
    return;
  }

  if (req.method === 'GET' && isPolicyListPath) {
    sendJson(res, 200, {
      fallback_tag: config.runtime.fallback_tag,
      tags: ((config._derived || {}).candidate_tags || []).slice(),
      policy_summary: ((config._derived || {}).policy_summary || {}),
      pipeline: config.pipeline
    });
    return;
  }

  if (req.method === 'GET' && isModelsPath) {
    sendJson(res, 200, listModelsResponse(config));
    return;
  }

  if (req.method !== 'POST') {
    maybeLogIngressEvent(traceMeta, 'request_rejected', { reason: 'method_not_allowed_or_not_found' });
    sendError(res, 404, 'Not found.', 'not_found_error', 'not_found', ingressTraceHeaders(traceMeta));
    return;
  }

  bodyLimit = requestBodyLimitForPath(pathname, config);
  contentLength = traceMeta.content_length;
  if (contentLength !== null && bodyLimit > 0 && contentLength > bodyLimit) {
    maybeLogIngressEvent(traceMeta, 'request_rejected', {
      reason: 'body_too_large',
      limit_bytes: bodyLimit
    });
    sendError(res, 413, 'Request body is too large for this endpoint.', 'invalid_request_error', 'body_too_large', ingressTraceHeaders(traceMeta), 'Configured limit: ' + String(bodyLimit) + ' bytes');
    return;
  }

  readRequestBody(req, bodyLimit, function(err, rawBody) {
    var body;
    var rawBodyBytes = Buffer.byteLength(rawBody || '', 'utf8');
    if (err) {
      maybeLogIngressEvent(traceMeta, 'body_read_error', {
        error: describeError(err),
        limit_bytes: bodyLimit
      });
      if (err.code === 'body_too_large') {
        sendError(res, 413, 'Request body is too large for this endpoint.', 'invalid_request_error', 'body_too_large', ingressTraceHeaders(traceMeta), err.message);
        return;
      }
      sendError(res, 400, 'Failed to read request body.', 'invalid_request_error', 'request_read_error', ingressTraceHeaders(traceMeta), err.message);
      return;
    }
    maybeLogIngressEvent(traceMeta, 'body_read_complete', {
      body_bytes: rawBodyBytes
    });
    try {
      body = JSON.parse(rawBody || '{}');
    } catch (err) {
      maybeLogIngressEvent(traceMeta, 'invalid_json', { body_bytes: rawBodyBytes });
      sendError(res, 400, 'Request body is not valid JSON.', 'invalid_request_error', 'invalid_json', ingressTraceHeaders(traceMeta));
      return;
    }

    if (isEvaluatePath) {
      handleEvaluationRequest(res, body.northbound_type === 'responses' ? 'responses' : 'chat', body, config, state);
      return;
    }

    if (isConfigValidatePath) {
      handleValidateConfigRequest(res, body);
      return;
    }

    if (isConfigActivatePath) {
      handleActivateConfigRequest(res, body);
      return;
    }

    if (isConfigRollbackPath) {
      handleRollbackConfigRequest(res, body);
      return;
    }

    if (isChatPath && config.northbound.allow_chat_completions) {
      handleModelRequest(req, res, 'chat', body, config, state);
      return;
    }

    if (isResponsesPath && config.northbound.allow_responses) {
      handleModelRequest(req, res, 'responses', body, config, state);
      return;
    }

    sendError(res, 404, 'Not found.', 'not_found_error', 'not_found');
  });
}

plugin.on('initialized', function() {
  try {
    refreshActiveConfig(true);
    console.log('LTM AI Gateway plugin initialized with valid config');
  } catch (err) {
    console.log('LTM AI Gateway plugin initialized without valid config: ' + err.message);
  }
});

process.on('uncaughtException', function(err) {
  if (isIgnorableTransportError(err)) {
    logIgnorableTransport('Suppressed ignorable transport uncaught exception', err);
    return;
  }
  console.log('Fatal uncaught exception: ' + describeError(err));
  process.exit(1);
});

process.on('unhandledRejection', function(reason) {
  if (isIgnorableTransportError(reason)) {
    logIgnorableTransport('Suppressed ignorable transport unhandled rejection', reason);
    return;
  }
  console.log('Fatal unhandled rejection: ' + describeError(reason));
  process.exit(1);
});

attachHttpServerGuards(plugin.startHttpServer(requestHandler));
