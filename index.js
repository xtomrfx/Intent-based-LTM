/*global require, __dirname, console, process, Buffer */
(function () {
'use strict';

var f5 = require('f5-nodejs');
var fs = require('fs');
var path = require('path');
var http = require('http');
var https = require('https');

var ilx = new f5.ILXServer();
var JSON_FILE_CACHE = {};
var DEFAULT_NATIVE_LOCAL_FILES = {
  classifiers: path.join('native', 'ifile_ai_gateway_classifiers.json'),
  backend_targets: path.join('native', 'ifile_ai_gateway_backend_targets.json'),
  provider_credential_pools: path.join('native', 'ifile_ai_gateway_provider_credential_pools.json'),
  routing_policies: path.join('native', 'ifile_ai_gateway_routing_policies.json'),
  config_snapshot: path.join('native', 'ifile_ai_gateway_config_snapshot.json')
};
var NATIVE_DOC_PAYLOAD_KEYS = {
  classifiers: 'classifiers',
  backend_targets: 'backendTargets',
  provider_credential_pools: 'providerCredentialPools',
  routing_policies: 'routingPolicies'
};
var NATIVE_MANAGED_SECTIONS = ['listeners', 'classifiers', 'backendTargets', 'providerCredentialPools', 'routingPolicies'];
var NATIVE_SUPERSEDED_TOP_LEVEL_KEYS = [
  'runtime',
  'candidateTags',
  'localRules',
  'decisions',
  'targetModels',
  'promptProfiles',
  'provider',
  'backend',
  'routeProfiles',
  'listenerRegistry',
  'classifierRegistry',
  'backendTargetRegistry',
  'providerCredentialPoolRegistry',
  'routingPolicyRegistry',
  'activeListenerRef',
  'activeClassifierRef',
  'activeRoutingPolicyRef',
  'activeListener',
  'activeClassifier',
  'activeRoutingPolicy'
];
var ILX_WORKSPACE_EXTENSION_DIR = '/var/ilx/workspaces/Common/llm_semantic_ws/extensions/llm_semantic_ext';
var VIRTUAL_KEY_USAGE_DEBOUNCE_MS = 2000;
var VIRTUAL_KEY_USAGE_FILE_PATHS = [
  process.env.AITO_VIRTUAL_KEY_USAGE_FILE || '',
  path.join(ILX_WORKSPACE_EXTENSION_DIR, 'virtual-key-usage.json'),
  path.join(__dirname, 'virtual-key-usage.json'),
  '/var/tmp/AITrafficOrchestrator-runtime/virtual-key-usage.json',
  '/var/tmp/AITrafficOrchestrator-virtual-key-usage.json'
].filter(function (filePath) {
  return !!filePath;
});
var VIRTUAL_KEY_USAGE_STATE = {
  loaded: false,
  filePath: '',
  records: {},
  pendingWrite: false,
  writeTimer: null,
  writing: false,
  lastErrorAt: 0
};
var PROVIDER_CREDENTIAL_RUNTIME_DEBOUNCE_MS = 2000;
var PROVIDER_CREDENTIAL_RUNTIME_FILE_PATHS = [
  process.env.AITO_PROVIDER_CREDENTIAL_RUNTIME_FILE || '',
  path.join(ILX_WORKSPACE_EXTENSION_DIR, 'provider-credential-runtime.json'),
  path.join(__dirname, 'provider-credential-runtime.json'),
  '/var/tmp/AITrafficOrchestrator-runtime/provider-credential-runtime.json',
  '/var/tmp/AITrafficOrchestrator-provider-credential-runtime.json'
].filter(function (filePath) {
  return !!filePath;
});
var PROVIDER_CREDENTIAL_RUNTIME_STATE = {
  loaded: false,
  filePath: '',
  pools: {},
  pendingWrite: false,
  writeTimer: null,
  writing: false,
  lastErrorAt: 0
};

var DEFAULT_CONFIG = {
  operatingMode: 'gateway',
  mode: 'openai_compatible_chat',
  timeoutMs: 3000,
  rulesFirst: true,
  candidateTags: ['chat', 'f5', 'bad', 'unknown'],
  localRules: [
    {
      name: 'bad_keywords',
      pattern: '(杀人|自杀|炸弹|恐怖袭击|强奸|qj|porn|sex|nude|hentai|成人视频|色情|裸聊|约炮|fuck you|操你|靠你|去死|教我方法)',
      tag: 'bad',
      confidence: 0.99
    },
    {
      name: 'f5_keywords',
      pattern: '(f5|big-ip|bigip|ltm|gtm|dns|asm|apm|afm|irule|i-rule|virtual server|pool|pool member|node|monitor|wide ip|snat|fastl4|oneconnect|tmsh|as3|do declaration|icontrol|hostname|ssl profile|persistence|health monitor)',
      tag: 'f5',
      confidence: 0.96
    },
    {
      name: 'capability_questions',
      pattern: '(what can you do|what do you support|what work do you support|你可以做什么|你能做什么|你会什么|你可以帮我做什么|你支持什么|你支持哪些|你支持什么功能|你支持什么工作|你能帮我什么)',
      tag: 'unknown',
      confidence: 0.88,
      terminal: true
    },
    {
      name: 'casual_chat',
      pattern: '(hello|hi|hey|你好|在吗|闲聊|聊聊|哈哈|谢谢|thanks|靠$|卧槽)',
      tag: 'chat',
      confidence: 0.82
    }
  ],
  targetModels: {
    ClassifierModels: {
      schema_family: 'openai_chat_compatible',
      targetModel_type: 'classifier_llm',
      provider_config: {
        protocol: 'https',
        hostname: 'api.deepseek.com',
        port: 443,
        path: '/chat/completions',
        method: 'POST',
        model: 'deepseek-chat',
        apiKeyEnv: 'SEMANTIC_ROUTER_API_KEY',
        headers: {
          'Content-Type': 'application/json'
        }
      },
      prompt_profile: 'classifier_default'
    },
    BackendModels: {
      schema_family: 'openai_chat_compatible',
      targetModel_type: 'backend_llm',
      provider_config: {
        protocol: 'https',
        hostname: 'api.deepseek.com',
        port: 443,
        path: '/chat/completions',
        method: 'POST',
        model: 'deepseek-chat',
        apiKeyEnv: 'DEEPSEEK_API_KEY',
        acceptClientModel: false,
        headers: {
          'Content-Type': 'application/json'
        }
      },
      prompt_profile: 'backend_default'
    }
  },
  promptProfiles: {
    classifier_default: {
      type: 'classifier_llm',
      system_prompt: {
        mode: 'append',
        value: 'You are a routing classifier inside an AI gateway. Classify the user input into exactly one tag from: chat, f5, bad, unknown. Return only compact JSON like {"tag":"f5","confidence":0.92}. Use bad for violence, sexual content, or abusive/harmful requests. Use f5 for BIG-IP, iRule, LTM, pool, node, monitor, virtual server, ASM, APM, WAF, DNS, GTM, or other F5 questions. Use chat for casual conversation. Use unknown when unsure.'
      },
      temperature: 0,
      max_tokens: 32
    },
    classifier_nli_default: {
      type: 'classifier_nli',
      labels: [
        { id: 'chat', text: 'casual chat' },
        { id: 'f5', text: 'F5 BIG-IP technical support' },
        { id: 'bad', text: 'harmful or disallowed request' }
      ],
      hypothesis_template: 'This text is about {}.',
      multi_label: false,
      decision_policy: {
        fallback_label: 'unknown',
        min_confidence: 0.55,
        min_margin: 0.12
      }
    },
    backend_default: {
      type: 'backend_llm',
      system_prompt: {
        mode: 'append',
        value: ''
      }
    },
    f5_expert: {
      type: 'backend_llm',
      system_prompt: {
        mode: 'append',
        value: 'You are an F5 BIG-IP expert. Answer F5 questions accurately with concrete tmsh, iRules, virtual server, pool, node, monitor, and operational guidance when useful. Answer in Chinese unless the user explicitly asks for another language.'
      },
      max_tokens: 512,
      temperature: 0.2
    },
    general_assistant: {
      type: 'backend_llm',
      system_prompt: {
        mode: 'append',
        value: 'You are an F5 AI gateway demo assistant. Your primary scope is F5 BIG-IP, iRules, LTM, pool, virtual server, monitor, DNS, ASM, APM, GTM, and closely related network or infrastructure topics. When the user asks what you can do, explain that you mainly support F5-related technical questions and gateway demo scenarios. If the request is outside F5, answer briefly and steer the conversation back to F5 or enterprise infrastructure topics. Answer in Chinese unless the user explicitly asks for another language.'
      },
      max_tokens: 256,
      temperature: 0.2
    }
  },
  decisions: {
    default: {
      action: 'route',
      pool: 'pool_semantic_demo_default_direct',
      prompt_profile: 'general_assistant'
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
        prompt_profile: 'f5_expert'
      },
      unknown: {
        action: 'route',
        pool: 'pool_semantic_demo_default_direct',
        prompt_profile: 'general_assistant'
      }
    }
  }
};

function loadConfig() {
  var configPath = path.join(__dirname, 'classifier-config.json');
  var rawConfig;
  var nativeConfig;
  try {
    rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    console.log('Using default classifier config: ' + err.message);
    rawConfig = DEFAULT_CONFIG;
  }

  nativeConfig = loadNativeConfigOverlay(rawConfig);
  if (nativeConfig.applied) {
    rawConfig = mergeNativeOverlay(rawConfig, nativeConfig.overlay);
    rawConfig._nativeConfigStatus = nativeConfig.status;
  } else {
    rawConfig._nativeConfigStatus = nativeConfig.status;
  }
  return rawConfig;
}

function mergeNativeOverlay(base, overlay) {
  var nativeBase = mergeObjects(base || {}, {});
  var merged;
  var i;
  var section;

  for (i = 0; i < NATIVE_SUPERSEDED_TOP_LEVEL_KEYS.length; i += 1) {
    delete nativeBase[NATIVE_SUPERSEDED_TOP_LEVEL_KEYS[i]];
  }

  merged = mergeObjects(nativeBase, overlay || {});

  for (i = 0; i < NATIVE_MANAGED_SECTIONS.length; i += 1) {
    section = NATIVE_MANAGED_SECTIONS[i];
    // Native UI is the SoT for managed objects. Replace every managed section
    // instead of deep-merging, otherwise legacy sample entries remain routable.
    merged[section] = mergeObjects((overlay && overlay[section]) || {}, {});
  }

  return merged;
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

function cloneJson(value) {
  if (value === undefined || value === null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function firstObjectKey(obj) {
  var key;
  if (!obj || typeof obj !== 'object') {
    return '';
  }
  for (key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      return key;
    }
  }
  return '';
}

function readJsonFileCached(filePath) {
  var stat;
  var cacheEntry;
  var cacheToken;
  try {
    stat = fs.statSync(filePath);
    cacheToken = String(stat.size) + ':' + String(stat.mtime.getTime());
    cacheEntry = JSON_FILE_CACHE[filePath];
    if (cacheEntry && cacheEntry.token === cacheToken) {
      return cacheEntry.value;
    }
    cacheEntry = {
      token: cacheToken,
      value: JSON.parse(fs.readFileSync(filePath, 'utf8'))
    };
    JSON_FILE_CACHE[filePath] = cacheEntry;
    return cacheEntry.value;
  } catch (err) {
    return null;
  }
}

function getTodayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeUsageDate(value) {
  var text = String(value || '').trim();
  var match = text.match(/^(\d{4}-\d{2}-\d{2})/);

  return match ? match[1] : '';
}

function normalizeVirtualKeyUsageRecord(kid, record) {
  var dateValue = normalizeUsageDate(record && (record.last_used_at || record.lastUsedAt));

  if (!kid || !dateValue) {
    return null;
  }

  return {
    kid: String((record && record.kid) || kid),
    tag: String((record && record.tag) || ''),
    pool_ref: String((record && (record.pool_ref || record.poolRef || record.virtual_key_pool_ref || record.virtualKeyPoolRef)) || ''),
    last_used_at: dateValue,
    updated_at: String((record && (record.updated_at || record.updatedAt)) || '')
  };
}

function mergeVirtualKeyUsageRecords(records) {
  Object.keys(records || {}).forEach(function (kid) {
    var normalized = normalizeVirtualKeyUsageRecord(kid, records[kid]);
    var current;

    if (!normalized) {
      return;
    }

    current = VIRTUAL_KEY_USAGE_STATE.records[kid];
    if (!current || normalized.last_used_at >= String(current.last_used_at || '')) {
      VIRTUAL_KEY_USAGE_STATE.records[kid] = normalized;
    }
  });
}

function readVirtualKeyUsageFile(filePath) {
  var payload;

  try {
    payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return false;
  }

  if (payload && payload.virtualKeys && typeof payload.virtualKeys === 'object') {
    mergeVirtualKeyUsageRecords(payload.virtualKeys);
    return true;
  }

  return false;
}

function loadVirtualKeyUsageState() {
  var i;
  var loadedPath = '';

  if (VIRTUAL_KEY_USAGE_STATE.loaded) {
    return;
  }

  for (i = 0; i < VIRTUAL_KEY_USAGE_FILE_PATHS.length; i += 1) {
    if (readVirtualKeyUsageFile(VIRTUAL_KEY_USAGE_FILE_PATHS[i]) && !loadedPath) {
      loadedPath = VIRTUAL_KEY_USAGE_FILE_PATHS[i];
    }
  }

  VIRTUAL_KEY_USAGE_STATE.filePath = loadedPath || VIRTUAL_KEY_USAGE_FILE_PATHS[0] || '';
  VIRTUAL_KEY_USAGE_STATE.loaded = true;
}

function buildVirtualKeyUsagePayload() {
  return JSON.stringify({
    version: 1,
    updated_at: new Date().toISOString(),
    virtualKeys: VIRTUAL_KEY_USAGE_STATE.records
  }, null, 2);
}

function getVirtualKeyUsageWritePaths() {
  var paths = VIRTUAL_KEY_USAGE_FILE_PATHS.slice(0);
  var preferred = VIRTUAL_KEY_USAGE_STATE.filePath;
  var preferredIndex;

  if (!preferred) {
    return paths;
  }

  preferredIndex = paths.indexOf(preferred);
  if (preferredIndex > 0) {
    paths.splice(preferredIndex, 1);
    paths.unshift(preferred);
  }

  return paths;
}

function writeVirtualKeyUsagePayload(paths, content, done) {
  var filePath = paths.shift();
  var tempPath;

  if (!filePath) {
    done(new Error('No writable Virtual Key usage file path is available.'));
    return;
  }

  tempPath = filePath + '.tmp-' + process.pid + '-' + Date.now();
  fs.writeFile(tempPath, content, {
    encoding: 'utf8',
    mode: 420
  }, function (writeError) {
    if (writeError) {
      writeVirtualKeyUsagePayload(paths, content, done);
      return;
    }

    fs.rename(tempPath, filePath, function (renameError) {
      if (!renameError) {
        done(null, filePath);
        return;
      }

      fs.unlink(tempPath, function () {
        writeVirtualKeyUsagePayload(paths, content, done);
      });
    });
  });
}

function logVirtualKeyUsageWriteError(error) {
  var now = Date.now();

  if (now - VIRTUAL_KEY_USAGE_STATE.lastErrorAt < 60000) {
    return;
  }

  VIRTUAL_KEY_USAGE_STATE.lastErrorAt = now;
  console.log('Virtual Key last-used update was not persisted: ' + ((error && error.message) || error));
}

function flushVirtualKeyUsageState() {
  var content;
  var paths;

  VIRTUAL_KEY_USAGE_STATE.writeTimer = null;
  if (!VIRTUAL_KEY_USAGE_STATE.pendingWrite || VIRTUAL_KEY_USAGE_STATE.writing) {
    return;
  }

  VIRTUAL_KEY_USAGE_STATE.pendingWrite = false;
  VIRTUAL_KEY_USAGE_STATE.writing = true;
  loadVirtualKeyUsageState();

  // Merge any file changes just before writing so independent ILX workers are less likely to overwrite each other.
  paths = VIRTUAL_KEY_USAGE_FILE_PATHS.slice(0);
  paths.forEach(readVirtualKeyUsageFile);
  content = buildVirtualKeyUsagePayload();

  writeVirtualKeyUsagePayload(getVirtualKeyUsageWritePaths(), content, function (error, filePath) {
    VIRTUAL_KEY_USAGE_STATE.writing = false;
    if (error) {
      logVirtualKeyUsageWriteError(error);
    } else {
      VIRTUAL_KEY_USAGE_STATE.filePath = filePath;
    }
    if (VIRTUAL_KEY_USAGE_STATE.pendingWrite) {
      scheduleVirtualKeyUsageWrite();
    }
  });
}

function scheduleVirtualKeyUsageWrite() {
  VIRTUAL_KEY_USAGE_STATE.pendingWrite = true;

  if (VIRTUAL_KEY_USAGE_STATE.writeTimer || VIRTUAL_KEY_USAGE_STATE.writing) {
    return;
  }

  VIRTUAL_KEY_USAGE_STATE.writeTimer = setTimeout(flushVirtualKeyUsageState, VIRTUAL_KEY_USAGE_DEBOUNCE_MS);
}

function recordVirtualKeyLastUsed(context) {
  var virtualKey = context && context.virtual_key ? context.virtual_key : null;
  var kid = virtualKey ? String(virtualKey.kid || '').trim() : '';
  var today;

  if (!kid) {
    return;
  }

  loadVirtualKeyUsageState();
  today = getTodayDateString();

  if (
    VIRTUAL_KEY_USAGE_STATE.records[kid] &&
    VIRTUAL_KEY_USAGE_STATE.records[kid].last_used_at === today
  ) {
    return;
  }

  VIRTUAL_KEY_USAGE_STATE.records[kid] = {
    kid: kid,
    tag: String(virtualKey.tag || ''),
    pool_ref: String(virtualKey.pool_ref || ''),
    last_used_at: today,
    updated_at: new Date().toISOString()
  };
  scheduleVirtualKeyUsageWrite();
}

function normalizeProviderCredentialRuntimeRecord(poolRef, credentialId, record) {
  var state = String(record && (record.runtime_state || record.runtimeState || record.state) || '').trim().toLowerCase().replace(/-/g, '_');
  var cooldownUntilEpoch = Number(record && (record.cooldown_until_epoch || record.cooldownUntilEpoch) || 0);
  var lastUsedAt = String(record && (record.last_used_at || record.lastUsedAt) || '').trim();
  var lastFailureAt = String(record && (record.last_failure_at || record.lastFailureAt) || '').trim();
  var updatedAt = String(record && (record.updated_at || record.updatedAt) || '').trim();

  if (!poolRef || !credentialId) {
    return null;
  }

  if (!state) {
    state = 'unknown';
  }

  return {
    pool_ref: String((record && (record.pool_ref || record.poolRef)) || poolRef),
    credential_id: String((record && (record.credential_id || record.credentialId)) || credentialId),
    runtime_state: state,
    status_code: Number(record && (record.status_code || record.statusCode) || 0),
    last_failure_reason: String(record && (record.last_failure_reason || record.lastFailureReason) || ''),
    last_failure_at: lastFailureAt,
    last_used_at: lastUsedAt,
    cooldown_until: String(record && (record.cooldown_until || record.cooldownUntil) || ''),
    cooldown_until_epoch: isFinite(cooldownUntilEpoch) ? cooldownUntilEpoch : 0,
    retry_after: String(record && (record.retry_after || record.retryAfter) || ''),
    upstream_host: String(record && (record.upstream_host || record.upstreamHost) || ''),
    fallback_count: Number(record && (record.fallback_count || record.fallbackCount) || 0),
    last_fallback_at: String(record && (record.last_fallback_at || record.lastFallbackAt) || ''),
    updated_at: updatedAt
  };
}

function ensureProviderCredentialRuntimePool(poolRef) {
  if (!PROVIDER_CREDENTIAL_RUNTIME_STATE.pools[poolRef]) {
    PROVIDER_CREDENTIAL_RUNTIME_STATE.pools[poolRef] = {
      credentials: {}
    };
  }
  if (!PROVIDER_CREDENTIAL_RUNTIME_STATE.pools[poolRef].credentials) {
    PROVIDER_CREDENTIAL_RUNTIME_STATE.pools[poolRef].credentials = {};
  }
  return PROVIDER_CREDENTIAL_RUNTIME_STATE.pools[poolRef];
}

function mergeProviderCredentialRuntimeCredentialMap(poolRef, credentialMap) {
  Object.keys(credentialMap || {}).forEach(function (credentialId) {
    var normalized = normalizeProviderCredentialRuntimeRecord(poolRef, credentialId, credentialMap[credentialId]);
    var pool;
    var current;

    if (!normalized) {
      return;
    }

    pool = ensureProviderCredentialRuntimePool(poolRef);
    current = pool.credentials[credentialId];
    if (!current || String(normalized.updated_at || '') >= String(current.updated_at || '')) {
      pool.credentials[credentialId] = normalized;
    }
  });
}

function mergeProviderCredentialRuntimePools(pools) {
  Object.keys(pools || {}).forEach(function (poolRef) {
    var poolRecord = pools[poolRef] || {};
    var credentialMap = poolRecord.credentials || {};

    if (Array.isArray(poolRecord.entries)) {
      poolRecord.entries.forEach(function (entry) {
        var credentialId = String(entry && (entry.credential_id || entry.credentialId) || '').trim();

        if (credentialId) {
          credentialMap[credentialId] = entry;
        }
      });
    }

    mergeProviderCredentialRuntimeCredentialMap(poolRef, credentialMap);
  });
}

function readProviderCredentialRuntimeFile(filePath) {
  var payload;

  try {
    payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return false;
  }

  if (payload && payload.providerCredentialPools && typeof payload.providerCredentialPools === 'object') {
    mergeProviderCredentialRuntimePools(payload.providerCredentialPools);
    return true;
  }
  if (payload && payload.credentialPools && typeof payload.credentialPools === 'object') {
    mergeProviderCredentialRuntimePools(payload.credentialPools);
    return true;
  }

  return false;
}

function loadProviderCredentialRuntimeState() {
  var i;
  var loadedPath = '';

  if (PROVIDER_CREDENTIAL_RUNTIME_STATE.loaded) {
    return;
  }

  for (i = 0; i < PROVIDER_CREDENTIAL_RUNTIME_FILE_PATHS.length; i += 1) {
    if (readProviderCredentialRuntimeFile(PROVIDER_CREDENTIAL_RUNTIME_FILE_PATHS[i]) && !loadedPath) {
      loadedPath = PROVIDER_CREDENTIAL_RUNTIME_FILE_PATHS[i];
    }
  }

  PROVIDER_CREDENTIAL_RUNTIME_STATE.filePath = loadedPath || PROVIDER_CREDENTIAL_RUNTIME_FILE_PATHS[0] || '';
  PROVIDER_CREDENTIAL_RUNTIME_STATE.loaded = true;
}

function buildProviderCredentialRuntimePayload() {
  return JSON.stringify({
    version: 1,
    updated_at: new Date().toISOString(),
    providerCredentialPools: PROVIDER_CREDENTIAL_RUNTIME_STATE.pools
  }, null, 2);
}

function getProviderCredentialRuntimeWritePaths() {
  var paths = PROVIDER_CREDENTIAL_RUNTIME_FILE_PATHS.slice(0);
  var preferred = PROVIDER_CREDENTIAL_RUNTIME_STATE.filePath;
  var preferredIndex;

  if (!preferred) {
    return paths;
  }

  preferredIndex = paths.indexOf(preferred);
  if (preferredIndex > 0) {
    paths.splice(preferredIndex, 1);
    paths.unshift(preferred);
  }

  return paths;
}

function writeProviderCredentialRuntimePayload(paths, content, done) {
  var filePath = paths.shift();
  var tempPath;

  if (!filePath) {
    done(new Error('No writable provider credential runtime file path is available.'));
    return;
  }

  tempPath = filePath + '.tmp-' + process.pid + '-' + Date.now();
  fs.writeFile(tempPath, content, {
    encoding: 'utf8',
    mode: 420
  }, function (writeError) {
    if (writeError) {
      writeProviderCredentialRuntimePayload(paths, content, done);
      return;
    }

    fs.rename(tempPath, filePath, function (renameError) {
      if (!renameError) {
        done(null, filePath);
        return;
      }

      fs.unlink(tempPath, function () {
        writeProviderCredentialRuntimePayload(paths, content, done);
      });
    });
  });
}

function logProviderCredentialRuntimeWriteError(error) {
  var now = Date.now();

  if (now - PROVIDER_CREDENTIAL_RUNTIME_STATE.lastErrorAt < 60000) {
    return;
  }

  PROVIDER_CREDENTIAL_RUNTIME_STATE.lastErrorAt = now;
  console.log('Provider credential runtime update was not persisted: ' + ((error && error.message) || error));
}

function flushProviderCredentialRuntimeState() {
  var content;
  var paths;

  PROVIDER_CREDENTIAL_RUNTIME_STATE.writeTimer = null;
  if (!PROVIDER_CREDENTIAL_RUNTIME_STATE.pendingWrite || PROVIDER_CREDENTIAL_RUNTIME_STATE.writing) {
    return;
  }

  PROVIDER_CREDENTIAL_RUNTIME_STATE.pendingWrite = false;
  PROVIDER_CREDENTIAL_RUNTIME_STATE.writing = true;
  loadProviderCredentialRuntimeState();

  paths = PROVIDER_CREDENTIAL_RUNTIME_FILE_PATHS.slice(0);
  paths.forEach(readProviderCredentialRuntimeFile);
  content = buildProviderCredentialRuntimePayload();

  writeProviderCredentialRuntimePayload(getProviderCredentialRuntimeWritePaths(), content, function (error, filePath) {
    PROVIDER_CREDENTIAL_RUNTIME_STATE.writing = false;
    if (error) {
      logProviderCredentialRuntimeWriteError(error);
    } else {
      PROVIDER_CREDENTIAL_RUNTIME_STATE.filePath = filePath;
    }
    if (PROVIDER_CREDENTIAL_RUNTIME_STATE.pendingWrite) {
      scheduleProviderCredentialRuntimeWrite();
    }
  });
}

function scheduleProviderCredentialRuntimeWrite() {
  PROVIDER_CREDENTIAL_RUNTIME_STATE.pendingWrite = true;

  if (PROVIDER_CREDENTIAL_RUNTIME_STATE.writeTimer || PROVIDER_CREDENTIAL_RUNTIME_STATE.writing) {
    return;
  }

  PROVIDER_CREDENTIAL_RUNTIME_STATE.writeTimer = setTimeout(flushProviderCredentialRuntimeState, PROVIDER_CREDENTIAL_RUNTIME_DEBOUNCE_MS);
}

function buildProviderCredentialFailureReason(statusCode, retryAfter) {
  if (statusCode === 429 && retryAfter) {
    return 'Retry-After ' + retryAfter + 's';
  }
  return statusCode ? String(statusCode) : '';
}

function recordProviderCredentialRuntimeEvent(rawEvent) {
  var event;
  var poolRef;
  var credentialId;
  var statusCode;
  var retryAfter;
  var upstreamHost;
  var cooldownSeconds;
  var cooldownUntilEpoch;
  var fallbackUsed;
  var runtimeState = 'available';
  var nowIso = new Date().toISOString();
  var today = getTodayDateString();
  var pool;
  var current;
  var next;

  if (!rawEvent) {
    return;
  }

  try {
    event = typeof rawEvent === 'string' ? JSON.parse(rawEvent) : rawEvent;
  } catch (error) {
    return;
  }

  poolRef = String(event.credential_pool_ref || event.credentialPoolRef || event.pool_ref || event.poolRef || '').trim();
  credentialId = String(event.credential_id || event.credentialId || '').trim();
  if (!poolRef || !credentialId) {
    return;
  }

  statusCode = Number(event.status_code || event.statusCode || 0);
  retryAfter = String(event.retry_after || event.retryAfter || '').trim();
  upstreamHost = String(event.upstream_host || event.upstreamHost || '');
  cooldownSeconds = Number(event.cooldown_seconds || event.cooldownSeconds || 0);
  cooldownUntilEpoch = Number(event.cooldown_until_epoch || event.cooldownUntilEpoch || 0);
  fallbackUsed = Boolean(event.fallback_used || event.fallbackUsed);

  if (statusCode === 401 || statusCode === 403) {
    runtimeState = 'auth_failed';
  } else if (statusCode === 429) {
    runtimeState = 'rate_limited';
  } else if (statusCode >= 400) {
    runtimeState = 'unknown';
  }

  if (!isFinite(cooldownUntilEpoch) || cooldownUntilEpoch < 0) {
    cooldownUntilEpoch = 0;
  }
  if (!cooldownUntilEpoch && runtimeState !== 'available' && isFinite(cooldownSeconds) && cooldownSeconds > 0) {
    cooldownUntilEpoch = Math.floor(Date.now() / 1000) + cooldownSeconds;
  }

  loadProviderCredentialRuntimeState();
  pool = ensureProviderCredentialRuntimePool(poolRef);
  current = pool.credentials[credentialId] || {};
  if (
    runtimeState === 'available' &&
    current.runtime_state === 'available' &&
    !fallbackUsed &&
    normalizeUsageDate(current.last_used_at) === today &&
    String(current.upstream_host || '') === upstreamHost &&
    Number(current.status_code || 0) === statusCode
  ) {
    return;
  }
  next = mergeObjects(current, {});

  next.pool_ref = poolRef;
  next.credential_id = credentialId;
  next.runtime_state = runtimeState;
  next.status_code = isFinite(statusCode) ? statusCode : 0;
  next.retry_after = retryAfter;
  next.upstream_host = upstreamHost;
  next.cooldown_until_epoch = cooldownUntilEpoch;
  next.cooldown_until = cooldownUntilEpoch > 0 ? new Date(cooldownUntilEpoch * 1000).toISOString() : '';
  next.updated_at = nowIso;

  if (runtimeState === 'available') {
    next.last_used_at = nowIso;
    next.cooldown_until = '';
    next.cooldown_until_epoch = 0;
  } else {
    next.last_failure_reason = String(event.last_failure || event.lastFailure || event.last_failure_reason || event.lastFailureReason || buildProviderCredentialFailureReason(statusCode, retryAfter) || '');
    next.last_failure_at = nowIso;
  }

  if (fallbackUsed) {
    next.fallback_count = Number(next.fallback_count || 0) + 1;
    next.last_fallback_at = nowIso;
  } else if (next.fallback_count === undefined) {
    next.fallback_count = 0;
  }

  pool.credentials[credentialId] = next;
  scheduleProviderCredentialRuntimeWrite();
}

function resolveNativeLocalFile(rawConfig, key) {
  var nativeObjects = (rawConfig && rawConfig.nativeObjects) || {};
  var localFiles = nativeObjects.local_files || nativeObjects.localFiles || {};
  var configured = localFiles[key];
  var relativePath = DEFAULT_NATIVE_LOCAL_FILES[key];

  if (configured) {
    if (path.isAbsolute(configured)) {
      return configured;
    }
    return path.join(__dirname, configured);
  }

  if (!relativePath) {
    return '';
  }
  return path.join(__dirname, relativePath);
}

function loadNativeConfigOverlay(rawConfig) {
  var overlay = {};
  var status = {
    attempted: true,
    applied: false,
    loaded_keys: [],
    files: {}
  };
  var key;
  var filePath;
  var documentObj;
  var payloadKey;
  var payload;

  filePath = resolveNativeLocalFile(rawConfig, 'config_snapshot');
  status.files.config_snapshot = filePath;
  if (filePath) {
    documentObj = readJsonFileCached(filePath);
    if (documentObj && typeof documentObj === 'object') {
      payload = normalizeNativeSnapshotPayload(documentObj);
      if (payload) {
        overlay = mergeObjects(overlay, payload);
        status.loaded_keys.push('config_snapshot');
      }
    }
  }

  for (key in NATIVE_DOC_PAYLOAD_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(NATIVE_DOC_PAYLOAD_KEYS, key)) {
      continue;
    }
    filePath = resolveNativeLocalFile(rawConfig, key);
    status.files[key] = filePath;
    if (!filePath) {
      continue;
    }
    documentObj = readJsonFileCached(filePath);
    if (!documentObj || typeof documentObj !== 'object') {
      continue;
    }
    payloadKey = NATIVE_DOC_PAYLOAD_KEYS[key];
    payload = documentObj[payloadKey];
    if (!payload || typeof payload !== 'object') {
      continue;
    }
    overlay[payloadKey] = mergeObjects(payload, {});
    status.loaded_keys.push(key);
  }

  status.applied = status.loaded_keys.length > 0;

  return {
    applied: status.applied,
    overlay: overlay,
    status: status
  };
}

function normalizeNativeSnapshotPayload(documentObj) {
  var snapshot = null;
  var activeIds;
  var runtime = {};

  if (documentObj && documentObj.block && typeof documentObj.block === 'object') {
    snapshot = documentObj.block;
  } else if (documentObj && documentObj.config && typeof documentObj.config === 'object') {
    snapshot = documentObj.config;
  }

  if (!snapshot) {
    return null;
  }

  snapshot = mergeObjects(snapshot, {});
  activeIds = snapshot.activeIds || snapshot.active_ids || {};

  if (activeIds.listener || activeIds.listener_ref) {
    runtime.listener_ref = activeIds.listener || activeIds.listener_ref;
  }
  if (activeIds.classifier || activeIds.classifier_ref) {
    runtime.classifier_ref = activeIds.classifier || activeIds.classifier_ref;
  }
  if (activeIds.policy || activeIds.policy_ref) {
    runtime.policy_ref = activeIds.policy || activeIds.policy_ref;
  }
  if (activeIds.backend || activeIds.backend_ref) {
    runtime.backend_ref = activeIds.backend || activeIds.backend_ref;
  }

  if (Object.keys(runtime).length) {
    snapshot.runtime = mergeObjects(snapshot.runtime || {}, runtime);
  }

  return snapshot;
}

function normalizeOperatingMode(value) {
  var normalized = String(value || 'gateway').toLowerCase();
  if (normalized === 'transparent') {
    return 'transparent';
  }
  return 'gateway';
}

function parseEndpointUrl(endpointUrl) {
  var original = String(endpointUrl || '').trim();
  var protocol = 'https';
  var remainder = original;
  var hostname = '';
  var port = '';
  var slashIndex;
  var hostPort;
  var colonIndex;
  var pathValue = '/chat/completions';

  if (!original) {
    return {
      protocol: protocol,
      hostname: '',
      port: 443,
      path: pathValue
    };
  }

  if (remainder.indexOf('http://') === 0) {
    protocol = 'http';
    remainder = remainder.slice(7);
  } else if (remainder.indexOf('https://') === 0) {
    protocol = 'https';
    remainder = remainder.slice(8);
  }

  slashIndex = remainder.indexOf('/');
  if (slashIndex >= 0) {
    hostPort = remainder.slice(0, slashIndex);
    pathValue = remainder.slice(slashIndex) || pathValue;
  } else {
    hostPort = remainder;
  }

  colonIndex = hostPort.lastIndexOf(':');
  if (colonIndex > 0) {
    hostname = hostPort.slice(0, colonIndex);
    port = hostPort.slice(colonIndex + 1);
  } else {
    hostname = hostPort;
  }

  return {
    protocol: protocol,
    hostname: hostname,
    port: Number(port || (protocol === 'http' ? 80 : 443)),
    path: pathValue
  };
}

function buildProviderConfigFromNativeSpec(spec, timeoutMs, defaultPath) {
  var endpoint = parseEndpointUrl(spec.endpoint_url || spec.endpointUrl || '');
  var egress = spec.classifier_egress || spec.classifierEgress || null;
  var providerConfig = {
    protocol: spec.protocol || endpoint.protocol || 'https',
    hostname: spec.hostname || endpoint.hostname || '',
    port: Number(spec.port || endpoint.port || 443),
    path: spec.request_path || spec.requestPath || spec.path || endpoint.path || defaultPath || '/chat/completions',
    method: spec.method || 'POST',
    model: spec.model_id || spec.modelId || spec.model || '',
    timeoutMs: Number(spec.timeout_ms || spec.timeoutMs || timeoutMs || DEFAULT_CONFIG.timeoutMs),
    headers: mergeObjects(spec.headers || {}, {})
  };

  if (!providerConfig.headers['Content-Type']) {
    providerConfig.headers['Content-Type'] = 'application/json';
  }
  if (spec.api_key) {
    providerConfig.apiKey = spec.api_key;
  } else if (spec.apiKey) {
    providerConfig.apiKey = spec.apiKey;
  }
  if (spec.api_key_env) {
    providerConfig.apiKeyEnv = spec.api_key_env;
  } else if (spec.apiKeyEnv) {
    providerConfig.apiKeyEnv = spec.apiKeyEnv;
  }
  if (spec.secret_ref) {
    providerConfig.secretRef = spec.secret_ref;
  } else if (spec.secretRef) {
    providerConfig.secretRef = spec.secretRef;
  }
  if (spec.credential_pool_ref) {
    providerConfig.credentialPoolRef = spec.credential_pool_ref;
  } else if (spec.credentialPoolRef) {
    providerConfig.credentialPoolRef = spec.credentialPoolRef;
  }

  if (egress && egress.enabled && egress.url) {
    providerConfig.classifierEgress = {
      url: egress.url,
      host: egress.host || egress.egress_host || endpoint.hostname || '',
      tls: egress.tls !== undefined ? Boolean(egress.tls) : Boolean(egress.egress_tls),
      virtualService: egress.virtual_service || egress.virtualService || '',
      poolName: egress.pool_name || egress.poolName || ''
    };
  }

  return providerConfig;
}

function ensureCandidateTags(tags, fallbackTag) {
  var normalized = [];
  var seen = {};
  var i;
  var value;

  if (Array.isArray(tags)) {
    for (i = 0; i < tags.length; i += 1) {
      value = String(tags[i] || '').trim().toLowerCase();
      if (!value || seen[value]) {
        continue;
      }
      seen[value] = true;
      normalized.push(value);
    }
  }

  value = String(fallbackTag || '').trim().toLowerCase();
  if (value && !seen[value]) {
    normalized.push(value);
  }

  if (!normalized.length) {
    return DEFAULT_CONFIG.candidateTags.slice(0);
  }

  return normalized;
}

function resolveFallbackTag(config, explicitFallback) {
  var candidateTags = ensureCandidateTags(config && config.candidateTags, explicitFallback || 'unknown');
  var fallbackTag = explicitFallback || (config && config.activeClassifier && config.activeClassifier.fallback_tag);
  if (fallbackTag) {
    return normalizeTag(fallbackTag, candidateTags, fallbackTag);
  }
  if (candidateTags.indexOf('unknown') >= 0) {
    return 'unknown';
  }
  return candidateTags[0] || 'unknown';
}

function normalizeLocalRules(rawRules, fallbackRules, candidateTags, fallbackTag) {
  var source = Array.isArray(rawRules) && rawRules.length ? rawRules : fallbackRules;
  var normalized = [];
  var i;
  var rule;
  var regexFlags;

  for (i = 0; i < source.length; i += 1) {
    rule = source[i];
    if (!rule || typeof rule !== 'object') {
      continue;
    }
    regexFlags = typeof rule.flags === 'string' && rule.flags ? rule.flags : 'i';
    normalized.push({
      name: rule.name || ('rule_' + i),
      pattern: String(rule.pattern || ''),
      flags: regexFlags,
      tag: normalizeTag(rule.tag, candidateTags, fallbackTag),
      confidence: Number(rule.confidence !== undefined ? rule.confidence : 0.5),
      terminal: Boolean(rule.terminal)
    });
  }

  return normalized;
}

function normalizeClientAuthType(value) {
  var normalized = String(value || 'none').trim().toLowerCase().replace(/-/g, '_');

  if (!normalized) {
    return 'none';
  }
  if (normalized === 'virtualkey') {
    return 'virtual_key';
  }

  return normalized;
}

function normalizeRoutingMode(value) {
  var normalized = String(value || 'classifier_only').trim().toLowerCase().replace(/-/g, '_');

  if (normalized === 'classifier') {
    return 'classifier_only';
  }
  if (normalized === 'key') {
    return 'key_only';
  }
  if (normalized === 'key_classifier' || normalized === 'key_then_intent') {
    return 'key_then_classifier';
  }
  if (normalized !== 'key_only' && normalized !== 'key_then_classifier') {
    return 'classifier_only';
  }
  return normalized;
}

function normalizePolicyAction(value, fallback) {
  var normalized = String(value || fallback || 'route').trim().toLowerCase().replace(/-/g, '_');

  if (normalized === 'local_response' || normalized === 'local response' || normalized === 'response') {
    return 'respond';
  }
  return normalized;
}

function normalizeNativeListener(name, rawListener) {
  var listener = mergeObjects(rawListener || {}, {});
  return {
    listener_name: listener.listener_name || listener.listenerName || name,
    virtual_service: listener.virtual_service || listener.virtualService || '',
    vip: listener.vip || '',
    port: Number(listener.port || listener.vport || 0),
    default_public_model: listener.default_public_model || listener.defaultPublicModel || '',
    streaming: listener.streaming !== undefined ? Boolean(listener.streaming) : true,
    client_auth_type: normalizeClientAuthType(listener.client_auth_type || listener.clientAuthType || 'none'),
    allowed_virtual_key_pool_refs: Array.isArray(listener.allowed_virtual_key_pool_refs) ?
      listener.allowed_virtual_key_pool_refs.slice(0) :
      (Array.isArray(listener.allowedVirtualKeyPoolRefs) ? listener.allowedVirtualKeyPoolRefs.slice(0) : []),
    classifier_ref: listener.classifier_ref || listener.classifierRef || '',
    policy_ref: listener.policy_ref || listener.policyRef || '',
    advanced: mergeObjects(listener.advanced || {}, {}),
    status: mergeObjects(listener.status || {}, {})
  };
}

function buildNativePromptProfile(type, mode, value, maxTokens, temperature, fallbackTags, extra) {
  var profile = mergeObjects(extra || {}, {});
  profile.type = type;
  if (type === 'classifier_nli') {
    profile.labels = Array.isArray(profile.labels) && profile.labels.length ? profile.labels : buildLabelDefinitions(fallbackTags);
    if (!profile.hypothesis_template) {
      profile.hypothesis_template = 'This text is about {}.';
    }
    if (profile.multi_label === undefined) {
      profile.multi_label = false;
    }
    if (!profile.decision_policy) {
      profile.decision_policy = {};
    }
    if (!profile.decision_policy.fallback_label) {
      profile.decision_policy.fallback_label = fallbackTags.indexOf('unknown') >= 0 ? 'unknown' : fallbackTags[0];
    }
    if (profile.decision_policy.min_confidence === undefined) {
      profile.decision_policy.min_confidence = 0.55;
    }
    if (profile.decision_policy.min_margin === undefined) {
      profile.decision_policy.min_margin = 0.12;
    }
    return normalizePromptProfile(profile, type, fallbackTags);
  }

  profile.system_prompt = {
    mode: mode === 'rewrite' ? 'rewrite' : 'append',
    value: typeof value === 'string' ? value : ''
  };
  if (maxTokens !== undefined && maxTokens !== null && maxTokens !== '') {
    profile.max_tokens = Number(maxTokens);
  }
  if (temperature !== undefined && temperature !== null && temperature !== '') {
    profile.temperature = Number(temperature);
  }
  return normalizePromptProfile(profile, type, fallbackTags);
}

function normalizeNativeClassifier(name, rawClassifier, timeoutMs) {
  var classifier = mergeObjects(rawClassifier || {}, {});
  var classifierType = classifier.classifier_type || classifier.classifierType || 'classifier_llm';
  var fallbackTag = classifier.fallback_tag || classifier.fallbackTag || 'unknown';
  var candidateTags = ensureCandidateTags(classifier.candidate_tags || classifier.candidateTags, fallbackTag);
  var providerConfig = buildProviderConfigFromNativeSpec(classifier, classifier.timeout_ms || classifier.timeoutMs || timeoutMs, '/chat/completions');
  var promptProfile;
  var promptProfileName = 'native_classifier__' + name;

  if (classifierType === 'classifier_nli') {
    promptProfile = buildNativePromptProfile('classifier_nli', 'append', '', null, null, candidateTags, {
      labels: buildLabelDefinitions(candidateTags.filter(function (tag) {
        return tag !== fallbackTag;
      })),
      hypothesis_template: classifier.hypothesis_template || classifier.hypothesisTemplate || 'This text is about {}.',
      multi_label: Boolean(classifier.multi_label || classifier.multiLabel),
      decision_policy: {
        fallback_label: fallbackTag,
        min_confidence: Number(classifier.min_confidence !== undefined ? classifier.min_confidence : (classifier.minConfidence !== undefined ? classifier.minConfidence : 0.55)),
        min_margin: Number(classifier.min_margin !== undefined ? classifier.min_margin : (classifier.minMargin !== undefined ? classifier.minMargin : 0.12))
      }
    });
  } else {
    promptProfile = buildNativePromptProfile(
      'classifier_llm',
      classifier.system_prompt_mode || classifier.systemPromptMode || 'append',
      classifier.classifier_prompt || classifier.classifierPrompt || classifier.system_prompt || classifier.systemPrompt || '',
      classifier.max_tokens || classifier.maxTokens,
      classifier.temperature,
      candidateTags
    );
  }

  return {
    classifier_name: classifier.classifier_name || classifier.classifierName || name,
    classifier_type: classifierType,
    schema_family: normalizeSchemaFamily(classifier.schema_family || classifier.schemaFamily || providerConfig.schema_family || 'openai_chat_compatible'),
    provider_config: providerConfig,
    pool_name: classifier.pool_name || classifier.poolName || '',
    prompt_profile_name: promptProfileName,
    prompt_profile: promptProfile,
    candidate_tags: candidateTags,
    fallback_tag: normalizeTag(fallbackTag, candidateTags, fallbackTag),
    bypass_enabled: classifier.bypass_enabled !== undefined ? Boolean(classifier.bypass_enabled) : Boolean(classifier.bypassEnabled),
    use_built_in_rules_first: classifier.use_built_in_rules_first !== undefined ? Boolean(classifier.use_built_in_rules_first) : (classifier.useBuiltInRulesFirst !== undefined ? Boolean(classifier.useBuiltInRulesFirst) : true),
    timeout_ms: Number(classifier.timeout_ms || classifier.timeoutMs || timeoutMs || DEFAULT_CONFIG.timeoutMs)
  };
}

function normalizeNativeBackendTarget(name, rawTarget, timeoutMs) {
  var target = mergeObjects(rawTarget || {}, {});
  var providerConfig = buildProviderConfigFromNativeSpec(target, timeoutMs, '/chat/completions');
  return {
    backend_target_name: target.backend_target_name || target.backendTargetName || name,
    schema_family: normalizeSchemaFamily(target.schema_family || target.schemaFamily || 'openai_chat_compatible'),
    provider_config: providerConfig,
    credential_pool_ref: target.credential_pool_ref || target.credentialPoolRef || '',
    pool_name: target.pool_name || target.poolName || '',
    prompt_profile_name: 'native_backend__' + name,
    prompt_profile: buildNativePromptProfile(
      'backend_llm',
      target.backend_prompt_mode || target.backendPromptMode || 'append',
      target.backend_prompt || target.backendPrompt || '',
      target.max_tokens || target.maxTokens,
      target.temperature,
      DEFAULT_CONFIG.candidateTags
    ),
    advanced: mergeObjects(target.advanced || {}, {})
  };
}

function normalizeNativeProviderCredentialEntry(entry, index) {
  var normalized = mergeObjects(entry || {}, {});
  var fallbackId = 'credential_' + (index + 1);
  var priority = normalized.priority;

  normalized.credential_id = String(
    normalized.credential_id || normalized.credentialId || normalized.id || fallbackId
  ).trim();
  normalized.display_name = String(
    normalized.display_name || normalized.displayName || normalized.name || normalized.credential_id || fallbackId
  ).trim();
  normalized.enabled = normalized.enabled !== undefined ? Boolean(normalized.enabled) : true;
  normalized.priority = priority === undefined || priority === null || priority === ''
    ? (index + 1) * 100
    : Number(priority);
  normalized.api_key = String(normalized.api_key || normalized.apiKey || '').trim();
  delete normalized.credentialId;
  delete normalized.id;
  delete normalized.displayName;
  delete normalized.name;
  delete normalized.apiKey;
  delete normalized.status;
  delete normalized.runtime_state;
  delete normalized.runtimeState;
  delete normalized.last_failure_reason;
  delete normalized.lastFailureReason;
  delete normalized.last_failure_at;
  delete normalized.lastFailureAt;
  delete normalized.status_code;
  delete normalized.statusCode;
  delete normalized.retry_after;
  delete normalized.retryAfter;
  delete normalized.cooldown_until;
  delete normalized.cooldownUntil;
  delete normalized.cooldown_until_epoch;
  delete normalized.cooldownUntilEpoch;
  delete normalized.fallback_count;
  delete normalized.fallbackCount;
  delete normalized.last_fallback_at;
  delete normalized.lastFallbackAt;
  delete normalized.updated_at;
  delete normalized.updatedAt;
  return normalized;
}

function normalizeNativeProviderCredentialPool(name, rawPool) {
  var pool = mergeObjects(rawPool || {}, {});

  return {
    pool_name: pool.pool_name || pool.poolName || name,
    vendor: String(pool.vendor || '').trim().toLowerCase(),
    auth_scheme: String(pool.auth_scheme || pool.authScheme || 'bearer').trim().toLowerCase(),
    selection_mode: String(pool.selection_mode || pool.selectionMode || 'priority_failover').trim().toLowerCase().replace(/-/g, '_'),
    cooldown_seconds: Number(pool.cooldown_seconds !== undefined ? pool.cooldown_seconds : (pool.cooldownSeconds !== undefined ? pool.cooldownSeconds : 30)),
    entries: Array.isArray(pool.entries) ? pool.entries.map(function (entry, index) {
      return normalizeNativeProviderCredentialEntry(entry, index);
    }) : []
  };
}

function normalizeNativeRoutingPolicy(name, rawPolicy, backendTargetRegistry) {
  var policy = mergeObjects(rawPolicy || {}, {});
  var rules = [];
  var keyRules = [];
  var fallbackBackendRef = policy.default_backend_target || policy.defaultBackendTarget || firstObjectKey(backendTargetRegistry);
  var routeFallbackBackendRef = policy.fallback_backend_target_ref || policy.fallbackBackendTargetRef || '';
  var i;
  var rule;
  var match;
  var normalizedAction;
  var routingMode;

  if (Array.isArray(policy.rules)) {
    for (i = 0; i < policy.rules.length; i += 1) {
      rule = policy.rules[i] || {};
      normalizedAction = normalizePolicyAction(rule.action, 'route');
      rules.push({
        rule_name: rule.rule_name || rule.ruleName || ('rule_' + i),
        source_tag: String(rule.source_tag || rule.sourceTag || '').trim().toLowerCase(),
        action: normalizedAction,
        backend_target_ref: rule.backend_target_ref || rule.backendTargetRef || rule.backend_target || rule.backendTarget || '',
        response_message: rule.response_message || rule.responseMessage || '',
        enabled: rule.enabled !== undefined ? Boolean(rule.enabled) : true
      });
    }
  }

  if (Array.isArray(policy.key_rules || policy.keyRules)) {
    keyRules = policy.key_rules || policy.keyRules;
    keyRules = keyRules.map(function (rawRule, index) {
      rawRule = rawRule || {};
      match = rawRule.match || {};
      normalizedAction = normalizePolicyAction(rawRule.action, 'route');
      if (normalizedAction !== 'respond' && normalizedAction !== 'classify') {
        normalizedAction = 'route';
      }
      return {
        rule_name: rawRule.rule_name || rawRule.ruleName || ('key_rule_' + index),
        enabled: rawRule.enabled !== undefined ? Boolean(rawRule.enabled) : true,
        match: {
          virtual_key_pool_ref: match.virtual_key_pool_ref || match.virtualKeyPoolRef || rawRule.virtual_key_pool_ref || rawRule.virtualKeyPoolRef || '',
          virtual_key_ref: match.virtual_key_ref || match.virtualKeyRef || rawRule.virtual_key_ref || rawRule.virtualKeyRef || '',
          virtual_key_tag: match.virtual_key_tag || match.virtualKeyTag || rawRule.virtual_key_tag || rawRule.virtualKeyTag || ''
        },
        action: normalizedAction,
        backend_target_ref: rawRule.backend_target_ref || rawRule.backendTargetRef || '',
        response_message: rawRule.response_message || rawRule.responseMessage || '',
        classifier_ref: rawRule.classifier_ref || rawRule.classifierRef || ''
      };
    });
  }

  normalizedAction = normalizePolicyAction((policy.default_rule && policy.default_rule.action) || policy.default_action, 'route');
  routingMode = normalizeRoutingMode(policy.routing_mode || policy.routingMode);

  return {
    policy_name: policy.policy_name || policy.policyName || name,
    policy_type: String(policy.policy_type || policy.policyType || 'routing').toLowerCase(),
    routing_mode: routingMode,
    classifier_ref: routingMode === 'key_only' ? '' : (policy.classifier_ref || policy.classifierRef || ''),
    fallback_backend_target_ref: routeFallbackBackendRef,
    key_rules: keyRules,
    rules: rules,
    default_rule: {
      action: normalizedAction,
      backend_target_ref: (policy.default_rule && (policy.default_rule.backend_target_ref || policy.default_rule.backendTargetRef || policy.default_rule.backend_target || policy.default_rule.backendTarget)) || fallbackBackendRef,
      response_message: (policy.default_rule && (policy.default_rule.response_message || policy.default_rule.responseMessage)) || policy.default_response_message || ''
    }
  };
}

function buildLegacyDecisionsFromPolicy(policy, backendTargetRegistry) {
  var decisions = {
    default: {
      action: 'route',
      pool: '',
      prompt_profile: ''
    },
    tags: {}
  };
  var defaultTarget;
  var i;
  var rule;
  var target;

  if (!policy) {
    return decisions;
  }

  defaultTarget = backendTargetRegistry[policy.default_rule.backend_target_ref];
  decisions.default.action = policy.default_rule.action || 'route';
  decisions.default.pool = defaultTarget ? defaultTarget.pool_name : '';
  decisions.default.prompt_profile = defaultTarget ? defaultTarget.prompt_profile_name : '';
  decisions.default.message = policy.default_rule.response_message || '';

  for (i = 0; i < policy.rules.length; i += 1) {
    rule = policy.rules[i];
    if (!rule.enabled || !rule.source_tag) {
      continue;
    }
    target = backendTargetRegistry[rule.backend_target_ref];
    decisions.tags[rule.source_tag] = {
      action: rule.action || 'route',
      pool: target ? target.pool_name : '',
      prompt_profile: target ? target.prompt_profile_name : '',
      message: rule.response_message || ''
    };
  }

  return decisions;
}

function buildLabelDefinitions(tags) {
  var labels = [];
  var i;
  if (!Array.isArray(tags)) {
    return labels;
  }
  for (i = 0; i < tags.length; i += 1) {
    labels.push({
      id: String(tags[i]),
      text: String(tags[i])
    });
  }
  return labels;
}

function normalizeSchemaFamily(schemaFamily) {
  if (!schemaFamily) {
    return 'openai_chat_compatible';
  }
  if (schemaFamily === 'openai_compatible_chat') {
    return 'openai_chat_compatible';
  }
  if (schemaFamily === 'classifier_http') {
    return 'legacy_classifier_http';
  }
  return schemaFamily;
}

function normalizePromptProfile(profile, fallbackType, fallbackTags) {
  var normalized = mergeObjects(profile || {}, {});
  var labels;
  var i;

  if (!normalized.type && fallbackType) {
    normalized.type = fallbackType;
  }

  if (normalized.systemPrompt && normalized.system_prompt === undefined) {
    normalized.system_prompt = {
      mode: 'append',
      value: normalized.systemPrompt
    };
  }

  if (typeof normalized.system_prompt === 'string') {
    normalized.system_prompt = {
      mode: 'append',
      value: normalized.system_prompt
    };
  }

  if (!normalized.system_prompt || typeof normalized.system_prompt !== 'object' || Array.isArray(normalized.system_prompt)) {
    normalized.system_prompt = {};
  }

  if (normalized.system_prompt.mode !== 'rewrite' && normalized.system_prompt.mode !== 'append') {
    normalized.system_prompt.mode = 'append';
  }

  if (typeof normalized.system_prompt.value !== 'string') {
    normalized.system_prompt.value = normalized.system_prompt.value ? String(normalized.system_prompt.value) : '';
  }

  if (normalized.maxTokens !== undefined && normalized.max_tokens === undefined) {
    normalized.max_tokens = normalized.maxTokens;
  }

  labels = [];
  if (Array.isArray(normalized.labels) && normalized.labels.length) {
    for (i = 0; i < normalized.labels.length; i += 1) {
      if (typeof normalized.labels[i] === 'string') {
        labels.push({
          id: normalized.labels[i],
          text: normalized.labels[i]
        });
      } else if (normalized.labels[i] && (normalized.labels[i].id || normalized.labels[i].text)) {
        labels.push({
          id: String(normalized.labels[i].id || normalized.labels[i].text),
          text: String(normalized.labels[i].text || normalized.labels[i].id)
        });
      }
    }
  } else if (Array.isArray(fallbackTags) && fallbackTags.length) {
    labels = buildLabelDefinitions(fallbackTags);
  }
  normalized.labels = labels;

  if (!normalized.decision_policy || typeof normalized.decision_policy !== 'object') {
    normalized.decision_policy = {};
  }

  return normalized;
}

function normalizeProviderConfig(providerConfig, timeoutMs) {
  var normalized = mergeObjects(providerConfig || {}, {});
  normalized.method = normalized.method || 'POST';
  normalized.headers = mergeObjects(normalized.headers || {}, {});
  if (normalized.timeoutMs === undefined || normalized.timeoutMs === null) {
    normalized.timeoutMs = timeoutMs;
  }
  return normalized;
}

function normalizeTargetModel(targetModel, defaults, timeoutMs) {
  var normalized = mergeObjects(defaults || {}, targetModel || {});
  normalized.schema_family = normalizeSchemaFamily(normalized.schema_family);
  normalized.provider_config = normalizeProviderConfig(normalized.provider_config || {}, timeoutMs);
  if (!normalized.prompt_profile) {
    if (normalized.targetModel_type === 'classifier_nli') {
      normalized.prompt_profile = 'classifier_nli_default';
    } else if (normalized.targetModel_type === 'backend_llm' || normalized.targetModel_type === 'backendModel') {
      normalized.prompt_profile = 'backend_default';
    } else {
      normalized.prompt_profile = 'classifier_default';
    }
  }
  return normalized;
}

function normalizeConfig(rawConfig) {
  var merged = mergeObjects(DEFAULT_CONFIG, rawConfig || {});
  var rawTargetModels = (rawConfig && rawConfig.targetModels) || {};
  var rawPromptProfiles = (rawConfig && rawConfig.promptProfiles) || {};
  var promptProfiles = mergeObjects(DEFAULT_CONFIG.promptProfiles, rawPromptProfiles);
  var targetModels = mergeObjects(DEFAULT_CONFIG.targetModels, rawTargetModels);
  var listeners = {};
  var classifiers = {};
  var backendTargets = {};
  var providerCredentialPools = {};
  var routingPolicies = {};
  var virtualKeys = {};
  var virtualKeyPools = {};
  var runtimeRefs = (rawConfig && rawConfig.runtime) || {};
  var listenerName;
  var classifierName;
  var backendTargetName;
  var providerCredentialPoolName;
  var policyName;
  var activeListenerRef;
  var activeClassifierRef;
  var activePolicyRef;
  var activeListener;
  var activeClassifier;
  var activePolicy;
  var activePolicyRoutingMode;
  var defaultBackendRef;
  var defaultBackendTarget;
  var routeProfiles;
  var routeProfileName;
  var provider;
  var backend;
  var virtualKeyName;
  var virtualKeyPoolName;

  merged.operatingMode = normalizeOperatingMode((rawConfig && rawConfig.operatingMode) || merged.operatingMode);

  if (rawConfig && rawConfig.routeProfiles) {
    routeProfiles = rawConfig.routeProfiles;
    for (routeProfileName in routeProfiles) {
      if (Object.prototype.hasOwnProperty.call(routeProfiles, routeProfileName)) {
        promptProfiles[routeProfileName] = {
          type: 'backend_llm',
          system_prompt: {
            mode: 'append',
            value: routeProfiles[routeProfileName].systemPrompt || ''
          },
          max_tokens: routeProfiles[routeProfileName].maxTokens,
          temperature: routeProfiles[routeProfileName].temperature
        };
      }
    }
  }

  if (!rawTargetModels.ClassifierModels && rawConfig && rawConfig.provider) {
    provider = mergeObjects(rawConfig.provider, {});
    targetModels.ClassifierModels = {
      schema_family: normalizeSchemaFamily(provider.schema_family || provider.type),
      targetModel_type: provider.type === 'classifier_http' ? 'classifier_nli' : 'classifier_llm',
      provider_config: provider,
      prompt_profile: provider.type === 'classifier_http' ? 'classifier_nli_default' : 'classifier_default'
    };

    if (provider.systemPrompt) {
      promptProfiles.classifier_default = {
        type: 'classifier_llm',
        system_prompt: {
          mode: 'append',
          value: provider.systemPrompt
        },
        temperature: 0,
        max_tokens: 32
      };
    } else if (provider.type === 'classifier_http') {
      promptProfiles.classifier_nli_default = {
        type: 'classifier_nli',
        labels: buildLabelDefinitions(merged.candidateTags),
        hypothesis_template: 'This text is about {}.',
        multi_label: false,
        decision_policy: {
          fallback_label: 'unknown',
          min_confidence: 0.55,
          min_margin: 0.12
        }
      };
    }
  }

  if (!rawTargetModels.BackendModels && rawConfig && rawConfig.backend) {
    backend = mergeObjects(rawConfig.backend, {});
    targetModels.BackendModels = {
      schema_family: normalizeSchemaFamily(backend.schema_family || 'openai_chat_compatible'),
      targetModel_type: 'backend_llm',
      provider_config: backend,
      prompt_profile: 'backend_default'
    };
  }

  if (rawConfig && rawConfig.listeners && typeof rawConfig.listeners === 'object') {
    for (listenerName in rawConfig.listeners) {
      if (Object.prototype.hasOwnProperty.call(rawConfig.listeners, listenerName)) {
        listeners[listenerName] = normalizeNativeListener(listenerName, rawConfig.listeners[listenerName]);
      }
    }
  }

  if (rawConfig && rawConfig.classifiers && typeof rawConfig.classifiers === 'object') {
    for (classifierName in rawConfig.classifiers) {
      if (Object.prototype.hasOwnProperty.call(rawConfig.classifiers, classifierName)) {
        classifiers[classifierName] = normalizeNativeClassifier(classifierName, rawConfig.classifiers[classifierName], merged.timeoutMs);
      }
    }
  }

  if (rawConfig && rawConfig.backendTargets && typeof rawConfig.backendTargets === 'object') {
    for (backendTargetName in rawConfig.backendTargets) {
      if (Object.prototype.hasOwnProperty.call(rawConfig.backendTargets, backendTargetName)) {
        backendTargets[backendTargetName] = normalizeNativeBackendTarget(backendTargetName, rawConfig.backendTargets[backendTargetName], merged.timeoutMs);
      }
    }
  }

  if (rawConfig && rawConfig.providerCredentialPools && typeof rawConfig.providerCredentialPools === 'object') {
    for (providerCredentialPoolName in rawConfig.providerCredentialPools) {
      if (Object.prototype.hasOwnProperty.call(rawConfig.providerCredentialPools, providerCredentialPoolName)) {
        providerCredentialPools[providerCredentialPoolName] = normalizeNativeProviderCredentialPool(
          providerCredentialPoolName,
          rawConfig.providerCredentialPools[providerCredentialPoolName]
        );
      }
    }
  }

  if (rawConfig && rawConfig.routingPolicies && typeof rawConfig.routingPolicies === 'object') {
    for (policyName in rawConfig.routingPolicies) {
      if (Object.prototype.hasOwnProperty.call(rawConfig.routingPolicies, policyName)) {
        routingPolicies[policyName] = normalizeNativeRoutingPolicy(policyName, rawConfig.routingPolicies[policyName], backendTargets);
      }
    }
  }

  if (rawConfig && rawConfig.virtualKeys && typeof rawConfig.virtualKeys === 'object') {
    for (virtualKeyName in rawConfig.virtualKeys) {
      if (Object.prototype.hasOwnProperty.call(rawConfig.virtualKeys, virtualKeyName)) {
        virtualKeys[virtualKeyName] = mergeObjects(rawConfig.virtualKeys[virtualKeyName] || {}, {});
      }
    }
  }

  if (rawConfig && rawConfig.virtualKeyPools && typeof rawConfig.virtualKeyPools === 'object') {
    for (virtualKeyPoolName in rawConfig.virtualKeyPools) {
      if (Object.prototype.hasOwnProperty.call(rawConfig.virtualKeyPools, virtualKeyPoolName)) {
        virtualKeyPools[virtualKeyPoolName] = mergeObjects(rawConfig.virtualKeyPools[virtualKeyPoolName] || {}, {});
      }
    }
  }

  for (classifierName in classifiers) {
    if (Object.prototype.hasOwnProperty.call(classifiers, classifierName)) {
      promptProfiles[classifiers[classifierName].prompt_profile_name] = classifiers[classifierName].prompt_profile;
    }
  }

  activeListenerRef = runtimeRefs.listener_ref || runtimeRefs.listenerRef || firstObjectKey(listeners);
  activeListener = listeners[activeListenerRef] || null;
  activePolicyRef = (activeListener && activeListener.policy_ref) || runtimeRefs.policy_ref || runtimeRefs.policyRef || firstObjectKey(routingPolicies);
  activePolicy = routingPolicies[activePolicyRef] || null;
  activePolicyRoutingMode = activePolicy ? normalizeRoutingMode(activePolicy.routing_mode) : '';
  activeClassifierRef = activePolicyRoutingMode === 'key_only' ?
    '' :
    ((activePolicy && activePolicy.classifier_ref) || (activeListener && activeListener.classifier_ref) || runtimeRefs.classifier_ref || runtimeRefs.classifierRef || firstObjectKey(classifiers));
  activeClassifier = classifiers[activeClassifierRef] || null;

  if (activeClassifier) {
    merged.timeoutMs = activeClassifier.timeout_ms || merged.timeoutMs;
    merged.rulesFirst = activeClassifier.use_built_in_rules_first;
    merged.candidateTags = ensureCandidateTags(activeClassifier.candidate_tags, activeClassifier.fallback_tag);
    merged.classifierBypassEnabled = Boolean(activeClassifier.bypass_enabled);
    targetModels.ClassifierModels = {
      schema_family: activeClassifier.schema_family,
      targetModel_type: activeClassifier.classifier_type,
      provider_config: activeClassifier.provider_config,
      prompt_profile: activeClassifier.prompt_profile_name
    };
  }

  for (backendTargetName in backendTargets) {
    if (Object.prototype.hasOwnProperty.call(backendTargets, backendTargetName)) {
      promptProfiles[backendTargets[backendTargetName].prompt_profile_name] = backendTargets[backendTargetName].prompt_profile;
    }
  }

  if (activePolicy) {
    merged.decisions = buildLegacyDecisionsFromPolicy(activePolicy, backendTargets);
    defaultBackendRef = activePolicy.default_rule.backend_target_ref;
    defaultBackendTarget = backendTargets[defaultBackendRef];
    if (defaultBackendTarget) {
      targetModels.BackendModels = {
        schema_family: defaultBackendTarget.schema_family,
        targetModel_type: 'backend_llm',
        provider_config: defaultBackendTarget.provider_config,
        prompt_profile: defaultBackendTarget.prompt_profile_name
      };
    }
  }

  merged.promptProfiles = {};
  for (routeProfileName in promptProfiles) {
    if (Object.prototype.hasOwnProperty.call(promptProfiles, routeProfileName)) {
      merged.promptProfiles[routeProfileName] = normalizePromptProfile(promptProfiles[routeProfileName], promptProfiles[routeProfileName].type, merged.candidateTags);
    }
  }

  merged.targetModels = {
    ClassifierModels: normalizeTargetModel(targetModels.ClassifierModels, DEFAULT_CONFIG.targetModels.ClassifierModels, merged.timeoutMs),
    BackendModels: normalizeTargetModel(targetModels.BackendModels, DEFAULT_CONFIG.targetModels.BackendModels, merged.timeoutMs)
  };

  merged.listenerRegistry = listeners;
  merged.classifierRegistry = classifiers;
  merged.backendTargetRegistry = backendTargets;
  merged.providerCredentialPoolRegistry = providerCredentialPools;
  merged.routingPolicyRegistry = routingPolicies;
  merged.virtualKeyRegistry = virtualKeys;
  merged.virtualKeyPoolRegistry = virtualKeyPools;
  merged.activeListenerRef = activeListenerRef;
  merged.activeClassifierRef = activeClassifierRef;
  merged.activeRoutingPolicyRef = activePolicyRef;
  merged.activeListener = activeListener;
  merged.activeClassifier = activeClassifier;
  merged.activeRoutingPolicy = activePolicy;
  merged.localRules = normalizeLocalRules((rawConfig && rawConfig.localRules) || rawConfig && rawConfig.local_rules, merged.localRules, merged.candidateTags, activeClassifier && activeClassifier.fallback_tag ? activeClassifier.fallback_tag : 'unknown');

  return merged;
}

function buildConfigForActiveRefs(config, listenerRef, policyRef, classifierRef) {
  var next = mergeObjects(config || {}, {});
  var listener = listenerRef && next.listenerRegistry ? next.listenerRegistry[listenerRef] : null;
  var policy = policyRef && next.routingPolicyRegistry ? next.routingPolicyRegistry[policyRef] : null;
  var classifierId = classifierRef || '';
  var classifier;
  var routingMode;

  if (!listener && next.activeListener) {
    listener = next.activeListener;
    listenerRef = next.activeListenerRef || listenerRef;
  }

  if (!policy && listener && listener.policy_ref && next.routingPolicyRegistry) {
    policyRef = listener.policy_ref;
    policy = next.routingPolicyRegistry[policyRef] || null;
  }
  if (!policy && next.activeRoutingPolicy) {
    policy = next.activeRoutingPolicy;
    policyRef = next.activeRoutingPolicyRef || policyRef;
  }

  routingMode = policy ? normalizeRoutingMode(policy.routing_mode) : '';

  if (routingMode === 'key_only') {
    classifierId = '';
  } else {
    if (!classifierId && policy) {
      classifierId = policy.classifier_ref || '';
    }
    if (!classifierId && listener) {
      classifierId = listener.classifier_ref || '';
    }
  }

  classifier = classifierId && next.classifierRegistry ? next.classifierRegistry[classifierId] : null;
  if (routingMode !== 'key_only' && !classifier && next.activeClassifier) {
    classifier = next.activeClassifier;
    classifierId = next.activeClassifierRef || classifierId;
  }

  next.activeListenerRef = listenerRef || '';
  next.activeListener = listener || null;
  next.activeRoutingPolicyRef = policyRef || '';
  next.activeRoutingPolicy = policy || null;
  next.activeClassifierRef = classifierId || '';
  next.activeClassifier = classifier || null;

  if (policy) {
    next.decisions = buildLegacyDecisionsFromPolicy(policy, next.backendTargetRegistry || {});
  }

  if (classifier) {
    next.timeoutMs = classifier.timeout_ms || next.timeoutMs;
    next.rulesFirst = classifier.use_built_in_rules_first;
    next.candidateTags = ensureCandidateTags(classifier.candidate_tags, classifier.fallback_tag);
    next.classifierBypassEnabled = Boolean(classifier.bypass_enabled);
    next.promptProfiles = mergeObjects(next.promptProfiles || {}, {});
    next.promptProfiles[classifier.prompt_profile_name] = classifier.prompt_profile;
    next.targetModels = mergeObjects(next.targetModels || {}, {});
    next.targetModels.ClassifierModels = normalizeTargetModel({
      schema_family: classifier.schema_family,
      targetModel_type: classifier.classifier_type,
      provider_config: classifier.provider_config,
      prompt_profile: classifier.prompt_profile_name
    }, DEFAULT_CONFIG.targetModels.ClassifierModels, next.timeoutMs);
    next.localRules = normalizeLocalRules(null, config.localRules || DEFAULT_CONFIG.localRules, next.candidateTags, classifier.fallback_tag || 'unknown');
  }

  return next;
}

function parseDecisionContext(rawContext) {
  var parsed;
  var virtualKey;

  if (!rawContext || typeof rawContext !== 'string') {
    return {
      listener_ref: '',
      virtual_key: null
    };
  }

  try {
    parsed = JSON.parse(rawContext);
  } catch (err) {
    return {
      listener_ref: '',
      virtual_key: null
    };
  }

  virtualKey = parsed && parsed.virtual_key && typeof parsed.virtual_key === 'object' ? parsed.virtual_key : null;

  return {
    listener_ref: String((parsed && (parsed.listener_ref || parsed.listenerRef)) || ''),
    virtual_key: virtualKey ? {
      kid: String(virtualKey.kid || virtualKey.key_id || virtualKey.keyId || ''),
      tag: String(virtualKey.tag || ''),
      pool_ref: String(virtualKey.pool_ref || virtualKey.poolRef || virtualKey.virtual_key_pool_ref || virtualKey.virtualKeyPoolRef || '')
    } : null
  };
}

function hasVirtualKeyContext(context) {
  return !!(context && context.virtual_key && (context.virtual_key.kid || context.virtual_key.tag || context.virtual_key.pool_ref));
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

function extractSystemPromptText(jsonObj) {
  var parts = [];
  var i;
  var item;
  var content;

  if (!jsonObj || typeof jsonObj !== 'object') {
    return '';
  }

  if (typeof jsonObj.instructions === 'string' && jsonObj.instructions) {
    parts.push(jsonObj.instructions);
  }

  if (Array.isArray(jsonObj.messages)) {
    for (i = 0; i < jsonObj.messages.length; i += 1) {
      item = jsonObj.messages[i];
      if (item && item.role === 'system') {
        content = normalizeText(item.content);
        if (content) {
          parts.push(content);
        }
      }
    }
  }

  if (Array.isArray(jsonObj.input)) {
    for (i = 0; i < jsonObj.input.length; i += 1) {
      item = jsonObj.input[i];
      if (item && item.role === 'system') {
        content = normalizeText(item.content || item.input || item);
        if (content) {
          parts.push(content);
        }
      }
    }
  }

  return parts.join('\n\n').replace(/\s+/g, ' ').trim();
}

function extractLocale(jsonObj) {
  if (!jsonObj || typeof jsonObj !== 'object') {
    return '';
  }
  if (typeof jsonObj.locale === 'string') {
    return jsonObj.locale;
  }
  if (typeof jsonObj.language === 'string') {
    return jsonObj.language;
  }
  return '';
}

function normalizeInputPayload(jsonObj, requestPath, contentType) {
  var promptText = extractPrompt(jsonObj);
  return {
    json: jsonObj,
    text: promptText,
    public_model: extractPublicModel(jsonObj),
    client_system_prompt: extractSystemPromptText(jsonObj),
    locale: extractLocale(jsonObj),
    request_id: '',
    request_path: requestPath || '',
    content_type: contentType || '',
    messages: normalizeMessageList(jsonObj && jsonObj.messages),
    prompt_length: promptText.length
  };
}

function normalizeTag(tag, candidateTags, fallbackTag) {
  var normalized = String(tag || fallbackTag || 'unknown').trim().toLowerCase();
  var knownTags = ensureCandidateTags(candidateTags, fallbackTag);
  var aliasMap = {
    nsfw: 'bad',
    violence: 'bad',
    harmful: 'bad',
    development: 'unknown',
    query: 'unknown'
  };

  if (aliasMap[normalized] && knownTags.indexOf(aliasMap[normalized]) >= 0) {
    normalized = aliasMap[normalized];
  }

  if (knownTags.indexOf(normalized) === -1) {
    if (fallbackTag) {
      return String(fallbackTag).toLowerCase();
    }
    if (knownTags.indexOf('unknown') >= 0) {
      return 'unknown';
    }
    return knownTags[0];
  }

  return normalized;
}

function classifyWithLocalRules(promptText, config) {
  var text;
  var rules = config && Array.isArray(config.localRules) ? config.localRules : DEFAULT_CONFIG.localRules;
  var i;
  var rule;
  var expression;
  var fallbackTag = resolveFallbackTag(config);

  if (!promptText) {
    return { tag: fallbackTag, confidence: 0.10, source: 'empty' };
  }

  text = promptText.toLowerCase();

  for (i = 0; i < rules.length; i += 1) {
    rule = rules[i];
    try {
      expression = new RegExp(rule.pattern, rule.flags || 'i');
      if (expression.test(text)) {
        return {
          tag: normalizeTag(rule.tag, config && config.candidateTags, fallbackTag),
          confidence: Number(rule.confidence !== undefined ? rule.confidence : 0.5),
          source: rule.terminal ? 'rules_terminal' : 'rules'
        };
      }
    } catch (ignore) {
    }
  }

  return { tag: fallbackTag, confidence: 0.20, source: 'rules' };
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

function formatReply(result, config) {
  var fallbackTag = resolveFallbackTag(config);
  var tag = normalizeTag(result.tag || fallbackTag, config && config.candidateTags, fallbackTag);
  var confidence = result.confidence || 0;
  var source = result.source || 'unknown';
  return [tag, confidence, source].join('|');
}

function getProviderCredentialEntries(pool) {
  var entries = Array.isArray(pool && pool.entries) ? pool.entries.slice(0) : [];

  entries = entries.filter(function (entry) {
    return entry && entry.enabled !== false && entry.api_key;
  }).sort(function (left, right) {
    if (left.priority !== right.priority) {
      return Number(left.priority || 0) - Number(right.priority || 0);
    }
    return String(left.credential_id || '').localeCompare(String(right.credential_id || ''));
  });

  return entries;
}

function buildProviderCredentialSelection(config, credentialPoolRef) {
  var registry = config && config.providerCredentialPoolRegistry;
  var pool = credentialPoolRef && registry ? registry[credentialPoolRef] : null;
  var entries;

  if (!pool) {
    return {
      pool: null,
      primary: null,
      fallback: null,
      cooldownSeconds: 0
    };
  }

  entries = getProviderCredentialEntries(pool);
  return {
    pool: pool,
    primary: entries.length ? entries[0] : null,
    fallback: entries.length > 1 ? entries[1] : null,
    cooldownSeconds: Number(pool.cooldown_seconds || 0)
  };
}

function resolveProviderCredentialPoolApiKey(config, credentialPoolRef) {
  var selection = buildProviderCredentialSelection(config, credentialPoolRef);
  return selection.primary ? selection.primary.api_key : '';
}

function resolveApiKey(section, config) {
  if (!section || typeof section !== 'object') {
    return '';
  }
  if (section.apiKey) {
    return section.apiKey;
  }
  if (section.apiKeyEnv && process.env[section.apiKeyEnv]) {
    return process.env[section.apiKeyEnv];
  }
  if (section.credentialPoolRef) {
    return resolveProviderCredentialPoolApiKey(config, section.credentialPoolRef);
  }
  return '';
}

function normalizeChatRole(role) {
  if (role === 'assistant' || role === 'system' || role === 'user' || role === 'tool') {
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

function resolvePromptProfile(config, promptProfileRef, fallbackName, fallbackType) {
  var profile = {};

  if (typeof promptProfileRef === 'string' && promptProfileRef && config.promptProfiles && config.promptProfiles[promptProfileRef]) {
    profile = config.promptProfiles[promptProfileRef];
  } else if (promptProfileRef && typeof promptProfileRef === 'object' && !Array.isArray(promptProfileRef)) {
    profile = promptProfileRef;
  } else if (fallbackName && config.promptProfiles && config.promptProfiles[fallbackName]) {
    profile = config.promptProfiles[fallbackName];
  }

  return normalizePromptProfile(profile, fallbackType, config.candidateTags);
}

function resolveTargetModel(config, targetModelName) {
  if (!config || !config.targetModels) {
    return null;
  }
  return config.targetModels[targetModelName] || null;
}

function supportsOpenAiChatSchema(schemaFamily) {
  return schemaFamily === 'openai_chat_compatible' || schemaFamily === 'ollama_openai_compatible';
}

function applySystemPromptProfile(originalSystemPrompt, promptProfile) {
  var promptSpec = normalizePromptProfile(promptProfile, promptProfile && promptProfile.type, DEFAULT_CONFIG.candidateTags).system_prompt;
  var original = originalSystemPrompt || '';
  var appended = promptSpec.value || '';

  if (promptSpec.mode === 'rewrite') {
    return appended;
  }

  if (!appended) {
    return original;
  }

  if (!original) {
    return appended;
  }

  return original + '\n\n' + appended;
}

function buildPromptedMessages(originalMessages, originalSystemPrompt, promptProfile) {
  var messages = [];
  var finalSystemPrompt = applySystemPromptProfile(originalSystemPrompt, promptProfile);
  var i;

  if (finalSystemPrompt) {
    messages.push({
      role: 'system',
      content: finalSystemPrompt
    });
  }

  for (i = 0; i < originalMessages.length; i += 1) {
    if (originalMessages[i].role === 'system') {
      continue;
    }
    messages.push(originalMessages[i]);
  }

  return messages;
}

function getSystemPromptSpec(promptProfile) {
  return normalizePromptProfile(promptProfile, promptProfile && promptProfile.type, DEFAULT_CONFIG.candidateTags).system_prompt;
}

function buildPassthroughChatMessages(originalMessages, originalSystemPrompt, promptProfile) {
  var messages = [];
  var source = Array.isArray(originalMessages) ? originalMessages : [];
  var promptSpec = getSystemPromptSpec(promptProfile);
  var finalSystemPrompt;
  var i;
  var message;

  if (!promptSpec.value && promptSpec.mode !== 'rewrite') {
    return cloneJson(source);
  }

  finalSystemPrompt = applySystemPromptProfile(originalSystemPrompt, promptProfile);
  if (finalSystemPrompt) {
    messages.push({
      role: 'system',
      content: finalSystemPrompt
    });
  }

  for (i = 0; i < source.length; i += 1) {
    message = source[i];
    if (!message || typeof message !== 'object') {
      continue;
    }
    if (String(message.role || '').toLowerCase() === 'system') {
      continue;
    }
    messages.push(cloneJson(message));
  }

  return messages;
}

function replaceTemplateSlot(template, value) {
  var source = typeof template === 'string' && template ? template : 'This text is about {}.';
  return source.replace(/\{\}/g, value || '');
}

function buildTransportRequest(providerConfig, body, config) {
  var bodyString = typeof body === 'string' ? body : stringifyAsciiJson(body);
  var headers = mergeObjects(providerConfig.headers || {}, {});
  var apiKey = resolveApiKey(providerConfig, config);
  var egress = providerConfig.classifierEgress || null;
  var egressEndpoint = egress && egress.url ? parseEndpointUrl(egress.url) : null;
  var transportProtocol = egressEndpoint ? egressEndpoint.protocol : providerConfig.protocol;
  var transportHostname = egressEndpoint ? egressEndpoint.hostname : providerConfig.hostname;
  var transportPort = egressEndpoint ? egressEndpoint.port : providerConfig.port;
  var transportPath = egressEndpoint ? (egressEndpoint.path || providerConfig.path) : providerConfig.path;

  headers['Content-Length'] = Buffer.byteLength(bodyString);
  headers.Connection = 'close';
  if (egressEndpoint && (egress.host || providerConfig.hostname)) {
    headers.Host = egress.host || providerConfig.hostname;
  }

  if (apiKey && !headers.Authorization) {
    headers.Authorization = 'Bearer ' + apiKey;
  }

  return {
    supported: true,
    protocol: transportProtocol === 'http' ? 'http:' : 'https:',
    hostname: transportHostname,
    port: transportPort,
    path: transportPath,
    method: providerConfig.method || 'POST',
    headers: headers,
    timeout: providerConfig.timeoutMs || DEFAULT_CONFIG.timeoutMs,
    body: bodyString
  };
}

function buildClassifierLlmRequest(schemaFamily, normalizedInput, promptProfile, providerConfig, config) {
  var systemPrompt;
  var payload = {};

  if (!supportsOpenAiChatSchema(schemaFamily)) {
    return {
      supported: false,
      reason: 'unsupported_schema_family'
    };
  }

  if (!providerConfig.hostname || !providerConfig.path || !providerConfig.model) {
    return {
      supported: false,
      reason: 'provider_not_configured'
    };
  }

  systemPrompt = applySystemPromptProfile(normalizedInput.client_system_prompt, promptProfile);
  payload.model = providerConfig.model;
  payload.temperature = promptProfile.temperature !== undefined ? promptProfile.temperature : 0;
  payload.max_tokens = promptProfile.max_tokens !== undefined ? promptProfile.max_tokens : 32;
  payload.messages = [];

  if (systemPrompt) {
    payload.messages.push({
      role: 'system',
      content: systemPrompt
    });
  }

  payload.messages.push({
    role: 'user',
    content: normalizedInput.text
  });

  return buildTransportRequest(providerConfig, payload, config);
}

function buildNliRequest(schemaFamily, normalizedInput, promptProfile, providerConfig, config) {
  var labels = promptProfile.labels || [];
  var i;
  var labelTexts = [];
  var labelIds = [];
  var pairs = [];

  if (!providerConfig.hostname || !providerConfig.path) {
    return {
      supported: false,
      reason: 'provider_not_configured'
    };
  }

  for (i = 0; i < labels.length; i += 1) {
    labelTexts.push(labels[i].text || labels[i].id);
    labelIds.push(labels[i].id);
    pairs.push({
      label_id: labels[i].id,
      premise: normalizedInput.text,
      hypothesis: replaceTemplateSlot(promptProfile.hypothesis_template, labels[i].text || labels[i].id)
    });
  }

  if (schemaFamily === 'hf_zero_shot_classification') {
    return buildTransportRequest(providerConfig, {
      inputs: normalizedInput.text,
      parameters: {
        candidate_labels: labelTexts,
        hypothesis_template: promptProfile.hypothesis_template || 'This text is about {}.',
        multi_label: Boolean(promptProfile.multi_label)
      }
    }, config);
  }

  if (schemaFamily === 'nli_pairs_json') {
    return buildTransportRequest(providerConfig, {
      pairs: pairs,
      multi_label: Boolean(promptProfile.multi_label),
      locale: normalizedInput.locale,
      request_id: normalizedInput.request_id
    }, config);
  }

  if (schemaFamily === 'custom_label_scores') {
    return buildTransportRequest(providerConfig, {
      text: normalizedInput.text,
      labels: labelIds,
      locale: normalizedInput.locale,
      request_id: normalizedInput.request_id
    }, config);
  }

  if (schemaFamily === 'legacy_classifier_http') {
    return buildTransportRequest(providerConfig, {
      text: normalizedInput.text,
      candidate_tags: labelIds,
      metadata: {
        path: normalizedInput.request_path,
        contentType: normalizedInput.content_type,
        promptLength: normalizedInput.prompt_length,
        locale: normalizedInput.locale,
        request_id: normalizedInput.request_id
      }
    }, config);
  }

  return {
    supported: false,
    reason: 'unsupported_schema_family'
  };
}

function buildBackendRequest(schemaFamily, normalizedInput, promptProfile, providerConfig, config) {
  var payload;
  var messages;

  if (!supportsOpenAiChatSchema(schemaFamily)) {
    return {
      supported: false,
      reason: 'unsupported_schema_family'
    };
  }

  if (!isChatCompletionsPath(normalizedInput.request_path)) {
    return {
      supported: false,
      reason: 'unsupported_path'
    };
  }

  if (!providerConfig.hostname || !providerConfig.path || !providerConfig.model) {
    return {
      supported: false,
      reason: 'backend_not_configured'
    };
  }

  if (!normalizedInput.json || !Array.isArray(normalizedInput.json.messages) || !normalizedInput.json.messages.length) {
    return {
      supported: false,
      reason: 'empty_messages'
    };
  }

  payload = cloneJson(normalizedInput.json);
  messages = buildPassthroughChatMessages(payload.messages, normalizedInput.client_system_prompt, promptProfile);
  payload.model = providerConfig.acceptClientModel && normalizedInput.public_model ? normalizedInput.public_model : providerConfig.model;
  payload.messages = messages;

  if (promptProfile.max_tokens !== undefined && promptProfile.max_tokens !== null) {
    payload.max_tokens = promptProfile.max_tokens;
  }

  if (promptProfile.temperature !== undefined && promptProfile.temperature !== null) {
    payload.temperature = promptProfile.temperature;
  }

  return buildTransportRequest(providerConfig, payload, config);
}

function build_request(schemaFamily, targetModelType, normalizedInput, promptProfile, providerConfig, config) {
  if (targetModelType === 'classifier_llm') {
    return buildClassifierLlmRequest(schemaFamily, normalizedInput, promptProfile, providerConfig, config);
  }
  if (targetModelType === 'classifier_nli') {
    return buildNliRequest(schemaFamily, normalizedInput, promptProfile, providerConfig, config);
  }
  if (targetModelType === 'backend_llm' || targetModelType === 'backendModel') {
    return buildBackendRequest(schemaFamily, normalizedInput, promptProfile, providerConfig, config);
  }
  return {
    supported: false,
    reason: 'unsupported_target_model_type'
  };
}

function parseClassifierLlmResponse(rawBody, candidateTags, fallbackTag) {
  var parsed;
  var modelResult;
  fallbackTag = fallbackTag || (candidateTags && candidateTags.indexOf('unknown') >= 0 ? 'unknown' : (candidateTags && candidateTags.length ? candidateTags[0] : 'unknown'));
  try {
    parsed = JSON.parse(rawBody);
  } catch (err) {
    return { tag: fallbackTag, confidence: 0.01, source: 'provider_parse_error', error: err.message };
  }

  if (parsed.tag || parsed.category || parsed.label) {
    return {
      tag: normalizeTag(parsed.tag || parsed.category || parsed.label, candidateTags, fallbackTag),
      confidence: Number(parsed.confidence || 0.50),
      source: 'provider'
    };
  }

  if (parsed.choices && parsed.choices[0] && parsed.choices[0].message) {
    modelResult = parseModelText(parsed.choices[0].message.content);
    if (modelResult && modelResult.tag) {
      return {
        tag: normalizeTag(modelResult.tag, candidateTags, fallbackTag),
        confidence: Number(modelResult.confidence || 0.50),
        source: 'provider_model'
      };
    }
  }

  return { tag: fallbackTag, confidence: 0.05, source: 'provider_unknown' };
}

function buildCandidateEvidence(externalLabel, internalLabel, score) {
  return {
    external_label: externalLabel || '',
    internal_label: internalLabel || '',
    score: Number(score || 0)
  };
}

function parseNliResponse(schemaFamily, rawBody) {
  var parsed;
  var candidates = [];
  var i;
  var labelKeys;
  var modelResult;

  try {
    parsed = JSON.parse(rawBody);
  } catch (err) {
    return {
      candidates: [],
      source: 'provider_parse_error',
      error: err.message
    };
  }

  if (schemaFamily === 'hf_zero_shot_classification' && Array.isArray(parsed.labels) && Array.isArray(parsed.scores)) {
    for (i = 0; i < parsed.labels.length; i += 1) {
      candidates.push(buildCandidateEvidence(parsed.labels[i], '', parsed.scores[i]));
    }
    return { candidates: candidates, source: 'provider_nli' };
  }

  if (schemaFamily === 'nli_pairs_json' && Array.isArray(parsed.results)) {
    for (i = 0; i < parsed.results.length; i += 1) {
      candidates.push(buildCandidateEvidence('', parsed.results[i].label_id, parsed.results[i].entailment));
    }
    return { candidates: candidates, source: 'provider_nli' };
  }

  if ((schemaFamily === 'custom_label_scores' || schemaFamily === 'legacy_classifier_http') && parsed.label_scores && typeof parsed.label_scores === 'object') {
    labelKeys = Object.keys(parsed.label_scores);
    for (i = 0; i < labelKeys.length; i += 1) {
      candidates.push(buildCandidateEvidence('', labelKeys[i], parsed.label_scores[labelKeys[i]]));
    }
    return { candidates: candidates, source: 'provider_nli' };
  }

  if ((schemaFamily === 'custom_label_scores' || schemaFamily === 'legacy_classifier_http') && Array.isArray(parsed.results)) {
    for (i = 0; i < parsed.results.length; i += 1) {
      candidates.push(buildCandidateEvidence(parsed.results[i].label, parsed.results[i].label_id, parsed.results[i].score || parsed.results[i].entailment));
    }
    return { candidates: candidates, source: 'provider_nli' };
  }

  if (parsed.tag || parsed.category || parsed.label) {
    return {
      candidates: [
        buildCandidateEvidence(parsed.tag || parsed.category || parsed.label, '', Number(parsed.confidence || 0.50))
      ],
      source: 'provider_nli'
    };
  }

  if (parsed.choices && parsed.choices[0] && parsed.choices[0].message) {
    modelResult = parseModelText(parsed.choices[0].message.content);
    if (modelResult && modelResult.tag) {
      return {
        candidates: [
          buildCandidateEvidence(modelResult.tag, '', Number(modelResult.confidence || 0.50))
        ],
        source: 'provider_nli'
      };
    }
  }

  return {
    candidates: [],
    source: 'provider_unknown'
  };
}

function parseBackendResponse(rawBody) {
  try {
    return {
      body: JSON.parse(rawBody),
      source: 'backend_model'
    };
  } catch (err) {
    return {
      body: rawBody,
      source: 'backend_model_raw'
    };
  }
}

function parse_response(schemaFamily, targetModelType, raw_response, candidateTags, fallbackTag) {
  if (targetModelType === 'classifier_llm') {
    return parseClassifierLlmResponse(raw_response, candidateTags, fallbackTag);
  }
  if (targetModelType === 'classifier_nli') {
    return parseNliResponse(schemaFamily, raw_response);
  }
  if (targetModelType === 'backend_llm' || targetModelType === 'backendModel') {
    return parseBackendResponse(raw_response);
  }
  return {
    source: 'unsupported_target_model_type'
  };
}

function mapCandidateLabel(promptProfile, candidate) {
  var labels = promptProfile.labels || [];
  var i;
  var external = candidate.external_label || candidate.internal_label || '';

  if (candidate.internal_label) {
    return candidate.internal_label;
  }

  for (i = 0; i < labels.length; i += 1) {
    if (labels[i].id === external || labels[i].text === external) {
      return labels[i].id;
    }
  }

  return external;
}

function finalize_classification(evidence, promptProfile) {
  var knownTags = (promptProfile.labels || []).map(function (label) {
    return label.id;
  });
  if (promptProfile.decision_policy && promptProfile.decision_policy.fallback_label) {
    knownTags.push(promptProfile.decision_policy.fallback_label);
  }
  var fallbackLabel = normalizeTag((promptProfile.decision_policy && promptProfile.decision_policy.fallback_label) || 'unknown', knownTags, 'unknown');
  var minConfidence = promptProfile.decision_policy && promptProfile.decision_policy.min_confidence !== undefined ? Number(promptProfile.decision_policy.min_confidence) : 0.55;
  var minMargin = promptProfile.decision_policy && promptProfile.decision_policy.min_margin !== undefined ? Number(promptProfile.decision_policy.min_margin) : 0.12;
  var candidates = [];
  var i;
  var top1;
  var top2;

  if (!evidence || !Array.isArray(evidence.candidates)) {
    return {
      tag: fallbackLabel,
      confidence: 0,
      candidates: [],
      source: evidence && evidence.source ? evidence.source : 'provider_unknown'
    };
  }

  for (i = 0; i < evidence.candidates.length; i += 1) {
    candidates.push({
      external_label: evidence.candidates[i].external_label || '',
      internal_label: mapCandidateLabel(promptProfile, evidence.candidates[i]),
      score: Number(evidence.candidates[i].score || 0)
    });
  }

  candidates.sort(function (a, b) {
    return b.score - a.score;
  });

  top1 = candidates[0];
  top2 = candidates[1] || { score: 0 };

  if (!top1) {
    return {
      tag: fallbackLabel,
      confidence: 0,
      candidates: candidates,
      source: evidence.source || 'provider_unknown'
    };
  }

  if (top1.score < minConfidence || (top1.score - top2.score) < minMargin) {
    return {
      tag: fallbackLabel,
      confidence: top1.score,
      candidates: candidates,
      source: evidence.source || 'provider_nli'
    };
  }

  return {
    tag: normalizeTag(top1.internal_label || fallbackLabel, knownTags, fallbackLabel),
    confidence: top1.score,
    candidates: candidates,
    source: evidence.source || 'provider_nli'
  };
}

function dispatchRequest(requestDescriptor, callback) {
  var transport = requestDescriptor.protocol === 'http:' ? http : https;
  var req = transport.request({
    protocol: requestDescriptor.protocol,
    hostname: requestDescriptor.hostname,
    port: requestDescriptor.port,
    path: requestDescriptor.path,
    method: requestDescriptor.method,
    headers: requestDescriptor.headers,
    timeout: requestDescriptor.timeout
  }, function (res) {
    var raw = '';
    res.on('data', function (chunk) {
      raw += chunk;
    });
    res.on('end', function () {
      callback(null, raw);
    });
  });

  req.on('error', function (err) {
    callback({
      source: 'provider_error',
      error: err.message
    });
  });

  req.on('timeout', function () {
    req.destroy();
    callback({
      source: 'provider_timeout',
      error: 'request timeout'
    });
  });

  req.write(requestDescriptor.body);
  req.end();
}

function buildDirectRoute(config, normalizedInput, decision, backendTargetRef) {
  var backendModel = resolveTargetModel(config, 'BackendModels');
  var selectedBackendTargetRef = backendTargetRef || decision.backendTargetRef || '';
  var backendTarget = selectedBackendTargetRef && config.backendTargetRegistry ? config.backendTargetRegistry[selectedBackendTargetRef] : null;
  var credentialSelection = null;
  var fallbackProviderConfig;
  var fallbackCredentialDescriptor = null;
  var effectiveBackendModel = backendTarget ? {
    schema_family: backendTarget.schema_family,
    targetModel_type: 'backend_llm',
    provider_config: backendTarget.provider_config,
    prompt_profile: backendTarget.prompt_profile_name
  } : backendModel;
  var promptProfile = backendTarget ? backendTarget.prompt_profile : resolvePromptProfile(config, decision.profile, effectiveBackendModel && effectiveBackendModel.prompt_profile, 'backend_llm');
  var requestDescriptor;

  if (selectedBackendTargetRef && !backendTarget) {
    return {
      supported: false,
      reason: 'backend_target_not_found'
    };
  }

  if (!effectiveBackendModel) {
    return {
      supported: false,
      reason: 'backend_not_configured'
    };
  }

  requestDescriptor = build_request(
    effectiveBackendModel.schema_family,
    effectiveBackendModel.targetModel_type,
    normalizedInput,
    promptProfile,
    effectiveBackendModel.provider_config,
    config
  );

  if (!requestDescriptor.supported) {
    return requestDescriptor;
  }

  if (backendTarget && backendTarget.provider_config && backendTarget.provider_config.credentialPoolRef) {
    credentialSelection = buildProviderCredentialSelection(config, backendTarget.provider_config.credentialPoolRef);
    if (!credentialSelection || !credentialSelection.primary) {
      return {
        supported: false,
        reason: 'credential_pool_unavailable'
      };
    }
    if (credentialSelection && credentialSelection.fallback) {
      fallbackProviderConfig = mergeObjects(effectiveBackendModel.provider_config || {}, {});
      fallbackProviderConfig.apiKey = credentialSelection.fallback.api_key;
      delete fallbackProviderConfig.apiKeyEnv;
      delete fallbackProviderConfig.credentialPoolRef;
      fallbackCredentialDescriptor = build_request(
        effectiveBackendModel.schema_family,
        effectiveBackendModel.targetModel_type,
        normalizedInput,
        promptProfile,
        fallbackProviderConfig,
        config
      );
    }
  }

  return {
    supported: true,
    pool: backendTarget ? backendTarget.pool_name : decision.pool,
    profile: backendTarget ? backendTarget.prompt_profile_name : decision.profile,
    backendTargetRef: selectedBackendTargetRef,
    upstreamHost: requestDescriptor.hostname,
    upstreamPath: requestDescriptor.path,
    authHeader: requestDescriptor.headers.Authorization || '',
    payloadB64: Buffer.from(requestDescriptor.body).toString('base64'),
    credentialPoolRef: credentialSelection && credentialSelection.pool ? (backendTarget.provider_config.credentialPoolRef || '') : '',
    credentialId: credentialSelection && credentialSelection.primary ? credentialSelection.primary.credential_id : '',
    fallbackCredentialId: credentialSelection && credentialSelection.fallback ? credentialSelection.fallback.credential_id : '',
    fallbackCredentialAuthHeader: fallbackCredentialDescriptor && fallbackCredentialDescriptor.supported ? (fallbackCredentialDescriptor.headers.Authorization || '') : '',
    credentialCooldownSeconds: credentialSelection ? credentialSelection.cooldownSeconds : 0
  };
}

function encodeDecision(decision) {
  return [
    decision.action || '',
    decision.tag || '',
    String(decision.confidence || 0),
    decision.source || 'unknown',
    decision.pool || '',
    decision.profile || '',
    decision.message || '',
    decision.publicModel || '',
    decision.upstreamHost || '',
    decision.upstreamPath || '',
    decision.authHeader || '',
    decision.payloadB64 || '',
    decision.fallbackPool || '',
    decision.fallbackProfile || '',
    decision.fallbackUpstreamHost || '',
    decision.fallbackUpstreamPath || '',
    decision.fallbackAuthHeader || '',
    decision.fallbackPayloadB64 || '',
    decision.fallbackBackendTargetRef || '',
    decision.credentialId || '',
    decision.fallbackCredentialId || '',
    decision.fallbackCredentialAuthHeader || '',
    String(decision.credentialCooldownSeconds || 0),
    decision.credentialPoolRef || ''
  ].join('\t');
}

function decisionForTag(config, classification, publicModel, forceDefaultRule) {
  var fallbackTag = resolveFallbackTag(config);
  var normalized = normalizeTag(classification.tag || fallbackTag, config && config.candidateTags, fallbackTag);
  var ruleSet = (config.decisions && config.decisions.tags) || {};
  var fallback = (config.decisions && config.decisions.default) || DEFAULT_CONFIG.decisions.default;
  var selected = ruleSet[normalized] || fallback || {};
  var activePolicy = config && config.activeRoutingPolicy;
  var routeFallbackBackendRef = '';
  var backendTarget;
  var i;

  if (activePolicy && activePolicy.policy_type !== 'orchestrator') {
    routeFallbackBackendRef = activePolicy.fallback_backend_target_ref || activePolicy.fallbackBackendTargetRef || '';
    selected = activePolicy.default_rule || fallback || {};
    if (!forceDefaultRule) {
      for (i = 0; i < activePolicy.rules.length; i += 1) {
        if (!activePolicy.rules[i].enabled) {
          continue;
        }
        if (normalizeTag(activePolicy.rules[i].source_tag, config.candidateTags, fallbackTag) === normalized) {
          selected = activePolicy.rules[i];
          break;
        }
      }
    }
  }

  backendTarget = selected.backend_target_ref && config.backendTargetRegistry ? config.backendTargetRegistry[selected.backend_target_ref] : null;

  return {
    action: selected.action || 'route',
    tag: normalized,
    confidence: classification.confidence || 0,
    source: classification.source || 'unknown',
    pool: selected.pool || (backendTarget ? backendTarget.pool_name : ''),
    profile: selected.prompt_profile || selected.profile || (backendTarget ? backendTarget.prompt_profile_name : ''),
    message: selected.message || selected.response_message || '',
    publicModel: publicModel || '',
    backendTargetRef: selected.backend_target_ref || '',
    fallbackBackendTargetRef: routeFallbackBackendRef
  };
}

function decisionForRule(config, rule, publicModel, source) {
  var selected = rule || {};
  var backendTarget = selected.backend_target_ref && config.backendTargetRegistry ? config.backendTargetRegistry[selected.backend_target_ref] : null;
  var fallbackBackendTargetRef = config && config.activeRoutingPolicy ?
    (config.activeRoutingPolicy.fallback_backend_target_ref || config.activeRoutingPolicy.fallbackBackendTargetRef || '') :
    '';

  return {
    action: selected.action || 'route',
    tag: selected.tag || 'virtual_key',
    confidence: selected.confidence || 1,
    source: source || 'key_policy',
    pool: selected.pool || (backendTarget ? backendTarget.pool_name : ''),
    profile: selected.prompt_profile || selected.profile || (backendTarget ? backendTarget.prompt_profile_name : ''),
    message: selected.message || selected.response_message || '',
    publicModel: publicModel || '',
    backendTargetRef: selected.backend_target_ref || '',
    fallbackBackendTargetRef: fallbackBackendTargetRef
  };
}

function virtualKeyMatchesRule(config, context, rule) {
  var match = rule && rule.match ? rule.match : {};
  var virtualKey = context && context.virtual_key ? context.virtual_key : null;
  var configuredKey;
  var expectedKid;

  if (!virtualKey) {
    return false;
  }

  if (match.virtual_key_pool_ref && match.virtual_key_pool_ref !== virtualKey.pool_ref) {
    return false;
  }

  if (match.virtual_key_tag && match.virtual_key_tag !== virtualKey.tag) {
    return false;
  }

  if (match.virtual_key_ref) {
    configuredKey = config && config.virtualKeyRegistry ? config.virtualKeyRegistry[match.virtual_key_ref] : null;
    expectedKid = configuredKey ? (configuredKey.kid || configuredKey.key_id || configuredKey.keyId || match.virtual_key_ref) : match.virtual_key_ref;
    if (expectedKid !== virtualKey.kid && match.virtual_key_ref !== virtualKey.kid) {
      return false;
    }
  }

  return true;
}

function findMatchingKeyRule(config, context) {
  var policy = config && config.activeRoutingPolicy ? config.activeRoutingPolicy : null;
  var rules = policy && Array.isArray(policy.key_rules) ? policy.key_rules : [];
  var i;

  for (i = 0; i < rules.length; i += 1) {
    if (!rules[i] || rules[i].enabled === false) {
      continue;
    }
    if (virtualKeyMatchesRule(config, context, rules[i])) {
      return rules[i];
    }
  }

  return null;
}

function isClassifierBypassEnabled(config) {
  return Boolean(config && config.classifierBypassEnabled);
}

function buildClassifierBypassResult(config, payload, requestPath, contentType) {
  var fallbackTag = resolveFallbackTag(config);
  var jsonObj;
  var normalizedInput;

  try {
    jsonObj = JSON.parse(payload);
  } catch (err) {
    return {
      classification: { tag: fallbackTag, confidence: 0, source: 'classifier_bypass_json_parse_error' },
      publicModel: '',
      jsonObj: null,
      normalizedInput: null
    };
  }

  normalizedInput = normalizeInputPayload(jsonObj, requestPath, contentType);
  return {
    classification: { tag: fallbackTag, confidence: 0, source: 'classifier_bypass' },
    publicModel: normalizedInput.public_model,
    jsonObj: jsonObj,
    normalizedInput: normalizedInput
  };
}

function buildRouteFailureMessage(reason, requestPath) {
  if (reason === 'unsupported_path') {
    if (isResponsesPath(requestPath)) {
      return '当前直连模式暂仅支持 chat completions 的 routed 请求，请改用 /v1/chat/completions 或 /chat/completions。';
    }
    return '当前直连模式暂仅支持 chat completions 的 routed 请求，请改用 /v1/chat/completions 或 /chat/completions。';
  }

  if (reason === 'credential_pool_unavailable') {
    return '当前路由的 southbound credential pool 不可用，请检查 credential pool 配置和 key 状态。';
  }

  if (reason === 'backend_target_not_found' || reason === 'backend_not_configured' || reason === 'provider_not_configured') {
    return '当前路由后端不可用，请检查 routing policy、backend target 和 provider 配置。';
  }

  return '当前网关路由不可用，请检查 routing policy 和 backend target 配置。';
}

function finalizeRouteDecision(config, result, requestPath, contentType, decision) {
  var directRoute;
  var fallbackRoute;
  var normalizedInput;

  if (decision.action === 'route') {
    normalizedInput = result.normalizedInput || normalizeInputPayload(result.jsonObj || {}, requestPath, contentType);
    directRoute = buildDirectRoute(config, normalizedInput, decision);
    if (!directRoute.supported) {
      decision.action = 'respond';
      decision.message = buildRouteFailureMessage(directRoute.reason, requestPath);
    } else {
      decision.pool = directRoute.pool || decision.pool;
      decision.profile = directRoute.profile || decision.profile;
      decision.upstreamHost = directRoute.upstreamHost;
      decision.upstreamPath = directRoute.upstreamPath;
      decision.authHeader = directRoute.authHeader;
      decision.payloadB64 = directRoute.payloadB64;
      decision.credentialPoolRef = directRoute.credentialPoolRef || '';
      decision.credentialId = directRoute.credentialId || '';
      decision.fallbackCredentialId = directRoute.fallbackCredentialId || '';
      decision.fallbackCredentialAuthHeader = directRoute.fallbackCredentialAuthHeader || '';
      decision.credentialCooldownSeconds = directRoute.credentialCooldownSeconds || 0;
      if (decision.fallbackBackendTargetRef && decision.fallbackBackendTargetRef !== decision.backendTargetRef) {
        fallbackRoute = buildDirectRoute(config, normalizedInput, decision, decision.fallbackBackendTargetRef);
        if (fallbackRoute.supported && fallbackRoute.pool && fallbackRoute.upstreamHost && fallbackRoute.payloadB64) {
          decision.fallbackPool = fallbackRoute.pool;
          decision.fallbackProfile = fallbackRoute.profile;
          decision.fallbackUpstreamHost = fallbackRoute.upstreamHost;
          decision.fallbackUpstreamPath = fallbackRoute.upstreamPath;
          decision.fallbackAuthHeader = fallbackRoute.authHeader;
          decision.fallbackPayloadB64 = fallbackRoute.payloadB64;
        }
      }
    }
  }

  return decision;
}

function callClassifierTargetModel(config, normalizedInput, callback) {
  var classifierModel = resolveTargetModel(config, 'ClassifierModels');
  var promptProfile;
  var requestDescriptor;
  var fallbackTag = resolveFallbackTag(config);

  if (!classifierModel) {
    callback({ tag: fallbackTag, confidence: 0.01, source: 'classifier_not_configured' });
    return;
  }

  promptProfile = resolvePromptProfile(config, classifierModel.prompt_profile, 'classifier_default', classifierModel.targetModel_type);
  requestDescriptor = build_request(
    classifierModel.schema_family,
    classifierModel.targetModel_type,
    normalizedInput,
    promptProfile,
    classifierModel.provider_config,
    config
  );

  if (!requestDescriptor.supported) {
    callback({
      tag: fallbackTag,
      confidence: 0.01,
      source: requestDescriptor.reason || 'request_not_supported'
    });
    return;
  }

  dispatchRequest(requestDescriptor, function (error, rawResponse) {
    var parsed;
    if (error) {
      callback({
        tag: fallbackTag,
        confidence: 0.01,
        source: error.source || 'provider_error',
        error: error.error
      });
      return;
    }

    parsed = parse_response(classifierModel.schema_family, classifierModel.targetModel_type, rawResponse, config.candidateTags, fallbackTag);

    if (classifierModel.targetModel_type === 'classifier_nli') {
      callback(finalize_classification(parsed, promptProfile));
      return;
    }

    callback(parsed);
  });
}

function classifyPayload(config, payload, requestPath, contentType, callback) {
  var jsonObj;
  var localResult;
  var normalizedInput;
  var fallbackTag = resolveFallbackTag(config);

  try {
    jsonObj = JSON.parse(payload);
  } catch (err) {
    callback({
      classification: { tag: fallbackTag, confidence: 0.01, source: 'json_parse_error' },
      publicModel: '',
      jsonObj: null,
      normalizedInput: null
    });
    return;
  }

  normalizedInput = normalizeInputPayload(jsonObj, requestPath, contentType);
  if (!normalizedInput.text || !normalizedInput.text.replace(/\s+/g, '')) {
    callback({
      classification: { tag: fallbackTag, confidence: 0.01, source: 'empty_prompt' },
      publicModel: normalizedInput.public_model,
      jsonObj: jsonObj,
      normalizedInput: normalizedInput
    });
    return;
  }

  if (config.rulesFirst) {
    localResult = classifyWithLocalRules(normalizedInput.text, config);
    if (localResult.tag !== fallbackTag || config.mode === 'local_only' || localResult.source === 'rules_terminal') {
      callback({
        classification: localResult,
        publicModel: normalizedInput.public_model,
        jsonObj: jsonObj,
        normalizedInput: normalizedInput
      });
      return;
    }
  }

  if (config.mode === 'mock') {
    callback({
      classification: classifyWithLocalRules(normalizedInput.text, config),
      publicModel: normalizedInput.public_model,
      jsonObj: jsonObj,
      normalizedInput: normalizedInput
    });
    return;
  }

  callClassifierTargetModel(config, normalizedInput, function (providerResult) {
    callback({
      classification: providerResult,
      publicModel: normalizedInput.public_model,
      jsonObj: jsonObj,
      normalizedInput: normalizedInput
    });
  });
}

ilx.addMethod('health', function (req, res) {
  var config = normalizeConfig(loadConfig());
  var classifierModel = resolveTargetModel(config, 'ClassifierModels') || {};
  var backendModel = resolveTargetModel(config, 'BackendModels') || {};
  var activePolicy = config.activeRoutingPolicy || {};
  res.reply(JSON.stringify({
    status: 'ok',
    operatingMode: config.operatingMode,
    mode: config.mode,
    nativeConfigApplied: Boolean(config._nativeConfigStatus && config._nativeConfigStatus.applied),
    nativeConfigLoadedKeys: config._nativeConfigStatus && config._nativeConfigStatus.loaded_keys ? config._nativeConfigStatus.loaded_keys : [],
    nativeConfigFiles: config._nativeConfigStatus && config._nativeConfigStatus.files ? config._nativeConfigStatus.files : {},
    listenerCount: Object.keys(config.listenerRegistry || {}).length,
    classifierCount: Object.keys(config.classifierRegistry || {}).length,
    backendTargetCount: Object.keys(config.backendTargetRegistry || {}).length,
    providerCredentialPoolCount: Object.keys(config.providerCredentialPoolRegistry || {}).length,
    routingPolicyCount: Object.keys(config.routingPolicyRegistry || {}).length,
    activeListenerRef: config.activeListenerRef || '',
    activeClassifierRef: config.activeClassifierRef || '',
    classifierBypassEnabled: isClassifierBypassEnabled(config),
    activeRoutingPolicyRef: config.activeRoutingPolicyRef || '',
    activeRoutingPolicyType: activePolicy.policy_type || '',
    activeRoutingRuleCount: activePolicy.rules ? activePolicy.rules.length : 0,
    classifierSchemaFamily: classifierModel.schema_family || '',
    classifierTargetModelType: classifierModel.targetModel_type || '',
    candidateTags: config.candidateTags,
    localRuleCount: config.localRules ? config.localRules.length : 0,
    backendSchemaFamily: backendModel.schema_family || '',
    backendTargetModelType: backendModel.targetModel_type || '',
    backendHost: (backendModel.provider_config && backendModel.provider_config.hostname) || '',
    backendPath: (backendModel.provider_config && backendModel.provider_config.path) || ''
  }));
});

ilx.addMethod('classifyIntent', function (req, res) {
  var params = req.params();
  var payload = params[0] || '';
  var requestPath = params[1] || '';
  var contentType = params[2] || '';
  var config = normalizeConfig(loadConfig());

  classifyPayload(config, payload, requestPath, contentType, function (result) {
    res.reply(formatReply(result.classification, config));
  });
});

ilx.addMethod('recordCredentialRuntime', function (req, res) {
  var params = req.params();

  recordProviderCredentialRuntimeEvent(params[0] || '');
  res.reply('ok');
});

ilx.addMethod('decideRoute', function (req, res) {
  var params = req.params();
  var payload = params[0] || '';
  var requestPath = params[1] || '';
  var contentType = params[2] || '';
  var context = parseDecisionContext(params[3] || '');
  var config = normalizeConfig(loadConfig());
  var activeConfig = buildConfigForActiveRefs(config, context.listener_ref || config.activeListenerRef);
  var activePolicy = activeConfig.activeRoutingPolicy || {};
  var routingMode = normalizeRoutingMode(activePolicy.routing_mode);
  var parsedPayload;
  var keyRule;
  var selectedClassifierRef;
  var bypassResult;
  var bypassDecision;

  try {
    parsedPayload = JSON.parse(payload);
  } catch (error) {
    res.reply(encodeDecision({
      action: 'bad_request',
      tag: 'unknown',
      confidence: 0,
      source: 'json_parse_error',
      message: 'Invalid JSON request body.'
    }));
    return;
  }

  if (!parsedPayload || typeof parsedPayload !== 'object' || Array.isArray(parsedPayload)) {
    res.reply(encodeDecision({
      action: 'bad_request',
      tag: 'unknown',
      confidence: 0,
      source: 'json_parse_error',
      message: 'JSON request body must be an object.'
    }));
    return;
  }

  recordVirtualKeyLastUsed(context);

  if (routingMode === 'key_only' || routingMode === 'key_then_classifier') {
    keyRule = hasVirtualKeyContext(context) ? findMatchingKeyRule(activeConfig, context) : null;
    if (keyRule && (keyRule.action === 'route' || keyRule.action === 'respond')) {
      bypassResult = buildClassifierBypassResult(activeConfig, payload, requestPath, contentType);
      bypassDecision = decisionForRule(activeConfig, keyRule, bypassResult.publicModel, 'key_policy');
      res.reply(encodeDecision(finalizeRouteDecision(activeConfig, bypassResult, requestPath, contentType, bypassDecision)));
      return;
    }
    if (keyRule && keyRule.action === 'classify') {
      selectedClassifierRef = keyRule.classifier_ref || activePolicy.classifier_ref || '';
      activeConfig = buildConfigForActiveRefs(config, context.listener_ref || config.activeListenerRef, activeConfig.activeRoutingPolicyRef, selectedClassifierRef);
    } else if (routingMode === 'key_only') {
      bypassResult = buildClassifierBypassResult(activeConfig, payload, requestPath, contentType);
      bypassResult.classification.source = keyRule ? 'key_policy_default' : 'key_policy_no_match';
      bypassDecision = decisionForTag(activeConfig, bypassResult.classification, bypassResult.publicModel, true);
      res.reply(encodeDecision(finalizeRouteDecision(activeConfig, bypassResult, requestPath, contentType, bypassDecision)));
      return;
    }
  }

  if (isClassifierBypassEnabled(activeConfig)) {
    bypassResult = buildClassifierBypassResult(activeConfig, payload, requestPath, contentType);
    bypassDecision = decisionForTag(activeConfig, bypassResult.classification, bypassResult.publicModel, true);
    res.reply(encodeDecision(finalizeRouteDecision(activeConfig, bypassResult, requestPath, contentType, bypassDecision)));
    return;
  }

  classifyPayload(activeConfig, payload, requestPath, contentType, function (result) {
    var decision = decisionForTag(activeConfig, result.classification, result.publicModel);
    res.reply(encodeDecision(finalizeRouteDecision(activeConfig, result, requestPath, contentType, decision)));
  });
});

ilx.listen();
}());
