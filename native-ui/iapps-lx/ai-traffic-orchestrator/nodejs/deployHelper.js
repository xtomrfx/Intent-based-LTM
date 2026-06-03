'use strict';

var childProcess = require('child_process');
var fs = require('fs');
var path = require('path');
var configProcessor = require('./configProcessor');

var APP_ROOT = '/var/config/rest/iapps/AITrafficOrchestrator';
var APPLY_WRAPPER = path.join(APP_ROOT, 'nodejs', 'apply_config_root.sh');
var PRESENTATION_SAMPLE_FILE = path.join(APP_ROOT, 'presentation', 'data', 'sample-config.json');
var RUNTIME_DIR = '/var/tmp/AITrafficOrchestrator-runtime';
var ILX_EXTENSION_DIR = '/var/ilx/workspaces/Common/llm_semantic_ws/extensions/llm_semantic_ext';
var ILX_NATIVE_DIR = path.join(ILX_EXTENSION_DIR, 'native');
var ILX_PLUGIN_NAME = '/Common/llm_semantic_plugin';
var ILX_PLUGIN_STORE_NATIVE_GLOB = '/var/sdm/plugin_store/plugins/:Common:llm_semantic_plugin_*/extensions/llm_semantic_ext/native';
var DEPLOYED_CONFIG_FILE = path.join(RUNTIME_DIR, 'deployed-config.json');
var MANAGED_SERVER_SSL_PROFILE = '/Common/aito_managed_serverssl';
var CLASSIFIER_EGRESS_IRULE = '/Common/aito_classifier_egress';
var CLASSIFIER_EGRESS_SETTINGS_DG = '/Common/dg_ai_gateway_classifier_egress_settings';
var CLASSIFIER_EGRESS_PORT_START = 39000;
var CLASSIFIER_EGRESS_PORT_END = 39999;
var VIRTUAL_KEYS_DG = '/Common/dg_ai_gateway_virtual_keys';
var DATA_GROUP_DIFF_REPLACE_THRESHOLD = 0.4;
var LISTENER_SETTINGS_ONLY_FIELDS = {
  max_payload_bytes: true,
  decision_timeout_ms: true,
  request_id_mode: true,
  root_paths: true,
  model_paths: true,
  chat_paths: true,
  responses_paths: true,
  northbound_api_mode: true,
  chat_completions_support: true,
  responses_support: true
};
var SERVICE_PORT_ALIASES = {
  http: '80',
  https: '443',
  domain: '53',
  tproxy: '8081'
};
var RUNTIME_CLEANUP_FILES = [
  path.join(RUNTIME_DIR, 'last-failed-apply.sh'),
  path.join(RUNTIME_DIR, 'no-save.sh'),
  path.join(RUNTIME_DIR, 'test-run.sh'),
  path.join(RUNTIME_DIR, '.tmsh-history-root')
];
var RUNTIME_NATIVE_FILES = {
  classifiers: path.join(RUNTIME_DIR, 'ifile_ai_gateway_classifiers.json'),
  backend_targets: path.join(RUNTIME_DIR, 'ifile_ai_gateway_backend_targets.json'),
  provider_credential_pools: path.join(RUNTIME_DIR, 'ifile_ai_gateway_provider_credential_pools.json'),
  routing_policies: path.join(RUNTIME_DIR, 'ifile_ai_gateway_routing_policies.json'),
  config_snapshot: path.join(RUNTIME_DIR, 'ifile_ai_gateway_config_snapshot.json')
};
var PUBLISHED_NATIVE_FILES = {
  classifiers: path.join(ILX_NATIVE_DIR, 'ifile_ai_gateway_classifiers.json'),
  backend_targets: path.join(ILX_NATIVE_DIR, 'ifile_ai_gateway_backend_targets.json'),
  provider_credential_pools: path.join(ILX_NATIVE_DIR, 'ifile_ai_gateway_provider_credential_pools.json'),
  routing_policies: path.join(ILX_NATIVE_DIR, 'ifile_ai_gateway_routing_policies.json'),
  config_snapshot: path.join(ILX_NATIVE_DIR, 'ifile_ai_gateway_config_snapshot.json')
};
var VIRTUAL_KEY_USAGE_FILES = [
  path.join(ILX_EXTENSION_DIR, 'virtual-key-usage.json'),
  path.join(RUNTIME_DIR, 'virtual-key-usage.json'),
  '/var/tmp/AITrafficOrchestrator-virtual-key-usage.json'
];
var PROVIDER_CREDENTIAL_RUNTIME_FILES = [
  path.join(ILX_EXTENSION_DIR, 'provider-credential-runtime.json'),
  path.join(RUNTIME_DIR, 'provider-credential-runtime.json'),
  '/var/tmp/AITrafficOrchestrator-provider-credential-runtime.json'
];

function clone(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return null;
  }
}

function normalizeUsageDate(value) {
  var text = String(value || '').trim();
  var match = text.match(/^(\d{4}-\d{2}-\d{2})/);

  return match ? match[1] : '';
}

function normalizeVirtualKeyUsageRecord(kid, record) {
  var lastUsedAt = normalizeUsageDate(record && (record.last_used_at || record.lastUsedAt));

  if (!kid || !lastUsedAt) {
    return null;
  }

  return {
    kid: String((record && record.kid) || kid),
    tag: String((record && record.tag) || ''),
    pool_ref: String((record && (record.pool_ref || record.poolRef || record.virtual_key_pool_ref || record.virtualKeyPoolRef)) || ''),
    last_used_at: lastUsedAt,
    updated_at: String((record && (record.updated_at || record.updatedAt)) || '')
  };
}

function mergeVirtualKeyUsageRecords(target, records) {
  Object.keys(records || {}).forEach(function (kid) {
    var normalized = normalizeVirtualKeyUsageRecord(kid, records[kid]);
    var current;

    if (!normalized) {
      return;
    }

    current = target[kid];
    if (!current || normalized.last_used_at >= String(current.last_used_at || '')) {
      target[kid] = normalized;
    }
  });
}

function readVirtualKeyUsageState() {
  var usage = {};

  VIRTUAL_KEY_USAGE_FILES.forEach(function (filePath) {
    var payload = readJsonFile(filePath);

    if (payload && payload.virtualKeys && typeof payload.virtualKeys === 'object') {
      mergeVirtualKeyUsageRecords(usage, payload.virtualKeys);
    }
  });

  return usage;
}

function normalizeProviderCredentialRuntimeRecord(poolRef, credentialId, record) {
  var cooldownUntilEpoch = Number(record && (record.cooldown_until_epoch || record.cooldownUntilEpoch) || 0);

  if (!poolRef || !credentialId) {
    return null;
  }

  return {
    pool_ref: String((record && (record.pool_ref || record.poolRef)) || poolRef),
    credential_id: String((record && (record.credential_id || record.credentialId)) || credentialId),
    runtime_state: String(record && (record.runtime_state || record.runtimeState || record.state) || 'unknown').trim().toLowerCase().replace(/-/g, '_'),
    status_code: Number(record && (record.status_code || record.statusCode) || 0),
    last_failure_reason: String(record && (record.last_failure_reason || record.lastFailureReason) || ''),
    last_failure_at: String(record && (record.last_failure_at || record.lastFailureAt) || ''),
    last_used_at: String(record && (record.last_used_at || record.lastUsedAt) || ''),
    cooldown_until: String(record && (record.cooldown_until || record.cooldownUntil) || ''),
    cooldown_until_epoch: isFinite(cooldownUntilEpoch) ? cooldownUntilEpoch : 0,
    retry_after: String(record && (record.retry_after || record.retryAfter) || ''),
    upstream_host: String(record && (record.upstream_host || record.upstreamHost) || ''),
    fallback_count: Number(record && (record.fallback_count || record.fallbackCount) || 0),
    last_fallback_at: String(record && (record.last_fallback_at || record.lastFallbackAt) || ''),
    updated_at: String(record && (record.updated_at || record.updatedAt) || '')
  };
}

function mergeProviderCredentialRuntimeCredentialMap(target, poolRef, credentialMap) {
  Object.keys(credentialMap || {}).forEach(function (credentialId) {
    var normalized = normalizeProviderCredentialRuntimeRecord(poolRef, credentialId, credentialMap[credentialId]);
    var current;

    if (!normalized) {
      return;
    }

    target[poolRef] = target[poolRef] || {
      credentials: {}
    };
    current = target[poolRef].credentials[credentialId];
    if (!current || String(normalized.updated_at || '') >= String(current.updated_at || '')) {
      target[poolRef].credentials[credentialId] = normalized;
    }
  });
}

function mergeProviderCredentialRuntimePools(target, pools) {
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

    mergeProviderCredentialRuntimeCredentialMap(target, poolRef, credentialMap);
  });
}

function readProviderCredentialRuntimeState() {
  var runtime = {};

  PROVIDER_CREDENTIAL_RUNTIME_FILES.forEach(function (filePath) {
    var payload = readJsonFile(filePath);

    if (payload && payload.providerCredentialPools && typeof payload.providerCredentialPools === 'object') {
      mergeProviderCredentialRuntimePools(runtime, payload.providerCredentialPools);
    } else if (payload && payload.credentialPools && typeof payload.credentialPools === 'object') {
      mergeProviderCredentialRuntimePools(runtime, payload.credentialPools);
    }
  });

  return runtime;
}

function ensureRuntimeDir() {
  if (!fs.existsSync(APP_ROOT)) {
    fs.mkdirSync(APP_ROOT, {
      recursive: true
    });
  }
  if (!fs.existsSync(RUNTIME_DIR)) {
    fs.mkdirSync(RUNTIME_DIR, {
      recursive: true
    });
  }
}

function writeFileAtomic(filePath, content, options) {
  var tempPath = filePath + '.tmp-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(16).slice(2);

  try {
    fs.writeFileSync(tempPath, content, options || 'utf8');
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      fs.unlinkSync(tempPath);
    } catch (cleanupError) {
      if (!cleanupError || cleanupError.code !== 'ENOENT') {
        // Best effort cleanup; preserve the original write failure.
      }
    }
    throw error;
  }
}

function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\"'\"'") + "'";
}

function tmshObjectName(name) {
  var normalized = String(name || '').trim();
  if (!normalized) {
    return '';
  }
  if (normalized.charAt(0) === '/') {
    return normalized;
  }
  if (normalized.indexOf('/') > 0) {
    return '/' + normalized.replace(/^\/+/, '');
  }
  return '/Common/' + normalized;
}

function splitTmshObjectPath(name) {
  var raw = String(name || '').trim();
  var normalized;
  var parts;

  if (!raw) {
    return {
      fullPath: '',
      partition: '',
      name: ''
    };
  }

  if (raw.charAt(0) === '/') {
    normalized = raw;
  } else if (raw.indexOf('/') > 0) {
    normalized = '/' + raw.replace(/^\/+/, '');
  } else {
    normalized = tmshObjectName(raw);
  }

  parts = normalized.split('/');
  return {
    fullPath: normalized,
    partition: parts.length > 1 ? parts[1] : 'Common',
    name: parts[parts.length - 1] || normalized
  };
}

function parseMemberName(raw) {
  var memberName = String(raw || '').trim();
  var colonIndex = memberName.lastIndexOf(':');
  if (!memberName || colonIndex <= 0) {
    return null;
  }
  return {
    name: memberName,
    address: memberName.slice(0, colonIndex),
    servicePort: memberName.slice(colonIndex + 1)
  };
}

