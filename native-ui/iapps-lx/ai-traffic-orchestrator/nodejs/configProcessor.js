'use strict';

function clone(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function bufferFromBytes(bytes) {
  if (typeof Buffer.from === 'function') {
    return Buffer.from(bytes);
  }
  return new Buffer(bytes);
}

function repairMojibakeString(value) {
  var text = String(value);
  var cp1252Bytes = {
    0x20ac: 0x80,
    0x201a: 0x82,
    0x0192: 0x83,
    0x201e: 0x84,
    0x2026: 0x85,
    0x2020: 0x86,
    0x2021: 0x87,
    0x02c6: 0x88,
    0x2030: 0x89,
    0x0160: 0x8a,
    0x2039: 0x8b,
    0x0152: 0x8c,
    0x017d: 0x8e,
    0x2018: 0x91,
    0x2019: 0x92,
    0x201c: 0x93,
    0x201d: 0x94,
    0x2022: 0x95,
    0x2013: 0x96,
    0x2014: 0x97,
    0x02dc: 0x98,
    0x2122: 0x99,
    0x0161: 0x9a,
    0x203a: 0x9b,
    0x0153: 0x9c,
    0x017e: 0x9e,
    0x0178: 0x9f
  };
  var bytes = [];
  var decoded;
  var index;
  var code;

  if (!/[\u00c0-\u00ff\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u0192\u02c6\u02dc\u2018-\u201e\u2020-\u2026\u2030\u2039\u203a\u20ac]/.test(text)) {
    return value;
  }

  for (index = 0; index < text.length; index += 1) {
    code = text.charCodeAt(index);
    if (code <= 255) {
      bytes.push(code);
    } else if (cp1252Bytes[code]) {
      bytes.push(cp1252Bytes[code]);
    } else {
      return value;
    }
  }

  decoded = bufferFromBytes(bytes).toString('utf8');
  if (decoded.indexOf('\ufffd') >= 0 || !/[\u3400-\u9fff]/.test(decoded)) {
    return value;
  }

  return decoded;
}

function repairMojibake(value) {
  if (Array.isArray(value)) {
    return value.map(repairMojibake);
  }

  if (value && typeof value === 'object') {
    Object.keys(value).forEach(function (key) {
      value[key] = repairMojibake(value[key]);
    });
    return value;
  }

  if (typeof value === 'string') {
    return repairMojibakeString(value);
  }

  return value;
}

function firstKey(map) {
  var keys = Object.keys(map || {});
  return keys.length ? keys[0] : '';
}

function buildReferencedPolicyRefMap(normalized) {
  var refs = {};

  Object.keys((normalized && normalized.listeners) || {}).forEach(function (listenerId) {
    var listener = normalized.listeners[listenerId] || {};
    var policyRef = listener.policy_ref || listener.policyRef || '';

    if (policyRef) {
      refs[policyRef] = true;
    }
  });

  return refs;
}

function normalizeActiveId(value, collection, fallback) {
  var id = typeof value === 'string' ? value : '';

  if (id && collection && collection[id]) {
    return id;
  }

  return fallback || '';
}

function normalizeEditorMode(value, fallback) {
  var mode = String(value || '').trim().toLowerCase();

  if (mode === 'create' || mode === 'edit' || mode === 'empty') {
    return mode;
  }

  return fallback;
}

var SUPPORTED_BACKEND_SCHEMA_FAMILIES = {
  openai_chat_compatible: true
};
var SUPPORTED_CLIENT_AUTH_TYPES = {
  none: true,
  virtual_key: true
};
var SUPPORTED_VIRTUAL_KEY_HASH_ALGS = {
  sha256: true
};
var SUPPORTED_ROUTING_MODES = {
  classifier_only: true,
  key_only: true,
  key_then_classifier: true
};
var SUPPORTED_POLICY_ACTIONS = {
  route: true,
  respond: true
};
var SUPPORTED_KEY_POLICY_ACTIONS = {
  route: true,
  respond: true,
  classify: true
};
var SUPPORTED_PROVIDER_CREDENTIAL_SELECTION_MODES = {
  priority_failover: true
};

function normalizeBackendSchemaFamily(value) {
  var normalized = String(value || '').trim();

  if (!normalized || normalized === 'openai_compatible_chat') {
    return 'openai_chat_compatible';
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

function normalizeVirtualKeyHashAlg(value) {
  var normalized = String(value || 'sha256').trim().toLowerCase().replace(/-/g, '');

  if (!normalized) {
    return 'sha256';
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
  if (!SUPPORTED_ROUTING_MODES[normalized]) {
    return 'classifier_only';
  }

  return normalized;
}

function normalizePolicyAction(value, fallback, allowClassify) {
  var normalized = String(value || fallback || 'route').trim().toLowerCase().replace(/-/g, '_');

  if (normalized === 'local_response' || normalized === 'local response' || normalized === 'response') {
    return 'respond';
  }
  if (!allowClassify && normalized === 'classify') {
    return fallback || 'route';
  }

  return normalized;
}

function isSupportedBackendSchemaFamily(value) {
  return !!SUPPORTED_BACKEND_SCHEMA_FAMILIES[normalizeBackendSchemaFamily(value)];
}

function toStringValue(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback || '';
  }
  return String(value);
}

function stripTransientStatusFields(record) {
  if (!record || typeof record !== 'object') {
    return record;
  }

  delete record.config_status;
  delete record.configStatus;
  delete record.health_status;
  delete record.healthStatus;
  delete record.runtime_status;
  delete record.runtimeStatus;

  return record;
}

function sanitizeListenerStatus(status) {
  var sanitized = clone(status || {});
  return stripTransientStatusFields(sanitized);
}

function sanitizeBackendStatus(status) {
  var sanitized = clone(status || {});

  stripTransientStatusFields(sanitized);
  delete sanitized.pool_status;
  delete sanitized.poolStatus;
  delete sanitized.member_summary;
  delete sanitized.memberSummary;

  return sanitized;
}

function sanitizeMember(member) {
  var sanitized = clone(member || {});
  return stripTransientStatusFields(sanitized);
}

function normalizePolicyDefaultRule(defaultRule) {
  var normalized = clone(defaultRule || {});

  normalized.action = normalizePolicyAction(normalized.action || 'route', 'route', false);
  normalized.backend_target_ref = normalized.backend_target_ref || normalized.backendTargetRef || '';
  normalized.response_message = normalized.response_message || normalized.responseMessage || '';
  delete normalized.backendTargetRef;
  delete normalized.responseMessage;

  return normalized;
}

function normalizePolicyTagRule(rule, index) {
  var normalized = clone(rule || {});

  normalized.rule_name = normalized.rule_name || normalized.ruleName || ('rule_' + index);
  normalized.source_tag = String(normalized.source_tag || normalized.sourceTag || '').trim();
  normalized.action = normalizePolicyAction(normalized.action || 'route', 'route', false);
  normalized.backend_target_ref = normalized.backend_target_ref || normalized.backendTargetRef || '';
  normalized.response_message = normalized.response_message || normalized.responseMessage || '';
  normalized.enabled = normalized.enabled !== undefined ? Boolean(normalized.enabled) : true;
  delete normalized.ruleName;
  delete normalized.sourceTag;
  delete normalized.backendTargetRef;
  delete normalized.responseMessage;

  return normalized;
}

function normalizePolicyKeyRule(rule, index) {
  var normalized = clone(rule || {});
  var match = clone(normalized.match || {});

  normalized.rule_name = normalized.rule_name || normalized.ruleName || ('key_rule_' + index);
  normalized.enabled = normalized.enabled !== undefined ? Boolean(normalized.enabled) : true;
  normalized.action = normalizePolicyAction(normalized.action || 'route', 'route', true);
  normalized.backend_target_ref = normalized.backend_target_ref || normalized.backendTargetRef || '';
  normalized.response_message = normalized.response_message || normalized.responseMessage || '';
  normalized.classifier_ref = normalized.classifier_ref || normalized.classifierRef || '';
  normalized.match = {
    virtual_key_pool_ref: String(match.virtual_key_pool_ref || match.virtualKeyPoolRef || normalized.virtual_key_pool_ref || normalized.virtualKeyPoolRef || '').trim(),
    virtual_key_ref: String(match.virtual_key_ref || match.virtualKeyRef || normalized.virtual_key_ref || normalized.virtualKeyRef || '').trim(),
    virtual_key_tag: String(match.virtual_key_tag || match.virtualKeyTag || normalized.virtual_key_tag || normalized.virtualKeyTag || '').trim()
  };
  delete normalized.ruleName;
  delete normalized.backendTargetRef;
  delete normalized.responseMessage;
  delete normalized.classifierRef;

  return normalized;
}

function findVirtualKeyByRef(virtualKeys, keyRef) {
  var found = null;

  if (!keyRef || !virtualKeys) {
    return null;
  }

  if (virtualKeys[keyRef]) {
    return virtualKeys[keyRef];
  }

  Object.keys(virtualKeys).some(function (keyId) {
    var virtualKey = virtualKeys[keyId] || {};

    if (virtualKey.kid === keyRef) {
      found = virtualKey;
      return true;
    }

    return false;
  });

  return found;
}

function normalizePathList(listener, status) {
  var supportedPaths = (status && status.supported_paths) || [];
  var fixed = {
    root_paths: ['/', '/v1'],
    model_paths: ['/v1/models', '/models', '/model/list'],
    chat_paths: ['/v1/chat/completions', '/chat/completions'],
    responses_paths: ['/v1/responses', '/responses']
  };
  var result = clone((listener && listener.runtime_paths) || {});

  Object.keys(fixed).forEach(function (key) {
    if (Array.isArray(result[key]) && result[key].length) {
      return;
    }
    result[key] = fixed[key].filter(function (pathValue) {
      return supportedPaths.indexOf(pathValue) >= 0;
    });
    if (!result[key].length) {
      result[key] = fixed[key].slice(0);
    }
  });

  return result;
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

function buildManagedClassifierMap(normalized) {
  var result = {};
  Object.keys(normalized.classifiers || {}).forEach(function (classifierId) {
    var classifier = normalized.classifiers[classifierId] || {};
    result[classifierId] = {
      classifier_name: classifier.classifier_name || classifier.classifierName || classifierId,
      classifier_type: classifier.classifier_type || classifier.classifierType || 'classifier_llm',
      schema_family: classifier.schema_family || classifier.schemaFamily || '',
      endpoint_url: classifier.endpoint_url || classifier.endpointUrl || '',
      api_key: classifier.api_key || classifier.apiKey || '',
      pool_name: classifier.pool_name || classifier.poolName || '',
      model_id: classifier.model_id || classifier.modelId || '',
      temperature: Number(classifier.temperature || 0),
      max_tokens: Number(classifier.max_tokens || classifier.maxTokens || 0),
      classifier_prompt: classifier.classifier_prompt || classifier.classifierPrompt || '',
      candidate_tags: Array.isArray(classifier.candidate_tags) ? classifier.candidate_tags.slice(0) : [],
      fallback_tag: classifier.fallback_tag || classifier.fallbackTag || '',
      bypass_enabled: classifier.bypass_enabled !== undefined ? Boolean(classifier.bypass_enabled) : Boolean(classifier.bypassEnabled),
      use_built_in_rules_first: classifier.use_built_in_rules_first !== undefined ? Boolean(classifier.use_built_in_rules_first) : true,
      timeout_ms: Number(classifier.timeout_ms || classifier.timeoutMs || 0),
      min_confidence: Number(classifier.min_confidence || classifier.minConfidence || 0),
      multi_label: classifier.multi_label !== undefined ? Boolean(classifier.multi_label) : Boolean(classifier.multiLabel),
      hypothesis_template: classifier.hypothesis_template || classifier.hypothesisTemplate || '',
      min_margin: Number(classifier.min_margin || classifier.minMargin || 0)
    };
    if (classifier.classifier_egress || classifier.classifierEgress) {
      result[classifierId].classifier_egress = clone(classifier.classifier_egress || classifier.classifierEgress);
    }
  });
  return result;
}

function buildManagedBackendMap(normalized) {
  var result = {};
  Object.keys(normalized.backendTargets || {}).forEach(function (backendId) {
    var backend = normalized.backendTargets[backendId] || {};
    result[backendId] = {
      backend_target_name: backend.backend_target_name || backend.backendTargetName || backendId,
      schema_family: normalizeBackendSchemaFamily(backend.schema_family || backend.schemaFamily),
      endpoint_url: backend.endpoint_url || backend.endpointUrl || '',
      api_key: backend.api_key || backend.apiKey || '',
      credential_pool_ref: backend.credential_pool_ref || backend.credentialPoolRef || '',
      model_id: backend.model_id || backend.modelId || '',
      pool_name: backend.pool_name || backend.poolName || '',
      backend_prompt: backend.backend_prompt || backend.backendPrompt || '',
      backend_prompt_mode: backend.backend_prompt_mode || backend.backendPromptMode || 'append'
    };
  });
  return result;
}

function normalizeProviderCredentialSelectionMode(value) {
  var normalized = String(value || 'priority_failover').trim().toLowerCase().replace(/-/g, '_');

  if (!SUPPORTED_PROVIDER_CREDENTIAL_SELECTION_MODES[normalized]) {
    return 'priority_failover';
  }

  return normalized;
}

function normalizeProviderCredentialEntry(entry, index) {
  var normalized = entry || {};
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

function normalizeProviderCredentialPool(poolId, pool) {
  var normalized = pool || {};

  normalized.pool_name = String(normalized.pool_name || normalized.poolName || poolId).trim();
  normalized.vendor = String(normalized.vendor || '').trim().toLowerCase();
  normalized.auth_scheme = String(normalized.auth_scheme || normalized.authScheme || 'bearer').trim().toLowerCase();
  normalized.selection_mode = normalizeProviderCredentialSelectionMode(normalized.selection_mode || normalized.selectionMode);
  normalized.cooldown_seconds = Number(
    normalized.cooldown_seconds !== undefined
      ? normalized.cooldown_seconds
      : (normalized.cooldownSeconds !== undefined ? normalized.cooldownSeconds : 30)
  );
  normalized.entries = Array.isArray(normalized.entries)
    ? normalized.entries.map(function (entry, index) {
      return normalizeProviderCredentialEntry(entry, index);
    })
    : [];

  delete normalized.poolName;
  delete normalized.authScheme;
  delete normalized.selectionMode;
  delete normalized.cooldownSeconds;

  return normalized;
}

function buildManagedProviderCredentialPoolMap(normalized) {
  var result = {};

  Object.keys(normalized.providerCredentialPools || {}).forEach(function (poolId) {
    var pool = normalized.providerCredentialPools[poolId] || {};

    result[poolId] = {
      pool_name: pool.pool_name || pool.poolName || poolId,
      vendor: pool.vendor || '',
      auth_scheme: pool.auth_scheme || pool.authScheme || 'bearer',
      selection_mode: normalizeProviderCredentialSelectionMode(pool.selection_mode || pool.selectionMode),
      cooldown_seconds: Number(pool.cooldown_seconds !== undefined ? pool.cooldown_seconds : (pool.cooldownSeconds !== undefined ? pool.cooldownSeconds : 30)),
      entries: Array.isArray(pool.entries) ? pool.entries.map(function (entry, index) {
        var normalizedEntry = normalizeProviderCredentialEntry(clone(entry || {}), index);
        return {
          credential_id: normalizedEntry.credential_id,
          display_name: normalizedEntry.display_name,
          enabled: normalizedEntry.enabled,
          priority: normalizedEntry.priority,
          api_key: normalizedEntry.api_key
        };
      }) : []
    };
  });

  return result;
}

function normalizeKeyRule(index, rawRule) {
  var normalized = normalizePolicyKeyRule(rawRule, index);

  if (!SUPPORTED_KEY_POLICY_ACTIONS[normalized.action]) {
    normalized.action = 'route';
  }

  return normalized;
}

function normalizeKeyRules(rules) {
  if (!Array.isArray(rules)) {
    return [];
  }

  return rules.map(function (rule, index) {
    return normalizeKeyRule(index, rule);
  });
}

function buildManagedPolicyMap(normalized) {
  var result = {};
  Object.keys(normalized.routingPolicies || {}).forEach(function (policyId) {
    var policy = normalized.routingPolicies[policyId] || {};
    var routingMode = normalizeRoutingMode(policy.routing_mode || policy.routingMode);
    result[policyId] = {
      policy_type: policy.policy_type || policy.policyType || 'routing',
      policy_name: policy.policy_name || policy.policyName || policyId,
      routing_mode: routingMode,
      classifier_ref: routingMode === 'key_only' ? '' : (policy.classifier_ref || policy.classifierRef || ''),
      fallback_backend_target_ref: policy.fallback_backend_target_ref || policy.fallbackBackendTargetRef || '',
      default_rule: clone(policy.default_rule || {
        action: 'route',
        backend_target_ref: '',
        response_message: ''
      }),
      key_rules: normalizeKeyRules(policy.key_rules || policy.keyRules),
      rules: Array.isArray(policy.rules) ? policy.rules.map(normalizePolicyTagRule) : []
    };
  });
  return result;
}

function normalizeVirtualKeyPool(poolId, pool) {
  var normalized = pool || {};

  normalized.pool_name = normalized.pool_name || normalized.poolName || poolId;
  normalized.description = normalized.description || '';
  normalized.enabled = normalized.enabled !== undefined ? Boolean(normalized.enabled) : normalized.enabled !== false;
  normalized.default_limits = normalized.default_limits || normalized.defaultLimits || {};
  delete normalized.poolName;
  delete normalized.defaultLimits;

  return normalized;
}

function normalizeVirtualKey(keyId, key) {
  var normalized = key || {};
  var createdAt = normalized.created_at;
  var lastUsedAt = normalized.last_used_at;

  normalized.kid = normalized.kid || normalized.key_id || normalized.keyId || keyId;
  normalized.tag = String(normalized.tag || '').trim();
  normalized.virtual_key_pool_ref = normalized.virtual_key_pool_ref || normalized.virtualKeyPoolRef || normalized.pool_ref || normalized.poolRef || '';
  normalized.description = normalized.description || '';
  normalized.enabled = normalized.enabled !== undefined ? Boolean(normalized.enabled) : normalized.enabled !== false;
  normalized.secret_hash_alg = normalizeVirtualKeyHashAlg(normalized.secret_hash_alg || normalized.secretHashAlg || 'sha256');
  normalized.secret_hash = String(normalized.secret_hash || normalized.secretHash || '').trim();
  normalized.key_preview = normalized.key_preview || normalized.keyPreview || '';
  normalized.secret_last4 = normalized.secret_last4 || normalized.secretLast4 || '';
  normalized.limits = normalized.limits || {};
  if (createdAt === undefined || createdAt === null || createdAt === '') {
    createdAt = normalized.createdAt;
  }
  if (lastUsedAt === undefined || lastUsedAt === null || lastUsedAt === '') {
    lastUsedAt = normalized.lastUsedAt;
  }
  normalized.created_at = toStringValue(createdAt, '');
  normalized.last_used_at = toStringValue(lastUsedAt, '');
  delete normalized.key_id;
  delete normalized.keyId;
  delete normalized.virtualKeyPoolRef;
  delete normalized.pool_ref;
  delete normalized.poolRef;
  delete normalized.secretHashAlg;
  delete normalized.secretHash;
  delete normalized.keyPreview;
  delete normalized.secretLast4;
  delete normalized.createdAt;
  delete normalized.lastUsedAt;
  delete normalized.secret;
  delete normalized.plaintext_secret;
  delete normalized.plaintextSecret;

  return normalized;
}

function normalizeBlock(block) {
  var normalized = repairMojibake(clone(block));
  var firstListener;
  var firstClassifier;
  var firstBackend;
  var firstPolicy;

  normalized.operatingMode = normalized.operatingMode || 'gateway';
  normalized.listeners = normalized.listeners || {};
  normalized.classifiers = normalized.classifiers || {};
  normalized.backendTargets = normalized.backendTargets || {};
  normalized.routingPolicies = normalized.routingPolicies || {};
  normalized.providerCredentialPools = normalized.providerCredentialPools || {};
  normalized.virtualKeyPools = normalized.virtualKeyPools || {};
  normalized.virtualKeys = normalized.virtualKeys || {};
  normalized.activeIds = normalized.activeIds || {};
  normalized.ui = normalized.ui || {};

  firstListener = firstKey(normalized.listeners);
  firstClassifier = firstKey(normalized.classifiers);
  firstBackend = firstKey(normalized.backendTargets);
  firstPolicy = firstKey(normalized.routingPolicies);

  Object.keys(normalized.listeners).forEach(function (listenerId) {
    var listener = normalized.listeners[listenerId] || {};
    var listenerPolicy;
    var listenerRoutingMode;
    stripTransientStatusFields(listener);
    listener.listener_name = listener.listener_name || listener.listenerName || listenerId;
    listener.virtual_service = listener.virtual_service || listener.virtualService || '';
    listener.enabled = listener.enabled !== undefined ? Boolean(listener.enabled) : true;
    listener.advanced = listener.advanced || {};
    listener.status = sanitizeListenerStatus(listener.status || {});
    listener.client_auth_type = normalizeClientAuthType(listener.client_auth_type || listener.clientAuthType || 'none');
    listener.allowed_virtual_key_pool_refs = (Array.isArray(listener.allowed_virtual_key_pool_refs)
      ? listener.allowed_virtual_key_pool_refs.slice(0)
      : (Array.isArray(listener.allowedVirtualKeyPoolRefs) ? listener.allowedVirtualKeyPoolRefs.slice(0) : [])).map(function (poolRef) {
        return String(poolRef || '').trim();
      }).filter(function (poolRef, index, poolRefs) {
        return !!poolRef && poolRefs.indexOf(poolRef) === index;
      });
    delete listener.clientAuthType;
    delete listener.allowedVirtualKeyPoolRefs;
    if (!listener.policy_ref) {
      listener.policy_ref = firstPolicy;
    }
    listenerPolicy = listener.policy_ref && normalized.routingPolicies[listener.policy_ref]
      ? normalized.routingPolicies[listener.policy_ref]
      : null;
    listenerRoutingMode = listenerPolicy ? normalizeRoutingMode(listenerPolicy.routing_mode || listenerPolicy.routingMode) : '';
    if (listenerRoutingMode === 'key_only') {
      listener.classifier_ref = '';
    } else {
      listener.classifier_ref = listener.classifier_ref || listener.classifierRef || '';
      if (!listener.classifier_ref && listenerPolicy) {
        listener.classifier_ref = listenerPolicy.classifier_ref || listenerPolicy.classifierRef || firstClassifier;
      }
      if (!listener.classifier_ref) {
        listener.classifier_ref = firstClassifier;
      }
    }
    delete listener.classifierRef;
    normalized.listeners[listenerId] = listener;
  });

  Object.keys(normalized.classifiers).forEach(function (classifierId) {
    var classifier = normalized.classifiers[classifierId] || {};
    delete classifier.api_key_env;
    delete classifier.apiKeyEnv;
    delete classifier.secret_ref;
    delete classifier.secretRef;
    classifier.pool_name = classifier.pool_name || classifier.poolName || '';
    delete classifier.poolName;
    classifier.bypass_enabled = classifier.bypass_enabled !== undefined ? Boolean(classifier.bypass_enabled) : Boolean(classifier.bypassEnabled);
    delete classifier.bypassEnabled;
    normalized.classifiers[classifierId] = classifier;
  });

  Object.keys(normalized.backendTargets).forEach(function (backendId) {
    var backend = normalized.backendTargets[backendId] || {};
    var backendStatus;

    stripTransientStatusFields(backend);
    delete backend.api_key_env;
    delete backend.apiKeyEnv;
    delete backend.secret_ref;
    delete backend.secretRef;
    backend.credential_pool_ref = backend.credential_pool_ref || backend.credentialPoolRef || '';
    delete backend.credentialPoolRef;
    backend.schema_family = normalizeBackendSchemaFamily(backend.schema_family || backend.schemaFamily);
    delete backend.advanced;
    delete backend.members;

    backendStatus = sanitizeBackendStatus(backend.status || {});
    if (Object.keys(backendStatus).length) {
      backend.status = backendStatus;
    } else {
      delete backend.status;
    }

    normalized.backendTargets[backendId] = backend;
  });

  Object.keys(normalized.providerCredentialPools).forEach(function (poolId) {
    normalized.providerCredentialPools[poolId] = normalizeProviderCredentialPool(poolId, normalized.providerCredentialPools[poolId] || {});
  });

  Object.keys(normalized.routingPolicies).forEach(function (policyId) {
    var policy = normalized.routingPolicies[policyId] || {};
    policy.policy_name = policy.policy_name || policy.policyName || policyId;
    policy.policy_type = policy.policy_type || policy.policyType || 'routing';
    policy.routing_mode = normalizeRoutingMode(policy.routing_mode || policy.routingMode);
    policy.classifier_ref = policy.routing_mode === 'key_only'
      ? ''
      : (policy.classifier_ref || policy.classifierRef || firstClassifier);
    policy.fallback_backend_target_ref = policy.fallback_backend_target_ref || policy.fallbackBackendTargetRef || '';
    policy.default_rule = normalizePolicyDefaultRule(policy.default_rule || {
      action: 'route',
      backend_target_ref: '',
      response_message: ''
    });
    policy.key_rules = normalizeKeyRules(policy.key_rules || policy.keyRules);
    policy.rules = Array.isArray(policy.rules) ? policy.rules.map(normalizePolicyTagRule) : [];
    delete policy.routingMode;
    delete policy.classifierRef;
    delete policy.keyRules;
    normalized.routingPolicies[policyId] = policy;
  });

  Object.keys(normalized.virtualKeyPools).forEach(function (poolId) {
    normalized.virtualKeyPools[poolId] = normalizeVirtualKeyPool(poolId, normalized.virtualKeyPools[poolId] || {});
  });

  Object.keys(normalized.virtualKeys).forEach(function (keyId) {
    normalized.virtualKeys[keyId] = normalizeVirtualKey(keyId, normalized.virtualKeys[keyId] || {});
  });

  normalized.activeIds.listener = normalizeActiveId(normalized.activeIds.listener, normalized.listeners, '');
  normalized.activeIds.classifier = normalizeActiveId(normalized.activeIds.classifier, normalized.classifiers, firstClassifier);
  normalized.activeIds.backend = normalizeActiveId(normalized.activeIds.backend, normalized.backendTargets, '');
  normalized.activeIds.policy = normalizeActiveId(normalized.activeIds.policy, normalized.routingPolicies, firstPolicy);
  normalized.activeIds.ruleIndex = typeof normalized.activeIds.ruleIndex === 'number' && normalized.activeIds.ruleIndex >= 0
    ? Math.floor(normalized.activeIds.ruleIndex)
    : 0;

  normalized.ui.classifierEditorMode = normalizeEditorMode(
    normalized.ui.classifierEditorMode,
    normalized.activeIds.classifier ? 'edit' : 'empty'
  );
  normalized.ui.listenerEditorMode = normalizeEditorMode(normalized.ui.listenerEditorMode, 'empty');
  normalized.ui.backendEditorMode = normalizeEditorMode(normalized.ui.backendEditorMode, 'empty');
  normalized.ui.policyEditorMode = normalizeEditorMode(normalized.ui.policyEditorMode, 'empty');

  if (normalized.ui.classifierEditorMode === 'edit' && !normalized.activeIds.classifier) {
    normalized.ui.classifierEditorMode = 'empty';
  }
  if (normalized.ui.listenerEditorMode === 'edit' && !normalized.activeIds.listener) {
    normalized.ui.listenerEditorMode = 'empty';
  }
  if (normalized.ui.backendEditorMode === 'edit' && !normalized.activeIds.backend) {
    normalized.ui.backendEditorMode = 'empty';
  }
  if (normalized.ui.policyEditorMode === 'edit' && !normalized.activeIds.policy) {
    normalized.ui.policyEditorMode = 'empty';
  }

  return normalized;
}

function buildListenerRefsRecords(block) {
  var records = {};

  Object.keys(block.listeners || {}).forEach(function (listenerId) {
    var listener = block.listeners[listenerId] || {};
    var virtualService = String(listener.virtual_service || '').trim();

    if (!virtualService) {
      return;
    }

    records[virtualService] = listenerId;
    records['/Common/' + virtualService] = listenerId;
  });

  return records;
}

function buildListenerSettingsRecords(block) {
  var records = {};

  Object.keys(block.listeners || {}).forEach(function (listenerId) {
    var listener = block.listeners[listenerId] || {};
    var status = listener.status || {};
    var advanced = listener.advanced || {};
    var runtimePaths = normalizePathList(listener, status);

    records[listenerId + '.plugin'] = '/Common/llm_semantic_plugin';
    records[listenerId + '.extension'] = 'llm_semantic_ext';
    records[listenerId + '.service_name'] = 'f5-ai-gateway';
    records[listenerId + '.max_payload_bytes'] = toStringValue(advanced.max_payload_bytes, '65535');
    records[listenerId + '.decision_timeout_ms'] = toStringValue(advanced.decision_timeout_ms, '3200');
    records[listenerId + '.request_id_mode'] = toStringValue(advanced.request_id_mode, 'auto');
    records[listenerId + '.root_paths'] = runtimePaths.root_paths.join(',');
    records[listenerId + '.model_paths'] = runtimePaths.model_paths.join(',');
    records[listenerId + '.chat_paths'] = runtimePaths.chat_paths.join(',');
    records[listenerId + '.responses_paths'] = runtimePaths.responses_paths.join(',');
    records[listenerId + '.northbound_api_mode'] = toStringValue(status.northbound_api_mode, 'OpenAI-compatible');
    records[listenerId + '.chat_completions_support'] = toStringValue(status.chat_completions_support, 'full');
    records[listenerId + '.responses_support'] = toStringValue(status.responses_support, 'partial');
    records[listenerId + '.client_auth_type'] = toStringValue(listener.client_auth_type, 'none');
    records[listenerId + '.allowed_virtual_key_pool_refs'] = Array.isArray(listener.allowed_virtual_key_pool_refs) ? listener.allowed_virtual_key_pool_refs.join(',') : '';
  });

  return records;
}

function compactDescription(value) {
  return String(value || '').replace(/[|,]/g, ' ').replace(/\n/g, ' ').replace(/\r/g, ' ').slice(0, 96);
}

function buildVirtualKeyRecords(block) {
  var records = {};

  Object.keys(block.virtualKeys || {}).forEach(function (keyId) {
    var key = normalizeVirtualKey(keyId, clone(block.virtualKeys[keyId] || {}));
    var hashValue = String(key.secret_hash || '').replace(/^sha256:/i, '');
    if (!key.kid || !hashValue) {
      return;
    }
    records[key.kid] = [
      'v=1',
      'state=' + (key.enabled ? 'enabled' : 'disabled'),
      'tag=' + key.tag,
      'pool=' + key.virtual_key_pool_ref,
      'alg=' + (key.secret_hash_alg || 'sha256'),
      'hash=' + hashValue,
      'desc=' + compactDescription(key.description)
    ].join(',');
  });

  return records;
}

function buildVirtualKeyPoolRecords(block) {
  var records = {};

  Object.keys(block.virtualKeyPools || {}).forEach(function (poolId) {
    var pool = normalizeVirtualKeyPool(poolId, clone(block.virtualKeyPools[poolId] || {}));
    records[poolId] = [
      'v=1',
      'state=' + (pool.enabled ? 'enabled' : 'disabled'),
      'name=' + compactDescription(pool.pool_name),
      'desc=' + compactDescription(pool.description)
    ].join(',');
  });

  return records;
}

function buildListenerVirtualKeyPoolAllowlistRecords(block) {
  var records = {};

  Object.keys(block.listeners || {}).forEach(function (listenerId) {
    var listener = block.listeners[listenerId] || {};

    if (listener.client_auth_type !== 'virtual_key' || !Array.isArray(listener.allowed_virtual_key_pool_refs)) {
      return;
    }

    listener.allowed_virtual_key_pool_refs.forEach(function (poolRef) {
      if (!poolRef || !block.virtualKeyPools || !block.virtualKeyPools[poolRef]) {
        return;
      }
      records[listenerId + '~' + poolRef] = 'enabled';
    });
  });

  return records;
}

function classifierTagSignature(classifier) {
  var tags = Array.isArray(classifier && classifier.candidate_tags) ? classifier.candidate_tags : [];
  return tags.join('\u0001') + '\u0002' + String((classifier && classifier.fallback_tag) || '');
}

function addPolicyClassifierSignatureIssue(issues, policyId, classifierId, expectedSignature, normalized) {
  var classifier = normalized.classifiers[classifierId];

  if (!classifier) {
    issues.push('Policy "' + policyId + '" references unknown classifier_ref "' + classifierId + '".');
    return expectedSignature;
  }

  if (!expectedSignature) {
    return classifierTagSignature(classifier);
  }

  if (classifierTagSignature(classifier) !== expectedSignature) {
    issues.push('Policy "' + policyId + '" references classifiers with different Candidate Tags or Fallback Tag. V1 requires all classifiers in one policy to share the same tag set.');
  }

  return expectedSignature;
}

function buildArtifacts(block) {
  var normalized = normalizeBlock(block);
  var generatedAt = new Date().toISOString();

  return {
    block: normalized,
    dataGroups: {
      listener_refs: {
        name: '/Common/dg_ai_gateway_listener_refs',
        records: buildListenerRefsRecords(normalized)
      },
      listener_settings: {
        name: '/Common/dg_ai_gateway_listener_settings',
        records: buildListenerSettingsRecords(normalized)
      },
      virtual_keys: {
        name: '/Common/dg_ai_gateway_virtual_keys',
        records: buildVirtualKeyRecords(normalized)
      },
      virtual_key_pools: {
        name: '/Common/dg_ai_gateway_virtual_key_pools',
        records: buildVirtualKeyPoolRecords(normalized)
      },
      listener_virtual_key_pool_allowlist: {
        name: '/Common/dg_ai_gateway_listener_vk_pool_allowlist',
        records: buildListenerVirtualKeyPoolAllowlistRecords(normalized)
      }
    },
    ifiles: {
      classifiers: {
        name: '/Common/ifile_ai_gateway_classifiers',
        content: {
          schema: 'f5-ai-gateway.classifiers/v1',
          generated_at_utc: generatedAt,
          classifiers: buildManagedClassifierMap(normalized)
        }
      },
      backend_targets: {
        name: '/Common/ifile_ai_gateway_backend_targets',
        content: {
          schema: 'f5-ai-gateway.backend-targets/v1',
          generated_at_utc: generatedAt,
          backendTargets: buildManagedBackendMap(normalized)
        }
      },
      provider_credential_pools: {
        name: '/Common/ifile_ai_gateway_provider_credential_pools',
        content: {
          schema: 'f5-ai-gateway.provider-credential-pools/v1',
          generated_at_utc: generatedAt,
          providerCredentialPools: buildManagedProviderCredentialPoolMap(normalized)
        }
      },
      routing_policies: {
        name: '/Common/ifile_ai_gateway_routing_policies',
        content: {
          schema: 'f5-ai-gateway.routing-policies/v1',
          generated_at_utc: generatedAt,
          routingPolicies: buildManagedPolicyMap(normalized)
        }
      },
      config_snapshot: {
        name: '/Common/ifile_ai_gateway_config_snapshot',
        content: {
          schema: 'f5-ai-gateway.config-snapshot/v1',
          generated_at_utc: generatedAt,
          block: normalized
        }
      }
    }
  };
}

function validateBlock(block) {
  var normalized = normalizeBlock(block);
  var issues = [];
  var referencedPolicyRefs = buildReferencedPolicyRefMap(normalized);

  Object.keys(normalized.listeners).forEach(function (listenerId) {
    var listener = normalized.listeners[listenerId] || {};
    if (!SUPPORTED_CLIENT_AUTH_TYPES[listener.client_auth_type]) {
      issues.push('Listener "' + listenerId + '" has unsupported client_auth_type "' + listener.client_auth_type + '". Supported values are none and virtual_key.');
    }
    if (!listener.virtual_service) {
      issues.push('Listener "' + listenerId + '" is missing virtual_service.');
    }
    if (!listener.vip) {
      issues.push('Listener "' + listenerId + '" is missing vip.');
    }
    if (!listener.port) {
      issues.push('Listener "' + listenerId + '" is missing port.');
    }
    if (!listener.policy_ref) {
      issues.push('Listener "' + listenerId + '" is missing policy_ref.');
    } else if (!normalized.routingPolicies[listener.policy_ref]) {
      issues.push('Listener "' + listenerId + '" references unknown policy_ref "' + listener.policy_ref + '".');
    } else if (
      normalizeRoutingMode(normalized.routingPolicies[listener.policy_ref].routing_mode) !== 'classifier_only' &&
      listener.client_auth_type !== 'virtual_key'
    ) {
      issues.push('Listener "' + listenerId + '" references a key-based Routing Policy but Client Authentication is not Virtual Key.');
    }
    if (listener.client_auth_type === 'virtual_key') {
      if (!Array.isArray(listener.allowed_virtual_key_pool_refs) || !listener.allowed_virtual_key_pool_refs.length) {
        issues.push('Listener "' + listenerId + '" uses Virtual Key authentication but has no allowed Virtual Key Pool selected.');
      }
      (listener.allowed_virtual_key_pool_refs || []).forEach(function (poolRef) {
        if (!normalized.virtualKeyPools[poolRef]) {
          issues.push('Listener "' + listenerId + '" references unknown Virtual Key Pool "' + poolRef + '".');
        }
      });
    }
  });

  Object.keys(normalized.backendTargets).forEach(function (backendId) {
    var backend = normalized.backendTargets[backendId] || {};
    if (!isSupportedBackendSchemaFamily(backend.schema_family)) {
      issues.push('Backend Target "' + backendId + '" has unsupported schema_family "' + backend.schema_family + '".');
    }
    if (backend.credential_pool_ref && (backend.api_key || backend.apiKey)) {
      issues.push('Backend Target "' + backendId + '" cannot set both credential_pool_ref and inline api_key. Choose one credential source.');
    }
    if (backend.credential_pool_ref && !normalized.providerCredentialPools[backend.credential_pool_ref]) {
      issues.push('Backend Target "' + backendId + '" references unknown credential_pool_ref "' + backend.credential_pool_ref + '".');
    }
  });

  Object.keys(normalized.providerCredentialPools).forEach(function (poolId) {
    var pool = normalized.providerCredentialPools[poolId] || {};
    var enabledEntries = 0;
    var seenCredentialIds = {};

    if (!SUPPORTED_PROVIDER_CREDENTIAL_SELECTION_MODES[pool.selection_mode]) {
      issues.push('Provider Credential Pool "' + poolId + '" has unsupported selection_mode "' + pool.selection_mode + '".');
    }

    (pool.entries || []).forEach(function (entry, index) {
      if (entry.enabled) {
        enabledEntries += 1;
      }
      if (!entry.credential_id) {
        issues.push('Provider Credential Pool "' + poolId + '" entry #' + (index + 1) + ' is missing credential_id.');
      } else if (seenCredentialIds[entry.credential_id]) {
        issues.push('Provider Credential Pool "' + poolId + '" has duplicate credential_id "' + entry.credential_id + '".');
      } else {
        seenCredentialIds[entry.credential_id] = true;
      }
      if (entry.enabled && !entry.api_key) {
        issues.push('Provider Credential Pool "' + poolId + '" entry #' + (index + 1) + ' is enabled but missing api_key.');
      }
      if (!isFinite(entry.priority)) {
        issues.push('Provider Credential Pool "' + poolId + '" entry #' + (index + 1) + ' has invalid priority "' + entry.priority + '".');
      }
    });

    if (!enabledEntries) {
      issues.push('Provider Credential Pool "' + poolId + '" must have at least one enabled entry.');
    }
  });

  Object.keys(normalized.classifiers).forEach(function (classifierId) {
    var classifier = normalized.classifiers[classifierId] || {};
    if (!classifier.pool_name) {
      issues.push('Classifier "' + (classifier.classifier_name || classifierId) + '" is missing Referenced BIG-IP Pool. Select an existing BIG-IP pool before deploying.');
    }
  });

  Object.keys(normalized.routingPolicies).forEach(function (policyId) {
    var policy = normalized.routingPolicies[policyId] || {};
    var defaultRule = policy.default_rule || {};
    var fallbackBackendRef = policy.fallback_backend_target_ref || policy.fallbackBackendTargetRef || '';
    var routingMode = normalizeRoutingMode(policy.routing_mode);
    var classifierSignature = '';
    var isReferencedPolicy = !!referencedPolicyRefs[policyId];

    if (policy.policy_type !== 'routing' && policy.policy_type !== 'orchestrator') {
      issues.push('Policy "' + policyId + '" has unsupported policy_type "' + policy.policy_type + '". Supported values are routing and orchestrator.');
    }

    if (policy.policy_type === 'orchestrator') {
      return;
    }

    if (!SUPPORTED_ROUTING_MODES[routingMode]) {
      issues.push('Policy "' + policyId + '" has unsupported routing_mode "' + policy.routing_mode + '".');
    }

    if (!isReferencedPolicy) {
      return;
    }

    if (routingMode !== 'key_only' && !policy.classifier_ref) {
      issues.push('Policy "' + policyId + '" is missing classifier_ref.');
    } else if (policy.classifier_ref && !normalized.classifiers[policy.classifier_ref]) {
      issues.push('Policy "' + policyId + '" references unknown classifier_ref "' + policy.classifier_ref + '".');
    } else if (policy.classifier_ref) {
      classifierSignature = addPolicyClassifierSignatureIssue(issues, policyId, policy.classifier_ref, classifierSignature, normalized);
    }

    if ((defaultRule.action || 'route') === 'route') {
      if (!defaultRule.backend_target_ref) {
        issues.push('Routing Policy "' + policyId + '" unmatched-tag default rule is set to Route but has no Backend Target selected. Select an existing Backend Target or change the default action to Local Response.');
      } else if (!normalized.backendTargets[defaultRule.backend_target_ref]) {
        issues.push('Routing Policy "' + policyId + '" unmatched-tag default rule still routes to deleted or missing Backend Target "' + defaultRule.backend_target_ref + '". Select an existing Backend Target or change the default action to Local Response.');
      }
    }

    if ((defaultRule.action || 'route') === 'respond' && !defaultRule.response_message) {
      issues.push('Routing Policy "' + policyId + '" unmatched-tag default rule is set to Local Response but has no response message.');
    }

    if (fallbackBackendRef && !normalized.backendTargets[fallbackBackendRef]) {
      issues.push('Routing Policy "' + policyId + '" fallback backend target still points to deleted or missing Backend Target "' + fallbackBackendRef + '". Select an existing Backend Target or clear Fallback Backend Target.');
    }

    if ((policy.key_rules || []).length && routingMode === 'classifier_only') {
      issues.push('Routing Policy "' + policyId + '" has Key Rules but Routing Mode is Classifier Only.');
    }

    (policy.key_rules || []).forEach(function (rule, index) {
      var action = rule.action || 'route';
      var match = rule.match || {};
      var classifierRef = rule.classifier_ref || policy.classifier_ref || '';
      var matchSourceCount = 0;

      if (rule.enabled === false) {
        return;
      }
      if (!SUPPORTED_KEY_POLICY_ACTIONS[action]) {
        issues.push('Routing Policy "' + policyId + '" key entry #' + (index + 1) + ' has unsupported action "' + action + '".');
      }
      if (match.virtual_key_pool_ref) {
        matchSourceCount += 1;
      }
      if (match.virtual_key_ref) {
        matchSourceCount += 1;
      }
      if (match.virtual_key_tag) {
        matchSourceCount += 1;
      }
      if (matchSourceCount !== 1) {
        issues.push('Routing Policy "' + policyId + '" key entry #' + (index + 1) + ' requires exactly one Source: Pool, Key, or Key Tag.');
      }
      if (routingMode === 'key_only' && action === 'classify') {
        issues.push('Routing Policy "' + policyId + '" key entry #' + (index + 1) + ' cannot use Classify when Routing Mode is Key Only.');
      }
      if (match.virtual_key_pool_ref && !normalized.virtualKeyPools[match.virtual_key_pool_ref]) {
        issues.push('Routing Policy "' + policyId + '" key entry #' + (index + 1) + ' references unknown Virtual Key Pool "' + match.virtual_key_pool_ref + '".');
      }
      if (match.virtual_key_ref && !findVirtualKeyByRef(normalized.virtualKeys, match.virtual_key_ref)) {
        issues.push('Routing Policy "' + policyId + '" key entry #' + (index + 1) + ' references unknown Virtual Key "' + match.virtual_key_ref + '".');
      } else if (match.virtual_key_ref) {
        var matchedVirtualKey = findVirtualKeyByRef(normalized.virtualKeys, match.virtual_key_ref);
        if (matchedVirtualKey && match.virtual_key_tag && matchedVirtualKey.tag !== match.virtual_key_tag) {
          issues.push('Routing Policy "' + policyId + '" key entry #' + (index + 1) + ' references Virtual Key "' + match.virtual_key_ref + '" with tag "' + match.virtual_key_tag + '", but the key tag is "' + matchedVirtualKey.tag + '". Update the key rule tag or clear the tag match.');
        }
        if (matchedVirtualKey && match.virtual_key_pool_ref && matchedVirtualKey.virtual_key_pool_ref !== match.virtual_key_pool_ref) {
          issues.push('Routing Policy "' + policyId + '" key entry #' + (index + 1) + ' references Virtual Key "' + match.virtual_key_ref + '" with pool "' + match.virtual_key_pool_ref + '", but the key pool is "' + matchedVirtualKey.virtual_key_pool_ref + '". Update the key rule pool or clear the pool match.');
        }
      }
      if (action === 'route' && !rule.backend_target_ref) {
        issues.push('Routing Policy "' + policyId + '" key entry #' + (index + 1) + ' is set to Route but has no Backend Target selected.');
      } else if (action === 'route' && !normalized.backendTargets[rule.backend_target_ref]) {
        issues.push('Routing Policy "' + policyId + '" key entry #' + (index + 1) + ' still routes to deleted or missing Backend Target "' + rule.backend_target_ref + '".');
      }
      if (action === 'respond' && !rule.response_message) {
        issues.push('Routing Policy "' + policyId + '" key entry #' + (index + 1) + ' is set to Local Response but has no response message.');
      }
      if (action === 'classify') {
        if (!classifierRef) {
          issues.push('Routing Policy "' + policyId + '" key entry #' + (index + 1) + ' is set to Classify but has no Classifier selected.');
        } else {
          classifierSignature = addPolicyClassifierSignatureIssue(issues, policyId, classifierRef, classifierSignature, normalized);
        }
      }
    });

    (policy.rules || []).forEach(function (rule, index) {
      if (rule.enabled === false) {
        return;
      }
      if (!SUPPORTED_POLICY_ACTIONS[rule.action]) {
        issues.push('Routing Policy "' + policyId + '" entry #' + (index + 1) + ' has unsupported action "' + rule.action + '".');
      }
      if (routingMode !== 'key_only' && !rule.source_tag) {
        issues.push('Routing Policy "' + policyId + '" entry #' + (index + 1) + ' is missing Source Tag.');
      }
      if (rule.action === 'route' && !rule.backend_target_ref) {
        issues.push('Routing Policy "' + policyId + '" entry #' + (index + 1) + ' is set to Route but has no Backend Target selected. Select an existing Backend Target or change this entry to Local Response.');
      } else if (rule.action === 'route' && !normalized.backendTargets[rule.backend_target_ref]) {
        issues.push('Routing Policy "' + policyId + '" entry #' + (index + 1) + ' still routes to deleted or missing Backend Target "' + rule.backend_target_ref + '". Select an existing Backend Target or change this entry to Local Response.');
      }
      if (rule.action === 'respond' && !rule.response_message) {
        issues.push('Routing Policy "' + policyId + '" entry #' + (index + 1) + ' is set to Local Response but has no response message.');
      }
    });
  });

  Object.keys(normalized.virtualKeys).forEach(function (keyId) {
    var key = normalized.virtualKeys[keyId] || {};
    if (!key.kid) {
      issues.push('Virtual Key "' + keyId + '" is missing kid.');
    }
    if (!key.tag) {
      issues.push('Virtual Key "' + keyId + '" is missing tag.');
    }
    if (!key.virtual_key_pool_ref) {
      issues.push('Virtual Key "' + keyId + '" is missing Virtual Key Pool.');
    } else if (!normalized.virtualKeyPools[key.virtual_key_pool_ref]) {
      issues.push('Virtual Key "' + keyId + '" references unknown Virtual Key Pool "' + key.virtual_key_pool_ref + '".');
    }
    if (!SUPPORTED_VIRTUAL_KEY_HASH_ALGS[key.secret_hash_alg]) {
      issues.push('Virtual Key "' + keyId + '" has unsupported secret_hash_alg "' + key.secret_hash_alg + '". Only sha256 is currently supported.');
    }
    if (!key.secret_hash) {
      issues.push('Virtual Key "' + keyId + '" is missing secret_hash.');
    }
  });

  return {
    valid: issues.length === 0,
    issues: issues
  };
}

module.exports = {
  normalizeBlock: normalizeBlock,
  buildArtifacts: buildArtifacts,
  validateBlock: validateBlock
};