function parseEndpointUrl(endpointUrl) {
  var original = String(endpointUrl || '').trim();
  var protocol = 'https';
  var remainder = original;
  var hostname = '';
  var port = '';
  var pathValue = '';
  var slashIndex;
  var hostPort;
  var colonIndex;

  if (!original) {
    return {
      protocol: protocol,
      hostname: '',
      port: 443,
      path: ''
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
  hostPort = slashIndex >= 0 ? remainder.slice(0, slashIndex) : remainder;
  pathValue = slashIndex >= 0 ? remainder.slice(slashIndex) : '';
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

function buildRecordsBlock(records) {
  function encodeDataValue(value) {
    return '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }

  return Object.keys(records || {}).filter(function (key) {
    var value = records[key];
    return value !== null && value !== undefined && String(value) !== '';
  }).sort().map(function (key) {
    return key + ' { data ' + encodeDataValue(records[key]) + ' }';
  }).join(' ');
}

function parseTmshDataGroupRecords(stdout) {
  var result = {};
  var match;
  var regex = /([^\s]+)\s+\{\s+data\s+([^}]*)\}/g;

  while ((match = regex.exec(stdout || ''))) {
    result[match[1]] = String(match[2] || '').trim().replace(/^"(.*)"$/, '$1');
  }

  return result;
}

function listDataGroupRecords(objectName) {
  var output = runShell([
    'set +e',
    'tmsh -q -c ' + shellQuote('cd /; list ltm data-group internal ' + objectName + ' one-line') + ' 2>&1 || true'
  ].join('\n'));

  if (/The requested value list .* was not found|was not found/i.test(String(output || ''))) {
    return {
      exists: false,
      records: {}
    };
  }
  if (/Syntax Error|unexpected argument|operation not supported|permission denied/i.test(String(output || ''))) {
    throw new Error(String(output || '').trim() || 'Unable to list BIG-IP data group ' + objectName + '.');
  }

  return {
    exists: true,
    records: parseTmshDataGroupRecords(output)
  };
}

function filterNonEmptyRecords(records) {
  var filtered = {};

  Object.keys(records || {}).forEach(function (key) {
    var value = records[key];
    if (value !== null && value !== undefined && String(value) !== '') {
      filtered[key] = String(value);
    }
  });

  return filtered;
}

function diffDataGroupRecords(currentRecords, desiredRecords) {
  var current = filterNonEmptyRecords(currentRecords);
  var desired = filterNonEmptyRecords(desiredRecords);
  var diff = {
    add: {},
    update: {},
    deleteKeys: [],
    currentCount: Object.keys(current).length,
    desiredCount: Object.keys(desired).length,
    changedCount: 0,
    changedRatio: 0
  };
  var denominator;

  Object.keys(desired).forEach(function (key) {
    if (!Object.prototype.hasOwnProperty.call(current, key)) {
      diff.add[key] = desired[key];
      return;
    }
    if (current[key] !== desired[key]) {
      diff.update[key] = desired[key];
    }
  });

  Object.keys(current).forEach(function (key) {
    if (!Object.prototype.hasOwnProperty.call(desired, key)) {
      diff.deleteKeys.push(key);
    }
  });

  diff.changedCount = Object.keys(diff.add).length + Object.keys(diff.update).length + diff.deleteKeys.length;
  denominator = Math.max(diff.currentCount, diff.desiredCount, 1);
  diff.changedRatio = diff.changedCount / denominator;

  return diff;
}

function buildEmptyConfig() {
  return {
    operatingMode: 'gateway',
    listeners: {},
    classifiers: {},
    backendTargets: {},
    routingPolicies: {},
    providerCredentialPools: {},
    virtualKeyPools: {},
    virtualKeys: {},
    activeIds: {
      listener: '',
      classifier: '',
      backend: '',
      policy: '',
      ruleIndex: 0
    },
    ui: {
      listenerEditorMode: 'empty',
      backendEditorMode: 'empty',
      policyEditorMode: 'empty'
    }
  };
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(function (key) {
      return JSON.stringify(key) + ':' + stableStringify(value[key]);
    }).join(',') + '}';
  }
  return JSON.stringify(value);
}

function deepEqual(left, right) {
  return stableStringify(left) === stableStringify(right);
}

function cloneOrNull(value) {
  if (value === undefined || value === null) {
    return null;
  }
  return JSON.parse(JSON.stringify(value));
}

function createDeployProfiler() {
  var startedAt = Date.now();
  var steps = [];
  var scope = null;

  return {
    measure: function (name, fn) {
      var stepStartedAt = Date.now();

      try {
        return fn();
      } finally {
        steps.push({
          name: name,
          duration_ms: Math.max(Date.now() - stepStartedAt, 0)
        });
      }
    },
    setScope: function (nextScope) {
      scope = cloneOrNull(nextScope);
    },
    build: function () {
      return {
        total_ms: Math.max(Date.now() - startedAt, 0),
        scope: cloneOrNull(scope),
        steps: clone(steps)
      };
    }
  };
}

function buildFailureResponse(issues, profiler) {
  var response = {
    ok: false,
    issues: Array.isArray(issues) ? issues : [String(issues || 'Unknown error.')]
  };

  if (profiler) {
    response.profile = profiler.build();
  }

  return response;
}

function buildSuccessResponse(payload, profiler) {
  var response = payload || {};

  response.ok = true;
  if (profiler) {
    response.profile = profiler.build();
  }

  return response;
}

function buildDeploySummary(block) {
  var normalized = block || {};

  return {
    listeners: Object.keys(normalized.listeners || {}).length,
    classifiers: Object.keys(normalized.classifiers || {}).length,
    backendTargets: Object.keys(normalized.backendTargets || {}).length,
    routingPolicies: Object.keys(normalized.routingPolicies || {}).length,
    providerCredentialPools: Object.keys(normalized.providerCredentialPools || {}).length,
    virtualKeyPools: Object.keys(normalized.virtualKeyPools || {}).length,
    virtualKeys: Object.keys(normalized.virtualKeys || {}).length
  };
}

function buildChangedKeyList(previousMap, requestedMap) {
  var changed = {};

  Object.keys(previousMap || {}).forEach(function (key) {
    changed[key] = true;
  });
  Object.keys(requestedMap || {}).forEach(function (key) {
    changed[key] = true;
  });

  return Object.keys(changed).filter(function (key) {
    var previousValue = previousMap && Object.prototype.hasOwnProperty.call(previousMap, key)
      ? previousMap[key]
      : undefined;
    var requestedValue = requestedMap && Object.prototype.hasOwnProperty.call(requestedMap, key)
      ? requestedMap[key]
      : undefined;

    return !deepEqual(previousValue, requestedValue);
  }).sort();
}

function buildScopeSectionSummary(previousMap, requestedMap) {
  var previousKeys = Object.keys(previousMap || {}).sort();
  var requestedKeys = Object.keys(requestedMap || {}).sort();
  var changedKeys = buildChangedKeyList(previousMap, requestedMap);

  return {
    previous: previousKeys.length,
    requested: requestedKeys.length,
    changed: changedKeys.length,
    changed_keys: changedKeys
  };
}

function buildListenerAuthScopeMap(block) {
  var scopeMap = {};

  Object.keys(block.listeners || {}).sort().forEach(function (listenerId) {
    var listener = block.listeners[listenerId] || {};

    scopeMap[listenerId] = {
      client_auth_type: listener.client_auth_type || 'none',
      allowed_virtual_key_pool_refs: Array.isArray(listener.allowed_virtual_key_pool_refs)
        ? listener.allowed_virtual_key_pool_refs.slice(0).sort()
        : []
    };
  });

  return scopeMap;
}

function buildListenerSettingsScopeMap(block) {
  var scopeMap = {};
  var records = configProcessor.buildArtifacts(block || buildEmptyConfig()).dataGroups.listener_settings.records;

  Object.keys(records || {}).sort().forEach(function (recordKey) {
    var dotIndex = recordKey.indexOf('.');
    var listenerId;
    var fieldName;

    if (dotIndex <= 0) {
      return;
    }

    listenerId = recordKey.slice(0, dotIndex);
    fieldName = recordKey.slice(dotIndex + 1);
    if (!LISTENER_SETTINGS_ONLY_FIELDS[fieldName]) {
      return;
    }

    if (!scopeMap[listenerId]) {
      scopeMap[listenerId] = {};
    }
    scopeMap[listenerId][fieldName] = records[recordKey];
  });

  return scopeMap;
}

function buildDesiredListenerLookup(desiredState) {
  var lookup = {};

  (desiredState && desiredState.listeners || []).forEach(function (listener) {
    if (!listener || !listener.id) {
      return;
    }
    lookup[listener.id] = listener;
  });

  return lookup;
}

function buildListenerLtmScopeMap(block, desiredState) {
  var scopeMap = {};
  var desiredListeners = buildDesiredListenerLookup(desiredState);

  Object.keys(block.listeners || {}).sort().forEach(function (listenerId) {
    var listener = block.listeners[listenerId] || {};
    var desiredListener = desiredListeners[listenerId] || {};

    scopeMap[listenerId] = {
      virtual_service: listener.virtual_service || '',
      enabled: listener.enabled !== false,
      vip: listener.vip || '',
      port: Number(listener.port || 0),
      policy_ref: listener.policy_ref || '',
      assigned_irule: desiredListener.assigned_irule || '',
      pool_name: desiredListener.pool_name || '',
      default_backend_ref: desiredListener.default_backend_ref || '',
      requires_server_ssl: Boolean(desiredListener.requires_server_ssl),
      server_ssl_profile: desiredListener.server_ssl_profile || ''
    };
  });

  return scopeMap;
}

function buildListenerUnknownScopeMap(block) {
  var scopeMap = {};

  Object.keys(block.listeners || {}).sort().forEach(function (listenerId) {
    var listener = clone(block.listeners[listenerId] || {});

    delete listener.client_auth_type;
    delete listener.allowed_virtual_key_pool_refs;
    delete listener.virtual_service;
    delete listener.enabled;
    delete listener.vip;
    delete listener.port;
    delete listener.policy_ref;
    delete listener.runtime_paths;
    delete listener.streaming;
    if (listener.advanced && typeof listener.advanced === 'object') {
      listener.advanced = clone(listener.advanced);
      delete listener.advanced.max_payload_bytes;
      delete listener.advanced.decision_timeout_ms;
      delete listener.advanced.request_id_mode;
      if (!Object.keys(listener.advanced).length) {
        delete listener.advanced;
      }
    }

    if (listener.status && typeof listener.status === 'object') {
      listener.status = clone(listener.status);
      delete listener.status.assigned_irule;
      delete listener.status.northbound_api_mode;
      delete listener.status.chat_completions_support;
      delete listener.status.responses_support;
      if (!Object.keys(listener.status).length) {
        delete listener.status;
      }
    }

    scopeMap[listenerId] = listener;
  });

  return scopeMap;
}

function buildClassifierEgressScopeMap(desiredState) {
  var scopeMap = {};

  (desiredState && desiredState.classifierEgress || []).forEach(function (egress) {
    if (!egress || !egress.classifier_id) {
      return;
    }

    scopeMap[egress.classifier_id] = {
      name: egress.name || '',
      vip: egress.vip || '',
      port: Number(egress.port || 0),
      pool_name: egress.pool_name || '',
      endpoint_protocol: egress.endpoint_protocol || '',
      endpoint_host: egress.endpoint_host || '',
      endpoint_path: egress.endpoint_path || '',
      requires_server_ssl: Boolean(egress.requires_server_ssl),
      server_ssl_profile: egress.server_ssl_profile || ''
    };
  });

  return scopeMap;
}

function buildUnknownScopeMap(block) {
  var scopeMap = {};
  var topLevel = {};
  var listenerUnknownMap = buildListenerUnknownScopeMap(block);

  topLevel.operatingMode = block.operatingMode || 'gateway';
  Object.keys(block || {}).sort().forEach(function (key) {
    if ([
      'operatingMode',
      'listeners',
      'classifiers',
      'backendTargets',
      'routingPolicies',
      'providerCredentialPools',
      'virtualKeyPools',
      'virtualKeys',
      'activeIds',
      'ui',
      'meta'
    ].indexOf(key) >= 0) {
      return;
    }
    topLevel[key] = block[key];
  });

  Object.keys(listenerUnknownMap).forEach(function (listenerId) {
    scopeMap['listener:' + listenerId] = listenerUnknownMap[listenerId];
  });

  scopeMap['top_level'] = topLevel;
  return scopeMap;
}

function isSubsetOfChangedSections(changedSections, allowedSections) {
  return changedSections.every(function (section) {
    return allowedSections.indexOf(section) >= 0;
  });
}

function isRuntimeArtifactsOnlyScope(changedSections) {
  return changedSections.length > 0 &&
    isSubsetOfChangedSections(changedSections, ['classifiers', 'routing_policies', 'backend_targets', 'provider_credential_pools']);
}

function determineDeployScopeType(changedSections) {
  if (!changedSections.length) {
    return 'none';
  }
  if (changedSections.indexOf('unknown') >= 0) {
    return 'unknown';
  }
  if (changedSections.indexOf('listener_ltm') >= 0) {
    return 'listener_ltm';
  }
  if (changedSections.length === 1 && changedSections[0] === 'listener_settings') {
    return 'listener_data_groups_only';
  }
  if (isSubsetOfChangedSections(changedSections, ['listener_settings', 'listener_auth', 'virtual_keys', 'virtual_key_pools'])) {
    return 'auth_data_groups_only';
  }
  if (
    changedSections.indexOf('classifier_egress') >= 0 &&
    isSubsetOfChangedSections(changedSections, ['classifiers', 'routing_policies', 'classifier_egress'])
  ) {
    return 'classifier_egress';
  }
  if (isRuntimeArtifactsOnlyScope(changedSections)) {
    return 'runtime_artifacts_only';
  }
  if (changedSections.length === 1) {
    return changedSections[0];
  }
  return 'mixed';
}

function buildDeployScopeRecommendations(scopeType, changedSections) {
  var recommendations = ['full_apply_retained'];

  if (scopeType === 'none') {
    return ['no_change_detected', 'no_runtime_apply'];
  }
  if (scopeType === 'auth_data_groups_only') {
    return ['data_group_fast_path', 'tmsh_save_retained', 'no_ltm_virtual_apply', 'no_ifile_publish', 'no_ilx_restart'];
  }
  if (scopeType === 'listener_data_groups_only') {
    return ['data_group_fast_path', 'tmsh_save_retained', 'no_ltm_virtual_apply', 'no_ifile_publish', 'no_ilx_restart'];
  }
  if (scopeType === 'runtime_artifacts_only') {
    return [
      'runtime_artifacts_fast_path',
      'write_runtime_files_retained',
      'publish_active_native_files',
      'no_ltm_virtual_apply',
      'no_data_group_apply',
      'no_ifile_publish',
      'no_tmsh_save',
      'no_ilx_restart'
    ];
  }
  if (scopeType === 'classifier_egress') {
    return [
      'classifier_egress_fast_path',
      'write_runtime_files_retained',
      'publish_active_native_files',
      'classifier_egress_dg_irule_virtual_apply',
      'tmsh_save_retained',
      'no_listener_virtual_apply',
      'no_listener_data_group_apply',
      'no_virtual_key_data_group_apply',
      'no_sys_file_ifile_apply',
      'no_ilx_restart'
    ];
  }
  if (changedSections.indexOf('listener_ltm') >= 0) {
    recommendations.unshift('listener_virtual_changes_detected');
  }
  if (changedSections.indexOf('classifier_egress') >= 0) {
    recommendations.unshift('classifier_egress_virtual_changes_detected');
  }
  if (
    changedSections.indexOf('classifiers') >= 0 ||
    changedSections.indexOf('backend_targets') >= 0 ||
    changedSections.indexOf('provider_credential_pools') >= 0 ||
    changedSections.indexOf('routing_policies') >= 0
  ) {
    recommendations.unshift('runtime_artifacts_changed');
  }
  if (changedSections.indexOf('unknown') >= 0) {
    recommendations.unshift('review_unknown_change_before_fast_path');
  }

  return recommendations.filter(function (value, index, values) {
    return values.indexOf(value) === index;
  });
}

function classifyDeployScope(previousBlock, requestedBlock, previousState, desiredState) {
  var previousNormalized = configProcessor.normalizeBlock(previousBlock || buildEmptyConfig());
  var requestedNormalized = configProcessor.normalizeBlock(requestedBlock || buildEmptyConfig());
  var previousDesiredState = previousState || buildDesiredState(previousNormalized);
  var requestedDesiredState = desiredState || buildDesiredState(requestedNormalized, previousDesiredState);
  var sectionMaps = {
    virtual_keys: {
      previous: previousNormalized.virtualKeys,
      requested: requestedNormalized.virtualKeys
    },
    virtual_key_pools: {
      previous: previousNormalized.virtualKeyPools,
      requested: requestedNormalized.virtualKeyPools
    },
    listener_auth: {
      previous: buildListenerAuthScopeMap(previousNormalized),
      requested: buildListenerAuthScopeMap(requestedNormalized)
    },
    listener_settings: {
      previous: buildListenerSettingsScopeMap(previousNormalized),
      requested: buildListenerSettingsScopeMap(requestedNormalized)
    },
    listener_ltm: {
      previous: buildListenerLtmScopeMap(previousNormalized, previousDesiredState),
      requested: buildListenerLtmScopeMap(requestedNormalized, requestedDesiredState)
    },
    classifiers: {
      previous: previousNormalized.classifiers,
      requested: requestedNormalized.classifiers
    },
    backend_targets: {
      previous: previousNormalized.backendTargets,
      requested: requestedNormalized.backendTargets
    },
    provider_credential_pools: {
      previous: previousNormalized.providerCredentialPools,
      requested: requestedNormalized.providerCredentialPools
    },
    routing_policies: {
      previous: previousNormalized.routingPolicies,
      requested: requestedNormalized.routingPolicies
    },
    classifier_egress: {
      previous: buildClassifierEgressScopeMap(previousDesiredState),
      requested: buildClassifierEgressScopeMap(requestedDesiredState)
    },
    unknown: {
      previous: buildUnknownScopeMap(previousNormalized),
      requested: buildUnknownScopeMap(requestedNormalized)
    }
  };
  var keyCounts = {};
  var changedKeys = {};
  var changedSections = [];
  var scopeType;

  Object.keys(sectionMaps).forEach(function (sectionName) {
    var summary = buildScopeSectionSummary(
      sectionMaps[sectionName].previous,
      sectionMaps[sectionName].requested
    );

    keyCounts[sectionName] = {
      previous: summary.previous,
      requested: summary.requested,
      changed: summary.changed
    };
    changedKeys[sectionName] = summary.changed_keys;
    if (summary.changed) {
      changedSections.push(sectionName);
    }
  });

  scopeType = determineDeployScopeType(changedSections);

  return {
    type: scopeType,
    changed_sections: changedSections,
    key_counts: keyCounts,
    changed_keys: changedKeys,
    recommendations: buildDeployScopeRecommendations(scopeType, changedSections)
  };
}

function normalizeMemberKey(name) {
  var normalized = String(name || '').trim();
  var parts;

  if (!normalized) {
    return '';
  }

  if (normalized.charAt(0) === '/') {
    parts = normalized.split('/');
    normalized = parts[parts.length - 1];
  }

  return normalized;
}

function normalizeStatusText(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function parseSectionedOutput(stdout) {
  var sections = {};
  var current = '';

  String(stdout || '').split(/\r?\n/).forEach(function (line) {
    if (line.indexOf('__AITO_SECTION__ ') === 0) {
      current = line.slice('__AITO_SECTION__ '.length).trim();
      sections[current] = '';
      return;
    }

    if (current) {
      sections[current] += line + '\n';
    }
  });

  return sections;
}

function isMissingTmshObject(output) {
  return /was not found|not found|unexpected argument|Syntax Error/i.test(String(output || ''));
}

function parseStatusLines(lines) {
  var fields = {};

  (lines || []).forEach(function (line) {
    var cleaned = String(line || '').replace(/^\|\s*/, '').trim();
    var match = cleaned.match(/^([^:]+)\s*:\s*(.*)$/);
    var key;

    if (!match) {
      return;
    }

    key = String(match[1] || '').trim().toLowerCase().replace(/\s+/g, '_');
    fields[key] = String(match[2] || '').trim();
  });

  return fields;
}

function parseVirtualShowOutput(output) {
  return {
    missing: isMissingTmshObject(output),
    fields: parseStatusLines(String(output || '').split(/\r?\n/))
  };
}

function parsePoolShowOutput(output) {
  var topLines = [];
  var members = {};
  var currentMemberName = '';

  String(output || '').split(/\r?\n/).forEach(function (line) {
    var trimmed = String(line || '').trim();
    var memberMatch = trimmed.match(/^(?:\|\s*)?Ltm::Pool Member:\s*(.+)$/i);

    if (!trimmed) {
      return;
    }

    if (memberMatch) {
      currentMemberName = normalizeMemberKey(memberMatch[1]);
      members[currentMemberName] = {
        name: String(memberMatch[1] || '').trim(),
        lines: []
      };
      return;
    }

    if (currentMemberName) {
      members[currentMemberName].lines.push(trimmed);
      return;
    }

    topLines.push(trimmed);
  });

  Object.keys(members).forEach(function (memberKey) {
    members[memberKey].fields = parseStatusLines(members[memberKey].lines);
  });

  return {
    missing: isMissingTmshObject(output),
    fields: parseStatusLines(topLines),
    members: members
  };
}

function determineHealthStatus(fields, options) {
  var settings = options || {};
  var availability = normalizeStatusText(fields && fields.availability);
  var state = normalizeStatusText(fields && fields.state);
  var monitorStatus = normalizeStatusText(fields && fields.monitor_status);
  var sessionStatus = normalizeStatusText(fields && fields.session_status);
  var signals = [availability, state, monitorStatus, sessionStatus].join(' ');

  if (settings.missing) {
    return settings.deployed ? 'problem' : 'unknown';
  }

  if (signals.indexOf('forced offline') >= 0 ||
      signals.indexOf('disabled') >= 0 ||
      sessionStatus === 'session disabled') {
    return 'disabled';
  }

  if ((availability === 'unknown' || availability === 'unchecked' || availability === '') &&
      (monitorStatus === 'unchecked' || monitorStatus === 'unknown' || monitorStatus === '')) {
    return 'unknown';
  }

  if (state === 'enabled' &&
      availability === 'available' &&
      (monitorStatus === '' || monitorStatus === 'up' || monitorStatus === 'enabled') &&
      (sessionStatus === '' || sessionStatus === 'enabled')) {
    return 'healthy';
  }

  if (state === 'enabled' &&
      ((availability && availability !== 'available' && availability !== 'unknown' && availability !== 'unchecked') ||
      (monitorStatus && monitorStatus !== 'up' && monitorStatus !== 'enabled' && monitorStatus !== 'unknown' && monitorStatus !== 'unchecked') ||
      (sessionStatus && sessionStatus !== 'enabled' && sessionStatus !== 'unknown' && sessionStatus !== 'unchecked'))) {
    return 'problem';
  }

  if (availability === 'available' || monitorStatus === 'up') {
    return 'healthy';
  }

  return 'unknown';
}

function aggregateHealthStatuses(statuses, fallback) {
  var filtered = (statuses || []).filter(function (status) {
    return Boolean(status);
  });

  if (!filtered.length) {
    return fallback || 'unknown';
  }
  if (filtered.some(function (status) { return status === 'problem'; })) {
    return 'problem';
  }
  if (filtered.every(function (status) { return status === 'disabled'; })) {
    return 'disabled';
  }
  if (filtered.every(function (status) { return status === 'healthy'; })) {
    return 'healthy';
  }
  if (filtered.some(function (status) { return status === 'healthy'; })) {
    return 'healthy';
  }
  return fallback || 'unknown';
}

function buildRuntimeInspectionScript(block) {
  var lines = [
    'set +e',
    'emit_section() {',
    '  printf "__AITO_SECTION__ %s\\n" "$1"',
    '}'
  ];

  Object.keys(block.listeners || {}).forEach(function (listenerId) {
    var listener = block.listeners[listenerId] || {};
    var virtualObject = tmshObjectName(listener.virtual_service);

    if (!virtualObject) {
      return;
    }

    lines.push('emit_section ' + shellQuote('virtual:' + listenerId));
    lines.push('tmsh show ltm virtual ' + shellQuote(virtualObject) + ' 2>&1 || true');
  });

  Object.keys(block.backendTargets || {}).forEach(function (backendId) {
    var backend = block.backendTargets[backendId] || {};
    var poolObject = tmshObjectName(backend.pool_name);

    if (!poolObject) {
      return;
    }

    lines.push('emit_section ' + shellQuote('pool:' + backendId));
    lines.push('tmsh show ltm pool ' + shellQuote(poolObject) + ' members 2>&1 || true');
  });

  Object.keys(block.classifiers || {}).forEach(function (classifierId) {
    var classifier = block.classifiers[classifierId] || {};
    var poolObject = tmshObjectName(classifier.pool_name);

    if (!poolObject) {
      return;
    }

    lines.push('emit_section ' + shellQuote('classifier_pool:' + classifierId));
    lines.push('tmsh show ltm pool ' + shellQuote(poolObject) + ' members 2>&1 || true');
  });

  return lines.join('\n');
}

function inspectRuntimeStatuses(block) {
  var sections;
  var output;
  var runtimeStatus = {
    listeners: {},
    backends: {},
    classifiers: {}
  };

  try {
    output = runShell(buildRuntimeInspectionScript(block));
  } catch (error) {
    return runtimeStatus;
  }

  sections = parseSectionedOutput(output);

  Object.keys(block.listeners || {}).forEach(function (listenerId) {
    runtimeStatus.listeners[listenerId] = parseVirtualShowOutput(sections['virtual:' + listenerId] || '');
  });

  Object.keys(block.backendTargets || {}).forEach(function (backendId) {
    runtimeStatus.backends[backendId] = parsePoolShowOutput(sections['pool:' + backendId] || '');
  });

  Object.keys(block.classifiers || {}).forEach(function (classifierId) {
    runtimeStatus.classifiers[classifierId] = parsePoolShowOutput(sections['classifier_pool:' + classifierId] || '');
  });

  return runtimeStatus;
}

function buildDeployedMemberMap(members) {
  var memberMap = {};

  (members || []).forEach(function (member) {
    memberMap[normalizeMemberKey(member.name)] = member;
  });

  return memberMap;
}

function buildRuntimeReferenceBlock(currentBlock, deployedBlock) {
  var runtimeBlock = buildEmptyConfig();

  Object.keys(currentBlock.listeners || {}).forEach(function (listenerId) {
    runtimeBlock.listeners[listenerId] = deployedBlock && deployedBlock.listeners && deployedBlock.listeners[listenerId]
      ? deployedBlock.listeners[listenerId]
      : currentBlock.listeners[listenerId];
  });

  Object.keys(currentBlock.backendTargets || {}).forEach(function (backendId) {
    runtimeBlock.backendTargets[backendId] = deployedBlock && deployedBlock.backendTargets && deployedBlock.backendTargets[backendId]
      ? deployedBlock.backendTargets[backendId]
      : currentBlock.backendTargets[backendId];
  });

  Object.keys(currentBlock.providerCredentialPools || {}).forEach(function (poolId) {
    runtimeBlock.providerCredentialPools[poolId] = deployedBlock && deployedBlock.providerCredentialPools && deployedBlock.providerCredentialPools[poolId]
      ? deployedBlock.providerCredentialPools[poolId]
      : currentBlock.providerCredentialPools[poolId];
  });

  Object.keys(currentBlock.classifiers || {}).forEach(function (classifierId) {
    runtimeBlock.classifiers[classifierId] = deployedBlock && deployedBlock.classifiers && deployedBlock.classifiers[classifierId]
      ? deployedBlock.classifiers[classifierId]
      : currentBlock.classifiers[classifierId];
  });

  return runtimeBlock;
}

function stripTmshPath(value) {
  var normalized = String(value || '').trim();
  var parts;

  if (!normalized) {
    return '';
  }

  if (normalized.charAt(0) === '/') {
    parts = normalized.split('/');
    return parts[parts.length - 1];
  }

  return normalized;
}

function buildRuntimeHealthMember(memberRuntime) {
  var rawName = String(memberRuntime && memberRuntime.name || '').trim();
  var displayName = normalizeMemberKey(rawName);
  var parsedMember = parseMemberName(displayName) || {};
  var fields = memberRuntime && memberRuntime.fields ? memberRuntime.fields : {};

  return {
    name: rawName || displayName,
    address: stripTmshPath(parsedMember.address || displayName),
    service_port: String(parsedMember.servicePort || ''),
    display: displayName,
    health_status: determineHealthStatus(fields, {
      missing: false,
      deployed: true
    }),
    monitor_status: String(fields.monitor_status || ''),
    session_status: String(fields.session_status || ''),
    state: String(fields.state || ''),
    reason: String(fields.reason || '')
  };
}

function getMemberAddressForClassification(member) {
  return String((member && (member.address || member.display || member.name)) || '').trim();
}

function isAutoFqdnMember(member) {
  var address = stripTmshPath(getMemberAddressForClassification(member));

  return /^_auto_/i.test(address);
}

function isHostnameMember(member) {
  var address = stripTmshPath(getMemberAddressForClassification(member));

  return !!address &&
    !isAutoFqdnMember(member) &&
    /[a-z]/i.test(address) &&
    address.indexOf(':') < 0;
}

function normalizeFqdnRuntimeMembers(members) {
  var hasAutoMember = (members || []).some(isAutoFqdnMember);

  if (!hasAutoMember) {
    return members || [];
  }

  return (members || []).map(function (member) {
    var normalized = clone(member);

    if (isHostnameMember(normalized) && normalized.health_status === 'problem') {
      normalized.health_status = 'unknown';
      normalized.reason = normalized.reason || 'FQDN template member; resolved _auto_ members carry runtime health.';
    }

    return normalized;
  });
}

function getEffectiveRuntimeMemberStatuses(members) {
  var normalizedMembers = members || [];
  var autoMembers = normalizedMembers.filter(isAutoFqdnMember);
  var statusMembers = autoMembers.length ? autoMembers : normalizedMembers;

  return statusMembers.map(function (member) {
    return member.health_status;
  });
}

function buildRuntimeHealthPayload(block, runtimeStatus) {
  var payload = {
    listeners: {},
    backendTargets: {},
    classifiers: {},
    providerCredentialPools: {},
    virtualKeys: {}
  };
  var virtualKeyUsage = readVirtualKeyUsageState();
  var providerCredentialRuntime = readProviderCredentialRuntimeState();

  Object.keys(block.listeners || {}).forEach(function (listenerId) {
    var listener = block.listeners[listenerId] || {};
    var runtimeListener = runtimeStatus.listeners[listenerId] || {};

    payload.listeners[listenerId] = {
      health_status: determineHealthStatus(runtimeListener.fields, {
        missing: runtimeListener.missing,
        deployed: Boolean(listener.virtual_service)
      })
    };
  });

  Object.keys(block.backendTargets || {}).forEach(function (backendId) {
    var backend = block.backendTargets[backendId] || {};
    var runtimeBackend = runtimeStatus.backends[backendId] || {};
    var members = Object.keys(runtimeBackend.members || {}).map(function (memberKey) {
      return buildRuntimeHealthMember(runtimeBackend.members[memberKey]);
    });
    var effectiveMemberStatuses;
    var poolHealthStatus = determineHealthStatus(runtimeBackend.fields, {
      missing: runtimeBackend.missing,
      deployed: Boolean(backend.pool_name)
    });

    members = normalizeFqdnRuntimeMembers(members);
    effectiveMemberStatuses = getEffectiveRuntimeMemberStatuses(members);

    if (poolHealthStatus === 'unknown' || (poolHealthStatus === 'problem' && effectiveMemberStatuses.some(function (status) { return status === 'healthy'; }))) {
      poolHealthStatus = aggregateHealthStatuses(effectiveMemberStatuses, 'unknown');
    }

    payload.backendTargets[backendId] = {
      health_status: poolHealthStatus,
      members: members
    };
  });

  Object.keys(block.classifiers || {}).forEach(function (classifierId) {
    var classifier = block.classifiers[classifierId] || {};
    var runtimeClassifier = runtimeStatus.classifiers[classifierId] || {};
    var members = Object.keys(runtimeClassifier.members || {}).map(function (memberKey) {
      return buildRuntimeHealthMember(runtimeClassifier.members[memberKey]);
    });
    var effectiveMemberStatuses;
    var poolHealthStatus = determineHealthStatus(runtimeClassifier.fields, {
      missing: runtimeClassifier.missing,
      deployed: Boolean(classifier.pool_name)
    });

    members = normalizeFqdnRuntimeMembers(members);
    effectiveMemberStatuses = getEffectiveRuntimeMemberStatuses(members);

    if (poolHealthStatus === 'unknown' || (poolHealthStatus === 'problem' && effectiveMemberStatuses.some(function (status) { return status === 'healthy'; }))) {
      poolHealthStatus = aggregateHealthStatuses(effectiveMemberStatuses, 'unknown');
    }

    payload.classifiers[classifierId] = {
      health_status: poolHealthStatus,
      members: members
    };
  });

  Object.keys(block.virtualKeys || {}).forEach(function (keyId) {
    var virtualKey = block.virtualKeys[keyId] || {};
    var kid = String(virtualKey.kid || keyId || '');
    var usage = virtualKeyUsage[kid] || virtualKeyUsage[keyId] || {};

    payload.virtualKeys[keyId] = {
      kid: kid,
      last_used_at: normalizeUsageDate(usage.last_used_at || '')
    };
  });

  Object.keys(block.providerCredentialPools || {}).forEach(function (poolId) {
    var pool = block.providerCredentialPools[poolId] || {};
    var runtimePool = providerCredentialRuntime[poolId] || {};
    var runtimeCredentials = runtimePool.credentials || {};

    payload.providerCredentialPools[poolId] = {
      credentials: {}
    };

    (pool.entries || []).forEach(function (entry) {
      var credentialId = String(entry && entry.credential_id || '').trim();
      var runtimeEntry = credentialId ? runtimeCredentials[credentialId] || {} : {};

      if (!credentialId) {
        return;
      }

      payload.providerCredentialPools[poolId].credentials[credentialId] = {
        credential_id: credentialId,
        runtime_state: runtimeEntry.runtime_state || 'unknown',
        status_code: Number(runtimeEntry.status_code || 0),
        last_failure_reason: runtimeEntry.last_failure_reason || '',
        last_failure_at: runtimeEntry.last_failure_at || '',
        last_used_at: runtimeEntry.last_used_at || '',
        cooldown_until: runtimeEntry.cooldown_until || '',
        cooldown_until_epoch: Number(runtimeEntry.cooldown_until_epoch || 0),
        retry_after: runtimeEntry.retry_after || '',
        upstream_host: runtimeEntry.upstream_host || '',
        fallback_count: Number(runtimeEntry.fallback_count || 0),
        last_fallback_at: runtimeEntry.last_fallback_at || '',
        updated_at: runtimeEntry.updated_at || ''
      };
    });
  });

  return payload;
}

function annotateBlockWithStatuses(block, deployedBlock) {
  var normalizedBlock = configProcessor.normalizeBlock(block || {});
  var annotatedBlock = clone(normalizedBlock);
  var normalizedDeployed = deployedBlock ? configProcessor.normalizeBlock(deployedBlock) : null;
  var runtimeReferenceBlock = buildRuntimeReferenceBlock(normalizedBlock, normalizedDeployed);
  var runtimeStatus = inspectRuntimeStatuses(runtimeReferenceBlock);

  annotatedBlock.meta = {
    source: deployedBlock ? 'deployed' : 'sample',
    dirty: false
  };

  Object.keys(annotatedBlock.listeners || {}).forEach(function (listenerId) {
    var listener = annotatedBlock.listeners[listenerId] || {};
    var deployedListener = normalizedDeployed && normalizedDeployed.listeners ? normalizedDeployed.listeners[listenerId] : null;
    var listenerConfigStatus = deployedListener && deepEqual(normalizedBlock.listeners[listenerId], deployedListener)
      ? 'deployed_synced'
      : 'draft_local';
    var runtimeListener = runtimeStatus.listeners[listenerId] || {};
    var listenerHealthStatus = determineHealthStatus(runtimeListener.fields, {
      missing: runtimeListener.missing,
      deployed: listenerConfigStatus === 'deployed_synced'
    });

    listener.status = listener.status || {};
    listener.config_status = listenerConfigStatus;
    listener.health_status = listenerHealthStatus;
    listener.status.config_status = listenerConfigStatus;
    listener.status.health_status = listenerHealthStatus;
    listener.status.runtime_status = listenerHealthStatus;
  });

  Object.keys(annotatedBlock.backendTargets || {}).forEach(function (backendId) {
    var backend = annotatedBlock.backendTargets[backendId] || {};
    var deployedBackend = normalizedDeployed && normalizedDeployed.backendTargets ? normalizedDeployed.backendTargets[backendId] : null;
    var backendConfigStatus = deployedBackend && deepEqual(normalizedBlock.backendTargets[backendId], deployedBackend)
      ? 'deployed_synced'
      : 'draft_local';
    var runtimeBackend = runtimeStatus.backends[backendId] || {};
    var deployedMemberMap = buildDeployedMemberMap(deployedBackend && deployedBackend.members);
    var memberStatuses = [];
    var runtimeMembers = normalizeFqdnRuntimeMembers(Object.keys(runtimeBackend.members || {}).map(function (memberKey) {
      return buildRuntimeHealthMember(runtimeBackend.members[memberKey]);
    }));
    var effectiveRuntimeMemberStatuses = getEffectiveRuntimeMemberStatuses(runtimeMembers);
    var poolHealthStatus;

    backend.status = backend.status || {};

    backend.members = (backend.members || []).map(function (member) {
      var memberKey = normalizeMemberKey(member.name);
      var deployedMember = deployedMemberMap[memberKey] || null;
      var memberConfigStatus = deployedMember && deepEqual(member, deployedMember)
        ? 'deployed_synced'
        : 'draft_local';
      var runtimeMember = runtimeBackend.members && runtimeBackend.members[memberKey] ? runtimeBackend.members[memberKey] : {};
      var memberMissing = !runtimeMember.fields;
      var memberHealthStatus = determineHealthStatus(runtimeMember.fields, {
        missing: runtimeBackend.missing && memberMissing,
        deployed: memberConfigStatus === 'deployed_synced'
      });
      var annotatedMember = clone(member);

      if (memberMissing && !runtimeBackend.missing) {
        memberHealthStatus = 'unknown';
      }

      annotatedMember.config_status = memberConfigStatus;
      annotatedMember.health_status = memberHealthStatus;
      memberStatuses.push(memberHealthStatus);

      return annotatedMember;
    });

    poolHealthStatus = determineHealthStatus(runtimeBackend.fields, {
      missing: runtimeBackend.missing,
      deployed: backendConfigStatus === 'deployed_synced'
    });

    if (poolHealthStatus === 'unknown' || (poolHealthStatus === 'problem' && effectiveRuntimeMemberStatuses.some(function (status) { return status === 'healthy'; }))) {
      poolHealthStatus = aggregateHealthStatuses(effectiveRuntimeMemberStatuses.length ? effectiveRuntimeMemberStatuses : memberStatuses, 'unknown');
    }

    backend.config_status = backendConfigStatus;
    backend.health_status = poolHealthStatus;
    backend.status.config_status = backendConfigStatus;
    backend.status.health_status = poolHealthStatus;
    backend.status.runtime_status = poolHealthStatus;
    backend.status.pool_status = poolHealthStatus;
  });

  return annotatedBlock;
}

function runShell(script) {
  var scriptPath;
  ensureRuntimeDir();
  scriptPath = path.join(RUNTIME_DIR, 'apply-' + Date.now() + '-' + process.pid + '.sh');
  fs.writeFileSync(scriptPath, script, {
    encoding: 'utf8',
    mode: 0o700
  });
  try {
    return childProcess.execFileSync('/bin/sudo', ['-n', '/bin/bash', APPLY_WRAPPER, scriptPath], {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });
  } catch (error) {
    try {
      fs.copyFileSync(scriptPath, path.join(RUNTIME_DIR, 'last-failed-apply.sh'));
    } catch (copyError) {
      // Keep the original deploy error; failed diagnostics capture should not mask it.
    }
    throw error;
  } finally {
    try {
      fs.unlinkSync(scriptPath);
    } catch (error) {
      // Best effort cleanup; a failed deploy should not be hidden by unlink noise.
    }
  }
}

function extractCommandFailure(error) {
  var stderr = error && error.stderr ? String(error.stderr).trim() : '';
  var stdout = error && error.stdout ? String(error.stdout).trim() : '';
  var message = stderr || stdout || (error && error.message) || 'Command failed.';

  message = message.replace(/Warning, can't fully initialize terminal, TERM is set to "unknown", status \(0\)\s*/g, '').trim();
  message = message.replace(/^Command failed:[\s\S]*?\n/, '').trim();

  return message || 'Command failed.';
}

function parsePoolListOutput(stdout) {
  var pools = [];

  String(stdout || '').split(/\r?\n/).forEach(function (line) {
    var match = String(line || '').trim().match(/^ltm pool ([^\s]+)\s+\{([\s\S]*)\}$/);
    var body;
    var pathInfo;
    var memberMatches;
    var monitorMatch;
    var lbMatch;

    if (!match) {
      return;
    }

    body = match[2] || '';
    pathInfo = splitTmshObjectPath(match[1]);
    memberMatches = body.match(/\/[^\s{}]+:[^\s{}]+\s+\{/g) || [];
    monitorMatch = body.match(/\bmonitor\s+([^\s{}]+)/);
    lbMatch = body.match(/\bload-balancing-mode\s+([^\s{}]+)/);

    pools.push({
      fullPath: pathInfo.fullPath,
      name: pathInfo.name,
      partition: pathInfo.partition,
      memberCount: memberMatches.length,
      monitor: monitorMatch ? monitorMatch[1] : '',
      loadBalancingMode: lbMatch ? lbMatch[1] : ''
    });
  });

  pools.sort(function (left, right) {
    return left.fullPath.localeCompare(right.fullPath);
  });

  return pools;
}

function normalizeServicePort(port) {
  var value = String(port || '').trim();
  var lower = value.toLowerCase();

  if (!value) {
    return '';
  }

  return SERVICE_PORT_ALIASES[lower] || value;
}

function parseDestination(raw) {
  var destination = String(raw || '').trim();
  var colonIndex = destination.lastIndexOf(':');
  var address;
  var port;

  if (!destination || colonIndex <= 0) {
    return {
      address: destination,
      port: ''
    };
  }

  address = destination.slice(0, colonIndex);
  port = destination.slice(colonIndex + 1);

  return {
    address: address,
    port: normalizeServicePort(port)
  };
}

function virtualConflictKey(address, port, protocol, source, vlans) {
  return [
    String(address || '').trim(),
    normalizeServicePort(port),
    String(protocol || 'tcp').trim().toLowerCase(),
    String(source || '0.0.0.0/0').trim(),
    String(vlans || 'all').trim()
  ].join('|');
}

function parseVirtualListOutput(stdout) {
  var virtuals = [];

  String(stdout || '').split(/\r?\n/).forEach(function (line) {
    var trimmed = String(line || '').trim();
    var match = trimmed.match(/^ltm virtual ([^\s]+)\s+\{([\s\S]*)\}$/);
    var body;
    var destinationMatch;
    var protocolMatch;
    var sourceMatch;
    var vlansMatch;
    var destination;
    var pathInfo;

    if (!match) {
      return;
    }

    body = match[2] || '';
    destinationMatch = body.match(/\bdestination\s+([^\s{}]+)/);
    if (!destinationMatch) {
      return;
    }

    protocolMatch = body.match(/\bip-protocol\s+([^\s{}]+)/);
    sourceMatch = body.match(/\bsource\s+([^\s{}]+)/);
    vlansMatch = body.match(/\bvlans\s+\{\s*([^}]+?)\s*\}/);
    destination = parseDestination(destinationMatch[1]);
    pathInfo = splitTmshObjectPath(match[1]);

    virtuals.push({
      fullPath: pathInfo.fullPath,
      name: pathInfo.name,
      destination: destinationMatch[1],
      address: destination.address,
      port: destination.port,
      ipProtocol: protocolMatch ? protocolMatch[1] : 'tcp',
      source: sourceMatch ? sourceMatch[1] : '0.0.0.0/0',
      vlans: vlansMatch ? vlansMatch[1].replace(/\s+/g, ',') : 'all'
    });
  });

  return virtuals;
}

function listBigIpVirtuals() {
  var output = runShell([
    'set +e',
    'tmsh -q -c ' + shellQuote('cd /; list ltm virtual recursive one-line') + ' 2>&1 || true'
  ].join('\n'));
  var virtuals = parseVirtualListOutput(output);

  if (!virtuals.length && /Syntax Error|unexpected argument|operation not supported|permission denied/i.test(String(output || ''))) {
    throw new Error(String(output || '').trim() || 'Unable to list BIG-IP virtual servers.');
  }

  return virtuals;
}

function listBigIpPools() {
  var output = runShell([
    'set +e',
    'tmsh -q -c ' + shellQuote('cd /; list ltm pool recursive one-line') + ' 2>&1 || true'
  ].join('\n'));
  var pools = parsePoolListOutput(output);

  if (!pools.length && /Syntax Error|unexpected argument|operation not supported|permission denied/i.test(String(output || ''))) {
    throw new Error(String(output || '').trim() || 'Unable to list BIG-IP pools.');
  }

  return {
    ok: true,
    source: 'tmsh',
    pools: pools
  };
}

function buildPoolLookup(pools) {
  var lookup = {};

  (pools || []).forEach(function (pool) {
    if (pool && pool.fullPath) {
      lookup[pool.fullPath] = pool;
    }
  });

  return lookup;
}

function validateReferencedPools(block) {
  var poolPayload = listBigIpPools();
  var poolLookup = buildPoolLookup(poolPayload.pools);
  var issues = [];

  Object.keys(block.backendTargets || {}).forEach(function (backendId) {
    var backend = block.backendTargets[backendId] || {};
    var poolName = tmshObjectName(backend.pool_name);
    if (poolName && !poolLookup[poolName]) {
      issues.push('Backend ' + (backend.backend_target_name || backendId) + ' references missing BIG-IP pool ' + poolName + '.');
    }
  });

  Object.keys(block.classifiers || {}).forEach(function (classifierId) {
    var classifier = block.classifiers[classifierId] || {};
    var poolName = tmshObjectName(classifier.pool_name);
    if (poolName && !poolLookup[poolName]) {
      issues.push('Classifier ' + (classifier.classifier_name || classifierId) + ' references missing BIG-IP pool ' + poolName + '.');
    }
  });

  return {
    valid: issues.length === 0,
    issues: issues,
    pools: poolPayload.pools
  };
}

function validateListenerVirtualDestinations(desiredState) {
  var existingVirtuals = listBigIpVirtuals();
  var existingByKey = {};
  var desiredByKey = {};
  var issues = [];
  var desiredVirtuals = [];

  existingVirtuals.forEach(function (virtualServer) {
    var key = virtualConflictKey(
      virtualServer.address,
      virtualServer.port,
      virtualServer.ipProtocol,
      virtualServer.source,
      virtualServer.vlans
    );

    if (!existingByKey[key]) {
      existingByKey[key] = [];
    }
    existingByKey[key].push(virtualServer);
  });

  (desiredState.listeners || []).forEach(function (listener) {
    desiredVirtuals.push({
      type: 'Listener',
      id: listener.id,
      name: listener.name,
      vip: listener.vip,
      port: listener.port
    });
  });

  (desiredState.classifierEgress || []).forEach(function (egress) {
    desiredVirtuals.push({
      type: 'Classifier egress',
      id: egress.classifier_id,
      name: egress.name,
      vip: egress.vip,
      port: egress.port
    });
  });

  desiredVirtuals.forEach(function (desiredVirtual) {
    var virtualObject = tmshObjectName(desiredVirtual.name);
    var key = virtualConflictKey(desiredVirtual.vip, desiredVirtual.port, 'tcp', '0.0.0.0/0', 'all');
    var existingConflicts = existingByKey[key] || [];
    var desiredConflict = desiredByKey[key];

    if (desiredConflict && desiredConflict.name !== desiredVirtual.name) {
      issues.push(
        desiredConflict.type + ' "' + desiredConflict.name + '" and ' + desiredVirtual.type + ' "' + desiredVirtual.name +
        '" both use ' + desiredVirtual.vip + ':' + desiredVirtual.port + '/tcp. Use a unique VIP/port.'
      );
      return;
    }

    desiredByKey[key] = desiredVirtual;

    existingConflicts.some(function (virtualServer) {
      if (virtualServer.fullPath === virtualObject) {
        return false;
      }

      issues.push(
        desiredVirtual.type + ' "' + (desiredVirtual.name || desiredVirtual.id) + '" uses ' + desiredVirtual.vip + ':' + desiredVirtual.port +
        '/tcp, but existing BIG-IP virtual server ' + virtualServer.fullPath +
        ' already owns that destination. Choose a different VIP/port or remove/change the existing virtual server.'
      );
      return true;
    });
  });

  return {
    valid: issues.length === 0,
    issues: issues
  };
}

function cleanupRuntimeHelpers() {
  var runtimeEntries = [];

  RUNTIME_CLEANUP_FILES.forEach(function (filePath) {
    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      if (!error || error.code !== 'ENOENT') {
        // Cleanup is best-effort; deploy success should not be masked by stale helper files.
      }
    }
  });

  try {
    runtimeEntries = fs.readdirSync(RUNTIME_DIR);
  } catch (error) {
    if (!error || error.code === 'ENOENT') {
      return;
    }
    return;
  }

  runtimeEntries.forEach(function (entryName) {
    if (!/^apply-.*\.sh$/.test(entryName)) {
      return;
    }
    try {
      fs.unlinkSync(path.join(RUNTIME_DIR, entryName));
    } catch (error) {
      if (!error || error.code !== 'ENOENT') {
        // Cleanup is best-effort; stale helper scripts should not mask deploy success.
      }
    }
  });
}

function resolveDefaultBackendForListener(block, listener) {
  var policy = block.routingPolicies[listener.policy_ref] || {};
  var defaultRule = policy.default_rule || {};
  var backendRef = defaultRule.backend_target_ref || '';
  return {
    backendRef: backendRef,
    backend: block.backendTargets[backendRef] || null,
    policy: policy
  };
}

function collectRouteBackendRefs(policy) {
  var refs = {};
  var defaultRule = policy && policy.default_rule ? policy.default_rule : {};
  var fallbackBackendRef = policy && (policy.fallback_backend_target_ref || policy.fallbackBackendTargetRef);

  if ((defaultRule.action || 'route') === 'route' && defaultRule.backend_target_ref) {
    refs[defaultRule.backend_target_ref] = true;
  }

  if (fallbackBackendRef) {
    refs[fallbackBackendRef] = true;
  }

  (policy && policy.rules || []).forEach(function (rule) {
    if (rule && rule.action === 'route' && rule.backend_target_ref) {
      refs[rule.backend_target_ref] = true;
    }
  });

  (policy && policy.key_rules || []).forEach(function (rule) {
    if (rule && rule.enabled !== false && rule.action === 'route' && rule.backend_target_ref) {
      refs[rule.backend_target_ref] = true;
    }
  });

  return Object.keys(refs);
}

function resolveRouteBackendsForListener(block, listener) {
  var policy = block.routingPolicies[listener.policy_ref] || {};
  return collectRouteBackendRefs(policy).map(function (backendRef) {
    return block.backendTargets[backendRef] || null;
  }).filter(function (backend) {
    return !!backend;
  });
}

function isHttpsBackend(backend) {
  var endpoint = parseEndpointUrl((backend && backend.endpoint_url) || '');
  return endpoint.protocol === 'https' && !!endpoint.hostname;
}

function buildVirtualProfiles(serverSslProfile) {
  var profiles = ['http { }', 'tcp { }', 'stream { }'];

  if (serverSslProfile) {
    profiles.push(tmshObjectName(serverSslProfile) + ' { context serverside }');
  }

  return profiles.join(' ');
}

function buildClassifierEgressProfiles(serverSslProfile) {
  var profiles = ['http { }', 'tcp { }'];

  if (serverSslProfile) {
    profiles.push(tmshObjectName(serverSslProfile) + ' { context serverside }');
  }

  return profiles.join(' ');
}

function sanitizeTmshNamePart(value) {
  var normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return normalized || 'classifier';
}

function normalizeEndpointPath(pathValue) {
  var normalized = String(pathValue || '').trim();
  if (!normalized) {
    return '/chat/completions';
  }
  return normalized.charAt(0) === '/' ? normalized : '/' + normalized;
}

function collectReferencedClassifiersForListeners(block) {
  var referenced = {};

  Object.keys(block.listeners || {}).forEach(function (listenerId) {
    var listener = block.listeners[listenerId] || {};
    var policy = block.routingPolicies[listener.policy_ref] || {};
    var routingMode = String(policy.routing_mode || 'classifier_only');
    var classifierIds = {};

    if (routingMode !== 'key_only' && policy.classifier_ref) {
      classifierIds[policy.classifier_ref] = true;
    }

    (policy.key_rules || []).forEach(function (rule) {
      var classifierId;

      if (!rule || rule.enabled === false || rule.action !== 'classify') {
        return;
      }
      classifierId = rule.classifier_ref || policy.classifier_ref || '';
      if (classifierId) {
        classifierIds[classifierId] = true;
      }
    });

    Object.keys(classifierIds).forEach(function (classifierId) {
      var classifier = block.classifiers[classifierId] || null;

      if (!classifier || classifier.bypass_enabled) {
        return;
      }
      if (!referenced[classifierId]) {
        referenced[classifierId] = {
          classifierId: classifierId,
          classifier: classifier,
          listener: listener
        };
      }
    });
  });

  return referenced;
}

function reservePort(reservedPortsByVip, vip, port) {
  var key = String(vip || '');
  if (!reservedPortsByVip[key]) {
    reservedPortsByVip[key] = {};
  }
  if (port) {
    reservedPortsByVip[key][String(port)] = true;
  }
}

function isPortReserved(reservedPortsByVip, vip, port) {
  var key = String(vip || '');
  return !!(reservedPortsByVip[key] && reservedPortsByVip[key][String(port)]);
}

function findPreviousClassifierEgress(classifierId, vip, previousState) {
  var previous = (previousState && previousState.classifierEgress) || [];
  var index;

  for (index = 0; index < previous.length; index += 1) {
    if (previous[index].classifier_id === classifierId && previous[index].vip === vip) {
      return previous[index];
    }
  }

  return null;
}

function allocateClassifierEgressPort(classifierId, vip, previousState, reservedPortsByVip) {
  var previous = findPreviousClassifierEgress(classifierId, vip, previousState);
  var port;

  if (
    previous &&
    previous.port >= CLASSIFIER_EGRESS_PORT_START &&
    previous.port <= CLASSIFIER_EGRESS_PORT_END &&
    !isPortReserved(reservedPortsByVip, vip, previous.port)
  ) {
    reservePort(reservedPortsByVip, vip, previous.port);
    return previous.port;
  }

  for (port = CLASSIFIER_EGRESS_PORT_START; port <= CLASSIFIER_EGRESS_PORT_END; port += 1) {
    if (!isPortReserved(reservedPortsByVip, vip, port)) {
      reservePort(reservedPortsByVip, vip, port);
      return port;
    }
  }

  throw new Error('No free classifier egress port remains in ' + CLASSIFIER_EGRESS_PORT_START + '-' + CLASSIFIER_EGRESS_PORT_END + ' for VIP ' + vip + '.');
}

function buildClassifierEgressEntries(normalizedBlock, previousState, reservedPortsByVip) {
  var referenced = collectReferencedClassifiersForListeners(normalizedBlock);
  var entries = [];

  Object.keys(referenced).sort().forEach(function (classifierId) {
    var item = referenced[classifierId] || {};
    var classifier = item.classifier || {};
    var listener = item.listener || {};
    var endpoint = parseEndpointUrl(classifier.endpoint_url || '');
    var vip = listener.vip || '';
    var port = allocateClassifierEgressPort(classifierId, vip, previousState, reservedPortsByVip);
    var virtualName = '/Common/aito_cls_egress_' + sanitizeTmshNamePart(classifierId);
    var pathValue = normalizeEndpointPath(endpoint.path);
    var requiresServerSsl = endpoint.protocol === 'https' && !!endpoint.hostname;

    entries.push({
      id: classifierId,
      classifier_id: classifierId,
      name: virtualName,
      vip: vip,
      port: port,
      pool_name: classifier.pool_name || '',
      endpoint_protocol: endpoint.protocol,
      endpoint_host: endpoint.hostname,
      endpoint_path: pathValue,
      requires_server_ssl: requiresServerSsl,
      server_ssl_profile: requiresServerSsl ? MANAGED_SERVER_SSL_PROFILE : '',
      egress_url: 'http://' + vip + ':' + port + pathValue,
      egress_host: endpoint.hostname,
      egress_tls: requiresServerSsl
    });
  });

  return entries;
}

function buildDesiredState(normalizedBlock, previousState) {
  var listeners = [];
  var backendPools = {};
  var reservedPortsByVip = {};
  var classifierEgress;

  Object.keys(normalizedBlock.backendTargets || {}).forEach(function (backendId) {
    var backend = normalizedBlock.backendTargets[backendId] || {};
    if (!backend.pool_name) {
      return;
    }
    if (!backendPools[backend.pool_name]) {
      backendPools[backend.pool_name] = {
        id: backendId,
        name: backend.pool_name,
        members: Array.isArray(backend.members) ? backend.members.slice(0) : []
      };
    }
  });

  Object.keys(normalizedBlock.listeners || {}).forEach(function (listenerId) {
    var listener = normalizedBlock.listeners[listenerId] || {};
    var defaultBackendInfo = resolveDefaultBackendForListener(normalizedBlock, listener);
    var defaultBackend = defaultBackendInfo.backend || {};
    var endpoint = parseEndpointUrl(defaultBackend.endpoint_url || '');
    var assignedIRule = listener.status && listener.status.assigned_irule ? listener.status.assigned_irule : 'llm_semantic_route_phase2';
    var routeBackends = resolveRouteBackendsForListener(normalizedBlock, listener);
    var requiresServerSsl = routeBackends.some(isHttpsBackend);

    listeners.push({
      id: listenerId,
      name: listener.virtual_service,
      enabled: listener.enabled !== false,
      vip: listener.vip,
      port: Number(listener.port || 0),
      pool_name: defaultBackend.pool_name || '',
      requires_server_ssl: requiresServerSsl,
      server_ssl_profile: requiresServerSsl ? MANAGED_SERVER_SSL_PROFILE : '',
      assigned_irule: assignedIRule,
      default_backend_host: endpoint.hostname,
      default_backend_model: defaultBackend.model_id || '',
      default_backend_ref: defaultBackendInfo.backendRef
    });
    reservePort(reservedPortsByVip, listener.vip, Number(listener.port || 0));
  });

  classifierEgress = buildClassifierEgressEntries(normalizedBlock, previousState, reservedPortsByVip);
  classifierEgress.forEach(function (egress) {
    if (egress.pool_name && !backendPools[egress.pool_name]) {
      backendPools[egress.pool_name] = {
        id: 'classifier:' + egress.classifier_id,
        name: egress.pool_name,
        members: []
      };
    }
  });

  return {
    listeners: listeners,
    classifierEgress: classifierEgress,
    pools: Object.keys(backendPools).map(function (poolName) {
      return backendPools[poolName];
    })
  };
}

function attachClassifierEgressToBlock(block, desiredState) {
  var artifactBlock = clone(block);
  var egressByClassifier = {};

  (desiredState.classifierEgress || []).forEach(function (egress) {
    egressByClassifier[egress.classifier_id] = egress;
  });

  Object.keys(artifactBlock.classifiers || {}).forEach(function (classifierId) {
    var classifier = artifactBlock.classifiers[classifierId] || {};
    var egress = egressByClassifier[classifierId];

    if (!egress) {
      delete classifier.classifier_egress;
      delete classifier.classifierEgress;
      artifactBlock.classifiers[classifierId] = classifier;
      return;
    }

    classifier.classifier_egress = {
      enabled: true,
      url: egress.egress_url,
      host: egress.egress_host,
      tls: egress.egress_tls,
      virtual_service: egress.name,
      pool_name: egress.pool_name
    };
    delete classifier.classifierEgress;
    artifactBlock.classifiers[classifierId] = classifier;
  });

  return artifactBlock;
}

function appendDataGroupApplyScript(lines, objectName, records) {
  var recordKeys = Object.keys(records || {}).filter(function (key) {
    var value = records[key];
    return value !== null && value !== undefined && String(value) !== '';
  });
  var recordsBlock;

  if (!recordKeys.length) {
    lines.push('if tmsh_has "^ltm data-group internal " list ltm data-group internal ' + objectName + '; then');
    lines.push('  tmsh delete ltm data-group internal ' + objectName);
    lines.push('fi');
    return;
  }

  recordsBlock = buildRecordsBlock(records);
  lines.push('if tmsh_has "^ltm data-group internal " list ltm data-group internal ' + objectName + '; then');
  lines.push('  tmsh modify ltm data-group internal ' + objectName + ' records replace-all-with { ' + recordsBlock + ' }');
  lines.push('else');
  lines.push('  tmsh create ltm data-group internal ' + objectName + ' type string records add { ' + recordsBlock + ' }');
  lines.push('fi');
}

function appendRecordMutation(lines, objectName, operation, records) {
  var recordsBlock;

  if (!Object.keys(records || {}).length) {
    return;
  }

  recordsBlock = buildRecordsBlock(records);
  lines.push('tmsh modify ltm data-group internal ' + objectName + ' records ' + operation + ' { ' + recordsBlock + ' }');
}

function appendRecordDeletes(lines, objectName, deleteKeys) {
  if (!(deleteKeys || []).length) {
    return;
  }

  lines.push('tmsh modify ltm data-group internal ' + objectName + ' records delete { ' + deleteKeys.slice(0).sort().join(' ') + ' }');
}

function appendDataGroupDiffApplyScript(lines, objectName, desiredRecords, currentDataGroup, options) {
  var desired = filterNonEmptyRecords(desiredRecords);
  var desiredKeys = Object.keys(desired);
  var current = currentDataGroup || {
    exists: false,
    records: {}
  };
  var threshold = options && typeof options.replaceThreshold === 'number'
    ? options.replaceThreshold
    : DATA_GROUP_DIFF_REPLACE_THRESHOLD;
  var diff;

  if (!desiredKeys.length) {
    lines.push('if tmsh_has "^ltm data-group internal " list ltm data-group internal ' + objectName + '; then');
    lines.push('  tmsh delete ltm data-group internal ' + objectName);
    lines.push('fi');
    return;
  }

  if (!current.exists) {
    lines.push('tmsh create ltm data-group internal ' + objectName + ' type string records add { ' + buildRecordsBlock(desired) + ' }');
    return;
  }

  diff = diffDataGroupRecords(current.records, desired);
  if (!diff.changedCount) {
    lines.push('# ' + objectName + ' records already in sync');
    return;
  }

  if (diff.changedRatio >= threshold) {
    lines.push('tmsh modify ltm data-group internal ' + objectName + ' records replace-all-with { ' + buildRecordsBlock(desired) + ' }');
    return;
  }

  appendRecordDeletes(lines, objectName, diff.deleteKeys);
  appendRecordMutation(lines, objectName, 'modify', diff.update);
  appendRecordMutation(lines, objectName, 'add', diff.add);
}

function buildClassifierEgressSettingsRecords(desiredState) {
  var records = {};

  (desiredState.classifierEgress || []).forEach(function (egress) {
    var pathInfo = splitTmshObjectPath(egress.name);
    var fullKey = egress.name + '.host';
    var shortKey = pathInfo.name + '.host';

    if (egress.egress_host) {
      records[fullKey] = egress.egress_host;
      records[shortKey] = egress.egress_host;
    }
  });

  return records;
}

function buildClassifierEgressEntryLookup(entries) {
  var lookup = {};

  (entries || []).forEach(function (entry) {
    var lookupKey;

    if (!entry) {
      return;
    }

    lookupKey = String(entry.classifier_id || entry.id || entry.name || '').trim();
    if (!lookupKey) {
      return;
    }

    lookup[lookupKey] = entry;
  });

  return lookup;
}

function buildClassifierEgressTemporaryName(name) {
  var pathInfo = splitTmshObjectPath(name);
  var partition = pathInfo.partition || 'Common';
  var objectName = pathInfo.name || sanitizeTmshNamePart(name);

  return '/' + partition + '/' + objectName + '__staged';
}

function cloneClassifierEgressEntryWithName(entry, name) {
  var cloned = clone(entry);

  cloned.name = name;
  return cloned;
}

function classifierEgressNeedsTransition(previousEgress, desiredEgress) {
  if (!previousEgress || !desiredEgress) {
    return false;
  }

  return String(previousEgress.vip || '') !== String(desiredEgress.vip || '') ||
    Number(previousEgress.port || 0) !== Number(desiredEgress.port || 0) ||
    String(previousEgress.name || '') !== String(desiredEgress.name || '');
}

function mergeRecordMaps(base, overlay) {
  var merged = clone(base || {});

  Object.keys(overlay || {}).forEach(function (key) {
    merged[key] = overlay[key];
  });

  return merged;
}

function buildClassifierEgressTransitionPlan(desiredState, previousState) {
  var desiredEntries = clone((desiredState && desiredState.classifierEgress) || []);
  var previousEntries = clone((previousState && previousState.classifierEgress) || []);
  var desiredLookup = buildClassifierEgressEntryLookup(desiredEntries);
  var previousLookup = buildClassifierEgressEntryLookup(previousEntries);
  var directEntries = [];
  var transitionEntries = [];
  var deletedEntries = [];
  var temporaryEntries;
  var prepublishRecords;

  desiredEntries.forEach(function (desiredEgress) {
    var lookupKey = String(desiredEgress.classifier_id || desiredEgress.id || desiredEgress.name || '').trim();
    var previousEgress = previousLookup[lookupKey] || null;

    if (classifierEgressNeedsTransition(previousEgress, desiredEgress)) {
      transitionEntries.push({
        previous: previousEgress,
        desired: desiredEgress,
        temporary: cloneClassifierEgressEntryWithName(
          desiredEgress,
          buildClassifierEgressTemporaryName(desiredEgress.name)
        )
      });
      return;
    }

    directEntries.push(desiredEgress);
  });

  previousEntries.forEach(function (previousEgress) {
    var lookupKey = String(previousEgress.classifier_id || previousEgress.id || previousEgress.name || '').trim();

    if (!desiredLookup[lookupKey]) {
      deletedEntries.push(previousEgress);
    }
  });

  temporaryEntries = transitionEntries.map(function (item) {
    return item.temporary;
  });
  prepublishRecords = mergeRecordMaps(
    buildClassifierEgressSettingsRecords({
      classifierEgress: previousEntries
    }),
    buildClassifierEgressSettingsRecords({
      classifierEgress: directEntries.concat(temporaryEntries)
    })
  );

  return {
    directEntries: directEntries,
    transitionEntries: transitionEntries,
    deletedEntries: deletedEntries,
    temporaryEntries: temporaryEntries,
    prepublishRecords: prepublishRecords,
    finalRecords: buildClassifierEgressSettingsRecords(desiredState),
    hasDesiredEntries: desiredEntries.length > 0,
    hasPreviousEntries: previousEntries.length > 0
  };
}

function buildClassifierEgressIRuleText() {
  return [
    'when RULE_INIT {',
    '    set static::aito_classifier_egress_settings "' + CLASSIFIER_EGRESS_SETTINGS_DG + '"',
    '}',
    '',
    'when HTTP_REQUEST {',
    '    set vs_name [virtual name]',
    '    set target_host [class match -value "${vs_name}.host" equals $static::aito_classifier_egress_settings]',
    '    if {$target_host eq "" && ![string match "/*" $vs_name]} {',
    '        set target_host [class match -value "/Common/${vs_name}.host" equals $static::aito_classifier_egress_settings]',
    '    }',
    '    if {$target_host ne ""} {',
    '        HTTP::header replace Host $target_host',
    '    }',
    '}',
    '',
    'when LB_FAILED {',
    '    HTTP::respond 503 content {{"error":{"message":"Classifier egress route failed before a backend connection was established. Check BIG-IP pool members, data-plane routing, and server-side TLS configuration.","type":"gateway_error","code":"classifier_egress_connect_failed"}}} noserver \\',
    '        "Content-Type" "application/json" \\',
    '        "Connection" "close"',
    '}',
    '',
    'when SERVERSSL_CLIENTHELLO_SEND {',
    '    set vs_name [virtual name]',
    '    set target_host [class match -value "${vs_name}.host" equals $static::aito_classifier_egress_settings]',
    '    if {$target_host eq "" && ![string match "/*" $vs_name]} {',
    '        set target_host [class match -value "/Common/${vs_name}.host" equals $static::aito_classifier_egress_settings]',
    '    }',
    '    if {$target_host ne ""} {',
    '        set host_len [string length $target_host]',
    '        set sni_ext [binary format S1S1S1cS1a* 0 [expr {$host_len + 5}] [expr {$host_len + 3}] 0 $host_len $target_host]',
    '        SSL::extensions insert $sni_ext',
    '    }',
    '}'
  ].join('\n');
}

function appendClassifierEgressIRuleScript(lines, desiredState) {
  if (!((desiredState.classifierEgress || []).length)) {
    lines.push('if tmsh_has "^ltm rule " list ltm rule ' + CLASSIFIER_EGRESS_IRULE + '; then tmsh delete ltm rule ' + CLASSIFIER_EGRESS_IRULE + '; fi');
    return;
  }

  lines.push('cat > /var/tmp/aito_classifier_egress.conf <<\'AITOCFG\'');
  lines.push('ltm rule ' + CLASSIFIER_EGRESS_IRULE + ' {');
  lines.push(buildClassifierEgressIRuleText());
  lines.push('}');
  lines.push('AITOCFG');
  lines.push('tmsh load sys config merge file /var/tmp/aito_classifier_egress.conf');
}

function appendClassifierEgressVirtualUpsert(lines, egress) {
  var virtualObject = tmshObjectName(egress.name);
  var poolObject = tmshObjectName(egress.pool_name);
  var profilesBlock = buildClassifierEgressProfiles(egress.server_ssl_profile);

  lines.push('if tmsh_has "^ltm virtual " list ltm virtual ' + virtualObject + '; then');
  lines.push('  tmsh modify ltm virtual ' + virtualObject + ' destination ' + egress.vip + ':' + egress.port + ' ip-protocol tcp');
  lines.push('else');
  lines.push('  tmsh create ltm virtual ' + virtualObject + ' destination ' + egress.vip + ':' + egress.port + ' ip-protocol tcp source-address-translation { type automap } translate-address enabled translate-port enabled');
  lines.push('fi');
  lines.push('tmsh modify ltm virtual ' + virtualObject + ' profiles replace-all-with { ' + profilesBlock + ' }');
  lines.push('tmsh modify ltm virtual ' + virtualObject + ' source-address-translation { type automap } translate-address enabled translate-port enabled');
  lines.push('tmsh_has "^ltm pool " list ltm pool ' + poolObject + ' || { echo "Missing required classifier pool: ' + poolObject + '" >&2; exit 1; }');
  lines.push('tmsh modify ltm virtual ' + virtualObject + ' pool ' + poolObject);
  lines.push('tmsh modify ltm virtual ' + virtualObject + ' rules { ' + CLASSIFIER_EGRESS_IRULE + ' }');
  if (egress.server_ssl_profile) {
    lines.push('tmsh modify ltm virtual ' + virtualObject + ' serverssl-use-sni enabled');
  } else {
    lines.push('tmsh modify ltm virtual ' + virtualObject + ' serverssl-use-sni disabled');
  }
}

function appendClassifierEgressVirtualDelete(lines, name) {
  var virtualObject = tmshObjectName(name);

  lines.push('if tmsh_has "^ltm virtual " list ltm virtual ' + virtualObject + '; then tmsh delete ltm virtual ' + virtualObject + '; fi');
}

function buildTmshOnlyPrelude() {
  return [
    'set -euo pipefail',
    'tmsh_has() {',
    '  local pattern="$1"',
    '  local output',
    '  shift',
    '  output="$(tmsh "$@" one-line 2>&1 || true)"',
    '  printf "%s\\n" "$output" | grep -q "$pattern"',
    '}'
  ];
}

function buildShellPrelude() {
  return [
    'set -euo pipefail',
    'shopt -s nullglob'
  ];
}

function appendRuntimeArtifactPublishHelpers(lines) {
  lines.push('verify_copied_file() {');
  lines.push('  local source_path="$1"');
  lines.push('  local target_path="$2"');
  lines.push('  cmp -s "$source_path" "$target_path" || {');
  lines.push('    echo "Published file verification failed: $target_path does not match $source_path" >&2');
  lines.push('    exit 1');
  lines.push('  }');
  lines.push('}');
  lines.push('publish_native_file() {');
  lines.push('  local source_path="$1"');
  lines.push('  local target_path="$2"');
  lines.push('  local target_dir');
  lines.push('  local temp_path');
  lines.push('  target_dir="$(dirname "$target_path")"');
  lines.push('  mkdir -p "$target_dir"');
  lines.push('  temp_path="${target_path}.tmp.$$"');
  lines.push('  install -m 0644 "$source_path" "$temp_path"');
  lines.push('  mv "$temp_path" "$target_path"');
  lines.push('  verify_copied_file "$source_path" "$target_path"');
  lines.push('}');
  lines.push('publish_plugin_store_file() {');
  lines.push('  local source_path="$1"');
  lines.push('  local filename="$2"');
  lines.push('  local matched=0');
  lines.push('  local target_dir');
  lines.push('  local target_path');
  lines.push('  for target_dir in ' + ILX_PLUGIN_STORE_NATIVE_GLOB + '; do');
  lines.push('    matched=1');
  lines.push('    mkdir -p "$target_dir"');
  lines.push('    target_path="$target_dir/$filename"');
  lines.push('    publish_native_file "$source_path" "$target_path"');
  lines.push('  done');
  lines.push('  if [[ "$matched" -eq 0 ]]; then');
  lines.push('    echo "Active plugin_store native directory not found for $filename under ' + ILX_PLUGIN_STORE_NATIVE_GLOB + '" >&2');
  lines.push('    exit 1');
  lines.push('  fi');
  lines.push('  return 0');
  lines.push('}');
}

function appendRuntimeArtifactPublishCommands(lines, ifileSpecs) {
  Object.keys(ifileSpecs).forEach(function (key) {
    var spec = ifileSpecs[key];

    lines.push('publish_native_file ' + shellQuote(spec.localPath) + ' ' + shellQuote(spec.publishedPath));
    lines.push('publish_plugin_store_file ' + shellQuote(spec.localPath) + ' ' + shellQuote(spec.fileName));
  });
}

function isDataGroupFastPathScope(scopeType) {
  return [
    'auth_data_groups_only',
    'listener_data_groups_only'
  ].indexOf(scopeType) >= 0;
}

function scopeHasChangedSection(scope, sectionName) {
  var changedSections = scope && Array.isArray(scope.changed_sections) ? scope.changed_sections : [];
  return changedSections.indexOf(sectionName) >= 0;
}

function shouldForceFullApplyObjects(previousDeployedConfig, scope) {
  return !previousDeployedConfig || !scope || scope.type === 'unknown';
}

function buildFullApplyObjectPlan(previousDeployedConfig, scope) {
  var forceAll = shouldForceFullApplyObjects(previousDeployedConfig, scope);

  return {
    inspectVirtualKeyDataGroup: forceAll || scopeHasChangedSection(scope, 'virtual_keys'),
    applyListenerSettingsDataGroup: forceAll ||
      scopeHasChangedSection(scope, 'listener_settings') ||
      scopeHasChangedSection(scope, 'listener_auth'),
    applyListenerVirtualKeyPoolAllowlistDataGroup: forceAll || scopeHasChangedSection(scope, 'listener_auth'),
    applyVirtualKeysDataGroup: forceAll || scopeHasChangedSection(scope, 'virtual_keys'),
    applyVirtualKeyPoolsDataGroup: forceAll || scopeHasChangedSection(scope, 'virtual_key_pools'),
    applyClassifierEgress: forceAll || scopeHasChangedSection(scope, 'classifier_egress')
  };
}

function buildDataGroupFastPathApplyScript(scope, listenerRefsRecords, listenerSettingsRecords, listenerVirtualKeyPoolAllowlistRecords, virtualKeyRecords, virtualKeyPoolRecords, currentVirtualKeyDataGroup) {
  var scopeType = scope && scope.type ? scope.type : '';
  var lines = buildTmshOnlyPrelude();

  if (scopeType === 'listener_data_groups_only') {
    appendDataGroupApplyScript(lines, '/Common/dg_ai_gateway_listener_refs', listenerRefsRecords);
  }

  if (scopeHasChangedSection(scope, 'listener_settings') || scopeHasChangedSection(scope, 'listener_auth')) {
    appendDataGroupApplyScript(lines, '/Common/dg_ai_gateway_listener_settings', listenerSettingsRecords);
  }

  if (scopeHasChangedSection(scope, 'listener_auth')) {
    appendDataGroupApplyScript(lines, '/Common/dg_ai_gateway_listener_vk_pool_allowlist', listenerVirtualKeyPoolAllowlistRecords);
  }

  if (scopeHasChangedSection(scope, 'virtual_keys')) {
    appendDataGroupDiffApplyScript(lines, VIRTUAL_KEYS_DG, virtualKeyRecords, currentVirtualKeyDataGroup, {
      replaceThreshold: DATA_GROUP_DIFF_REPLACE_THRESHOLD
    });
  }
  if (scopeHasChangedSection(scope, 'virtual_key_pools')) {
    appendDataGroupApplyScript(lines, '/Common/dg_ai_gateway_virtual_key_pools', virtualKeyPoolRecords);
  }

  lines.push('tmsh save sys config');
  return lines.join('\n');
}

function buildRuntimeArtifactsFastPathApplyScript(ifileSpecs) {
  var lines = buildShellPrelude();

  appendRuntimeArtifactPublishHelpers(lines);
  appendRuntimeArtifactPublishCommands(lines, ifileSpecs);

  return lines.join('\n');
}

function buildClassifierEgressFastPathApplyScript(desiredState, previousState, ifileSpecs) {
  var transitionPlan = buildClassifierEgressTransitionPlan(desiredState, previousState);
  var lines = buildShellPrelude();

  lines.push('tmsh_has() {');
  lines.push('  local pattern="$1"');
  lines.push('  local output');
  lines.push('  shift');
  lines.push('  output="$(tmsh "$@" one-line 2>&1 || true)"');
  lines.push('  printf "%s\\n" "$output" | grep -q "$pattern"');
  lines.push('}');
  appendRuntimeArtifactPublishHelpers(lines);

  (desiredState.classifierEgress || []).forEach(function (egress) {
    var poolObject = tmshObjectName(egress.pool_name);

    lines.push('tmsh_has "^ltm pool " list ltm pool ' + poolObject + ' || { echo "Missing required classifier pool: ' + poolObject + '" >&2; exit 1; }');
  });

  if ((desiredState.classifierEgress || []).some(function (egress) { return !!egress.server_ssl_profile; })) {
    lines.push('if ! tmsh_has "^ltm profile server-ssl " list ltm profile server-ssl ' + tmshObjectName(MANAGED_SERVER_SSL_PROFILE) + '; then');
    lines.push('  tmsh create ltm profile server-ssl ' + tmshObjectName(MANAGED_SERVER_SSL_PROFILE) + ' defaults-from /Common/serverssl');
    lines.push('fi');
  }

  if (transitionPlan.hasDesiredEntries) {
    appendDataGroupApplyScript(lines, CLASSIFIER_EGRESS_SETTINGS_DG, transitionPlan.prepublishRecords);
    appendClassifierEgressIRuleScript(lines, {
      classifierEgress: transitionPlan.directEntries.concat(transitionPlan.temporaryEntries)
    });
  }

  transitionPlan.directEntries.forEach(function (egress) {
    appendClassifierEgressVirtualUpsert(lines, egress);
  });
  transitionPlan.temporaryEntries.forEach(function (egress) {
    appendClassifierEgressVirtualUpsert(lines, egress);
  });

  appendRuntimeArtifactPublishCommands(lines, ifileSpecs);

  transitionPlan.transitionEntries.forEach(function (entry) {
    appendClassifierEgressVirtualDelete(lines, entry.previous && entry.previous.name);
  });
  transitionPlan.deletedEntries.forEach(function (egress) {
    appendClassifierEgressVirtualDelete(lines, egress.name);
  });

  if (transitionPlan.hasDesiredEntries) {
    appendDataGroupApplyScript(lines, CLASSIFIER_EGRESS_SETTINGS_DG, transitionPlan.finalRecords);
    appendClassifierEgressIRuleScript(lines, desiredState);
    transitionPlan.transitionEntries.forEach(function (entry) {
      appendClassifierEgressVirtualUpsert(lines, entry.desired);
    });
    transitionPlan.temporaryEntries.forEach(function (egress) {
      appendClassifierEgressVirtualDelete(lines, egress.name);
    });
  } else if (transitionPlan.hasPreviousEntries) {
    appendDataGroupApplyScript(lines, CLASSIFIER_EGRESS_SETTINGS_DG, {});
    appendClassifierEgressIRuleScript(lines, desiredState);
  }

  lines.push('tmsh save sys config');
  return lines.join('\n');
}

function buildApplyScript(desiredState, previousState, listenerRefsRecords, listenerSettingsRecords, listenerVirtualKeyPoolAllowlistRecords, virtualKeyRecords, virtualKeyPoolRecords, currentVirtualKeyDataGroup, ifileSpecs, options) {
  var applyOptions = options || {};
  var lines = buildShellPrelude();

  lines.push('tmsh_has() {');
  lines.push('  local pattern="$1"');
  lines.push('  local output');
  lines.push('  shift');
  lines.push('  output="$(tmsh "$@" one-line 2>&1 || true)"');
  lines.push('  printf "%s\\n" "$output" | grep -q "$pattern"');
  lines.push('}');
  appendRuntimeArtifactPublishHelpers(lines);
  lines.push('restart_ilx_plugin() {');
  lines.push('  local plugin_name="' + ILX_PLUGIN_NAME + '"');
  lines.push('  if tmsh_has "^ilx plugin " list ilx plugin "$plugin_name"; then');
  lines.push('    tmsh modify ilx plugin "$plugin_name" disabled');
  lines.push('    sleep 1');
  lines.push('    tmsh modify ilx plugin "$plugin_name" enabled');
  lines.push('  fi');
  lines.push('}');

  desiredState.pools.forEach(function (pool) {
    var poolObject = tmshObjectName(pool.name);

    lines.push('tmsh_has "^ltm pool " list ltm pool ' + poolObject + ' || { echo "Missing required pool: ' + poolObject + '" >&2; exit 1; }');
  });

  if (
    (desiredState.listeners || []).some(function (listener) { return !!listener.server_ssl_profile; }) ||
    (
      applyOptions.applyClassifierEgress !== false &&
      (desiredState.classifierEgress || []).some(function (egress) { return !!egress.server_ssl_profile; })
    )
  ) {
    lines.push('if ! tmsh_has "^ltm profile server-ssl " list ltm profile server-ssl ' + tmshObjectName(MANAGED_SERVER_SSL_PROFILE) + '; then');
    lines.push('  tmsh create ltm profile server-ssl ' + tmshObjectName(MANAGED_SERVER_SSL_PROFILE) + ' defaults-from /Common/serverssl');
    lines.push('fi');
  }

  if (applyOptions.applyClassifierEgress !== false) {
    if ((desiredState.classifierEgress || []).length) {
      appendDataGroupApplyScript(lines, CLASSIFIER_EGRESS_SETTINGS_DG, buildClassifierEgressSettingsRecords(desiredState));
      appendClassifierEgressIRuleScript(lines, desiredState);
    }

    (desiredState.classifierEgress || []).forEach(function (egress) {
      appendClassifierEgressVirtualUpsert(lines, egress);
    });

    (previousState.classifierEgress || []).forEach(function (previousEgress) {
      var stillPresent = (desiredState.classifierEgress || []).some(function (egress) {
        return egress.name === previousEgress.name;
      });
      if (!stillPresent && previousEgress.name) {
        appendClassifierEgressVirtualDelete(lines, previousEgress.name);
      }
    });

    if (!((desiredState.classifierEgress || []).length)) {
      appendDataGroupApplyScript(lines, CLASSIFIER_EGRESS_SETTINGS_DG, {});
      appendClassifierEgressIRuleScript(lines, desiredState);
    }
  }

  desiredState.listeners.forEach(function (listener) {
    var virtualObject = tmshObjectName(listener.name);
    var poolObject = listener.pool_name ? tmshObjectName(listener.pool_name) : '';
    var ruleObject = listener.assigned_irule ? tmshObjectName(listener.assigned_irule) : '';
    var profilesBlock = buildVirtualProfiles(listener.server_ssl_profile);
    lines.push('if tmsh_has "^ltm virtual " list ltm virtual ' + virtualObject + '; then');
    lines.push('  tmsh modify ltm virtual ' + virtualObject + ' destination ' + listener.vip + ':' + listener.port + ' ip-protocol tcp');
    lines.push('else');
    lines.push('  tmsh create ltm virtual ' + virtualObject + ' destination ' + listener.vip + ':' + listener.port + ' ip-protocol tcp source-address-translation { type automap } translate-address enabled translate-port enabled');
    lines.push('fi');
    lines.push('tmsh modify ltm virtual ' + virtualObject + ' profiles replace-all-with { ' + profilesBlock + ' }');
    lines.push('tmsh modify ltm virtual ' + virtualObject + ' source-address-translation { type automap } translate-address enabled translate-port enabled');
    if (poolObject) {
      lines.push('tmsh_has "^ltm pool " list ltm pool ' + poolObject + ' || { echo "Missing required listener pool: ' + poolObject + '" >&2; exit 1; }');
      lines.push('tmsh modify ltm virtual ' + virtualObject + ' pool ' + poolObject);
    }
    if (ruleObject) {
      lines.push('tmsh modify ltm virtual ' + virtualObject + ' rules { ' + ruleObject + ' }');
    }
    if (listener.server_ssl_profile) {
      lines.push('tmsh modify ltm virtual ' + virtualObject + ' serverssl-use-sni enabled');
    } else {
      lines.push('tmsh modify ltm virtual ' + virtualObject + ' serverssl-use-sni disabled');
    }
    if (listener.enabled === false) {
      lines.push('tmsh modify ltm virtual ' + virtualObject + ' disabled');
    } else {
      lines.push('tmsh modify ltm virtual ' + virtualObject + ' enabled');
    }
  });

  (previousState.listeners || []).forEach(function (previousListener) {
    var stillPresent = desiredState.listeners.some(function (listener) {
      return listener.name === previousListener.name;
    });
    if (!stillPresent && previousListener.name) {
      lines.push('if tmsh_has "^ltm virtual " list ltm virtual ' + tmshObjectName(previousListener.name) + '; then tmsh delete ltm virtual ' + tmshObjectName(previousListener.name) + '; fi');
    }
  });

  appendDataGroupApplyScript(lines, '/Common/dg_ai_gateway_listener_refs', listenerRefsRecords);
  if (applyOptions.applyListenerSettingsDataGroup !== false) {
    appendDataGroupApplyScript(lines, '/Common/dg_ai_gateway_listener_settings', listenerSettingsRecords);
  }
  if (applyOptions.applyListenerVirtualKeyPoolAllowlistDataGroup !== false) {
    appendDataGroupApplyScript(lines, '/Common/dg_ai_gateway_listener_vk_pool_allowlist', listenerVirtualKeyPoolAllowlistRecords);
  }
  if (applyOptions.applyVirtualKeysDataGroup !== false) {
    appendDataGroupDiffApplyScript(lines, VIRTUAL_KEYS_DG, virtualKeyRecords, currentVirtualKeyDataGroup, {
      replaceThreshold: DATA_GROUP_DIFF_REPLACE_THRESHOLD
    });
  }
  if (applyOptions.applyVirtualKeyPoolsDataGroup !== false) {
    appendDataGroupApplyScript(lines, '/Common/dg_ai_gateway_virtual_key_pools', virtualKeyPoolRecords);
  }

  Object.keys(ifileSpecs).forEach(function (key) {
    var spec = ifileSpecs[key];

    lines.push('publish_native_file ' + shellQuote(spec.localPath) + ' ' + shellQuote(spec.publishedPath));
    lines.push('publish_plugin_store_file ' + shellQuote(spec.localPath) + ' ' + shellQuote(spec.fileName));
    lines.push('if tmsh_has "^sys file ifile " list sys file ifile ' + spec.objectName + '; then');
    lines.push('  tmsh modify sys file ifile ' + spec.objectName + ' source-path file:' + spec.publishedPath);
    lines.push('else');
    lines.push('  tmsh create sys file ifile ' + spec.objectName + ' source-path file:' + spec.publishedPath);
    lines.push('fi');
  });

  lines.push('restart_ilx_plugin');
  lines.push('tmsh save sys config');

  return lines.join('\n');
}

function writeRuntimeFiles(artifacts) {
  ensureRuntimeDir();
  writeFileAtomic(RUNTIME_NATIVE_FILES.classifiers, JSON.stringify(artifacts.ifiles.classifiers.content, null, 2), 'utf8');
  writeFileAtomic(RUNTIME_NATIVE_FILES.backend_targets, JSON.stringify(artifacts.ifiles.backend_targets.content, null, 2), 'utf8');
  if (artifacts.ifiles.provider_credential_pools) {
    writeFileAtomic(RUNTIME_NATIVE_FILES.provider_credential_pools, JSON.stringify(artifacts.ifiles.provider_credential_pools.content, null, 2), 'utf8');
  }
  writeFileAtomic(RUNTIME_NATIVE_FILES.routing_policies, JSON.stringify(artifacts.ifiles.routing_policies.content, null, 2), 'utf8');
  writeFileAtomic(RUNTIME_NATIVE_FILES.config_snapshot, JSON.stringify(artifacts.ifiles.config_snapshot.content, null, 2), 'utf8');
}

function buildNativeFileSpecs(artifacts) {
  var specs = {};

  if (artifacts.ifiles.classifiers) {
    specs.classifiers = {
      objectName: artifacts.ifiles.classifiers.name,
      localPath: RUNTIME_NATIVE_FILES.classifiers,
      publishedPath: PUBLISHED_NATIVE_FILES.classifiers,
      fileName: path.basename(PUBLISHED_NATIVE_FILES.classifiers)
    };
  }
  if (artifacts.ifiles.backend_targets) {
    specs.backend_targets = {
      objectName: artifacts.ifiles.backend_targets.name,
      localPath: RUNTIME_NATIVE_FILES.backend_targets,
      publishedPath: PUBLISHED_NATIVE_FILES.backend_targets,
      fileName: path.basename(PUBLISHED_NATIVE_FILES.backend_targets)
    };
  }
  if (artifacts.ifiles.provider_credential_pools) {
    specs.provider_credential_pools = {
      objectName: artifacts.ifiles.provider_credential_pools.name,
      localPath: RUNTIME_NATIVE_FILES.provider_credential_pools,
      publishedPath: PUBLISHED_NATIVE_FILES.provider_credential_pools,
      fileName: path.basename(PUBLISHED_NATIVE_FILES.provider_credential_pools)
    };
  }
  if (artifacts.ifiles.routing_policies) {
    specs.routing_policies = {
      objectName: artifacts.ifiles.routing_policies.name,
      localPath: RUNTIME_NATIVE_FILES.routing_policies,
      publishedPath: PUBLISHED_NATIVE_FILES.routing_policies,
      fileName: path.basename(PUBLISHED_NATIVE_FILES.routing_policies)
    };
  }
  if (artifacts.ifiles.config_snapshot) {
    specs.config_snapshot = {
      objectName: artifacts.ifiles.config_snapshot.name,
      localPath: RUNTIME_NATIVE_FILES.config_snapshot,
      publishedPath: PUBLISHED_NATIVE_FILES.config_snapshot,
      fileName: path.basename(PUBLISHED_NATIVE_FILES.config_snapshot)
    };
  }

  return specs;
}

function loadCurrentConfig() {
  return readJsonFile(DEPLOYED_CONFIG_FILE) || readJsonFile(PRESENTATION_SAMPLE_FILE) || buildEmptyConfig();
}

function canonicalizeConfigUiState(block) {
  var normalized = clone(block || {});

  normalized.activeIds = normalized.activeIds || {};
  normalized.ui = normalized.ui || {};
  normalized.ui.classifierEditorMode = normalized.activeIds.classifier ? 'edit' : 'empty';
  normalized.ui.listenerEditorMode = 'empty';
  normalized.ui.backendEditorMode = 'empty';
  normalized.ui.policyEditorMode = 'empty';

  return normalized;
}

function loadCurrentConfigWithStatus() {
  var deployedBlock = readJsonFile(DEPLOYED_CONFIG_FILE);
  var currentBlock = deployedBlock || readJsonFile(PRESENTATION_SAMPLE_FILE) || buildEmptyConfig();

  return canonicalizeConfigUiState(annotateBlockWithStatuses(currentBlock, deployedBlock));
}

function loadCurrentRuntimeHealth() {
  var deployedBlock = readJsonFile(DEPLOYED_CONFIG_FILE);
  var currentBlock = configProcessor.normalizeBlock(deployedBlock || buildEmptyConfig());
  var runtimeStatus = inspectRuntimeStatuses(currentBlock);

  return buildRuntimeHealthPayload(currentBlock, runtimeStatus);
}

function applyConfig(block) {
  var profiler = createDeployProfiler();
  var validation = profiler.measure('validate_config', function () {
    return configProcessor.validateBlock(block);
  });
  var normalizedBlock;
  var previousDeployedConfig;
  var previousConfig;
  var previousNormalized;
  var previousState;
  var desiredState;
  var deployScope;
  var poolValidation;
  var listenerDestinationValidation;
  var artifactBlock;
  var artifacts;
  var mergedListenerSettings;
  var ifileSpecs;
  var currentVirtualKeyDataGroup;
  var fullApplyObjectPlan;
  var applyScript;
  var stdout;

  if (!validation.valid) {
    return buildFailureResponse(validation.issues, profiler);
  }

  normalizedBlock = profiler.measure('normalize_block', function () {
    return configProcessor.normalizeBlock(block);
  });

  try {
    previousDeployedConfig = readJsonFile(DEPLOYED_CONFIG_FILE);
    previousConfig = previousDeployedConfig || readJsonFile(PRESENTATION_SAMPLE_FILE) || buildEmptyConfig();
    previousNormalized = configProcessor.normalizeBlock(previousConfig);
    profiler.measure('build_desired_state', function () {
      previousState = buildDesiredState(previousNormalized);
      desiredState = buildDesiredState(normalizedBlock, previousState);
      deployScope = classifyDeployScope(previousNormalized, normalizedBlock, previousState, desiredState);
      profiler.setScope(deployScope);
    });
  } catch (error) {
    return buildFailureResponse(['Unable to build BIG-IP deploy plan: ' + error.message], profiler);
  }

  if (previousDeployedConfig && deployScope && deployScope.type === 'none') {
    normalizedBlock.meta = {
      source: 'deployed',
      dirty: false
    };

    try {
      profiler.measure('write_deployed_config', function () {
        writeFileAtomic(DEPLOYED_CONFIG_FILE, JSON.stringify(normalizedBlock, null, 2), 'utf8');
      });
    } catch (error) {
      return buildFailureResponse(['Unable to write deployed config snapshot: ' + error.message], profiler);
    }

    return buildSuccessResponse(profiler.measure('skip_no_runtime_apply', function () {
      return {
        block: annotateBlockWithStatuses(normalizedBlock, normalizedBlock),
        summary: buildDeploySummary(normalizedBlock),
        output: 'No BIG-IP runtime changes detected; skipped BIG-IP apply.'
      };
    }), profiler);
  }

  try {
    poolValidation = profiler.measure('validate_pools', function () {
      return validateReferencedPools(normalizedBlock);
    });
  } catch (error) {
    return buildFailureResponse(['Unable to validate BIG-IP pool references: ' + error.message], profiler);
  }

  if (!poolValidation.valid) {
    return buildFailureResponse(poolValidation.issues, profiler);
  }

  normalizedBlock.meta = {
    source: 'deployed',
    dirty: false
  };

  try {
    listenerDestinationValidation = profiler.measure('validate_virtual_destinations', function () {
      return validateListenerVirtualDestinations(desiredState);
    });
  } catch (error) {
    return buildFailureResponse(['Unable to validate BIG-IP virtual server destinations: ' + error.message], profiler);
  }

  if (!listenerDestinationValidation.valid) {
    return buildFailureResponse(listenerDestinationValidation.issues, profiler);
  }

  try {
    artifacts = profiler.measure('build_artifacts', function () {
      artifactBlock = attachClassifierEgressToBlock(normalizedBlock, desiredState);
      return configProcessor.buildArtifacts(artifactBlock);
    });
  } catch (error) {
    return buildFailureResponse(['Unable to build deployment artifacts: ' + error.message], profiler);
  }

  mergedListenerSettings = artifacts.dataGroups.listener_settings.records;
  ifileSpecs = buildNativeFileSpecs(artifacts);
  fullApplyObjectPlan = buildFullApplyObjectPlan(previousDeployedConfig, deployScope);

  if (previousDeployedConfig && deployScope && deployScope.type === 'runtime_artifacts_only') {
    try {
      profiler.measure('write_runtime_files', function () {
        writeRuntimeFiles(artifacts);
      });
    } catch (error) {
      return buildFailureResponse(['Unable to write runtime files: ' + error.message], profiler);
    }

    try {
      applyScript = profiler.measure('build_runtime_artifacts_fast_path_script', function () {
        return buildRuntimeArtifactsFastPathApplyScript(ifileSpecs);
      });
    } catch (error) {
      return buildFailureResponse(['Unable to build BIG-IP runtime-artifacts fast path apply script: ' + error.message], profiler);
    }

    try {
      stdout = profiler.measure('run_runtime_artifacts_fast_path_apply', function () {
        return runShell(applyScript);
      });
    } catch (error) {
      return buildFailureResponse(['Deploy runtime-artifacts fast path failed: ' + extractCommandFailure(error)], profiler);
    }

    try {
      profiler.measure('write_deployed_config', function () {
        writeFileAtomic(DEPLOYED_CONFIG_FILE, JSON.stringify(normalizedBlock, null, 2), 'utf8');
      });
    } catch (error) {
      return buildFailureResponse(['Unable to write deployed config snapshot: ' + error.message], profiler);
    }

    profiler.measure('cleanup', function () {
      cleanupRuntimeHelpers();
    });

    return buildSuccessResponse({
      block: annotateBlockWithStatuses(normalizedBlock, normalizedBlock),
      summary: buildDeploySummary(normalizedBlock),
      output: stdout
    }, profiler);
  }

  if (previousDeployedConfig && deployScope && deployScope.type === 'classifier_egress') {
    try {
      profiler.measure('write_runtime_files', function () {
        writeRuntimeFiles(artifacts);
      });
    } catch (error) {
      return buildFailureResponse(['Unable to write runtime files: ' + error.message], profiler);
    }

    try {
      applyScript = profiler.measure('build_classifier_egress_fast_path_script', function () {
        return buildClassifierEgressFastPathApplyScript(desiredState, previousState, ifileSpecs);
      });
    } catch (error) {
      return buildFailureResponse(['Unable to build BIG-IP classifier-egress fast path apply script: ' + error.message], profiler);
    }

    try {
      stdout = profiler.measure('run_classifier_egress_fast_path_apply', function () {
        return runShell(applyScript);
      });
    } catch (error) {
      return buildFailureResponse(['Deploy classifier-egress fast path failed: ' + extractCommandFailure(error)], profiler);
    }

    try {
      profiler.measure('write_deployed_config', function () {
        writeFileAtomic(DEPLOYED_CONFIG_FILE, JSON.stringify(normalizedBlock, null, 2), 'utf8');
      });
    } catch (error) {
      return buildFailureResponse(['Unable to write deployed config snapshot: ' + error.message], profiler);
    }

    profiler.measure('cleanup', function () {
      cleanupRuntimeHelpers();
    });

    return buildSuccessResponse({
      block: annotateBlockWithStatuses(normalizedBlock, normalizedBlock),
      summary: buildDeploySummary(normalizedBlock),
      output: stdout
    }, profiler);
  }

  if (previousDeployedConfig && deployScope && isDataGroupFastPathScope(deployScope.type)) {
    if (scopeHasChangedSection(deployScope, 'virtual_keys')) {
      try {
        currentVirtualKeyDataGroup = profiler.measure('inspect_virtual_key_dg', function () {
          return listDataGroupRecords(VIRTUAL_KEYS_DG);
        });
      } catch (error) {
        return buildFailureResponse(['Unable to inspect current Virtual Key data group: ' + error.message], profiler);
      }
    } else {
      currentVirtualKeyDataGroup = {
        exists: false,
        records: {}
      };
    }

    try {
      applyScript = profiler.measure('build_data_group_fast_path_script', function () {
        return buildDataGroupFastPathApplyScript(
          deployScope,
          artifacts.dataGroups.listener_refs.records,
          mergedListenerSettings,
          artifacts.dataGroups.listener_virtual_key_pool_allowlist.records,
          artifacts.dataGroups.virtual_keys.records,
          artifacts.dataGroups.virtual_key_pools.records,
          currentVirtualKeyDataGroup
        );
      });
    } catch (error) {
      return buildFailureResponse(['Unable to build BIG-IP data-group fast path apply script: ' + error.message], profiler);
    }

    try {
      stdout = profiler.measure('run_data_group_fast_path_apply', function () {
        return runShell(applyScript);
      });
    } catch (error) {
      return buildFailureResponse(['Deploy data-group fast path failed: ' + extractCommandFailure(error)], profiler);
    }

    try {
      profiler.measure('write_deployed_config', function () {
        writeFileAtomic(DEPLOYED_CONFIG_FILE, JSON.stringify(normalizedBlock, null, 2), 'utf8');
      });
    } catch (error) {
      return buildFailureResponse(['Unable to write deployed config snapshot: ' + error.message], profiler);
    }

    profiler.measure('cleanup', function () {
      cleanupRuntimeHelpers();
    });

    return buildSuccessResponse({
      block: annotateBlockWithStatuses(normalizedBlock, normalizedBlock),
      summary: buildDeploySummary(normalizedBlock),
      output: stdout
    }, profiler);
  }

  if (fullApplyObjectPlan.inspectVirtualKeyDataGroup) {
    try {
      currentVirtualKeyDataGroup = profiler.measure('inspect_virtual_key_dg', function () {
        return listDataGroupRecords(VIRTUAL_KEYS_DG);
      });
    } catch (error) {
      return buildFailureResponse(['Unable to inspect current Virtual Key data group: ' + error.message], profiler);
    }
  } else {
    currentVirtualKeyDataGroup = {
      exists: false,
      records: {}
    };
  }

  try {
    profiler.measure('write_runtime_files', function () {
      writeRuntimeFiles(artifacts);
    });
  } catch (error) {
    return buildFailureResponse(['Unable to write runtime files: ' + error.message], profiler);
  }

  try {
    applyScript = profiler.measure('build_apply_script', function () {
      return buildApplyScript(
        desiredState,
        previousState,
        artifacts.dataGroups.listener_refs.records,
        mergedListenerSettings,
        artifacts.dataGroups.listener_virtual_key_pool_allowlist.records,
        artifacts.dataGroups.virtual_keys.records,
        artifacts.dataGroups.virtual_key_pools.records,
        currentVirtualKeyDataGroup,
        ifileSpecs,
        fullApplyObjectPlan
      );
    });
  } catch (error) {
    return buildFailureResponse(['Unable to build BIG-IP apply script: ' + error.message], profiler);
  }

  try {
    stdout = profiler.measure('run_apply_script', function () {
      return runShell(applyScript);
    });
  } catch (error) {
    return buildFailureResponse(['Deploy apply script failed: ' + extractCommandFailure(error)], profiler);
  }

  try {
    profiler.measure('write_deployed_config', function () {
      writeFileAtomic(DEPLOYED_CONFIG_FILE, JSON.stringify(normalizedBlock, null, 2), 'utf8');
    });
  } catch (error) {
    return buildFailureResponse(['Unable to write deployed config snapshot: ' + error.message], profiler);
  }

  profiler.measure('cleanup', function () {
    cleanupRuntimeHelpers();
  });

  return buildSuccessResponse({
    block: annotateBlockWithStatuses(normalizedBlock, normalizedBlock),
    summary: buildDeploySummary(normalizedBlock),
    output: stdout
  }, profiler);
}

module.exports = {
  APP_ROOT: APP_ROOT,
  DEPLOYED_CONFIG_FILE: DEPLOYED_CONFIG_FILE,
  RUNTIME_DIR: RUNTIME_DIR,
  loadCurrentConfig: loadCurrentConfig,
  loadCurrentConfigWithStatus: loadCurrentConfigWithStatus,
  loadCurrentRuntimeHealth: loadCurrentRuntimeHealth,
  annotateBlockWithStatuses: annotateBlockWithStatuses,
  listBigIpPools: listBigIpPools,
  validateReferencedPools: validateReferencedPools,
  applyConfig: applyConfig,
  _test: {
    DATA_GROUP_DIFF_REPLACE_THRESHOLD: DATA_GROUP_DIFF_REPLACE_THRESHOLD,
    VIRTUAL_KEYS_DG: VIRTUAL_KEYS_DG,
    VIRTUAL_KEY_USAGE_FILES: VIRTUAL_KEY_USAGE_FILES,
    PROVIDER_CREDENTIAL_RUNTIME_FILES: PROVIDER_CREDENTIAL_RUNTIME_FILES,
    readVirtualKeyUsageState: readVirtualKeyUsageState,
    readProviderCredentialRuntimeState: readProviderCredentialRuntimeState,
    buildRuntimeHealthPayload: buildRuntimeHealthPayload,
    createDeployProfiler: createDeployProfiler,
    buildRecordsBlock: buildRecordsBlock,
    writeFileAtomic: writeFileAtomic,
    buildScopeSectionSummary: buildScopeSectionSummary,
    buildListenerAuthScopeMap: buildListenerAuthScopeMap,
    buildListenerSettingsScopeMap: buildListenerSettingsScopeMap,
    buildListenerLtmScopeMap: buildListenerLtmScopeMap,
    buildClassifierEgressScopeMap: buildClassifierEgressScopeMap,
    buildUnknownScopeMap: buildUnknownScopeMap,
    buildDesiredState: buildDesiredState,
    buildApplyScript: buildApplyScript,
    classifyDeployScope: classifyDeployScope,
    diffDataGroupRecords: diffDataGroupRecords,
    appendDataGroupDiffApplyScript: appendDataGroupDiffApplyScript,
    buildDataGroupFastPathApplyScript: buildDataGroupFastPathApplyScript,
    buildRuntimeArtifactsFastPathApplyScript: buildRuntimeArtifactsFastPathApplyScript,
    buildNativeFileSpecs: buildNativeFileSpecs,
    isDataGroupFastPathScope: isDataGroupFastPathScope
  }
};
