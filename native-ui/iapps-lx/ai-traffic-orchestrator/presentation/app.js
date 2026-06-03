(function () {
  'use strict';

  var STORAGE_KEY = 'ai-traffic-orchestrator-native-ui-draft';
  var STALE_STORAGE_PREFIX = 'ai-traffic-orchestrator-native-ui-stale-draft-';
  var LOCAL_DRAFT_SCHEMA_VERSION = 8;
  var PAGE_STORAGE_KEY = 'ai-traffic-orchestrator-native-ui-page-v2';
  var CONFIG_URL = '/mgmt/iapps/AITrafficOrchestrator/config';
  var STATUS_URL = '/mgmt/iapps/AITrafficOrchestrator/status';
  var POOLS_URL = '/mgmt/iapps/AITrafficOrchestrator/pools';
  var DEPLOY_URL = '/mgmt/iapps/AITrafficOrchestrator/deploy';
  var TEST_CLASSIFIER_URL = '/mgmt/iapps/AITrafficOrchestrator/test-classifier';
  var TEST_BACKEND_URL = '/mgmt/iapps/AITrafficOrchestrator/test-backend';
  var STATUS_POLL_INTERVAL_MS = 30000;
  var PROBE_RESULT_RESET_DELAY_MS = 3000;
  var MANAGED_SERVER_SSL_PROFILE = '/Common/aito_managed_serverssl';
  var DEEPSEEK_CLASSIFIER_MIN_MAX_TOKENS = 128;
  var DEFAULT_NLI_HYPOTHESIS_TEMPLATE = 'This text is about {}.';
  var SAMPLE_URL = './data/sample-config.json';
  var sampleState = null;
  var state = null;
  var runtimeStatusState = {
    listeners: {},
    backendTargets: {},
    classifiers: {},
    providerCredentialPools: {},
    virtualKeys: {},
    loading: false,
    lastUpdatedAt: 0
  };
  var poolCatalogState = {
    pools: [],
    loading: false,
    loaded: false,
    lastUpdatedAt: 0,
    error: ''
  };
  var statusPollTimer = 0;
  var pendingListenerDraft = null;
  var pendingListenerDraftId = '';
  var pendingListenerValidationActive = false;
  var pendingBackendDraft = null;
  var pendingBackendDraftId = '';
  var pendingBackendCredentialSource = '';
  var pendingBackendValidationActive = false;
  var listenerSelection = {};
  var listenerSearchTerm = '';
  var listenerPage = 1;
  var backendSelection = {};
  var backendSearchTerm = '';
  var backendPage = 1;
  var pendingClassifierDraft = null;
  var pendingClassifierDraftId = '';
  var pendingClassifierValidationActive = false;
  var classifierFormHydrationGuardUntil = 0;
  var classifierFormUserInteracted = false;
  var classifierFormHydrationRestoreTimer = 0;
  var pendingPolicyDraft = null;
  var pendingPolicyDraftId = '';
  var pendingPolicyValidationActive = false;
  var policySelection = {};
  var policySearchTerm = '';
  var policyPage = 1;
  var commitFeedbackTimers = {};
  var LISTENER_REQUIRED_FIELDS = [
    { id: 'listener_virtual_service', key: 'virtual_service', label: 'Virtual Service' },
    { id: 'listener_vip', key: 'vip', label: 'VIP' },
    { id: 'listener_port', key: 'port', label: 'Port' },
    { id: 'listener_policy_ref', key: 'policy_ref', label: 'Assigned Policy' }
  ];
  var BACKEND_REQUIRED_FIELDS = [
    { id: 'backend_name', key: 'backend_target_name', label: 'Backend Name' },
    { id: 'backend_endpoint', key: 'endpoint_url', label: 'Endpoint URL' },
    { id: 'backend_model', key: 'model_id', label: 'Model ID' },
    { id: 'backend_pool', key: 'pool_name', label: 'Referenced BIG-IP Pool' }
  ];
  var BACKEND_INLINE_API_KEY_FIELD = { id: 'backend_api_key', key: 'api_key', label: 'API Key' };
  var BACKEND_CREDENTIAL_POOL_FIELD = { id: 'backend_credential_pool_ref', key: 'credential_pool_ref', label: 'Credential Pool' };
  var CLASSIFIER_REQUIRED_FIELDS = [
    { id: 'classifier_name', key: 'classifier_name', label: 'Classifier Name' },
    { id: 'classifier_type', key: 'classifier_type', label: 'Classifier Type' },
    { id: 'classifier_schema', key: 'schema_family', label: 'Schema Family' },
    { id: 'classifier_endpoint', key: 'endpoint_url', label: 'Endpoint URL' },
    { id: 'classifier_api_key', key: 'api_key', label: 'API Key' },
    { id: 'classifier_pool', key: 'pool_name', label: 'Referenced BIG-IP Pool' },
    { id: 'classifier_tags', key: 'candidate_tags', label: 'Candidate Tags' }
  ];
  var CLASSIFIER_LLM_REQUIRED_FIELDS = [
    { id: 'classifier_model', key: 'model_id', label: 'Model ID' },
    { id: 'classifier_prompt', key: 'classifier_prompt', label: 'Classifier Prompt' }
  ];
  var CLASSIFIER_NLI_REQUIRED_FIELDS = [
    { id: 'classifier_hypothesis', key: 'hypothesis_template', label: 'Hypothesis Template' }
  ];
  var POLICY_REQUIRED_FIELDS = [
    { id: 'policy_type', key: 'policy_type', label: 'Policy Type' },
    { id: 'policy_name', key: 'policy_name', label: 'Policy Name' },
    { id: 'policy_routing_mode', key: 'routing_mode', label: 'Routing Mode' }
  ];
  var POLICY_ROUTING_MODES = {
    classifier_only: true,
    key_only: true,
    key_then_classifier: true
  };
  var backendProbeState = {
    status: 'idle',
    loading: false,
    message: '',
    validationActive: false,
    resetTimer: 0
  };
  var classifierProbeState = {
    status: 'idle',
    loading: false,
    message: '',
    validationActive: false,
    resetTimer: 0
  };
  var transientVirtualKeySecrets = {};
  var virtualKeyRevealState = {};
  var virtualKeyCopyState = {};
  var virtualKeyCopyFeedbackTimers = {};
  var pendingVirtualKeyPoolDraft = null;
  var pendingVirtualKeyPoolDraftId = '';
  var pendingVirtualKeyPoolValidationActive = false;
  var pendingVirtualKeyDraft = null;
  var pendingVirtualKeyDraftId = '';
  var pendingVirtualKeyValidationActive = false;
  var virtualKeyPoolSelection = {};
  var virtualKeySelection = {};
  var activeVirtualKeyPoolFilters = [];
  var virtualKeyPoolSearchTerm = '';
  var virtualKeySearchTerm = '';
  var listenerPoolSearchState = {
    selected: '',
    available: ''
  };
  var virtualKeyPoolPage = 1;
  var virtualKeyPage = 1;
  var virtualKeyPaneWidthPx = 420;
  var virtualKeyPaneDragState = null;
  var pendingModelCredentialPoolDraft = null;
  var pendingModelCredentialPoolDraftId = '';
  var pendingModelCredentialPoolValidationActive = false;
  var pendingModelCredentialDraft = null;
  var pendingModelCredentialDraftId = '';
  var pendingModelCredentialValidationActive = false;
  var modelCredentialPoolSelection = {};
  var modelCredentialSelection = {};
  var activeModelCredentialPoolFilters = [];
  var modelCredentialPoolSearchTerm = '';
  var modelCredentialSearchTerm = '';
  var modelCredentialPoolPage = 1;
  var modelCredentialPage = 1;
  var modelCredentialPaneWidthPx = 420;
  var modelCredentialPaneDragState = null;
  var VIRTUAL_KEY_STACK_BREAKPOINT = 1120;
  var VIRTUAL_KEY_PAGE_SIZE = 25;
  var CLASSIFIER_FORM_HYDRATION_GUARD_MS = 2000;
  var BLANK_COLLAPSE_POINTER_WINDOW_MS = 5000;
  var VIRTUAL_KEY_POOL_NAME_PATTERN = /^[A-Za-z0-9_. -]+$/;
  var VIRTUAL_KEY_TAG_PATTERN = /^[A-Za-z0-9_-]+$/;
  var PROVIDER_CREDENTIAL_POOL_NAME_PATTERN = /^[A-Za-z0-9_. -]+$/;
  var lastPointerDownTarget = null;
  var lastPointerDownPage = '';
  var lastPointerDownAt = 0;

  function byId(id) {
    return document.getElementById(id);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value || {}));
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

  function resetCommitButton(button) {
    if (!button) {
      return;
    }
    button.textContent = 'Commit';
    button.classList.remove('is-done');
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }

  function showCommitDone(buttonId) {
    var button = byId(buttonId);

    if (!button) {
      return;
    }

    if (commitFeedbackTimers[buttonId]) {
      window.clearTimeout(commitFeedbackTimers[buttonId]);
    }

    button.textContent = 'Done';
    button.classList.add('is-done');
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');

    commitFeedbackTimers[buttonId] = window.setTimeout(function () {
      var currentButton = byId(buttonId);
      if (currentButton) {
        resetCommitButton(currentButton);
      }
      delete commitFeedbackTimers[buttonId];
    }, 2000);
  }

  function deepEqual(left, right) {
    return stableStringify(left) === stableStringify(right);
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

  function parseJson(text) {
    return JSON.parse(text);
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

    try {
      if (window.TextDecoder && window.Uint8Array) {
        decoded = new window.TextDecoder('utf-8', { fatal: true }).decode(new window.Uint8Array(bytes));
      } else {
        decoded = decodeURIComponent(escape(text));
      }
    } catch (error) {
      return value;
    }

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

  function base64EncodeUtf8(text) {
    var bytes;
    var binary = '';
    var index;
    var chunk;

    if (window.TextEncoder && window.Uint8Array) {
      bytes = new window.TextEncoder().encode(text);
      for (index = 0; index < bytes.length; index += 0x8000) {
        chunk = bytes.subarray(index, index + 0x8000);
        binary += String.fromCharCode.apply(null, chunk);
      }
      return window.btoa(binary);
    }

    return window.btoa(unescape(encodeURIComponent(text)));
  }

  function buildUtf8JsonRequestBody(payload) {
    return JSON.stringify({
      encoding: 'base64-json-v1',
      payload: base64EncodeUtf8(JSON.stringify(payload))
    });
  }

  function buildDeployRequestBody() {
    return buildUtf8JsonRequestBody(normalizeLoadedState(state));
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeConfigStatus(value, fallback) {
    var status = String(value || fallback || '').toLowerCase();

    if (status === 'draft_local' || status === 'draft') {
      return 'draft_local';
    }
    if (status === 'deployed_synced' || status === 'active' || status === 'synced') {
      return 'deployed_synced';
    }

    return fallback || 'deployed_synced';
  }

  function normalizeHealthStatus(value, fallback) {
    var status = String(value || fallback || '').toLowerCase();

    if (status === 'healthy' || status === 'ok' || status === 'active') {
      return 'healthy';
    }
    if (status === 'problem' || status === 'warn' || status === 'warning' || status === 'error' || status === 'unhealthy') {
      return 'problem';
    }
    if (status === 'disabled' || status === 'down') {
      return 'disabled';
    }
    if (status === 'unknown' || status === 'inactive' || status === 'pending') {
      return 'unknown';
    }

    return fallback || 'unknown';
  }

  function getConfigStatusMeta(value) {
    var status = normalizeConfigStatus(value, 'deployed_synced');

    return {
      value: status,
      shortLabel: 'C',
      label: status === 'draft_local' ? 'Draft Local' : 'Deployed Synced',
      tone: status === 'draft_local' ? 'draft-local' : 'deployed-synced'
    };
  }

  function getHealthStatusMeta(value) {
    var status = normalizeHealthStatus(value, 'unknown');
    var labels = {
      healthy: 'Healthy',
      problem: 'Problem',
      disabled: 'Disabled',
      unknown: 'Unknown'
    };

    return {
      value: status,
      shortLabel: 'H',
      label: labels[status] || 'Unknown',
      tone: status
    };
  }

  function sanitizeListenerForConfigComparison(listener) {
    var sanitized = clone(listener);

    delete sanitized.status;
    delete sanitized.config_status;
    delete sanitized.configStatus;
    delete sanitized.health_status;
    delete sanitized.healthStatus;
    delete sanitized.runtime_status;
    delete sanitized.runtimeStatus;

    return sanitized;
  }

  function sanitizeMemberForConfigComparison(member) {
    var sanitized = clone(member);

    delete sanitized.health;
    delete sanitized.health_status;
    delete sanitized.healthStatus;
    delete sanitized.runtime_status;
    delete sanitized.runtimeStatus;
    delete sanitized.config_status;
    delete sanitized.configStatus;

    return sanitized;
  }

  function sanitizeBackendForConfigComparison(backend) {
    var sanitized = clone(backend);

    sanitized.schema_family = normalizeBackendSchemaFamily(sanitized.schema_family || sanitized.schemaFamily);
    sanitized.pool_name = normalizePoolReference(sanitized.pool_name || sanitized.poolName || '');
    sanitized.credential_pool_ref = normalizeComparisonString(sanitized.credential_pool_ref || sanitized.credentialPoolRef || '');
    delete sanitized.poolName;
    delete sanitized.schemaFamily;
    delete sanitized.credentialPoolRef;
    delete sanitized.status;
    delete sanitized.health_status;
    delete sanitized.healthStatus;
    delete sanitized.runtime_status;
    delete sanitized.runtimeStatus;
    delete sanitized.config_status;
    delete sanitized.configStatus;
    delete sanitized.api_key_env;
    delete sanitized.apiKeyEnv;
    delete sanitized.secret_ref;
    delete sanitized.secretRef;
    delete sanitized.advanced;
    delete sanitized.members;

    return sanitized;
  }

  function sanitizeProviderCredentialEntryForConfigComparison(entry) {
    var sanitized = clone(entry);

    delete sanitized.status;
    delete sanitized.runtime_state;
    delete sanitized.runtimeState;
    delete sanitized.last_failure_reason;
    delete sanitized.lastFailureReason;
    delete sanitized.last_failure_at;
    delete sanitized.lastFailureAt;
    delete sanitized.status_code;
    delete sanitized.statusCode;
    delete sanitized.retry_after;
    delete sanitized.retryAfter;
    delete sanitized.cooldown_until;
    delete sanitized.cooldownUntil;
    delete sanitized.cooldown_until_epoch;
    delete sanitized.cooldownUntilEpoch;
    delete sanitized.fallback_count;
    delete sanitized.fallbackCount;
    delete sanitized.last_fallback_at;
    delete sanitized.lastFallbackAt;
    delete sanitized.updated_at;
    delete sanitized.updatedAt;

    return sanitized;
  }

  function sanitizeProviderCredentialPoolForConfigComparison(pool) {
    var sanitized = clone(pool);

    sanitized.entries = Array.isArray(sanitized.entries)
      ? sanitized.entries.map(sanitizeProviderCredentialEntryForConfigComparison)
      : [];

    return sanitized;
  }

  function sanitizeRecordForConfigComparison(record) {
    var sanitized = clone(record);

    delete sanitized.status;
    delete sanitized.config_status;
    delete sanitized.configStatus;
    delete sanitized.health_status;
    delete sanitized.healthStatus;
    delete sanitized.runtime_status;
    delete sanitized.runtimeStatus;
    delete sanitized.api_key_env;
    delete sanitized.apiKeyEnv;
    delete sanitized.secret_ref;
    delete sanitized.secretRef;

    return sanitized;
  }

  function normalizeRoutingMode(value) {
    var normalized = String(value || '').trim().toLowerCase().replace(/-/g, '_');

    return POLICY_ROUTING_MODES[normalized] ? normalized : 'classifier_only';
  }

  function normalizePolicyStageAction(value) {
    return String(value || '').trim().toLowerCase() === 'respond' ? 'respond' : 'route';
  }

  function normalizePolicyKeyAction(value) {
    var normalized = String(value || '').trim().toLowerCase();

    if (normalized === 'respond' || normalized === 'classify') {
      return normalized;
    }

    return 'route';
  }

  function isPolicyKeyActionAllowed(policy, action) {
    return !(normalizeRoutingMode(policy && policy.routing_mode) === 'key_only' && action === 'classify');
  }

  function normalizePolicyDefaultRule(rule) {
    var normalized = clone(rule || {});
    var backendTargetRef;
    var responseMessage;

    backendTargetRef = normalizeComparisonString(normalized.backend_target_ref || normalized.backendTargetRef);
    responseMessage = normalizeComparisonString(normalized.response_message || normalized.responseMessage);

    if (backendTargetRef) {
      responseMessage = '';
    } else if (responseMessage) {
      backendTargetRef = '';
    }

    return {
      action: backendTargetRef ? 'route' : (responseMessage ? 'respond' : normalizePolicyStageAction(normalized.action)),
      backend_target_ref: backendTargetRef,
      response_message: responseMessage
    };
  }

  function normalizePolicyTagRule(rule, index) {
    var normalized = clone(rule || {});
    var action = normalizePolicyStageAction(normalized.action);
    var backendTargetRef = normalizeComparisonString(normalized.backend_target_ref || normalized.backendTargetRef);
    var responseMessage = normalizeComparisonString(normalized.response_message || normalized.responseMessage);

    if (action === 'respond') {
      backendTargetRef = '';
    } else {
      responseMessage = '';
    }

    return {
      rule_name: normalizeComparisonString(normalized.rule_name || normalized.ruleName || ('rule_' + (index + 1))),
      source_tag: normalizeComparisonString(normalized.source_tag || normalized.sourceTag),
      action: action,
      backend_target_ref: backendTargetRef,
      response_message: responseMessage,
      enabled: normalized.enabled !== undefined ? normalizeComparisonBoolean(normalized.enabled) : true
    };
  }

  function normalizePolicyKeySourceMatch(match) {
    var normalized = {
      virtual_key_pool_ref: normalizeComparisonString(match && match.virtual_key_pool_ref),
      virtual_key_ref: normalizeComparisonString(match && match.virtual_key_ref),
      virtual_key_tag: normalizeComparisonString(match && match.virtual_key_tag)
    };

    if (normalized.virtual_key_ref) {
      normalized.virtual_key_pool_ref = '';
      normalized.virtual_key_tag = '';
    } else if (normalized.virtual_key_tag) {
      normalized.virtual_key_pool_ref = '';
    }

    return normalized;
  }

  function normalizePolicyKeyRule(rule, index, options) {
    var normalized = clone(rule || {});
    var match = normalized.match || {};
    var action = normalizePolicyKeyAction(normalized.action);
    var backendTargetRef = normalizeComparisonString(normalized.backend_target_ref || normalized.backendTargetRef);
    var responseMessage = normalizeComparisonString(normalized.response_message || normalized.responseMessage);
    var classifierRef = normalizeComparisonString(normalized.classifier_ref || normalized.classifierRef);
    var normalizedMatch;
    var normalizedRule;

    if (action === 'route') {
      responseMessage = '';
      classifierRef = '';
    } else if (action === 'respond') {
      backendTargetRef = '';
      classifierRef = '';
    } else {
      backendTargetRef = '';
      responseMessage = '';
    }

    normalizedMatch = normalizePolicyKeySourceMatch({
      virtual_key_pool_ref: normalizeComparisonString(match.virtual_key_pool_ref || match.virtualKeyPoolRef || normalized.virtual_key_pool_ref || normalized.virtualKeyPoolRef),
      virtual_key_ref: normalizeComparisonString(match.virtual_key_ref || match.virtualKeyRef || normalized.virtual_key_ref || normalized.virtualKeyRef),
      virtual_key_tag: normalizeComparisonString(match.virtual_key_tag || match.virtualKeyTag || normalized.virtual_key_tag || normalized.virtualKeyTag)
    });

    normalizedRule = {
      rule_name: normalizeComparisonString(normalized.rule_name || normalized.ruleName || ('key_rule_' + (index + 1))),
      enabled: normalized.enabled !== undefined ? normalizeComparisonBoolean(normalized.enabled) : true,
      match: normalizedMatch,
      action: action,
      backend_target_ref: backendTargetRef,
      response_message: responseMessage,
      classifier_ref: classifierRef
    };

    if (options && options.preserveUiSourceType === true) {
      normalizedRule.ui_source_type = getPolicyKeyRuleSourceType(normalized, normalizedMatch);
    }

    return normalizedRule;
  }

  function normalizePolicyRecord(policy, defaultClassifierRef, options) {
    var normalized = sanitizeRecordForConfigComparison(policy || {});
    var keyRuleNormalizeOptions = options && options.preserveUiSourceType === true
      ? { preserveUiSourceType: true }
      : null;

    normalized.policy_type = normalizeComparisonString(normalized.policy_type || 'routing');
    normalized.policy_name = normalizeComparisonString(normalized.policy_name);
    normalized.routing_mode = normalizeRoutingMode(normalized.routing_mode || normalized.routingMode);
    normalized.classifier_ref = normalized.routing_mode === 'key_only'
      ? ''
      : normalizeComparisonString(normalized.classifier_ref || normalized.classifierRef || defaultClassifierRef || '');
    normalized.fallback_backend_target_ref = normalizeComparisonString(normalized.fallback_backend_target_ref || normalized.fallbackBackendTargetRef);
    normalized.default_rule = normalizePolicyDefaultRule(normalized.default_rule || normalized.defaultRule);
    normalized.rules = Array.isArray(normalized.rules) ? normalized.rules.map(normalizePolicyTagRule) : [];
    normalized.key_rules = Array.isArray(normalized.key_rules)
      ? normalized.key_rules.map(function (rule, index) {
        return normalizePolicyKeyRule(rule, index, keyRuleNormalizeOptions);
      })
      : (Array.isArray(normalized.keyRules) ? normalized.keyRules.map(function (rule, index) {
        return normalizePolicyKeyRule(rule, index, keyRuleNormalizeOptions);
      }) : []);
    delete normalized.routingMode;
    delete normalized.classifierRef;
    delete normalized.fallbackBackendTargetRef;
    delete normalized.defaultRule;
    delete normalized.keyRules;

    return normalized;
  }

  function sanitizePolicyForConfigComparison(policy) {
    return normalizePolicyRecord(policy, '');
  }

  function normalizeComparisonString(value) {
    return value == null ? '' : String(value);
  }

  function normalizeSearchTerm(value) {
    return normalizeComparisonString(value).trim().toLowerCase();
  }

  function normalizeComparisonNumber(value) {
    var numberValue = Number(value);

    return isFinite(numberValue) ? numberValue : 0;
  }

  function normalizeComparisonBoolean(value) {
    if (value === true || value === false) {
      return value;
    }
    if (typeof value === 'string') {
      value = value.trim().toLowerCase();
      if (!value || value === 'false' || value === '0' || value === 'off' || value === 'no') {
        return false;
      }
      if (value === 'true' || value === '1' || value === 'on' || value === 'yes') {
        return true;
      }
    }

    return Boolean(value);
  }

  function sanitizeClassifierForConfigComparison(record) {
    var sanitized = sanitizeRecordForConfigComparison(record);

    sanitized.classifier_name = normalizeComparisonString(sanitized.classifier_name);
    sanitized.classifier_type = sanitized.classifier_type || 'classifier_llm';
    sanitized.schema_family = normalizeClassifierSchemaFamily(sanitized.classifier_type, sanitized.schema_family);
    sanitized.endpoint_url = normalizeComparisonString(sanitized.endpoint_url);
    sanitized.pool_name = normalizePoolReference(sanitized.pool_name || sanitized.poolName || '');
    delete sanitized.poolName;
    sanitized.model_id = normalizeComparisonString(sanitized.model_id);
    sanitized.temperature = normalizeComparisonNumber(sanitized.temperature);
    sanitized.max_tokens = normalizeComparisonNumber(sanitized.max_tokens);
    sanitized.classifier_prompt = normalizeComparisonString(sanitized.classifier_prompt);
    sanitized.timeout_ms = normalizeComparisonNumber(sanitized.timeout_ms);
    sanitized.min_confidence = normalizeComparisonNumber(sanitized.min_confidence);
    sanitized.multi_label = normalizeComparisonBoolean(sanitized.multi_label);
    sanitized.hypothesis_template = normalizeComparisonString(sanitized.hypothesis_template);
    sanitized.min_margin = normalizeComparisonNumber(sanitized.min_margin);
    sanitized.bypass_enabled = normalizeComparisonBoolean(sanitized.bypass_enabled);
    sanitized.use_built_in_rules_first = normalizeComparisonBoolean(sanitized.use_built_in_rules_first);
    syncClassifierCandidateTags(sanitized);
    ensureClassifierFallbackTag(sanitized);

    return sanitized;
  }

  function sanitizeVirtualKeyPoolForConfigComparison(pool) {
    var sanitized = clone(pool);

    delete sanitized.default_limits;
    delete sanitized.defaultLimits;

    return sanitized;
  }

  function sanitizeVirtualKeyForConfigComparison(virtualKey) {
    var sanitized = clone(virtualKey);

    delete sanitized.secret;
    delete sanitized.plaintext_secret;
    delete sanitized.plaintextSecret;
    delete sanitized.limits;

    return sanitized;
  }

  function sanitizeBlockForConfigComparison(block) {
    var sanitized = clone(block);

    delete sanitized.activeIds;
    delete sanitized.activePage;
    delete sanitized.meta;
    delete sanitized.ui;

    sanitized.listeners = sanitized.listeners || {};
    sanitized.classifiers = sanitized.classifiers || {};
    sanitized.backendTargets = sanitized.backendTargets || {};
    sanitized.providerCredentialPools = sanitized.providerCredentialPools || {};
    sanitized.routingPolicies = sanitized.routingPolicies || {};
    sanitized.virtualKeyPools = sanitized.virtualKeyPools || {};
    sanitized.virtualKeys = sanitized.virtualKeys || {};

    Object.keys(sanitized.listeners).forEach(function (listenerId) {
      sanitized.listeners[listenerId] = sanitizeListenerForConfigComparison(sanitized.listeners[listenerId]);
    });

    Object.keys(sanitized.classifiers).forEach(function (classifierId) {
      sanitized.classifiers[classifierId] = sanitizeClassifierForConfigComparison(sanitized.classifiers[classifierId]);
    });

    Object.keys(sanitized.backendTargets).forEach(function (backendId) {
      sanitized.backendTargets[backendId] = sanitizeBackendForConfigComparison(sanitized.backendTargets[backendId]);
    });

    Object.keys(sanitized.providerCredentialPools).forEach(function (poolId) {
      sanitized.providerCredentialPools[poolId] = sanitizeProviderCredentialPoolForConfigComparison(sanitized.providerCredentialPools[poolId]);
    });

    Object.keys(sanitized.routingPolicies).forEach(function (policyId) {
      sanitized.routingPolicies[policyId] = sanitizePolicyForConfigComparison(sanitized.routingPolicies[policyId]);
    });

    Object.keys(sanitized.virtualKeyPools).forEach(function (poolId) {
      sanitized.virtualKeyPools[poolId] = sanitizeVirtualKeyPoolForConfigComparison(sanitized.virtualKeyPools[poolId]);
    });

    Object.keys(sanitized.virtualKeys).forEach(function (keyId) {
      sanitized.virtualKeys[keyId] = sanitizeVirtualKeyForConfigComparison(sanitized.virtualKeys[keyId]);
    });

    return sanitized;
  }

  function getConfigFingerprint(block) {
    return stableStringify(sanitizeBlockForConfigComparison(block || {}));
  }

  function buildStoredDraftEnvelope(draft) {
    return {
      version: LOCAL_DRAFT_SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      baseFingerprint: sampleState ? getConfigFingerprint(sampleState) : '',
      draft: draft
    };
  }

  function persistCurrentDraftToLocalStorage() {
    if (!state || !window.localStorage) {
      return;
    }

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(buildStoredDraftEnvelope(normalizeLoadedState(state)), null, 2));
    } catch (error) {
      // Local draft persistence is best-effort. Deploy remains the authoritative apply path.
    }
  }

  function parseStoredDraft(raw) {
    var parsed = parseJson(raw);

    if (parsed && parsed.draft && typeof parsed.version !== 'undefined') {
      return parsed;
    }

    return {
      version: 1,
      legacy: true,
      baseFingerprint: '',
      draft: parsed
    };
  }

  function isStoredDraftSchemaCurrent(envelope) {
    return !!envelope && Number(envelope.version) === LOCAL_DRAFT_SCHEMA_VERSION;
  }

  function archiveStoredDraft(raw) {
    try {
      window.localStorage.setItem(STALE_STORAGE_PREFIX + Date.now(), raw);
    } catch (error) {
      // Best-effort only. The active stale draft must still be removed.
    }
    window.localStorage.removeItem(STORAGE_KEY);
  }

  function isStoredDraftCurrent(envelope, draft) {
    var deployedFingerprint;

    if (!sampleState) {
      return true;
    }

    deployedFingerprint = getConfigFingerprint(sampleState);
    if (envelope && envelope.baseFingerprint) {
      return envelope.baseFingerprint === deployedFingerprint;
    }

    return deepEqual(
      sanitizeBlockForConfigComparison(draft),
      sanitizeBlockForConfigComparison(sampleState)
    );
  }

  function getGlobalConfigStatus() {
    if (!state || !sampleState) {
      return state && state.meta && state.meta.dirty ? 'draft_local' : 'deployed_synced';
    }

    if (state.meta && state.meta.source === 'deployed' && !state.meta.dirty) {
      return 'deployed_synced';
    }

    return deepEqual(
      sanitizeBlockForConfigComparison(state),
      sanitizeBlockForConfigComparison(sampleState)
    ) ? 'deployed_synced' : 'draft_local';
  }

  function getDeployedListener(listenerId) {
    return sampleState && sampleState.listeners ? sampleState.listeners[listenerId] : null;
  }

  function getDeployedBackend(backendId) {
    return sampleState && sampleState.backendTargets ? sampleState.backendTargets[backendId] : null;
  }

  function normalizeStatusPayload(data) {
    var normalized = clone(data);

    normalized.listeners = normalized && normalized.listeners ? normalized.listeners : {};
    normalized.backendTargets = normalized && normalized.backendTargets ? normalized.backendTargets : {};
    normalized.classifiers = normalized && normalized.classifiers ? normalized.classifiers : {};
    normalized.providerCredentialPools = normalized && normalized.providerCredentialPools ? normalized.providerCredentialPools : {};
    normalized.virtualKeys = normalized && normalized.virtualKeys ? normalized.virtualKeys : {};

    return normalized;
  }

  function getStatusResponsePayload(payload) {
    if (payload && payload.block) {
      return payload.block;
    }
    if (payload && payload.status) {
      return payload.status;
    }
    return payload || {};
  }

  function mergeRuntimeView(baseValue, runtimeValue, preserveMembers) {
    var merged = clone(baseValue);

    if (!runtimeValue) {
      return merged;
    }

    Object.keys(runtimeValue).forEach(function (key) {
      if (key === 'members' && !preserveMembers) {
        return;
      }

      if (key === 'advanced' && runtimeValue.advanced && typeof runtimeValue.advanced === 'object') {
        merged.advanced = merged.advanced || {};
        Object.keys(runtimeValue.advanced).forEach(function (advancedKey) {
          merged.advanced[advancedKey] = clone(runtimeValue.advanced[advancedKey]);
        });
        return;
      }

      merged[key] = clone(runtimeValue[key]);
    });

    return merged;
  }

  function getRuntimeListener(listenerId) {
    return runtimeStatusState.listeners[listenerId] || null;
  }

  function getRuntimeBackend(backendId) {
    return runtimeStatusState.backendTargets[backendId] || null;
  }

  function getRuntimeClassifier(classifierId) {
    return runtimeStatusState.classifiers[classifierId] || null;
  }

  function getRuntimeProviderCredential(poolRef, credentialId) {
    var pool = poolRef && runtimeStatusState.providerCredentialPools ? runtimeStatusState.providerCredentialPools[poolRef] : null;
    var credentials = pool && pool.credentials ? pool.credentials : {};

    return credentialId ? credentials[credentialId] || null : null;
  }

  function getRuntimeVirtualKey(keyId, virtualKey) {
    var kid = virtualKey && virtualKey.kid ? virtualKey.kid : '';

    return (runtimeStatusState.virtualKeys && (
      runtimeStatusState.virtualKeys[keyId] ||
      (kid ? runtimeStatusState.virtualKeys[kid] : null)
    )) || null;
  }

  function getVirtualKeyLastUsedAt(keyId, virtualKey) {
    var runtimeVirtualKey = getRuntimeVirtualKey(keyId, virtualKey);
    var runtimeLastUsed = runtimeVirtualKey && runtimeVirtualKey.last_used_at;

    return runtimeLastUsed || (virtualKey && virtualKey.last_used_at) || '';
  }

  function getRuntimeListenerView(listenerId, listener) {
    return mergeRuntimeView(listener, getRuntimeListener(listenerId), false);
  }

  function getRuntimeBackendView(backendId, backend) {
    return mergeRuntimeView(backend, getRuntimeBackend(backendId), false);
  }

  function getRuntimeBackendMembers(backendId) {
    var runtimeBackend = getRuntimeBackend(backendId);

    return runtimeBackend && Array.isArray(runtimeBackend.members) ? runtimeBackend.members : [];
  }

  function getRuntimeClassifierMembers(classifierId) {
    var runtimeClassifier = getRuntimeClassifier(classifierId);

    return runtimeClassifier && Array.isArray(runtimeClassifier.members) ? runtimeClassifier.members : [];
  }

  function getConfigStatusForListener(listenerId, listener, editorMode) {
    var deployedListener;

    if (editorMode === 'create') {
      return 'draft_local';
    }

    deployedListener = getDeployedListener(listenerId);
    if (!deployedListener) {
      return 'draft_local';
    }

    return deepEqual(
      sanitizeListenerForConfigComparison(listener),
      sanitizeListenerForConfigComparison(deployedListener)
    ) ? 'deployed_synced' : 'draft_local';
  }

  function getConfigStatusForMember(backendId, member) {
    // Backend targets reference existing BIG-IP pools; pool members are runtime-only.
    return 'deployed_synced';
  }

  function getConfigStatusForBackend(backendId, backend, editorMode) {
    var deployedBackend;

    if (editorMode === 'create') {
      return 'draft_local';
    }

    deployedBackend = getDeployedBackend(backendId);
    if (!deployedBackend) {
      return 'draft_local';
    }

    return deepEqual(
      sanitizeBackendForConfigComparison(backend),
      sanitizeBackendForConfigComparison(deployedBackend)
    ) ? 'deployed_synced' : 'draft_local';
  }

  function getListenerStatusModel(listenerId, listener, editorMode) {
    var runtimeListener = getRuntimeListenerView(listenerId, listener);
    var status = (runtimeListener && runtimeListener.status) || {};
    var configValue = getConfigStatusForListener(listenerId, listener, editorMode);
    var healthValue = firstDefined([
      status.health_status,
      runtimeListener && runtimeListener.health_status,
      status.runtime_status,
      runtimeListener && runtimeListener.runtime_status,
      status.health,
      runtimeListener && runtimeListener.health
    ]);

    if (editorMode === 'create') {
      configValue = 'draft_local';
      healthValue = 'unknown';
    }

    return {
      config: getConfigStatusMeta(normalizeConfigStatus(configValue, 'deployed_synced')),
      health: getHealthStatusMeta(normalizeHealthStatus(healthValue, status.status === 'active' ? 'healthy' : 'unknown'))
    };
  }

  function getMemberStatusModel(backendId, member) {
    var memberHealth = firstDefined([
      member && member.health_status,
      member && member.healthStatus,
      member && member.health,
      member && member.status && member.status.health_status,
      member && member.status && member.status.runtime_status,
      member && member.status && member.status.health
    ]);

    return {
      config: getConfigStatusMeta(normalizeConfigStatus(getConfigStatusForMember(backendId, member), 'deployed_synced')),
      health: getHealthStatusMeta(normalizeHealthStatus(memberHealth, 'unknown'))
    };
  }

  function deriveBackendHealthStatus(backendId, backend) {
    var explicitStatus = firstDefined([
      backend && backend.status && backend.status.health_status,
      backend && backend.health_status,
      backend && backend.status && backend.status.runtime_status,
      backend && backend.runtime_status,
      backend && backend.status && backend.status.health,
      backend && backend.health
    ]);
    var members = getRuntimeBackendMembers(backendId);
    var statuses;

    if (explicitStatus) {
      return normalizeHealthStatus(explicitStatus, 'unknown');
    }
    if (!members.length) {
      return 'unknown';
    }

    statuses = members.map(function (member) {
      return getMemberStatusModel(backendId, member).health.value;
    });

    if (statuses.some(function (status) { return status === 'problem'; })) {
      return 'problem';
    }
    if (statuses.every(function (status) { return status === 'disabled'; })) {
      return 'disabled';
    }
    if (statuses.every(function (status) { return status === 'healthy'; })) {
      return 'healthy';
    }
    if (statuses.some(function (status) { return status === 'healthy'; })) {
      return 'healthy';
    }

    return 'unknown';
  }

  function getBackendStatusModel(backendId, backend, editorMode) {
    var runtimeBackend = getRuntimeBackendView(backendId, backend);
    var status = (runtimeBackend && runtimeBackend.status) || {};
    var configValue = getConfigStatusForBackend(backendId, backend, editorMode);
    var healthValue = deriveBackendHealthStatus(backendId, runtimeBackend);

    if (editorMode === 'create') {
      configValue = 'draft_local';
      healthValue = 'unknown';
    }

    return {
      config: getConfigStatusMeta(normalizeConfigStatus(configValue, 'deployed_synced')),
      health: getHealthStatusMeta(normalizeHealthStatus(healthValue, 'unknown'))
    };
  }

  function deriveClassifierHealthStatus(classifierId) {
    var runtimeClassifier = getRuntimeClassifier(classifierId);
    var explicitStatus = firstDefined([
      runtimeClassifier && runtimeClassifier.status && runtimeClassifier.status.health_status,
      runtimeClassifier && runtimeClassifier.health_status,
      runtimeClassifier && runtimeClassifier.status && runtimeClassifier.status.runtime_status,
      runtimeClassifier && runtimeClassifier.runtime_status,
      runtimeClassifier && runtimeClassifier.status && runtimeClassifier.status.health,
      runtimeClassifier && runtimeClassifier.health
    ]);
    var members = getRuntimeClassifierMembers(classifierId);
    var statuses;

    if (explicitStatus) {
      return normalizeHealthStatus(explicitStatus, 'unknown');
    }
    if (!members.length) {
      return 'unknown';
    }

    statuses = members.map(function (member) {
      return getHealthStatusMeta(normalizeHealthStatus(member.health_status || member.health, 'unknown')).value;
    });

    if (statuses.some(function (status) { return status === 'problem'; })) {
      return 'problem';
    }
    if (statuses.every(function (status) { return status === 'disabled'; })) {
      return 'disabled';
    }
    if (statuses.every(function (status) { return status === 'healthy'; })) {
      return 'healthy';
    }
    if (statuses.some(function (status) { return status === 'healthy'; })) {
      return 'healthy';
    }

    return 'unknown';
  }

  function getClassifierStatusModel(classifierId, classifier) {
    return {
      config: getClassifierConfigStatusMeta(classifier),
      health: getHealthStatusMeta(deriveClassifierHealthStatus(classifierId))
    };
  }

  function renderInlineStatusIndicators(statusModel) {
    return '<div class="mini-status-stack">' + [
      renderMiniStatusIndicator('Config status', statusModel.config),
      renderMiniStatusIndicator('Runtime health', statusModel.health)
    ].join('') + '</div>';
  }

  function getBackendDenseStatusTone(statusModel) {
    if (statusModel && statusModel.health && (statusModel.health.value === 'problem' || statusModel.health.value === 'disabled')) {
      return 'danger';
    }
    if (statusModel && statusModel.config && statusModel.config.value === 'draft_local') {
      return 'warning';
    }
    return 'ok';
  }

  function renderBackendDenseStatus(statusModel) {
    var title = 'Config status: ' + statusModel.config.label + '. Runtime health: ' + statusModel.health.label + '.';
    var tone = getBackendDenseStatusTone(statusModel);

    return '<span class="backend-status-dot backend-status-dot--' + tone + '" title="' + escapeHtml(title) + '" aria-label="' + escapeHtml(title) + '"></span>';
  }

  function getClassifierConfigStatusMeta(classifier) {
    var status = getClassifierStatus(classifier);

    return getConfigStatusMeta(status === 'active' ? 'deployed_synced' : 'draft_local');
  }

  function renderMiniStatusIndicator(kindLabel, meta) {
    return '<span class="mini-status mini-status--' + meta.tone + '" title="' + escapeHtml(kindLabel + ': ' + meta.label) + '" aria-label="' + escapeHtml(kindLabel + ': ' + meta.label) + '">' +
      '<span class="mini-status__dot"></span>' +
      '<span class="mini-status__text">' + meta.shortLabel + '</span>' +
      '</span>';
  }

  function firstDefined(values) {
    var index;
    var value;

    for (index = 0; index < values.length; index += 1) {
      value = values[index];
      if (value !== null && typeof value !== 'undefined' && value !== '') {
        return value;
      }
    }

    return '';
  }

  function normalizeStringList(value) {
    if (Array.isArray(value)) {
      return value.map(function (item) {
        return String(item == null ? '' : item).trim();
      }).filter(function (item) {
        return !!item;
      });
    }

    if (typeof value === 'string') {
      return value.split(',').map(function (item) {
        return item.trim();
      }).filter(function (item) {
        return !!item;
      });
    }

    return [];
  }

  function formatStatusValue(value) {
    if (typeof value === 'boolean') {
      return value ? 'Enabled' : 'Disabled';
    }
    if (Array.isArray(value)) {
      return value.join(', ');
    }
    if (value === null || typeof value === 'undefined') {
      return '';
    }

    return String(value);
  }

  function normalizeVirtualKeyPoolRefs(value) {
    var seen = {};
    var unique = normalizeStringList(value).filter(function (item) {
      if (seen[item]) {
        return false;
      }
      seen[item] = true;
      return true;
    });

    unique.sort();
    return unique;
  }

  function getListenerAllowedPoolRefs(listener) {
    var selectedMap = {};

    return normalizeVirtualKeyPoolRefs(listener && listener.allowed_virtual_key_pool_refs).filter(function (poolRef) {
      var pool = state.virtualKeyPools && state.virtualKeyPools[poolRef];
      if (!pool || pool.enabled === false || selectedMap[poolRef]) {
        return false;
      }
      selectedMap[poolRef] = true;
      return true;
    });
  }

  function getListenerAvailablePoolRefs(listener) {
    var selectedMap = {};

    getListenerAllowedPoolRefs(listener).forEach(function (poolRef) {
      selectedMap[poolRef] = true;
    });

    return Object.keys(state.virtualKeyPools || {}).filter(function (poolRef) {
      var pool = state.virtualKeyPools[poolRef];
      return pool && pool.enabled !== false && !selectedMap[poolRef];
    }).sort(function (left, right) {
      return getVirtualKeyPoolName(left).localeCompare(getVirtualKeyPoolName(right));
    });
  }

  function buildListenerPoolListOptions(poolRefs, filterValue) {
    var query = String(filterValue || '').trim().toLowerCase();

    return poolRefs.filter(function (poolRef) {
      var pool = state.virtualKeyPools[poolRef] || {};
      var label = String(pool.pool_name || poolRef).toLowerCase();
      return !query || label.indexOf(query) >= 0 || String(poolRef).toLowerCase().indexOf(query) >= 0;
    }).map(function (poolRef) {
      var pool = state.virtualKeyPools[poolRef] || {};
      return '<option value="' + escapeHtml(poolRef) + '">' +
        escapeHtml((pool.pool_name || poolRef) + ' (' + poolRef + ')') +
        '</option>';
    }).join('');
  }

  function renderListenerAllowedPoolSelector(listener) {
    var selector = byId('listenerAllowedPoolsSelector');
    var selectedFilter = byId('listener_allowed_virtual_key_pools_selected_filter');
    var availableFilter = byId('listener_allowed_virtual_key_pools_available_filter');
    var selectedList = byId('listener_allowed_virtual_key_pools_selected');
    var availableList = byId('listener_allowed_virtual_key_pools_available');
    var addButton = byId('listenerAllowedPoolsAddButton');
    var removeButton = byId('listenerAllowedPoolsRemoveButton');
    var authType = listener && listener.client_auth_type;
    var selectedRefs;
    var availableRefs;
    var isDisabled;

    if (!selector || !selectedFilter || !availableFilter || !selectedList || !availableList || !addButton || !removeButton) {
      return;
    }

    selectedRefs = getListenerAllowedPoolRefs(listener);
    availableRefs = getListenerAvailablePoolRefs(listener);
    isDisabled = authType !== 'virtual_key';

    selectedFilter.value = listenerPoolSearchState.selected;
    availableFilter.value = listenerPoolSearchState.available;
    selectedList.innerHTML = buildListenerPoolListOptions(selectedRefs, listenerPoolSearchState.selected);
    availableList.innerHTML = buildListenerPoolListOptions(availableRefs, listenerPoolSearchState.available);

    [selectedFilter, availableFilter, selectedList, availableList, addButton, removeButton].forEach(function (element) {
      element.disabled = isDisabled;
    });
    selector.classList.toggle('is-disabled', isDisabled);
  }

  function moveListenerAllowedPools(direction) {
    var listener = getListenerFormModel();
    var sourceId = direction === 'add'
      ? 'listener_allowed_virtual_key_pools_available'
      : 'listener_allowed_virtual_key_pools_selected';
    var selectedValues = getSelectedValues(sourceId);
    var nextRefs;

    if (!listener || listener.client_auth_type !== 'virtual_key' || !selectedValues.length) {
      return;
    }

    nextRefs = getListenerAllowedPoolRefs(listener);
    if (direction === 'add') {
      nextRefs = normalizeVirtualKeyPoolRefs(nextRefs.concat(selectedValues));
    } else {
      nextRefs = nextRefs.filter(function (poolRef) {
        return selectedValues.indexOf(poolRef) < 0;
      });
    }

    listener.allowed_virtual_key_pool_refs = nextRefs;
    renderListenerAllowedPoolSelector(listener);
  }

  function setVirtualKeyCopyFeedback(targetId, active) {
    if (!targetId) {
      return;
    }
    if (active) {
      virtualKeyCopyState[targetId] = true;
    } else {
      delete virtualKeyCopyState[targetId];
    }
  }

  function scheduleVirtualKeyCopyFeedbackReset(targetId, renderCallback) {
    if (!targetId) {
      return;
    }
    if (virtualKeyCopyFeedbackTimers[targetId]) {
      window.clearTimeout(virtualKeyCopyFeedbackTimers[targetId]);
    }
    virtualKeyCopyFeedbackTimers[targetId] = window.setTimeout(function () {
      delete virtualKeyCopyFeedbackTimers[targetId];
      setVirtualKeyCopyFeedback(targetId, false);
      if (typeof renderCallback === 'function') {
        renderCallback();
      }
    }, 2000);
  }

  function getListenerStatusDetails(listener) {
    var status = (listener && listener.status) || {};
    var defaultSupportedPaths = [
      '/',
      '/v1',
      '/v1/models',
      '/models',
      '/model/list',
      '/v1/chat/completions',
      '/chat/completions',
      '/v1/responses',
      '/responses'
    ];
    var supportedPaths = normalizeStringList(firstDefined([
      status.supported_paths,
      status.supportedPaths,
      status.supported_apis,
      status.supportedApis,
      listener && listener.supported_paths,
      listener && listener.supportedPaths
    ]));

    return {
      northboundApiMode: formatStatusValue(firstDefined([
        status.northbound_api_mode,
        status.northboundApiMode,
        status.api_mode,
        status.apiMode,
        listener && listener.northbound_api_mode,
        listener && listener.northboundApiMode
      ])) || 'OpenAI-compatible',
      supportedPaths: supportedPaths.length ? supportedPaths : defaultSupportedPaths,
      chatCompletionsSupport: formatStatusValue(firstDefined([
        status.chat_completions_support,
        status.chatCompletionsSupport,
        status.chat_support,
        status.chatSupport,
        listener && listener.chat_completions_support,
        listener && listener.chatCompletionsSupport
      ])) || 'Full',
      responsesSupport: formatStatusValue(firstDefined([
        status.responses_support,
        status.responsesSupport,
        status.response_support,
        status.responseSupport,
        listener && listener.responses_support,
        listener && listener.responsesSupport
      ])) || 'Partial',
      assignedIRule: formatStatusValue(firstDefined([
        status.assigned_irule,
        status.assignedIRule,
        status.irule,
        status.iRule,
        listener && listener.assigned_irule,
        listener && listener.assignedIRule
      ])) || 'llm_semantic_route_phase2'
    };
  }

  function renderDetailStatusPair(statusModel) {
    return '<div class="detail-status-pair">' +
      renderStatusBadge('Config', statusModel.config) +
      renderStatusBadge('Health', statusModel.health) +
      '</div>';
  }

  function renderStatusBadge(kindLabel, meta) {
    return '<span class="status-badge status-badge--' + meta.tone + '" title="' + escapeHtml(kindLabel + ': ' + meta.label) + '">' +
      '<span class="status-badge__kind">' + kindLabel + '</span>' +
      '<span class="status-badge__value">' + meta.label + '</span>' +
      '</span>';
  }

  function renderStatusBadgeLabel(kindLabel, label, tone) {
    return renderStatusBadge(kindLabel, {
      label: label,
      tone: tone
    });
  }

  function formatCountLabel(count, singularLabel, pluralLabel) {
    return String(count) + ' ' + (count === 1 ? singularLabel : pluralLabel);
  }

  function copyTextToClipboard(text) {
    var textarea;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }

    textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'readonly');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();

    try {
      document.execCommand('copy');
      document.body.removeChild(textarea);
      return Promise.resolve();
    } catch (error) {
      document.body.removeChild(textarea);
      return Promise.reject(error);
    }
  }

  function setValue(id, value) {
    var element = byId(id);
    var radioGroup;

    if (!element) {
      radioGroup = document.querySelectorAll('input[name="' + id + '"]');
      if (!radioGroup.length) {
        return;
      }
      Array.prototype.forEach.call(radioGroup, function (radio) {
        radio.checked = radio.value === String(value == null ? '' : value);
      });
      return;
    }
    element.value = value == null ? '' : value;
  }

  function getValue(id) {
    var element = byId(id);
    var checked;

    if (element) {
      return element.value;
    }

    checked = document.querySelector('input[name="' + id + '"]:checked');
    return checked ? checked.value : '';
  }

  function shouldSyncPendingEditorFromForm(pageName, editorModeName, formId) {
    return !!(
      state &&
      state.ui &&
      state.activePage === pageName &&
      state.ui[editorModeName] !== 'empty' &&
      byId(formId)
    );
  }

  function startClassifierFormHydrationGuard() {
    classifierFormHydrationGuardUntil = Date.now() + CLASSIFIER_FORM_HYDRATION_GUARD_MS;
    classifierFormUserInteracted = false;
  }

  function armClassifierFormUserInteraction() {
    classifierFormUserInteracted = true;
    classifierFormHydrationGuardUntil = 0;
  }

  function shouldIgnoreClassifierHydrationEvent(event) {
    return !!(
      event &&
      event.target &&
      event.target.closest &&
      event.target.closest('#classifierForm') &&
      !classifierFormUserInteracted &&
      Date.now() < classifierFormHydrationGuardUntil
    );
  }

  function restoreClassifierFormAfterHydrationEvent() {
    if (classifierFormHydrationRestoreTimer) {
      window.clearTimeout(classifierFormHydrationRestoreTimer);
    }
    classifierFormHydrationRestoreTimer = window.setTimeout(function () {
      classifierFormHydrationRestoreTimer = 0;
      renderClassifierForm();
    }, 0);
  }

  function getSecretDisplayValue(record) {
    return record.api_key || record.apiKey || '';
  }

  function looksLikeEnvReference(value) {
    return /^[A-Z_][A-Z0-9_]*$/.test(String(value || '').trim());
  }

  function setSecretValue(record, rawValue) {
    var value = String(rawValue || '').trim();

    delete record.api_key;
    delete record.apiKey;
    delete record.api_key_env;
    delete record.apiKeyEnv;
    delete record.secret_ref;
    delete record.secretRef;

    if (!value) {
      return;
    }

    record.api_key = value;
  }

  function setToggle(id, value) {
    var button = document.querySelector('[data-toggle="' + id + '"]');
    if (!button) {
      return;
    }
    button.classList.toggle('is-on', !!value);
    button.setAttribute('aria-pressed', value ? 'true' : 'false');
  }

  function showToast(message, tone) {
    var toast = byId('toast');
    var topbarAlert = byId('topbarAlert');

    if (tone === 'error' && topbarAlert) {
      if (toast) {
        toast.className = 'toast';
      }
      topbarAlert.textContent = message;
      topbarAlert.hidden = false;
      window.clearTimeout(showToast._alertTimer);
      showToast._alertTimer = window.setTimeout(function () {
        topbarAlert.hidden = true;
        topbarAlert.textContent = '';
      }, 6000);
      return;
    }

    if (topbarAlert) {
      topbarAlert.hidden = true;
      topbarAlert.textContent = '';
      window.clearTimeout(showToast._alertTimer);
    }

    if (!toast) {
      return;
    }
    toast.textContent = message;
    toast.className = 'toast is-visible' + (tone ? ' toast--' + tone : '');
    window.clearTimeout(showToast._timer);
    showToast._timer = window.setTimeout(function () {
      toast.className = 'toast';
    }, 2600);
  }

  function setButtonBusy(id, busy, busyLabel, idleLabel) {
    var button = byId(id);
    if (!button) {
      return;
    }
    button.disabled = !!busy;
    button.textContent = busy ? busyLabel : idleLabel;
  }

  function normalizeProviderCredentialSelectionMode(value) {
    var normalized = String(value || '').trim().toLowerCase().replace(/-/g, '_');

    return normalized === 'priority_failover' ? normalized : 'priority_failover';
  }

  function getValidPages() {
    return {
      listener: true,
      classifier: true,
      backend: true,
      policy: true,
      'model-credential': true,
      'virtual-key': true
    };
  }

  function persistActivePage() {
    if (!state || !state.activePage) {
      return;
    }
    window.localStorage.setItem(PAGE_STORAGE_KEY, state.activePage);
    if (window.location.hash !== '#' + state.activePage) {
      window.history.replaceState(null, '', '#' + state.activePage);
    }
  }

  function getPreferredActivePage() {
    var hashPage = window.location.hash.replace(/^#/, '');
    var storedPage = window.localStorage.getItem(PAGE_STORAGE_KEY);
    var validPages = getValidPages();

    if (hashPage && validPages[hashPage]) {
      return hashPage;
    }

    if (storedPage && validPages[storedPage]) {
      return storedPage;
    }

    return '';
  }

  function restoreActivePagePreference() {
    var preferredPage = getPreferredActivePage();

    if (preferredPage) {
      state.activePage = preferredPage;
    }
  }

  function finishBootstrapShell() {
    var shell = byId('bootLoadingShell');

    if (shell) {
      shell.hidden = true;
    }
    document.documentElement.classList.remove('is-bootstrapping');
  }

  function normalizeLoadedState(data) {
    var normalized = repairMojibake(clone(data));

    normalized.operatingMode = normalized.operatingMode || 'gateway';
    normalized.listeners = normalized.listeners || {};
    normalized.classifiers = normalized.classifiers || {};
    normalized.backendTargets = normalized.backendTargets || {};
    normalized.providerCredentialPools = normalized.providerCredentialPools || {};
    normalized.routingPolicies = normalized.routingPolicies || {};
    normalized.virtualKeyPools = normalized.virtualKeyPools || {};
    normalized.virtualKeys = normalized.virtualKeys || {};
    normalized.activeIds = normalized.activeIds || {};
    normalized.ui = normalized.ui || {};

    if (typeof normalized.activeIds.listener === 'undefined') {
      normalized.activeIds.listener = '';
    }
    if (typeof normalized.activeIds.listener !== 'string') {
      normalized.activeIds.listener = '';
    }
    if (typeof normalized.activeIds.classifier === 'undefined') {
      normalized.activeIds.classifier = Object.keys(normalized.classifiers)[0] || '';
    }
    if (!normalized.activeIds.classifier) {
      normalized.activeIds.classifier = Object.keys(normalized.classifiers)[0] || '';
    }
    if (normalized.activeIds.classifier && !normalized.classifiers[normalized.activeIds.classifier]) {
      normalized.activeIds.classifier = Object.keys(normalized.classifiers)[0] || '';
    }
    if (typeof normalized.activeIds.backend === 'undefined') {
      normalized.activeIds.backend = '';
    }
    if (normalized.activeIds.backend && !normalized.backendTargets[normalized.activeIds.backend]) {
      normalized.activeIds.backend = '';
    }
    if (!normalized.activeIds.policy) {
      normalized.activeIds.policy = Object.keys(normalized.routingPolicies)[0] || '';
    }
    if (normalized.activeIds.policy && !normalized.routingPolicies[normalized.activeIds.policy]) {
      normalized.activeIds.policy = Object.keys(normalized.routingPolicies)[0] || '';
    }
    if (typeof normalized.activeIds.ruleIndex !== 'number') {
      normalized.activeIds.ruleIndex = 0;
    }

    normalized.activePage = normalized.activePage || 'classifier';
    normalized.ui.classifierEditorMode = normalized.ui.classifierEditorMode === 'create' || normalized.ui.classifierEditorMode === 'edit'
      ? normalized.ui.classifierEditorMode
      : 'empty';
    normalized.ui.listenerEditorMode = normalized.ui.listenerEditorMode === 'create' || normalized.ui.listenerEditorMode === 'edit'
      ? normalized.ui.listenerEditorMode
      : 'empty';
    normalized.ui.backendEditorMode = normalized.ui.backendEditorMode === 'create' || normalized.ui.backendEditorMode === 'edit'
      ? normalized.ui.backendEditorMode
      : 'empty';
    normalized.ui.policyEditorMode = normalized.ui.policyEditorMode === 'create' || normalized.ui.policyEditorMode === 'edit'
      ? normalized.ui.policyEditorMode
      : 'empty';
    normalized.meta = normalized.meta || {};
    normalized.meta.source = normalized.meta.source || 'deployed';
    normalized.meta.dirty = !!normalized.meta.dirty;
    delete normalized.ui.listenerEnabledDrafts;

    Object.keys(normalized.listeners).forEach(function (key) {
      var listener = normalized.listeners[key] || {};

      delete listener.default_public_model;
      delete listener.defaultPublicModel;
      listener.client_auth_type = listener.client_auth_type || listener.clientAuthType || 'none';
      if (['none', 'virtual_key', 'mtls', 'oidc/jwt'].indexOf(listener.client_auth_type) < 0) {
        listener.client_auth_type = 'none';
      }
      listener.enabled = typeof listener.enabled !== 'undefined' ? Boolean(listener.enabled) : true;
      listener.allowed_virtual_key_pool_refs = Array.isArray(listener.allowed_virtual_key_pool_refs)
        ? listener.allowed_virtual_key_pool_refs
        : (Array.isArray(listener.allowedVirtualKeyPoolRefs) ? listener.allowedVirtualKeyPoolRefs : []);
      listener.allowed_virtual_key_pool_refs = normalizeVirtualKeyPoolRefs(listener.allowed_virtual_key_pool_refs);
      delete listener.clientAuthType;
      delete listener.allowedVirtualKeyPoolRefs;
      normalized.listeners[key] = listener;
    });

    Object.keys(normalized.classifiers).forEach(function (key) {
      var classifier = normalized.classifiers[key] || {};

      delete classifier.api_key_env;
      delete classifier.apiKeyEnv;
      delete classifier.secret_ref;
      delete classifier.secretRef;
      classifier.pool_name = normalizePoolReference(classifier.pool_name || classifier.poolName || '');
      delete classifier.poolName;
      classifier.bypass_enabled = classifier.bypass_enabled !== undefined ? Boolean(classifier.bypass_enabled) : Boolean(classifier.bypassEnabled);
      delete classifier.bypassEnabled;
      classifier.classifier_type = classifier.classifier_type || 'classifier_llm';
      classifier.schema_family = normalizeClassifierSchemaFamily(classifier.classifier_type, classifier.schema_family);
      syncClassifierCandidateTags(classifier);
      ensureClassifierFallbackTag(classifier);
      normalized.classifiers[key] = classifier;
    });

    Object.keys(normalized.backendTargets).forEach(function (key) {
      var backend = normalized.backendTargets[key] || {};

      delete backend.api_key_env;
      delete backend.apiKeyEnv;
      delete backend.secret_ref;
      delete backend.secretRef;
      backend.schema_family = normalizeBackendSchemaFamily(backend.schema_family || backend.schemaFamily);
      backend.pool_name = normalizePoolReference(backend.pool_name || backend.poolName || '');
      backend.credential_pool_ref = backend.credential_pool_ref || backend.credentialPoolRef || '';
      delete backend.poolName;
      delete backend.credentialPoolRef;
      delete backend.schemaFamily;
      normalized.backendTargets[key] = backend;
    });

    Object.keys(normalized.providerCredentialPools).forEach(function (key) {
      var pool = normalized.providerCredentialPools[key] || {};

      pool.pool_name = pool.pool_name || pool.poolName || key;
      pool.vendor = String(pool.vendor || '').trim();
      pool.auth_scheme = String(pool.auth_scheme || pool.authScheme || 'bearer').trim().toLowerCase() || 'bearer';
      pool.selection_mode = normalizeProviderCredentialSelectionMode(pool.selection_mode || pool.selectionMode);
      pool.cooldown_seconds = Number(
        pool.cooldown_seconds !== undefined
          ? pool.cooldown_seconds
          : (pool.cooldownSeconds !== undefined ? pool.cooldownSeconds : 30)
      );
      if (!isFinite(pool.cooldown_seconds) || pool.cooldown_seconds < 0) {
        pool.cooldown_seconds = 30;
      }
      pool.description = String(pool.description || '').trim();
      pool.enabled = pool.enabled !== undefined ? Boolean(pool.enabled) : true;
      pool.entries = Array.isArray(pool.entries) ? pool.entries.map(function (entry, index) {
        var normalizedEntry = clone(entry || {});
        var generatedId = normalizeIdentifier(
          normalizedEntry.credential_id || normalizedEntry.credentialId || normalizedEntry.display_name || normalizedEntry.displayName || ('credential_' + (index + 1)),
          'credential_' + (index + 1)
        );

        normalizedEntry.credential_id = String(
          normalizedEntry.credential_id || normalizedEntry.credentialId || generatedId
        ).trim();
        normalizedEntry.display_name = String(
          normalizedEntry.display_name || normalizedEntry.displayName || normalizedEntry.name || normalizedEntry.credential_id || generatedId
        ).trim();
        normalizedEntry.priority = parseInt(normalizedEntry.priority, 10);
        if (!isFinite(normalizedEntry.priority)) {
          normalizedEntry.priority = (index + 1) * 100;
        }
        normalizedEntry.api_key = String(normalizedEntry.api_key || normalizedEntry.apiKey || '').trim();
        normalizedEntry.enabled = normalizedEntry.enabled !== undefined ? Boolean(normalizedEntry.enabled) : true;
        delete normalizedEntry.credentialId;
        delete normalizedEntry.displayName;
        delete normalizedEntry.name;
        delete normalizedEntry.apiKey;
        delete normalizedEntry.status;
        delete normalizedEntry.runtime_state;
        delete normalizedEntry.runtimeState;
        delete normalizedEntry.last_failure_reason;
        delete normalizedEntry.lastFailureReason;
        delete normalizedEntry.last_failure_at;
        delete normalizedEntry.lastFailureAt;
        delete normalizedEntry.status_code;
        delete normalizedEntry.statusCode;
        delete normalizedEntry.retry_after;
        delete normalizedEntry.retryAfter;
        delete normalizedEntry.cooldown_until;
        delete normalizedEntry.cooldownUntil;
        delete normalizedEntry.cooldown_until_epoch;
        delete normalizedEntry.cooldownUntilEpoch;
        delete normalizedEntry.fallback_count;
        delete normalizedEntry.fallbackCount;
        delete normalizedEntry.last_fallback_at;
        delete normalizedEntry.lastFallbackAt;
        delete normalizedEntry.updated_at;
        delete normalizedEntry.updatedAt;
        return normalizedEntry;
      }) : [];
      delete pool.poolName;
      delete pool.authScheme;
      delete pool.selectionMode;
      delete pool.cooldownSeconds;
      normalized.providerCredentialPools[key] = pool;
    });

    Object.keys(normalized.routingPolicies).forEach(function (key) {
      normalized.routingPolicies[key] = normalizePolicyRecord(
        normalized.routingPolicies[key],
        normalized.activeIds.classifier || Object.keys(normalized.classifiers)[0] || ''
      );
    });

    Object.keys(normalized.virtualKeyPools).forEach(function (key) {
      var pool = normalized.virtualKeyPools[key] || {};
      pool.pool_name = pool.pool_name || pool.poolName || key;
      pool.description = pool.description || '';
      pool.enabled = pool.enabled !== undefined ? Boolean(pool.enabled) : true;
      delete pool.poolName;
      delete pool.default_limits;
      delete pool.defaultLimits;
      normalized.virtualKeyPools[key] = pool;
    });

    Object.keys(normalized.virtualKeys).forEach(function (key) {
      var virtualKey = normalized.virtualKeys[key] || {};
      virtualKey.kid = virtualKey.kid || virtualKey.key_id || virtualKey.keyId || key;
      virtualKey.tag = virtualKey.tag || '';
      virtualKey.virtual_key_pool_ref = virtualKey.virtual_key_pool_ref || virtualKey.virtualKeyPoolRef || virtualKey.pool_ref || '';
      virtualKey.description = virtualKey.description || '';
      virtualKey.enabled = virtualKey.enabled !== undefined ? Boolean(virtualKey.enabled) : true;
      virtualKey.secret_hash_alg = virtualKey.secret_hash_alg || virtualKey.secretHashAlg || 'sha256';
      virtualKey.secret_hash = virtualKey.secret_hash || virtualKey.secretHash || '';
      virtualKey.key_preview = virtualKey.key_preview || virtualKey.keyPreview || '';
      virtualKey.secret_last4 = virtualKey.secret_last4 || virtualKey.secretLast4 || '';
      virtualKey.created_at = String(virtualKey.created_at || virtualKey.createdAt || '');
      virtualKey.last_used_at = String(virtualKey.last_used_at || virtualKey.lastUsedAt || '');
      delete virtualKey.key_id;
      delete virtualKey.keyId;
      delete virtualKey.virtualKeyPoolRef;
      delete virtualKey.pool_ref;
      delete virtualKey.secretHashAlg;
      delete virtualKey.secretHash;
      delete virtualKey.keyPreview;
      delete virtualKey.secretLast4;
      delete virtualKey.createdAt;
      delete virtualKey.lastUsedAt;
      delete virtualKey.secret;
      delete virtualKey.plaintext_secret;
      delete virtualKey.plaintextSecret;
      delete virtualKey.limits;
      normalized.virtualKeys[key] = virtualKey;
    });

    Object.keys(normalized.listeners).forEach(function (key) {
      var listener = normalized.listeners[key] || {};
      listener.allowed_virtual_key_pool_refs = normalizeVirtualKeyPoolRefs(listener.allowed_virtual_key_pool_refs).filter(function (poolRef) {
        return !!normalized.virtualKeyPools[poolRef];
      });
      if (listener.client_auth_type !== 'virtual_key') {
        listener.allowed_virtual_key_pool_refs = [];
      }
    });

    return normalized;
  }

  function getActiveListener() {
    if (state.ui && state.ui.listenerEditorMode === 'create') {
      return pendingListenerDraft;
    }
    return state.listeners[state.activeIds.listener];
  }

  function buildBlankListener() {
    return {
      listener_name: '',
      virtual_service: '',
      vip: '',
      port: '',
      policy_ref: '',
      enabled: true,
      streaming: true,
      client_auth_type: 'none',
      allowed_virtual_key_pool_refs: [],
      advanced: {
        max_payload_bytes: 65535,
        decision_timeout_ms: 3000,
        request_id_mode: 'auto'
      },
      status: {
        northbound_api_mode: 'OpenAI-compatible',
        supported_paths: ['/','/v1','/v1/models','/models','/model/list','/v1/chat/completions','/chat/completions','/v1/responses','/responses'],
        chat_completions_support: 'full',
        responses_support: 'partial',
        assigned_irule: 'llm_semantic_route_phase2',
        status: 'draft'
      }
    };
  }

  function getListenerEnabledState(listenerId, listener) {
    return !listener || listener.enabled !== false;
  }

  function setListenerEnabledState(listenerId, enabled) {
    var listener = state.listeners && state.listeners[listenerId];

    if (!listener) {
      return;
    }

    listener.enabled = !!enabled;
    if (pendingListenerDraft && pendingListenerDraftId === listenerId) {
      pendingListenerDraft.enabled = !!enabled;
    }
  }

  function buildListenerIdFromName(name) {
    var base = String(name || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '');
    var candidate;
    var counter = 2;

    if (!base) {
      base = 'listener';
    }

    candidate = base;
    while (state.listeners && state.listeners[candidate]) {
      candidate = base + '_' + counter;
      counter += 1;
    }

    return candidate;
  }

  function buildVirtualKeyObjectId(prefix, map) {
    var randomPart = Math.random().toString(36).slice(2, 10);
    var candidate = prefix + '_' + randomPart;
    var counter = 2;

    while (map && map[candidate]) {
      candidate = prefix + '_' + randomPart + '_' + counter;
      counter += 1;
    }

    return candidate;
  }

  function normalizeIdentifier(value, fallback) {
    var normalized = String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '');

    return normalized || fallback;
  }

  function getSelectedValues(selectId) {
    var select = byId(selectId);
    var result = [];

    if (!select || !select.options) {
      return result;
    }

    Array.prototype.forEach.call(select.options, function (option) {
      if (option.selected && option.value) {
        result.push(option.value);
      }
    });

    return result;
  }

  function setSelectedValues(selectId, values) {
    var select = byId(selectId);
    var selectedMap = {};

    if (!select || !select.options) {
      return;
    }

    (values || []).forEach(function (value) {
      selectedMap[value] = true;
    });

    Array.prototype.forEach.call(select.options, function (option) {
      option.selected = !!selectedMap[option.value];
    });
  }

  function randomKeyPart(length) {
    var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
    var bytes;
    var result = '';
    var index;

    if (!window.crypto || !window.crypto.getRandomValues) {
      return '';
    }

    bytes = new Uint8Array(length);
    window.crypto.getRandomValues(bytes);
    for (index = 0; index < bytes.length; index += 1) {
      result += alphabet.charAt(bytes[index] % alphabet.length);
    }
    return result;
  }

  function sha256Hex(value) {
    var bytes;

    if (!window.crypto || !window.crypto.subtle || !window.TextEncoder) {
      return Promise.reject(new Error('Browser crypto API is not available.'));
    }

    bytes = new window.TextEncoder().encode(value);
    return window.crypto.subtle.digest('SHA-256', bytes).then(function (hashBuffer) {
      return Array.prototype.map.call(new Uint8Array(hashBuffer), function (byte) {
        return byte.toString(16).padStart(2, '0');
      }).join('');
    });
  }

  function ensureListenerEditDraft() {
    if (!(state.ui && state.ui.listenerEditorMode === 'edit')) {
      return null;
    }
    if (!state.activeIds.listener || !state.listeners[state.activeIds.listener]) {
      return null;
    }
    if (pendingListenerDraft && pendingListenerDraftId === state.activeIds.listener) {
      return pendingListenerDraft;
    }

    pendingListenerDraft = clone(state.listeners[state.activeIds.listener]);
    pendingListenerDraftId = state.activeIds.listener;
    pendingListenerValidationActive = false;
    return pendingListenerDraft;
  }

  function getListenerFormModel() {
    if (state.ui && state.ui.listenerEditorMode === 'create') {
      return pendingListenerDraft;
    }
    if (state.ui && state.ui.listenerEditorMode === 'edit') {
      return ensureListenerEditDraft();
    }
    return getActiveListener();
  }

  function buildBlankBackend() {
    return {
      backend_target_name: '',
      schema_family: 'openai_chat_compatible',
      endpoint_url: '',
      api_key: '',
      credential_pool_ref: '',
      pool_name: '',
      model_id: '',
      backend_prompt: '',
      backend_prompt_mode: 'append',
      members: []
    };
  }

  function buildBackendIdFromName(name) {
    var base = String(name || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '');
    var candidate;
    var counter = 2;

    if (!base) {
      base = 'backend_target';
    }

    candidate = base;
    while (state.backendTargets && state.backendTargets[candidate]) {
      candidate = base + '_' + counter;
      counter += 1;
    }

    return candidate;
  }

  function buildPolicyIdFromName(name) {
    var base = String(name || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '');
    var candidate;
    var counter = 2;

    if (!base) {
      base = 'routing_policy';
    }

    candidate = base;
    while (state.routingPolicies && state.routingPolicies[candidate]) {
      candidate = base + '_' + counter;
      counter += 1;
    }

    return candidate;
  }

  function normalizeBackendCredentialSource(value) {
    return value === 'credential_pool' ? 'credential_pool' : 'inline_api_key';
  }

  function getBackendCredentialSourceValue(backend) {
    return backend && String(backend.credential_pool_ref || '').trim()
      ? 'credential_pool'
      : 'inline_api_key';
  }

  function getBackendFormCredentialSource(backend) {
    if (
      backend &&
      pendingBackendDraft &&
      backend === pendingBackendDraft &&
      state.ui &&
      (state.ui.backendEditorMode === 'create' || state.ui.backendEditorMode === 'edit')
    ) {
      return normalizeBackendCredentialSource(pendingBackendCredentialSource || getBackendCredentialSourceValue(backend));
    }

    return getBackendCredentialSourceValue(backend);
  }

  function getBackendRequiredFieldList(backend) {
    var fields = BACKEND_REQUIRED_FIELDS.slice(0);

    fields.push(
      getBackendFormCredentialSource(backend) === 'credential_pool'
        ? BACKEND_CREDENTIAL_POOL_FIELD
        : BACKEND_INLINE_API_KEY_FIELD
    );

    return fields;
  }

  function getBackendRequiredIssues(backend, label) {
    var issues = [];
    var targetLabel = label || (backend && backend.backend_target_name) || 'Backend target';

    if (!backend) {
      return [targetLabel + ' is missing.'];
    }

    getMissingBackendRequiredFields(backend).forEach(function (field) {
      issues.push(targetLabel + ' requires ' + field.label + '.');
    });

    return issues;
  }

  function isBackendPlaceholderValue(fieldKey, value) {
    var text = String(value || '').trim().toLowerCase();

    if (!text) {
      return false;
    }

    return (
      (fieldKey === 'backend_target_name' && (text === 'target pending' || text === 'backend target pending')) ||
      (fieldKey === 'pool_name' && text === 'pool pending') ||
      (fieldKey === 'model_id' && text === 'model pending')
    );
  }

  function isBackendRequiredFieldMissing(backend, field) {
    var value;
    var endpoint;
    var pool;

    if (!backend || !field) {
      return true;
    }

    if (field.key === 'api_key') {
      value = getSecretDisplayValue(backend);
    } else if (field.key === 'credential_pool_ref') {
      value = backend.credential_pool_ref;
      pool = value && state && state.providerCredentialPools ? state.providerCredentialPools[value] : null;
      return !String(value || '').trim() || !pool;
    } else {
      value = backend[field.key];
    }

    if (!String(value || '').trim() || isBackendPlaceholderValue(field.key, value)) {
      return true;
    }

    if (field.key === 'endpoint_url') {
      endpoint = parseEndpointUrlForDisplay(value);
      return !endpoint.hostname;
    }

    return false;
  }

  function getMissingBackendRequiredFields(backend) {
    if (!backend) {
      return BACKEND_REQUIRED_FIELDS.concat([BACKEND_INLINE_API_KEY_FIELD]);
    }

    return getBackendRequiredFieldList(backend).filter(function (field) {
      return isBackendRequiredFieldMissing(backend, field);
    });
  }

  function getMissingPolicyRequiredFields(policy) {
    var defaultRule = policy && policy.default_rule ? policy.default_rule : {};
    var missing = [];
    var labelPrefix;

    if (!policy) {
      return POLICY_REQUIRED_FIELDS.concat([
        { id: 'policy_classifier_ref', key: 'classifier_ref', label: 'Classifier' },
        { id: 'policy_default_backend_target', key: 'default_rule', label: 'Unmatched Tag Backend Target or Unmatched Tag Local Response' },
        { id: 'policy_default_response_message', key: 'default_rule', label: 'Unmatched Tag Backend Target or Unmatched Tag Local Response' }
      ]);
    }

    POLICY_REQUIRED_FIELDS.forEach(function (field) {
      if (!String(policy[field.key] || '').trim()) {
        missing.push(field);
      }
    });

    if (policyUsesClassifierStage(policy) && !String(policy.classifier_ref || '').trim()) {
      missing.push({ id: 'policy_classifier_ref', key: 'classifier_ref', label: 'Classifier' });
    }

    labelPrefix = policyDefaultRuleLabelPrefix(policy);

    if (!String(defaultRule.backend_target_ref || '').trim() && !String(defaultRule.response_message || '').trim()) {
      missing.push({ id: 'policy_default_backend_target', key: 'default_rule', label: labelPrefix + ' Backend Target or ' + labelPrefix + ' Local Response' });
      missing.push({ id: 'policy_default_response_message', key: 'default_rule', label: labelPrefix + ' Backend Target or ' + labelPrefix + ' Local Response' });
    }

    return missing;
  }

  function getPolicyClassifierSetSignature(classifierRef) {
    var classifier = classifierRef && state.classifiers ? state.classifiers[classifierRef] : null;
    var tags;

    if (!classifier) {
      return '';
    }

    tags = normalizeTagList(classifier.candidate_tags || []).slice(0).sort();
    return tags.join('|') + '::' + String(classifier.fallback_tag || '');
  }

  function findVirtualKeyByRef(keyRef) {
    var virtualKeys = state.virtualKeys || {};
    var found = null;

    if (!keyRef) {
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

  function getPolicyValidationIssues(policy, label) {
    var issues = [];
    var targetLabel = label || (policy && policy.policy_name) || 'Routing Policy';
    var backendTargets = state.backendTargets || {};
    var classifiers = state.classifiers || {};
    var classifierRefs = [];
    var classifierSignature = '';
    var defaultRule;

    if (!policy) {
      return [targetLabel + ' is missing.'];
    }

    defaultRule = policy.default_rule || {};

    if (policyUsesClassifierStage(policy)) {
      if (!policy.classifier_ref) {
        issues.push(targetLabel + ' requires Classifier.');
      } else if (!classifiers[policy.classifier_ref]) {
        issues.push(targetLabel + ' classifier "' + policy.classifier_ref + '" no longer exists.');
      } else {
        classifierRefs.push(policy.classifier_ref);
        classifierSignature = getPolicyClassifierSetSignature(policy.classifier_ref);
      }
    }

    if ((defaultRule.action || 'route') === 'route') {
      if (!defaultRule.backend_target_ref) {
        issues.push(targetLabel + ' requires ' + policyDefaultRuleLabelPrefix(policy) + ' Backend Target or ' + policyDefaultRuleLabelPrefix(policy) + ' Local Response.');
      } else if (!backendTargets[defaultRule.backend_target_ref]) {
        issues.push(targetLabel + ' default rule still routes to deleted Backend Target "' + defaultRule.backend_target_ref + '".');
      }
    } else if ((defaultRule.action || '') === 'respond' && !String(defaultRule.response_message || '').trim()) {
      issues.push(targetLabel + ' requires ' + policyDefaultRuleLabelPrefix(policy) + ' Backend Target or ' + policyDefaultRuleLabelPrefix(policy) + ' Local Response.');
    }

    if (policy.fallback_backend_target_ref && !backendTargets[policy.fallback_backend_target_ref]) {
      issues.push(targetLabel + ' fallback backend target still points to deleted Backend Target "' + policy.fallback_backend_target_ref + '".');
    }

    if (policyUsesKeyStage(policy)) {
      (policy.key_rules || []).forEach(function (rule, index) {
        var ruleLabel = targetLabel + ' key rule #' + (index + 1);
        var match = rule.match || {};
        var matchSourceCount = 0;
        var matchedVirtualKey;

        if (rule.enabled === false) {
          return;
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
          issues.push(ruleLabel + ' requires exactly one Source: Pool, Key, or Key Tag.');
        }
        if (match.virtual_key_ref) {
          matchedVirtualKey = findVirtualKeyByRef(match.virtual_key_ref);
          if (!matchedVirtualKey) {
            issues.push(ruleLabel + ' references deleted Virtual Key "' + match.virtual_key_ref + '".');
          } else {
            if (match.virtual_key_tag && matchedVirtualKey.tag !== match.virtual_key_tag) {
              issues.push(ruleLabel + ' references Virtual Key "' + match.virtual_key_ref + '" with tag "' + match.virtual_key_tag + '", but the key tag is "' + matchedVirtualKey.tag + '". Update the key rule tag or clear the tag match.');
            }
            if (match.virtual_key_pool_ref && matchedVirtualKey.virtual_key_pool_ref !== match.virtual_key_pool_ref) {
              issues.push(ruleLabel + ' references Virtual Key "' + match.virtual_key_ref + '" with pool "' + match.virtual_key_pool_ref + '", but the key pool is "' + matchedVirtualKey.virtual_key_pool_ref + '". Update the key rule pool or clear the pool match.');
            }
          }
        }
        if (normalizeRoutingMode(policy.routing_mode) === 'key_only' && rule.action === 'classify') {
          issues.push(ruleLabel + ' cannot use Classify when Routing Mode is Key Only.');
        }
        if (rule.action === 'route') {
          if (!rule.backend_target_ref) {
            issues.push(ruleLabel + ' is set to Route but has no Backend Target selected.');
          } else if (!backendTargets[rule.backend_target_ref]) {
            issues.push(ruleLabel + ' still routes to deleted Backend Target "' + rule.backend_target_ref + '".');
          }
        } else if (rule.action === 'respond') {
          if (!String(rule.response_message || '').trim()) {
            issues.push(ruleLabel + ' is set to Local Response but has no Response Message.');
          }
        } else if (rule.action === 'classify') {
          if (!rule.classifier_ref) {
            issues.push(ruleLabel + ' is set to Classify but has no Classifier selected.');
          } else if (!classifiers[rule.classifier_ref]) {
            issues.push(ruleLabel + ' references deleted Classifier "' + rule.classifier_ref + '".');
          } else {
            if (classifierRefs.indexOf(rule.classifier_ref) < 0) {
              classifierRefs.push(rule.classifier_ref);
            }
            if (!classifierSignature) {
              classifierSignature = getPolicyClassifierSetSignature(rule.classifier_ref);
            } else if (classifierSignature !== getPolicyClassifierSetSignature(rule.classifier_ref)) {
              issues.push(targetLabel + ' uses multiple classifiers with different candidate_tags or fallback_tag. V1 requires matching tag sets across all classifiers in the same policy.');
            }
          }
        }
      });
    }

    if (policyUsesClassifierStage(policy)) {
      (policy.rules || []).forEach(function (rule, index) {
        var ruleLabel = targetLabel + ' tag rule #' + (index + 1);

        if (rule.enabled === false) {
          return;
        }
        if (!String(rule.source_tag || '').trim()) {
          issues.push(ruleLabel + ' requires Source Tag.');
        }
        if (rule.action === 'route') {
          if (!rule.backend_target_ref) {
            issues.push(ruleLabel + ' is set to Route but has no Backend Target selected.');
          } else if (!backendTargets[rule.backend_target_ref]) {
            issues.push(ruleLabel + ' still routes to deleted Backend Target "' + rule.backend_target_ref + '".');
          }
        } else if (!String(rule.response_message || '').trim()) {
          issues.push(ruleLabel + ' is set to Local Response but has no Response Message.');
        }
      });
    }

    return issues;
  }

  function getPolicyRequiredIssues(policy, label) {
    var issues = [];
    var targetLabel = label || (policy && policy.policy_name) || 'Routing Policy';
    var hasDefaultRuleIssue = false;

    if (!policy) {
      return [targetLabel + ' is missing.'];
    }

    getMissingPolicyRequiredFields(policy).forEach(function (field) {
      if (field.key === 'default_rule') {
        if (!hasDefaultRuleIssue) {
          issues.push(targetLabel + ' requires Unmatched Tag Backend Target or Unmatched Tag Local Response.');
          hasDefaultRuleIssue = true;
        }
        return;
      }
      issues.push(targetLabel + ' requires ' + field.label + '.');
    });

    return issues.concat(getPolicyValidationIssues(policy, label));
  }

  function getMissingListenerRequiredFields(listener) {
    if (!listener) {
      return LISTENER_REQUIRED_FIELDS.slice(0);
    }

    return LISTENER_REQUIRED_FIELDS.filter(function (field) {
      if (field.key === 'port') {
        var port = parseInt(listener.port, 10);
        return !(port > 0 && port <= 65535);
      }
      return !String(listener[field.key] || '').trim();
    });
  }

  function getListenerRequiredIssues(listener, label) {
    var issues = [];
    var targetLabel = label || (listener && listener.virtual_service) || 'Virtual Service';

    if (!listener) {
      return [targetLabel + ' is missing.'];
    }

    getMissingListenerRequiredFields(listener).forEach(function (field) {
      issues.push(targetLabel + ' requires ' + field.label + '.');
    });

    return issues;
  }

  function getClassifierRequiredFieldSet(classifier) {
    var fields = CLASSIFIER_REQUIRED_FIELDS.slice(0);
    var type = classifier && classifier.classifier_type ? classifier.classifier_type : 'classifier_llm';

    return fields.concat(type === 'classifier_nli' ? CLASSIFIER_NLI_REQUIRED_FIELDS : CLASSIFIER_LLM_REQUIRED_FIELDS);
  }

  function isClassifierRequiredFieldMissing(classifier, field) {
    var value;

    if (!classifier || !field) {
      return true;
    }

    if (field.key === 'api_key') {
      value = getSecretDisplayValue(classifier);
      return !String(value || '').trim();
    }

    if (field.key === 'candidate_tags') {
      return !normalizeTagList(classifier.candidate_tags || []).length;
    }

    return !String(classifier[field.key] || '').trim();
  }

  function getMissingClassifierRequiredFields(classifier) {
    if (!classifier) {
      return getClassifierRequiredFieldSet({ classifier_type: 'classifier_llm' });
    }

    return getClassifierRequiredFieldSet(classifier).filter(function (field) {
      return isClassifierRequiredFieldMissing(classifier, field);
    });
  }

  function getClassifierRequiredIssues(classifier, label) {
    var issues = [];
    var targetLabel = label || (classifier && classifier.classifier_name) || 'Classifier';

    if (!classifier) {
      return [targetLabel + ' is missing.'];
    }

    getMissingClassifierRequiredFields(classifier).forEach(function (field) {
      issues.push(targetLabel + ' requires ' + field.label + '.');
    });

    return issues;
  }

  function isClassifierComplete(classifier) {
    return getMissingClassifierRequiredFields(classifier).length === 0;
  }

  function isListenerComplete(listener) {
    return getMissingListenerRequiredFields(listener).length === 0;
  }

  function getProviderCredentialEntriesForPool(poolRef) {
    var pool = poolRef && state && state.providerCredentialPools ? state.providerCredentialPools[poolRef] : null;
    var entries = Array.isArray(pool && pool.entries) ? pool.entries.slice(0) : [];

    entries = entries.filter(function (entry) {
      return entry && entry.enabled !== false;
    });

    entries.sort(function (left, right) {
      var leftPriority = isFinite(Number(left && left.priority)) ? Number(left.priority) : 999999;
      var rightPriority = isFinite(Number(right && right.priority)) ? Number(right.priority) : 999999;

      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }

      return String((left && left.credential_id) || '').localeCompare(String((right && right.credential_id) || ''));
    });

    return entries;
  }

  function getBackendProbeApiKey(backend) {
    var entries;
    var firstUsable;

    if (!backend) {
      return '';
    }

    if (getBackendFormCredentialSource(backend) !== 'credential_pool') {
      return String(getSecretDisplayValue(backend) || '').trim();
    }

    entries = getProviderCredentialEntriesForPool(backend.credential_pool_ref || '');
    firstUsable = entries.filter(function (entry) {
      return !!String(entry.api_key || '').trim();
    })[0];

    return firstUsable ? String(firstUsable.api_key || '').trim() : '';
  }

  function getMissingBackendProbeFields(backend) {
    var fields;
    var apiKey;

    if (!backend) {
      return [
        { id: 'backend_endpoint', key: 'endpoint_url', label: 'Endpoint URL' },
        BACKEND_INLINE_API_KEY_FIELD,
        { id: 'backend_model', key: 'model_id', label: 'Model ID' }
      ];
    }

    fields = [
      { id: 'backend_endpoint', key: 'endpoint_url', label: 'Endpoint URL' },
      { id: 'backend_model', key: 'model_id', label: 'Model ID' }
    ];

    if (getBackendFormCredentialSource(backend) === 'credential_pool') {
      fields.push(BACKEND_CREDENTIAL_POOL_FIELD);
      return fields.filter(function (field) {
        if (field.key === 'credential_pool_ref') {
          return isBackendRequiredFieldMissing(backend, field) || !String(getBackendProbeApiKey(backend) || '').trim();
        }
        return !String(backend[field.key] || '').trim();
      });
    }

    apiKey = getBackendProbeApiKey(backend);
    fields.push(BACKEND_INLINE_API_KEY_FIELD);
    return fields.filter(function (field) {
      if (field.key === 'api_key') {
        return !apiKey;
      }
      return !String(backend[field.key] || '').trim();
    });
  }

  function isBackendComplete(backend) {
    return getBackendRequiredIssues(backend).length === 0;
  }

  function getInvalidCommittedBackendIds(block) {
    var backendTargets = block && block.backendTargets ? block.backendTargets : {};

    return Object.keys(backendTargets).filter(function (backendId) {
      return getMissingBackendRequiredFields(backendTargets[backendId]).length > 0;
    });
  }

  function getInvalidCommittedClassifierIds(block) {
    var classifiers = block && block.classifiers ? block.classifiers : {};

    return Object.keys(classifiers).filter(function (classifierId) {
      return getMissingClassifierRequiredFields(classifiers[classifierId]).length > 0;
    });
  }

  function hasInvalidCommittedConfiguration(block) {
    return !!(
      getInvalidCommittedBackendIds(block).length ||
      getInvalidCommittedClassifierIds(block).length
    );
  }

  function restoreDeployedIfCommittedConfigurationInvalid() {
    var activePage;
    var baseSource;
    var rawDraft;

    if (!state || !sampleState) {
      return false;
    }

    if (!hasInvalidCommittedConfiguration(state) || hasInvalidCommittedConfiguration(sampleState)) {
      return false;
    }

    rawDraft = window.localStorage.getItem(STORAGE_KEY);
    if (rawDraft) {
      archiveStoredDraft(rawDraft);
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }

    activePage = state.activePage;
    baseSource = sampleState.meta && sampleState.meta.source ? sampleState.meta.source : 'deployed';
    discardPendingBackendDraft();
    state = normalizeLoadedState(sampleState);
    state.activePage = activePage || state.activePage;
    state.meta.source = baseSource;
    state.meta.dirty = false;
    showToast('Discarded invalid local draft. Loaded deployed configuration.');
    return true;
  }

  function buildBlankPolicy() {
    return {
      policy_type: 'routing',
      policy_name: '',
      routing_mode: 'classifier_only',
      classifier_ref: Object.keys(state.classifiers || {})[0] || '',
      fallback_backend_target_ref: '',
      default_rule: {
        action: '',
        backend_target_ref: '',
        response_message: ''
      },
      key_rules: [],
      rules: []
    };
  }

  function getActiveClassifier() {
    if (state.ui && state.ui.classifierEditorMode === 'create') {
      return pendingClassifierDraft;
    }
    return state.classifiers[state.activeIds.classifier];
  }

  function buildBlankClassifier() {
    return {
      classifier_name: '',
      classifier_type: 'classifier_llm',
      schema_family: 'openai_chat_compatible',
      endpoint_url: '',
      api_key: '',
      model_id: '',
      temperature: 0,
      max_tokens: 128,
      classifier_prompt: '',
      candidate_tags: [],
      fallback_tag: '',
      timeout_ms: 3000,
      min_confidence: 0.5,
      multi_label: false,
      hypothesis_template: '',
      min_margin: 0,
      bypass_enabled: false
    };
  }

  function buildClassifierIdFromName(name) {
    var base = String(name || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '');
    var candidate;
    var counter = 2;

    if (!base) {
      base = 'classifier';
    }

    candidate = base;
    while (state.classifiers && state.classifiers[candidate]) {
      candidate = base + '_' + counter;
      counter += 1;
    }

    return candidate;
  }

  function ensureClassifierEditDraft() {
    if (!(state.ui && state.ui.classifierEditorMode === 'edit')) {
      return null;
    }
    if (!state.activeIds.classifier || !state.classifiers[state.activeIds.classifier]) {
      return null;
    }
    if (pendingClassifierDraft && pendingClassifierDraftId === state.activeIds.classifier) {
      return pendingClassifierDraft;
    }

    pendingClassifierDraft = clone(state.classifiers[state.activeIds.classifier]);
    pendingClassifierDraftId = state.activeIds.classifier;
    pendingClassifierValidationActive = false;
    return pendingClassifierDraft;
  }

  function getClassifierFormModel() {
    if (state.ui && state.ui.classifierEditorMode === 'create') {
      return pendingClassifierDraft;
    }
    if (state.ui && state.ui.classifierEditorMode === 'edit') {
      return ensureClassifierEditDraft();
    }
    return getActiveClassifier();
  }

  function getActiveBackend() {
    if (state.ui && state.ui.backendEditorMode === 'create') {
      return pendingBackendDraft;
    }
    return state.backendTargets[state.activeIds.backend];
  }

  function ensureBackendEditDraft() {
    if (!(state.ui && state.ui.backendEditorMode === 'edit')) {
      return null;
    }
    if (!state.activeIds.backend || !state.backendTargets[state.activeIds.backend]) {
      return null;
    }
    if (pendingBackendDraft && pendingBackendDraftId === state.activeIds.backend) {
      pendingBackendCredentialSource = normalizeBackendCredentialSource(
        pendingBackendCredentialSource || getBackendCredentialSourceValue(pendingBackendDraft)
      );
      return pendingBackendDraft;
    }

    pendingBackendDraft = clone(state.backendTargets[state.activeIds.backend]);
    pendingBackendDraftId = state.activeIds.backend;
    pendingBackendCredentialSource = getBackendCredentialSourceValue(pendingBackendDraft);
    pendingBackendValidationActive = false;
    return pendingBackendDraft;
  }

  function getBackendFormModel() {
    if (state.ui && state.ui.backendEditorMode === 'create') {
      return pendingBackendDraft;
    }
    if (state.ui && state.ui.backendEditorMode === 'edit') {
      return ensureBackendEditDraft();
    }
    return getActiveBackend();
  }

  function getActivePolicy() {
    if (state.ui && state.ui.policyEditorMode === 'create') {
      return pendingPolicyDraft;
    }
    return state.routingPolicies[state.activeIds.policy];
  }

  function ensurePolicyEditDraft() {
    if (!(state.ui && state.ui.policyEditorMode === 'edit')) {
      return null;
    }
    if (!state.activeIds.policy || !state.routingPolicies[state.activeIds.policy]) {
      return null;
    }
    if (pendingPolicyDraft && pendingPolicyDraftId === state.activeIds.policy) {
      return pendingPolicyDraft;
    }

    pendingPolicyDraft = clone(state.routingPolicies[state.activeIds.policy]);
    pendingPolicyDraftId = state.activeIds.policy;
    pendingPolicyValidationActive = false;
    return pendingPolicyDraft;
  }

  function getPolicyFormModel() {
    if (state.ui && state.ui.policyEditorMode === 'create') {
      return pendingPolicyDraft;
    }
    if (state.ui && state.ui.policyEditorMode === 'edit') {
      return ensurePolicyEditDraft();
    }
    return getActivePolicy();
  }

  function getActiveRule() {
    var policy = getActivePolicy();
    if (!policy || !policy.rules) {
      return null;
    }
    return policy.rules[state.activeIds.ruleIndex] || null;
  }

  function getPrimaryPolicyRule(policy) {
    var targetPolicy = policy || getActivePolicy();
    if (!targetPolicy || !targetPolicy.rules || !targetPolicy.rules.length) {
      return {
        rule_name: '',
        source_tag: '',
        action: 'route',
        backend_target_ref: '',
        response_message: '',
        enabled: true
      };
    }
    return targetPolicy.rules[0];
  }

  function policyUsesClassifierStage(policy) {
    return normalizeRoutingMode(policy && policy.routing_mode) !== 'key_only';
  }

  function policyUsesKeyStage(policy) {
    return normalizeRoutingMode(policy && policy.routing_mode) !== 'classifier_only';
  }

  function getRoutingModeLabel(value) {
    var routingMode = normalizeRoutingMode(value);

    if (routingMode === 'key_only') {
      return 'Key Only';
    }
    if (routingMode === 'key_then_classifier') {
      return 'Key Then Classifier';
    }

    return 'Classifier Only';
  }

  function policyDefaultRuleLabelPrefix(policy) {
    return normalizeRoutingMode(policy && policy.routing_mode) === 'key_only' ? 'Unmatched Key' : 'Unmatched Tag';
  }

  function getPolicyEntryCountSummary(policy) {
    var keyCount = ((policy && policy.key_rules) || []).length;
    var tagCount = ((policy && policy.rules) || []).length;
    var routingMode = normalizeRoutingMode(policy && policy.routing_mode);

    if (routingMode === 'key_only') {
      return keyCount + ' key rule' + (keyCount === 1 ? '' : 's');
    }
    if (routingMode === 'key_then_classifier') {
      return keyCount + ' key / ' + tagCount + ' tag';
    }

    return tagCount + ' tag rule' + (tagCount === 1 ? '' : 's');
  }

  var TAG_COLOR_PALETTE = [
    { bg: '#eef4ff', border: '#bed1f8', text: '#1f4b8f' },
    { bg: '#edf9f0', border: '#b8e1c0', text: '#1e6a37' },
    { bg: '#fff3e8', border: '#f2c7a1', text: '#9a4b10' },
    { bg: '#f5efff', border: '#d4c2f8', text: '#5a3ea6' },
    { bg: '#fff0f4', border: '#f0bfd0', text: '#a53b62' },
    { bg: '#eef8fb', border: '#b7dde8', text: '#1f667d' },
    { bg: '#f9f4eb', border: '#e3d2ab', text: '#7f6123' },
    { bg: '#eef1f7', border: '#c3ccdc', text: '#40536f' }
  ];

  function normalizeTagList(tags) {
    var seen = {};
    return (tags || []).map(function (tag) {
      return String(tag || '').trim();
    }).filter(function (tag) {
      if (!tag || seen[tag]) {
        return false;
      }
      seen[tag] = true;
      return true;
    });
  }

  function extractPromptTags(prompt) {
    var pattern = /\{\{\s*([^{}]+?)\s*\}\}/g;
    var matches = [];
    var match;

    while ((match = pattern.exec(prompt || ''))) {
      matches.push(match[1]);
    }

    return normalizeTagList(matches);
  }

  function syncClassifierCandidateTags(classifier) {
    if (!classifier) {
      return;
    }

    if (classifier.classifier_type === 'classifier_llm') {
      classifier.candidate_tags = extractPromptTags(classifier.classifier_prompt || '');
      return;
    }

    classifier.candidate_tags = normalizeTagList(classifier.candidate_tags || []);
  }

  function findMatchingTag(tags, value) {
    var normalizedValue = String(value || '').trim().toLowerCase();
    var index;

    if (!normalizedValue) {
      return '';
    }

    for (index = 0; index < tags.length; index += 1) {
      if (String(tags[index]).toLowerCase() === normalizedValue) {
        return tags[index];
      }
    }

    return '';
  }

  function ensureClassifierFallbackTag(classifier) {
    var tags = normalizeTagList((classifier && classifier.candidate_tags) || []);
    var current = findMatchingTag(tags, classifier && classifier.fallback_tag);
    var unknown = findMatchingTag(tags, 'unknown');

    if (!classifier) {
      return '';
    }

    classifier.fallback_tag = current || unknown || tags[0] || '';
    return classifier.fallback_tag;
  }

  function ensureClassifierNliDefaultHypothesis(classifier) {
    if (
      classifier &&
      classifier.classifier_type === 'classifier_nli' &&
      !String(classifier.hypothesis_template || '').trim()
    ) {
      classifier.hypothesis_template = DEFAULT_NLI_HYPOTHESIS_TEMPLATE;
    }

    return classifier;
  }

  function renderClassifierFallbackOptions(classifier) {
    var select = byId('classifier_fallback');
    var tags = normalizeTagList((classifier && classifier.candidate_tags) || []);
    var fallback = ensureClassifierFallbackTag(classifier);

    if (!select) {
      return;
    }

    if (!tags.length) {
      select.disabled = true;
      select.innerHTML = '<option value="">No tags available</option>';
      return;
    }

    select.disabled = false;
    select.innerHTML = tags.map(function (tag) {
      var selected = tag === fallback ? ' selected' : '';
      return '<option value="' + escapeHtml(tag) + '"' + selected + '>' + escapeHtml(tag) + '</option>';
    }).join('');
  }

  function getTagColor(tag) {
    var hash = 0;
    var paletteIndex;
    var value = String(tag || '');
    var index;

    for (index = 0; index < value.length; index += 1) {
      hash = ((hash << 5) - hash) + value.charCodeAt(index);
      hash |= 0;
    }

    paletteIndex = Math.abs(hash) % TAG_COLOR_PALETTE.length;
    return TAG_COLOR_PALETTE[paletteIndex];
  }

  function buildTagChip(tag, toneClass) {
    var color = getTagColor(tag);
    var extraClass = toneClass ? ' ' + toneClass : '';

    return '<span class="tag-chip' + extraClass + '" style="--tag-bg:' + color.bg + ';--tag-border:' + color.border + ';--tag-text:' + color.text + ';">' + escapeHtml(tag) + '</span>';
  }

  function buildTagChipList(tags, emptyLabel) {
    var normalizedTags = normalizeTagList(tags);

    if (!normalizedTags.length) {
      return '<span class="tag-chip tag-chip--empty">' + escapeHtml(emptyLabel || 'No tags defined') + '</span>';
    }

    return normalizedTags.map(function (tag) {
      return buildTagChip(tag);
    }).join('');
  }

  var CLASSIFIER_SCHEMA_OPTIONS = {
    classifier_llm: [
      { value: 'openai_chat_compatible', label: 'OpenAI Chat Compatible' },
      { value: 'ollama_chat', label: 'Ollama Chat' }
    ],
    classifier_nli: [
      { value: 'hf_zero_shot_classification', label: 'Hugging Face Zero-Shot Classification' },
      { value: 'hf_text_classification', label: 'Hugging Face Text Classification' }
    ]
  };

  var BACKEND_SCHEMA_OPTIONS = [
    { value: 'openai_chat_compatible', label: 'OpenAI Chat Compatible' }
  ];

  function getClassifierSchemaOptions(classifierType) {
    return CLASSIFIER_SCHEMA_OPTIONS[classifierType] || CLASSIFIER_SCHEMA_OPTIONS.classifier_llm;
  }

  function normalizeClassifierSchemaFamily(classifierType, value) {
    var schemaValue = String(value || '').trim();
    var options = getClassifierSchemaOptions(classifierType);
    var found = options.some(function (option) {
      return option.value === schemaValue;
    });

    return found ? schemaValue : (options[0] && options[0].value) || '';
  }

  function normalizeBackendSchemaFamily(value) {
    var normalized = String(value || '').trim();
    var index;

    if (!normalized || normalized === 'openai_compatible_chat') {
      return 'openai_chat_compatible';
    }

    for (index = 0; index < BACKEND_SCHEMA_OPTIONS.length; index += 1) {
      if (BACKEND_SCHEMA_OPTIONS[index].value === normalized) {
        return normalized;
      }
    }

    return 'openai_chat_compatible';
  }

  function buildBackendSchemaOptions(selected) {
    var normalized = normalizeBackendSchemaFamily(selected);

    return BACKEND_SCHEMA_OPTIONS.map(function (option) {
      var isSelected = option.value === normalized ? ' selected' : '';
      return '<option value="' + option.value + '"' + isSelected + '>' + option.label + '</option>';
    }).join('');
  }

  function normalizePoolReference(value) {
    var text = String(value || '').trim();

    if (!text) {
      return '';
    }

    if (text.charAt(0) === '/') {
      return text;
    }

    if (text.indexOf('/') > 0) {
      return '/' + text.replace(/^\/+/, '');
    }

    return '/Common/' + text;
  }

  function getSelectedPoolValue(selected) {
    var text = String(selected || '').trim();
    var normalized = normalizePoolReference(text);
    var match;

    if (!text) {
      return '';
    }

    match = (poolCatalogState.pools || []).filter(function (pool) {
      return pool && (pool.fullPath === text || pool.fullPath === normalized || pool.name === text);
    })[0];

    return match && match.fullPath ? match.fullPath : text;
  }

  function renderPoolOption(pool, selectedValue) {
    var value = pool.fullPath || normalizePoolReference(pool.name);
    var label = value;
    var selected = value === selectedValue ? ' selected' : '';

    if (typeof pool.memberCount === 'number') {
      label += ' (' + pool.memberCount + ' members)';
    }

    return '<option value="' + escapeHtml(value) + '"' + selected + '>' + escapeHtml(label) + '</option>';
  }

  function buildPoolOptions(selected) {
    var selectedValue = getSelectedPoolValue(selected);
    var options = ['<option value="">Select existing BIG-IP pool</option>'];
    var found = false;

    (poolCatalogState.pools || []).forEach(function (pool) {
      if (pool && pool.fullPath) {
        found = found || pool.fullPath === selectedValue;
        options.push(renderPoolOption(pool, selectedValue));
      }
    });

    if (selectedValue && !found) {
      options.push('<option value="' + escapeHtml(selectedValue) + '" selected>' +
        escapeHtml(selectedValue + (poolCatalogState.loaded ? ' (not found)' : ' (current)')) +
        '</option>');
    }

    if (!selectedValue && poolCatalogState.loading && !(poolCatalogState.pools || []).length) {
      return '<option value="">Loading BIG-IP pools...</option>';
    }

    if (!selectedValue && poolCatalogState.loaded && !(poolCatalogState.pools || []).length) {
      return '<option value="">No BIG-IP pools found</option>';
    }

    return options.join('');
  }

  function renderPoolCatalogControls() {
    var buttons = [
      byId('refreshPoolCatalogButton'),
      byId('refreshClassifierPoolCatalogButton')
    ];

    buttons.forEach(function (button) {
      if (!button) {
        return;
      }
      button.disabled = poolCatalogState.loading;
      button.innerHTML = poolCatalogState.loading ? '...' : '&#8635;';
    });
  }

  function renderClassifierPoolStatus(classifierId, classifier) {
    var host = byId('classifierPoolStatus');
    var runtimeClassifier = getRuntimeClassifier(classifierId || '');
    var members = getRuntimeClassifierMembers(classifierId || '');
    var healthMeta = getHealthStatusMeta(deriveClassifierHealthStatus(classifierId || ''));
    var poolName = classifier && classifier.pool_name ? classifier.pool_name : '';

    if (!host) {
      return;
    }

    if (!poolName) {
      host.textContent = '';
      return;
    }

    if (!runtimeClassifier) {
      host.textContent = 'Runtime pool health appears after Deploy Changes.';
      return;
    }

    host.textContent = 'Runtime pool: ' + healthMeta.label + (members.length ? ', ' + members.length + ' member' + (members.length === 1 ? '' : 's') : ', no live members reported');
  }

  function markDirty(source) {
    state.meta.dirty = true;
    if (source) {
      state.meta.source = source;
    }
    updateRuntimeSummary();
    persistCurrentDraftToLocalStorage();
  }

  function clearDirty(source) {
    state.meta.dirty = false;
    if (source) {
      state.meta.source = source;
    }
    updateRuntimeSummary();
  }

  function updateRuntimeSummary() {
    var summary = byId('runtimeSummary');
    var pill;
    var meta;

    if (!summary) {
      return;
    }

    meta = getConfigStatusMeta(getGlobalConfigStatus());
    summary.textContent = 'Config: ' + meta.label;

    pill = summary.closest ? summary.closest('.status-pill') : null;
    if (pill) {
      pill.classList.toggle('status-pill--draft-local', meta.value === 'draft_local');
      pill.classList.toggle('status-pill--deployed-synced', meta.value === 'deployed_synced');
      pill.title = meta.label;
    }
  }

  function renderMode() {
    var select = byId('listener_operating_mode');
    if (select) {
      select.value = state.operatingMode;
    }
  }

  function renderNav() {
    document.querySelectorAll('.nav-item').forEach(function (button) {
      var isActive = button.getAttribute('data-page') === state.activePage;
      button.classList.toggle('is-active', isActive);
    });
    document.querySelectorAll('.page').forEach(function (page) {
      page.classList.toggle('is-active', page.id === 'page-' + state.activePage);
    });
    persistActivePage();
  }

  function renderListenerList() {
    var host = byId('listenerList');
    var selectAll = byId('listenerSelectAll');
    var searchInput = byId('listenerSearchInput');
    var visibleListenerIds = getVisibleListenerIds();
    var pageState = clampListenerPage(visibleListenerIds.length);
    var listenerIds = isShowAllPage(pageState.currentPage)
      ? visibleListenerIds
      : visibleListenerIds.slice((pageState.currentPage - 1) * VIRTUAL_KEY_PAGE_SIZE, pageState.currentPage * VIRTUAL_KEY_PAGE_SIZE);
    var html = '';
    var selectedCount = 0;

    if (!host) {
      return;
    }

    pruneListenerPresentationState();
    if (searchInput && searchInput.value !== listenerSearchTerm) {
      searchInput.value = listenerSearchTerm;
    }

    listenerIds.forEach(function (key) {
      var listener = state.listeners[key];
      var active = key === state.activeIds.listener ? ' is-active' : '';
      var title = getListenerDisplayName(key, listener);
      var destination = listener.vip || 'pending';
      var servicePort = listener.port || 'pending';
      var policyLabel = getListenerPolicyDisplayName(listener);
      var isSelected = !!listenerSelection[key];
      var statusModel = getListenerStatusModel(key, listener);

      if (isSelected) {
        selectedCount += 1;
      }

      html += '<tr class="' + active.trim() + '" data-listener="' + escapeHtml(key) + '">' +
        '<td class="virtual-key-checkbox-col"><input type="checkbox" data-listener-select="' + escapeHtml(key) + '"' + (isSelected ? ' checked' : '') + ' aria-label="Select Virtual Server ' + escapeHtml(title) + '"></td>' +
        '<td class="listener-status-cell">' + renderListenerDenseStatus(key, listener, statusModel) + '</td>' +
        '<td><span class="table-primary" title="' + escapeHtml(title) + '">' + escapeHtml(title) + '</span></td>' +
        '<td><span class="table-secondary" title="' + escapeHtml(destination) + '">' + escapeHtml(destination) + '</span></td>' +
        '<td><span class="table-secondary" title="' + escapeHtml(String(servicePort)) + '">' + escapeHtml(String(servicePort)) + '</span></td>' +
        '<td><span class="table-secondary" title="' + escapeHtml(policyLabel) + '">' + escapeHtml(policyLabel) + '</span></td>' +
        '<td><div class="row-action-group row-action-group--compact">' +
        '<button class="row-action-button virtual-key-config-button" type="button" data-listener-config="' + escapeHtml(key) + '" title="Configure listener" aria-label="Configure listener"></button>' +
        '<button class="row-action-button row-action-button--danger row-action-button--delete" type="button" data-listener-delete="' + escapeHtml(key) + '" aria-label="Delete listener">&#x1F5D1;&#xFE0E;</button>' +
        '</div></td>' +
        '</tr>';
    });

    if (!html) {
      html = '<tr><td class="table-empty" colspan="7"><div class="empty-editor"><p class="eyebrow">No Listeners</p><h3>' +
        (Object.keys(state.listeners || {}).length ? 'No listeners match the current search.' : 'Create the first virtual service to begin.') +
        '</h3></div></td></tr>';
    }

    host.innerHTML = html;
    if (selectAll) {
      selectAll.checked = listenerIds.length > 0 && selectedCount === listenerIds.length;
      selectAll.indeterminate = selectedCount > 0 && selectedCount < listenerIds.length;
    }
    renderListenerPagination(visibleListenerIds.length, pageState);
  }

  function deleteListeners(listenerIds) {
    var ids = [];
    var keys;
    var activeDeleted = false;

    (listenerIds || []).forEach(function (listenerId) {
      if (listenerId && state.listeners[listenerId] && ids.indexOf(listenerId) < 0) {
        ids.push(listenerId);
      }
    });

    if (!ids.length) {
      return;
    }

    if (!window.confirm('Delete ' + formatCountLabel(ids.length, 'Virtual Server', 'Virtual Servers') + '?')) {
      return;
    }

    ids.forEach(function (listenerId) {
      if (pendingListenerDraft && pendingListenerDraftId === listenerId) {
        discardPendingListenerDraft();
      }
      if (state.activeIds.listener === listenerId) {
        activeDeleted = true;
      }
      delete state.listeners[listenerId];
      delete listenerSelection[listenerId];
    });

    keys = Object.keys(state.listeners);

    if (!keys.length) {
      state.activeIds.listener = '';
      state.ui.listenerEditorMode = 'empty';
    } else if (activeDeleted) {
      state.activeIds.listener = keys[0];
      state.ui.listenerEditorMode = 'empty';
    }

    markDirty(ids.length === 1 ? 'delete listener' : 'bulk delete listeners');
    renderAll();
  }

  function deleteListener(listenerId) {
    deleteListeners([listenerId]);
  }

  function deleteSelectedListeners() {
    var ids = Object.keys(listenerSelection).filter(function (listenerId) {
      return listenerSelection[listenerId] && state.listeners[listenerId];
    });

    if (!ids.length) {
      showToast('Select at least one Virtual Server.', 'error');
      return;
    }

    deleteListeners(ids);
  }

  function renderListenerLayout() {
    var layout = byId('listenerLayout');
    var editorCard = byId('listenerEditorCard');
    var isExpanded = state.ui.listenerEditorMode !== 'empty' && !!getListenerFormModel();

    if (!layout || !editorCard) {
      return;
    }

    layout.classList.toggle('is-expanded', isExpanded);
    editorCard.hidden = !isExpanded;
  }

  function collapseListenerEditor() {
    if (state.ui.listenerEditorMode === 'empty') {
      return;
    }
    state.ui.listenerEditorMode = 'empty';
    renderAll();
  }

  function getListenerDisplayName(listenerId, listener) {
    var values = [
      listener && listener.virtual_service,
      listener && listener.listener_name,
      /^listener_draft_/i.test(String(listenerId || '')) ? '' : listenerId
    ];
    var index;
    var value;

    for (index = 0; index < values.length; index += 1) {
      value = String(values[index] || '').trim();
      if (value) {
        return value;
      }
    }

    return 'Virtual Service pending';
  }

  function getListenerPolicyDisplayName(listener) {
    var policyId = listener && listener.policy_ref;
    var policy = policyId && state.routingPolicies ? state.routingPolicies[policyId] : null;

    if (!policyId) {
      return 'Policy pending';
    }

    return getPolicyDisplayName(policyId, policy);
  }

  function getListenerAllowedPoolDisplayNames(listener) {
    return normalizeVirtualKeyPoolRefs(listener && listener.allowed_virtual_key_pool_refs).map(function (poolRef) {
      var pool = state.virtualKeyPools && state.virtualKeyPools[poolRef];
      return (pool && pool.pool_name) || poolRef;
    });
  }

  function renderListenerDenseStatus(listenerId, listener, statusModel) {
    var enabled = getListenerEnabledState(listenerId, listener);
    var warningClass = '';
    var warningTitle = '';
    var warningLabel = '';
    var title = 'Listener is ' + (enabled ? 'enabled' : 'disabled') + '. Config status: ' + statusModel.config.label + '. Runtime health: ' + statusModel.health.label + '.';

    if (statusModel.health.value === 'problem') {
      warningClass = 'virtual-key-warning-dot--danger';
      warningTitle = 'Runtime health: ' + statusModel.health.label + '.';
      warningLabel = '!';
    } else if (statusModel.config.value === 'draft_local') {
      warningClass = 'virtual-key-warning-dot--warn';
      warningTitle = 'Config status: ' + statusModel.config.label + '.';
      warningLabel = '!';
    } else if (statusModel.health.value === 'unknown') {
      warningClass = 'virtual-key-warning-dot--warn';
      warningTitle = 'Runtime health: ' + statusModel.health.label + '.';
      warningLabel = '?';
    }

    return '<div class="virtual-key-dense-status" title="' + escapeHtml(title) + '" aria-label="' + escapeHtml(title) + '">' +
      '<span class="virtual-key-pool-status-dot ' + (enabled ? 'virtual-key-pool-status-dot--enabled' : 'virtual-key-pool-status-dot--disabled') + '" aria-hidden="true"></span>' +
      (warningTitle
        ? '<span class="virtual-key-warning-dot ' + warningClass + '" title="' + escapeHtml(warningTitle) + '" aria-label="' + escapeHtml(warningTitle) + '">' + warningLabel + '</span>'
        : '') +
      '</div>';
  }

  function getVisibleListenerIds() {
    var term = normalizeSearchTerm(listenerSearchTerm);

    return Object.keys(state.listeners || {}).filter(function (listenerId) {
      var listener = state.listeners[listenerId] || {};
      var haystack;

      if (!term) {
        return true;
      }

      haystack = [
        listenerId,
        getListenerDisplayName(listenerId, listener),
        listener.vip,
        listener.port,
        getListenerPolicyDisplayName(listener)
      ].map(normalizeSearchTerm).join(' ');

      return haystack.indexOf(term) >= 0;
    }).sort(function (left, right) {
      return getListenerDisplayName(left, state.listeners[left]).localeCompare(getListenerDisplayName(right, state.listeners[right]));
    });
  }

  function clampListenerPage(totalVisibleListeners) {
    var pageState = getPageState(totalVisibleListeners, listenerPage);

    listenerPage = pageState.currentPage;
    return pageState;
  }

  function renderListenerPagination(totalVisibleListeners, pageState) {
    var select = byId('listenerPageSelect');

    if (!select) {
      return;
    }

    select.innerHTML = buildVirtualKeyPageOptions(totalVisibleListeners, pageState);
    select.disabled = totalVisibleListeners === 0;
  }

  function pruneListenerPresentationState() {
    Object.keys(listenerSelection).forEach(function (listenerId) {
      if (!state.listeners[listenerId]) {
        delete listenerSelection[listenerId];
      }
    });
    clampListenerPage(getVisibleListenerIds().length);
  }

  function renderListenerStatusPanel(listener, editorMode) {
    var runtimeListener;
    var statusDetails;
    var statusHost;
    var statusHtml;
    var statusModel;
    var statusEmpty = byId('listenerStatusEmpty');
    var statusTitle = byId('listenerStatusTitle');
    var statusList = byId('listenerStatus');
    var pathsCard = byId('listenerPathsCard');

    if (!statusEmpty || !statusTitle || !statusList || !pathsCard) {
      return;
    }

    if (!listener) {
      statusEmpty.hidden = true;
      statusList.hidden = true;
      pathsCard.hidden = true;
      statusTitle.textContent = 'Status';
      return;
    }

    runtimeListener = getRuntimeListenerView(state.activeIds.listener, listener);
    statusDetails = getListenerStatusDetails(runtimeListener);
    statusModel = getListenerStatusModel(state.activeIds.listener, listener, editorMode);

    if (editorMode === 'create') {
      statusEmpty.hidden = true;
      statusList.hidden = true;
      pathsCard.hidden = true;
      statusTitle.textContent = 'Draft Status';
      return;
    }

    statusTitle.textContent = 'Status';
    statusEmpty.hidden = true;
    statusList.hidden = false;
    pathsCard.hidden = !statusDetails.supportedPaths.length;
    statusHost = byId('listenerStatus');
    statusHtml = [];
    statusHtml.push(['Name', getListenerDisplayName(state.activeIds.listener, listener)]);
    statusHtml.push(['Northbound API Mode', statusDetails.northboundApiMode]);
    statusHtml.push(['Assigned Policy', getListenerPolicyDisplayName(listener)]);
    statusHtml.push(['Streaming', listener.streaming !== false ? 'Enabled' : 'Disabled']);
    statusHtml.push(['Client Authentication', listener.client_auth_type || 'none']);
    if ((listener.client_auth_type || 'none') === 'virtual_key') {
      statusHtml.push([
        'Allowed Virtual Key Pools',
        getListenerAllowedPoolDisplayNames(listener).join(', ') || 'None selected'
      ]);
    }
    statusHtml.push(['Assigned iRule', statusDetails.assignedIRule]);
    statusHtml = statusHtml.map(function (entry) {
      return '<div><dt>' + escapeHtml(entry[0]) + '</dt><dd>' + (entry[1] ? escapeHtml(entry[1]) : '<span class="stat-empty">Not reported</span>') + '</dd></div>';
    }).join('');
    statusHost.innerHTML = statusHtml;

    byId('listenerPaths').innerHTML = statusDetails.supportedPaths.map(function (path) {
      return '<span class="path-pill">' + path + '</span>';
    }).join('');
  }

  function renderListenerForm() {
    var activeListener = state.listeners[state.activeIds.listener];
    var listener = getListenerFormModel();
    var editorMode = state.ui.listenerEditorMode;
    var emptyState = byId('listenerEmptyState');
    var editorPanel = byId('listenerEditorPanel');
    var editorTitle = byId('listenerEditorTitle');
    var confirmButton = byId('listenerConfirmButton');
    if (confirmButton) {
      confirmButton.hidden = true;
    }

    if (!listener) {
      renderListenerLayout();
      emptyState.hidden = false;
      editorPanel.hidden = true;
      renderListenerStatusPanel(listener, editorMode);
      return;
    }

    renderListenerLayout();
    if (editorMode === 'empty') {
      emptyState.hidden = false;
      editorPanel.hidden = true;
    } else {
      emptyState.hidden = true;
      editorPanel.hidden = false;
      editorTitle.textContent = editorMode === 'create' ? 'Create Virtual Service' : 'Listener Configuration';
      if (confirmButton) {
        confirmButton.hidden = editorMode !== 'create' && editorMode !== 'edit';
        resetCommitButton(confirmButton);
      }

      listener.advanced = listener.advanced || {};
      setValue('listener_virtual_service', listener.virtual_service);
      setValue('listener_vip', listener.vip);
      setValue('listener_port', listener.port);
      byId('listener_policy_ref').innerHTML = buildListenerPolicyOptions(listener.policy_ref || '');
      byId('listener_client_auth').value = listener.client_auth_type;
      renderListenerAllowedPoolSelector(listener);
      setToggle('listener_streaming', listener.streaming);
      setValue('listener_payload', listener.advanced.max_payload_bytes);
      setValue('listener_timeout', listener.advanced.decision_timeout_ms);
      byId('listener_request_id_mode').value = listener.advanced.request_id_mode;
      if (pendingListenerValidationActive) {
        setListenerRequiredErrors(getMissingListenerRequiredFields(listener));
      } else {
        clearListenerRequiredErrors();
      }
    }

    renderListenerStatusPanel(editorMode === 'create' ? listener : activeListener, editorMode);
  }

  function renderClassifierList() {
    var host = byId('classifierList');
    var html = '';
    var statusModel;
    var bypassEnabled;

    Object.keys(state.classifiers).forEach(function (key) {
      var classifier = state.classifiers[key];
      var active = key === state.activeIds.classifier ? ' is-active' : '';
      statusModel = getClassifierStatusModel(key, classifier);
      bypassEnabled = getClassifierListBypassState(key);
      html += '<div class="list-item' + active + '">' +
        '<button type="button" class="list-item__main" data-classifier="' + key + '">' +
        '<span class="list-item__status">' + renderBackendDenseStatus(statusModel) + '</span>' +
        '<span class="list-item__content">' +
        '<strong>' + classifier.classifier_name + '</strong>' +
        '<div class="meta-line">' + classifier.classifier_type + '</div>' +
        '<div class="mono-line">' + classifier.schema_family + '</div>' +
        '</span>' +
        '</button>' +
        '<div class="row-action-group row-action-group--compact">' +
        '<button class="classifier-bypass-switch' + (bypassEnabled ? ' is-on' : '') + '" type="button" data-classifier-bypass="' + key + '" aria-pressed="' + (bypassEnabled ? 'true' : 'false') + '" aria-label="Toggle classifier bypass">' +
        '<span class="classifier-bypass-switch__dot"></span><span>Bypass</span>' +
        '</button>' +
        '<button class="row-action-button row-action-button--danger row-action-button--delete" type="button" data-classifier-delete="' + key + '" aria-label="Delete classifier">&#x1F5D1;&#xFE0E;</button>' +
        '</div>' +
        '</div>';
    });

    if (!html) {
      html = '<div class="empty-editor empty-editor--compact"><h3>No classifiers defined.</h3></div>';
    }

    host.innerHTML = html;
  }

  function getClassifierListBypassState(classifierId) {
    if (
      state.ui &&
      state.ui.classifierEditorMode === 'edit' &&
      pendingClassifierDraft &&
      pendingClassifierDraftId === classifierId
    ) {
      return !!pendingClassifierDraft.bypass_enabled;
    }

    return !!(state.classifiers[classifierId] && state.classifiers[classifierId].bypass_enabled);
  }

  function confirmClassifierBypass(classifierName) {
    return window.confirm(
      'Bypass classifier "' + classifierName + '"?\n\n' +
      '1. Policies using it will skip classification and use their Default Rule.\n' +
      '2. Click Commit to save this draft change.\n' +
      '3. Click Deploy Changes to apply it.'
    );
  }

  function setClassifierBypass(classifierId, next) {
    var classifier = state.classifiers[classifierId];
    var draft;
    var classifierName;

    if (!classifier) {
      return;
    }

    classifierName = classifier.classifier_name || classifierId;
    if (next && !confirmClassifierBypass(classifierName)) {
      setToggle('classifier_bypass', false);
      return;
    }

    state.activeIds.classifier = classifierId;
    state.ui.classifierEditorMode = 'edit';
    draft = ensureClassifierEditDraft();
    if (!draft) {
      return;
    }
    draft.bypass_enabled = next;
    setToggle('classifier_bypass', next);
    renderClassifierList();
    renderClassifierForm();
    renderPolicyList();
    renderPolicyStatus();
  }

  function deleteClassifier(classifierId) {
    var keys;

    if (!classifierId || !state.classifiers[classifierId]) {
      return;
    }

    if (!window.confirm('Delete this classifier?')) {
      return;
    }

    if (pendingClassifierDraft && pendingClassifierDraftId === classifierId) {
      discardPendingClassifierDraft();
    }

    delete state.classifiers[classifierId];
    Object.keys(state.routingPolicies || {}).forEach(function (policyId) {
      if (state.routingPolicies[policyId].classifier_ref === classifierId) {
        state.routingPolicies[policyId].classifier_ref = '';
      }
      (state.routingPolicies[policyId].key_rules || []).forEach(function (rule) {
        if (rule.classifier_ref === classifierId) {
          rule.classifier_ref = '';
        }
      });
    });
    keys = Object.keys(state.classifiers);

    if (!keys.length) {
      state.activeIds.classifier = '';
      state.ui.classifierEditorMode = 'empty';
    } else if (state.activeIds.classifier === classifierId) {
      state.activeIds.classifier = keys[0];
      state.ui.classifierEditorMode = 'edit';
    }

    markDirty('delete classifier');
    renderAll();
  }

  function getClassifierStatus(classifier) {
    var hasCommon = classifier && classifier.schema_family && classifier.endpoint_url && classifier.pool_name && (classifier.candidate_tags || []).length;

    if (!hasCommon) {
      return 'draft';
    }

    if (classifier.classifier_type === 'classifier_nli') {
      return classifier.hypothesis_template ? 'active' : 'draft';
    }

    if (classifier.classifier_type === 'classifier_llm') {
      return classifier.model_id && classifier.classifier_prompt ? 'active' : 'draft';
    }

    return 'inactive';
  }

  function renderClassifierTagSection(classifier, isNli) {
    var tagInput = byId('classifier_tags');
    var tagLabel = byId('classifierTagsLabel');
    var tagHelp = byId('classifierTagsHelp');
    var tagPreview = byId('classifierTagPreview');
    var isEditingTagInput = !!(isNli && tagInput && document.activeElement === tagInput);

    if (tagLabel) {
      tagLabel.innerHTML = isNli
        ? 'Candidate Tags'
        : 'Candidate Tags (Derived) <span class="help-icon" data-tooltip="Use {{tag}} placeholders inside Classifier Prompt. Tags are auto-extracted and color-mapped." tabindex="0" aria-label="Use {{tag}} placeholders inside Classifier Prompt. Tags are auto-extracted and color-mapped.">?</span>';
    }
    if (tagHelp) {
      tagHelp.hidden = true;
      tagHelp.textContent = '';
    }
    if (tagInput) {
      tagInput.hidden = !isNli;
      tagInput.readOnly = !isNli;
      tagInput.classList.toggle('is-readonly', !isNli);
      tagInput.placeholder = isNli ? 'chat, f5, bad, unknown' : '';
      if (!isEditingTagInput) {
        tagInput.value = (classifier.candidate_tags || []).join(', ');
      }
    }
    if (tagPreview) {
      tagPreview.classList.toggle('tag-chip-list--derived', !isNli);
      tagPreview.innerHTML = buildTagChipList(classifier.candidate_tags || [], isNli ? 'No candidate tags configured' : 'No {{tag}} placeholders found');
    }
  }

  function clearClassifierTestResult() {
    var result = byId('classifierTestResult');
    if (!result) {
      return;
    }
    result.hidden = true;
    result.className = 'classifier-test-result';
    result.innerHTML = '';
  }

  function renderClassifierTestPending(message) {
    var result = byId('classifierTestResult');
    if (!result) {
      return;
    }
    result.hidden = false;
    result.className = 'classifier-test-result';
    result.innerHTML = '<strong>Testing.</strong> ' + escapeHtml(message || 'Preparing classifier test request...');
  }

  function renderClassifierTestResult(payload, isError) {
    var result = byId('classifierTestResult');
    var confidence;
    var candidateText;
    var detailText = '';

    if (!result) {
      return;
    }

    result.hidden = false;
    result.className = 'classifier-test-result' + (isError ? ' classifier-test-result--error' : '');

    if (isError) {
      if (payload && (payload.source || payload.status_code || payload.provider_message || payload.finish_reason || payload.recommended_max_tokens || payload.details || payload.elapsed_ms)) {
        detailText =
          '<div><strong>Source:</strong> ' + escapeHtml(payload.source || 'test_worker') + '</div>' +
          (payload.status_code ? '<div><strong>HTTP status:</strong> ' + escapeHtml(payload.status_code) + '</div>' : '') +
          (payload.provider_message ? '<div><strong>Provider:</strong> ' + escapeHtml(payload.provider_message) + '</div>' : '') +
          (payload.finish_reason ? '<div><strong>Finish reason:</strong> ' + escapeHtml(payload.finish_reason) + '</div>' : '') +
          (payload.recommended_max_tokens ? '<div><strong>Recommended Max Tokens:</strong> ' + escapeHtml(payload.recommended_max_tokens) + '</div>' : '') +
          (payload.details ? '<div><strong>Details:</strong> ' + escapeHtml(payload.details) + '</div>' : '') +
          (payload.elapsed_ms ? '<div><strong>Elapsed:</strong> ' + escapeHtml(payload.elapsed_ms) + ' ms</div>' : '');
      }
      result.innerHTML = '<strong>Test failed.</strong> ' + escapeHtml((payload && payload.message) || 'Classifier test failed.') + detailText;
      return;
    }

    confidence = typeof payload.confidence === 'number' ? payload.confidence.toFixed(3) : escapeHtml(payload.confidence || '');
    candidateText = payload.candidates && payload.candidates.length
      ? '<div>Top candidates: ' + payload.candidates.slice(0, 3).map(function (candidate) {
        return escapeHtml(candidate.tag || '') + ' ' + (typeof candidate.confidence === 'number' ? candidate.confidence.toFixed(3) : escapeHtml(candidate.confidence || ''));
      }).join(', ') + '</div>'
      : '';

    result.innerHTML =
      '<div><strong>Matched tag:</strong> ' + buildTagChip(payload.tag || 'unknown', 'tag-chip--compact') + '</div>' +
      '<div><strong>Confidence:</strong> ' + confidence + '</div>' +
      '<div><strong>Source:</strong> ' + escapeHtml(payload.source || 'provider') + '</div>' +
      '<div><strong>Elapsed:</strong> ' + escapeHtml(payload.elapsed_ms || 0) + ' ms</div>' +
      candidateText;
  }

  function renderClassifierForm() {
    var classifier;
    var isNli;
    var schemaOptions;
    var form = byId('classifierForm');
    var testPanel = document.querySelector('.classifier-test-panel');
    var editorTitle = byId('classifierEditorTitle');
    var confirmButton = byId('classifierConfirmButton');

    if (state && state.activePage !== 'classifier') {
      discardPendingClassifierDraftIfSynced();
      if (form) {
        form.hidden = true;
      }
      if (testPanel) {
        testPanel.hidden = true;
      }
      return;
    }

    if (!state || !state.ui || state.ui.classifierEditorMode === 'empty') {
      discardPendingClassifierDraftIfSynced();
      if (form) {
        form.hidden = true;
      }
      if (testPanel) {
        testPanel.hidden = true;
      }
      return;
    }

    classifier = getClassifierFormModel();

    if (confirmButton) {
      confirmButton.hidden = true;
    }
    if (!classifier) {
      if (form) {
        form.hidden = true;
      }
      if (testPanel) {
        testPanel.hidden = true;
      }
      return;
    }

    if (form) {
      form.hidden = false;
    }
    if (testPanel) {
      testPanel.hidden = false;
    }
    if (editorTitle) {
      editorTitle.textContent = state.ui.classifierEditorMode === 'create' ? 'Create Classifier' : 'Classifier Definition';
    }
    if (confirmButton) {
      confirmButton.hidden = state.ui.classifierEditorMode !== 'create' && state.ui.classifierEditorMode !== 'edit';
      resetCommitButton(confirmButton);
    }

    syncClassifierCandidateTags(classifier);
    isNli = classifier.classifier_type === 'classifier_nli';
    ensureClassifierNliDefaultHypothesis(classifier);
    classifier.schema_family = normalizeClassifierSchemaFamily(classifier.classifier_type, classifier.schema_family);
    schemaOptions = getClassifierSchemaOptions(classifier.classifier_type);

    setValue('classifier_name', classifier.classifier_name);
    byId('classifier_type').value = classifier.classifier_type;
    byId('classifier_schema').innerHTML = schemaOptions.map(function (option) {
      var isSelected = option.value === classifier.schema_family ? ' selected' : '';
      return '<option value="' + option.value + '"' + isSelected + '>' + option.label + '</option>';
    }).join('');
    setValue('classifier_endpoint', classifier.endpoint_url);
    if (byId('classifier_pool')) {
      byId('classifier_pool').innerHTML = buildPoolOptions(classifier.pool_name);
      setValue('classifier_pool', getSelectedPoolValue(classifier.pool_name));
    }
    setValue('classifier_api_key', getSecretDisplayValue(classifier));
    setValue('classifier_model', classifier.model_id);
    setValue('classifier_temperature', classifier.temperature);
    setValue('classifier_max_tokens', classifier.max_tokens);
    setValue('classifier_prompt', classifier.classifier_prompt || '');
    setValue('classifier_tags', (classifier.candidate_tags || []).join(', '));
    renderClassifierFallbackOptions(classifier);
    setToggle('classifier_bypass', classifier.bypass_enabled);
    setToggle('classifier_rules_first', classifier.use_built_in_rules_first);
    setValue('classifier_timeout', classifier.timeout_ms);
    setValue('classifier_min_confidence', classifier.min_confidence);
    setToggle('classifier_multi_label', classifier.multi_label);
    setValue('classifier_hypothesis', classifier.hypothesis_template || '');
    setValue('classifier_min_margin', classifier.min_margin);

    document.querySelectorAll('.llm-only').forEach(function (element) {
      element.style.display = isNli ? 'none' : '';
    });
    document.querySelectorAll('.nli-only').forEach(function (element) {
      element.style.display = isNli ? '' : 'none';
    });
    renderPoolCatalogControls();
    renderClassifierPoolStatus(state.ui.classifierEditorMode === 'edit' ? (pendingClassifierDraftId || state.activeIds.classifier) : '', classifier);
    renderClassifierTagSection(classifier, isNli);
    renderClassifierProbeButton();
    if (pendingClassifierValidationActive) {
      setClassifierRequiredErrors(getMissingClassifierRequiredFields(classifier));
    } else {
      clearClassifierRequiredErrors();
    }
  }

  function syncClassifierFromForm(classifier) {
    var isNli;

    if (!classifier) {
      return null;
    }

    classifier.classifier_type = getValue('classifier_type') || classifier.classifier_type || 'classifier_llm';
    isNli = classifier.classifier_type === 'classifier_nli';
    classifier.classifier_name = getValue('classifier_name');
    classifier.schema_family = normalizeClassifierSchemaFamily(classifier.classifier_type, getValue('classifier_schema'));
    classifier.endpoint_url = getValue('classifier_endpoint');
    classifier.pool_name = normalizePoolReference(getValue('classifier_pool'));
    setSecretValue(classifier, getValue('classifier_api_key'));
    classifier.model_id = getValue('classifier_model');
    classifier.temperature = parseFloat(getValue('classifier_temperature')) || 0;
    classifier.max_tokens = parseInt(getValue('classifier_max_tokens'), 10) || 0;
    classifier.classifier_prompt = getValue('classifier_prompt');
    classifier.candidate_tags = isNli ? parseTagList(getValue('classifier_tags')) : extractPromptTags(classifier.classifier_prompt);
    classifier.fallback_tag = getValue('classifier_fallback');
    ensureClassifierFallbackTag(classifier);
    classifier.timeout_ms = parseInt(getValue('classifier_timeout'), 10) || 0;
    classifier.min_confidence = parseFloat(getValue('classifier_min_confidence')) || 0;
    classifier.hypothesis_template = getValue('classifier_hypothesis');
    classifier.min_margin = parseFloat(getValue('classifier_min_margin')) || 0;

    return classifier;
  }

  function syncActiveClassifierFromForm() {
    var classifier = getClassifierFormModel();
    var isNli;

    if (!classifier) {
      return null;
    }

    syncClassifierFromForm(classifier);
    isNli = classifier.classifier_type === 'classifier_nli';
    renderClassifierTagSection(classifier, isNli);
    renderClassifierFallbackOptions(classifier);
    return classifier;
  }

  function syncListenerFromForm(listener) {
    var portValue;
    var authType;

    if (!listener) {
      return;
    }

    listener.advanced = listener.advanced || {};
    listener.virtual_service = getValue('listener_virtual_service');
    listener.listener_name = state.ui && state.ui.listenerEditorMode === 'create'
      ? listener.virtual_service
      : (listener.listener_name || listener.virtual_service);
    listener.vip = getValue('listener_vip');
    portValue = getValue('listener_port');
    listener.port = portValue === '' ? '' : (parseInt(portValue, 10) || 0);
    listener.policy_ref = getValue('listener_policy_ref');
    authType = getValue('listener_client_auth');
    listener.client_auth_type = authType;
    listener.allowed_virtual_key_pool_refs = authType === 'virtual_key'
      ? getListenerAllowedPoolRefs(listener)
      : [];
    listener.advanced.max_payload_bytes = parseInt(getValue('listener_payload'), 10) || 0;
    listener.advanced.decision_timeout_ms = parseInt(getValue('listener_timeout'), 10) || 0;
    listener.advanced.request_id_mode = getValue('listener_request_id_mode');
  }

  function normalizeClassifierMaxTokensForTest(classifier) {
    var modelId = String((classifier && (classifier.model_id || classifier.modelId)) || '').toLowerCase();
    var currentValue = Number((classifier && (classifier.max_tokens || classifier.maxTokens)) || 0);

    if (!classifier || classifier.classifier_type === 'classifier_nli') {
      return 0;
    }
    if (modelId.indexOf('deepseek') < 0 || currentValue >= DEEPSEEK_CLASSIFIER_MIN_MAX_TOKENS) {
      return 0;
    }

    classifier.max_tokens = DEEPSEEK_CLASSIFIER_MIN_MAX_TOKENS;
    setValue('classifier_max_tokens', DEEPSEEK_CLASSIFIER_MIN_MAX_TOKENS);
    return DEEPSEEK_CLASSIFIER_MIN_MAX_TOKENS;
  }

  function syncBackendFromForm(backend) {
    var credentialSource;

    if (!backend) {
      return;
    }

    backend.backend_target_name = getValue('backend_name');
    backend.schema_family = normalizeBackendSchemaFamily(getValue('backend_schema'));
    backend.endpoint_url = getValue('backend_endpoint');
    credentialSource = getValue('backend_credential_source') || getBackendFormCredentialSource(backend);
    pendingBackendCredentialSource = normalizeBackendCredentialSource(credentialSource);
    if (credentialSource === 'credential_pool') {
      setSecretValue(backend, '');
      backend.credential_pool_ref = getValue('backend_credential_pool_ref');
    } else {
      setSecretValue(backend, getValue('backend_api_key'));
      backend.credential_pool_ref = '';
    }
    backend.model_id = getValue('backend_model');
    backend.pool_name = normalizePoolReference(getValue('backend_pool'));
    backend.backend_prompt = getValue('backend_prompt');
    backend.backend_prompt_mode = getValue('backend_prompt_mode') || 'append';
    delete backend.advanced;
  }

  function applyBackendCredentialSourceSelection(source) {
    var backend = getBackendFormModel();
    var normalizedSource = normalizeBackendCredentialSource(source);

    if (!backend || state.activePage !== 'backend' || (state.ui.backendEditorMode !== 'create' && state.ui.backendEditorMode !== 'edit')) {
      return;
    }

    pendingBackendCredentialSource = normalizedSource;
    setValue('backend_credential_source', normalizedSource);
    syncBackendFromForm(backend);
    invalidateBackendProbeState();
    renderBackendForm();
    if (pendingBackendValidationActive) {
      setBackendRequiredErrors(getMissingBackendRequiredFields(backend));
    } else if (backendProbeState.validationActive) {
      setBackendRequiredErrors(getMissingBackendProbeFields(backend));
    }
  }

  function syncPolicyFromForm(policy) {
    var defaultBackend;
    var defaultResponse;
    var routingMode;

    if (!policy) {
      return;
    }

    policy.default_rule = policy.default_rule || {};
    policy.policy_type = getValue('policy_type');
    policy.policy_name = getValue('policy_name');
    policy.routing_mode = normalizeRoutingMode(getValue('policy_routing_mode'));
    routingMode = policy.routing_mode;
    policy.classifier_ref = getValue('policy_classifier_ref');
    policy.fallback_backend_target_ref = getValue('policy_fallback_backend_target');
    policy.key_rules = Array.isArray(policy.key_rules) ? policy.key_rules.map(normalizePolicyKeyRule) : [];
    if (routingMode === 'key_only') {
      policy.classifier_ref = '';
      policy.key_rules.forEach(function (rule) {
        if (rule.action === 'classify') {
          rule.action = 'route';
          rule.classifier_ref = '';
        }
      });
    }
    policy.rules = Array.isArray(policy.rules) ? policy.rules.map(normalizePolicyTagRule) : [];
    defaultBackend = getValue('policy_default_backend_target');
    defaultResponse = getValue('policy_default_response_message');

    if (defaultBackend) {
      defaultResponse = '';
    } else if (defaultResponse) {
      defaultBackend = '';
    }

    policy.default_rule.backend_target_ref = defaultBackend;
    policy.default_rule.response_message = defaultResponse;
    policy.default_rule.action = defaultBackend ? 'route' : (defaultResponse ? 'respond' : '');
  }

  function setListenerRequiredErrors(missingFields) {
    var missing = {};

    (missingFields || []).forEach(function (field) {
      missing[field.id] = true;
    });

    LISTENER_REQUIRED_FIELDS.forEach(function (field) {
      var element = byId(field.id);
      var wrapper = element && element.closest ? element.closest('.field') : null;
      var isMissing = !!missing[field.id];

      if (element) {
        element.classList.toggle('is-invalid', isMissing);
      }
      if (wrapper) {
        wrapper.classList.toggle('field--invalid', isMissing);
      }
    });
  }

  function clearListenerRequiredErrors() {
    setListenerRequiredErrors([]);
  }

  function setBackendRequiredErrors(missingFields) {
    var missing = {};

    (missingFields || []).forEach(function (field) {
      missing[field.id] = true;
    });

    BACKEND_REQUIRED_FIELDS.concat([
      BACKEND_INLINE_API_KEY_FIELD,
      BACKEND_CREDENTIAL_POOL_FIELD
    ]).forEach(function (field) {
      var element = byId(field.id);
      var wrapper = element && element.closest ? element.closest('.field') : null;
      var isMissing = !!missing[field.id];

      if (element) {
        element.classList.toggle('is-invalid', isMissing);
      }
      if (wrapper) {
        wrapper.classList.toggle('field--invalid', isMissing);
      }
    });
  }

  function clearBackendRequiredErrors() {
    setBackendRequiredErrors([]);
  }

  function setPolicyRequiredErrors(missingFields) {
    var missing = {};

    (missingFields || []).forEach(function (field) {
      missing[field.id] = true;
    });

    POLICY_REQUIRED_FIELDS.concat([
      { id: 'policy_classifier_ref' },
      { id: 'policy_default_backend_target' },
      { id: 'policy_default_response_message' }
    ]).forEach(function (field) {
      var element = byId(field.id);
      var wrapper = element && element.closest ? element.closest('.field') : null;
      var isMissing = !!missing[field.id];

      if (element) {
        element.classList.toggle('is-invalid', isMissing);
      }
      if (wrapper) {
        wrapper.classList.toggle('field--invalid', isMissing);
      }
    });
  }

  function clearPolicyRequiredErrors() {
    setPolicyRequiredErrors([]);
  }

  function setClassifierRequiredErrors(missingFields) {
    var missing = {};

    (missingFields || []).forEach(function (field) {
      missing[field.id] = true;
    });

    CLASSIFIER_REQUIRED_FIELDS.concat(CLASSIFIER_LLM_REQUIRED_FIELDS, CLASSIFIER_NLI_REQUIRED_FIELDS).forEach(function (field) {
      var element = byId(field.id);
      var wrapper = element && element.closest ? element.closest('.field') : null;
      var isMissing = !!missing[field.id];

      if (element) {
        element.classList.toggle('is-invalid', isMissing);
      }
      if (wrapper) {
        wrapper.classList.toggle('field--invalid', isMissing);
      }
    });
  }

  function clearClassifierRequiredErrors() {
    setClassifierRequiredErrors([]);
  }

  function renderPolicyDefaultRuleState(policy) {
    var backendSelect = byId('policy_default_backend_target');
    var responseInput = byId('policy_default_response_message');
    var eyebrow = byId('policyDefaultRuleEyebrow');
    var title = byId('policyDefaultRuleTitle');
    var backendLabel = byId('policyDefaultBackendLabel');
    var responseLabel = byId('policyDefaultResponseLabel');
    var defaultRule = policy && policy.default_rule ? policy.default_rule : {};
    var hasBackend = !!String(defaultRule.backend_target_ref || '').trim();
    var hasResponse = !!String(defaultRule.response_message || '').trim();
    var labelPrefix = policyDefaultRuleLabelPrefix(policy);

    if (backendSelect) {
      backendSelect.disabled = hasResponse;
      backendSelect.value = defaultRule.backend_target_ref || '';
    }
    if (responseInput) {
      responseInput.disabled = hasBackend;
      responseInput.value = defaultRule.response_message || '';
    }
    if (eyebrow) {
      eyebrow.textContent = normalizeRoutingMode(policy && policy.routing_mode) === 'key_only' ? 'No Key Match' : 'No Tag Match';
    }
    if (title) {
      title.textContent = 'Default Rule';
    }
    if (backendLabel) {
      backendLabel.innerHTML = escapeHtml(labelPrefix + ' Backend Target') + ' <em class="field-required" aria-label="required">*</em>';
    }
    if (responseLabel) {
      responseLabel.innerHTML = escapeHtml(labelPrefix + ' Local Response') + ' <em class="field-required" aria-label="required">*</em>';
    }
  }

  function renderPolicyStageLayout(policy) {
    var routingMode = normalizeRoutingMode(policy && policy.routing_mode);
    var classifierField = byId('policyClassifierField');
    var classifierSelect = byId('policy_classifier_ref');
    var keyStagePanel = byId('policyKeyStagePanel');
    var tagStagePanel = byId('policyTagStagePanel');
    var tagStageTitle = byId('policyTagStageTitle');

    if (classifierField) {
      classifierField.hidden = !policyUsesClassifierStage(policy);
    }
    if (classifierSelect) {
      classifierSelect.disabled = !policyUsesClassifierStage(policy);
    }
    if (keyStagePanel) {
      keyStagePanel.hidden = !policyUsesKeyStage(policy);
    }
    if (tagStagePanel) {
      tagStagePanel.hidden = !policyUsesClassifierStage(policy);
    }
    if (tagStageTitle) {
      tagStageTitle.textContent = routingMode === 'key_then_classifier' ? 'Classifier Tag Rules' : 'Tag Rules';
    }
  }

  function clearPendingPolicyDraft() {
    pendingPolicyDraft = null;
    pendingPolicyDraftId = '';
    pendingPolicyValidationActive = false;
    clearPolicyRequiredErrors();
  }

  function discardPendingPolicyDraft() {
    clearPendingPolicyDraft();
  }

  function discardPendingPolicyDraftIfSynced() {
    if (!pendingPolicyDraft) {
      return false;
    }

    if (!pendingPolicyDraftId) {
      if (!hasPolicyDraftContent(pendingPolicyDraft)) {
        discardPendingPolicyDraft();
        return true;
      }
      return false;
    }

    if (!state.routingPolicies[pendingPolicyDraftId]) {
      return false;
    }

    if (deepEqual(
      sanitizePolicyForConfigComparison(pendingPolicyDraft),
      sanitizePolicyForConfigComparison(state.routingPolicies[pendingPolicyDraftId])
    )) {
      discardPendingPolicyDraft();
      return true;
    }

    return false;
  }

  function clearPendingClassifierDraft() {
    pendingClassifierDraft = null;
    pendingClassifierDraftId = '';
    pendingClassifierValidationActive = false;
    clearClassifierRequiredErrors();
  }

  function discardPendingClassifierDraft() {
    clearPendingClassifierDraft();
  }

  function discardPendingClassifierDraftIfSynced() {
    if (!pendingClassifierDraft) {
      return false;
    }

    if (!pendingClassifierDraftId) {
      if (!hasClassifierDraftContent(pendingClassifierDraft)) {
        discardPendingClassifierDraft();
        return true;
      }
      return false;
    }

    if (!state.classifiers[pendingClassifierDraftId]) {
      return false;
    }

    if (deepEqual(
      sanitizeClassifierForConfigComparison(pendingClassifierDraft),
      sanitizeClassifierForConfigComparison(state.classifiers[pendingClassifierDraftId])
    )) {
      discardPendingClassifierDraft();
      return true;
    }

    return false;
  }

  function hasClassifierDraftContent(classifier) {
    var values = [
      classifier && classifier.classifier_name,
      classifier && classifier.endpoint_url,
      classifier && getSecretDisplayValue(classifier),
      classifier && classifier.pool_name,
      classifier && classifier.model_id,
      classifier && classifier.classifier_prompt,
      classifier && classifier.hypothesis_template,
      classifier && classifier.fallback_tag
    ];

    return values.some(function (value) {
      return !!String(value || '').trim();
    }) || !!normalizeTagList((classifier && classifier.candidate_tags) || []).length;
  }

  function hasPolicyDraftContent(policy) {
    var defaultRule = policy && policy.default_rule ? policy.default_rule : {};
    var keyRules = policy && Array.isArray(policy.key_rules) ? policy.key_rules : [];
    var rules = policy && Array.isArray(policy.rules) ? policy.rules : [];

    if (!policy) {
      return false;
    }

    if (String(policy.policy_name || '').trim()) {
      return true;
    }
    if (normalizeRoutingMode(policy.routing_mode) !== 'classifier_only') {
      return true;
    }
    if (String(defaultRule.backend_target_ref || '').trim() || String(defaultRule.response_message || '').trim()) {
      return true;
    }
    if (String(policy.fallback_backend_target_ref || '').trim()) {
      return true;
    }

    if (keyRules.some(function (rule) {
      var match = rule.match || {};
      return !!(
        String(rule.rule_name || '').trim() ||
        String(match.virtual_key_pool_ref || '').trim() ||
        String(match.virtual_key_ref || '').trim() ||
        String(match.virtual_key_tag || '').trim() ||
        String(rule.backend_target_ref || '').trim() ||
        String(rule.response_message || '').trim() ||
        String(rule.classifier_ref || '').trim()
      );
    })) {
      return true;
    }

    return rules.some(function (rule) {
      return !!(
        String(rule.source_tag || '').trim() ||
        String(rule.backend_target_ref || '').trim() ||
        String(rule.response_message || '').trim()
      );
    });
  }

  function clearBackendProbeResetTimer() {
    if (backendProbeState.resetTimer) {
      window.clearTimeout(backendProbeState.resetTimer);
      backendProbeState.resetTimer = 0;
    }
  }

  function scheduleBackendProbeReset() {
    clearBackendProbeResetTimer();
    backendProbeState.resetTimer = window.setTimeout(function () {
      backendProbeState.resetTimer = 0;
      backendProbeState.status = 'idle';
      backendProbeState.loading = false;
      backendProbeState.message = '';
      renderBackendProbeButton();
    }, PROBE_RESULT_RESET_DELAY_MS);
  }

  function resetBackendProbeState() {
    clearBackendProbeResetTimer();
    backendProbeState.status = 'idle';
    backendProbeState.loading = false;
    backendProbeState.message = '';
    backendProbeState.validationActive = false;
    renderBackendProbeButton();
  }

  function invalidateBackendProbeState() {
    clearBackendProbeResetTimer();
    backendProbeState.status = 'idle';
    backendProbeState.loading = false;
    backendProbeState.message = '';
    renderBackendProbeButton();
  }

  function setBackendProbeState(status, message, loading) {
    clearBackendProbeResetTimer();
    backendProbeState.status = status || 'idle';
    backendProbeState.message = message || '';
    backendProbeState.loading = !!loading;
    renderBackendProbeButton();
  }

  function renderBackendProbeButton() {
    var button = byId('backendProbeButton');
    var status = backendProbeState.status || 'idle';
    var titleMap = {
      idle: 'Probe backend model',
      ok: backendProbeState.message || 'Backend model probe succeeded',
      fail: backendProbeState.message || 'Backend model probe failed'
    };

    if (!button) {
      return;
    }

    button.disabled = !!backendProbeState.loading || !(state && state.ui && state.ui.backendEditorMode !== 'empty' && getBackendFormModel());
    button.className = 'probe-button probe-button--' + (backendProbeState.loading ? 'idle is-loading' : status);
    button.textContent = backendProbeState.loading ? '...' : (status === 'ok' ? '✓' : (status === 'fail' ? '×' : '!'));
    button.title = backendProbeState.loading ? 'Probing backend model...' : (titleMap[status] || titleMap.idle);
    button.setAttribute('aria-label', button.title);
  }

  function clearClassifierProbeResetTimer() {
    if (classifierProbeState.resetTimer) {
      window.clearTimeout(classifierProbeState.resetTimer);
      classifierProbeState.resetTimer = 0;
    }
  }

  function scheduleClassifierProbeReset() {
    clearClassifierProbeResetTimer();
    classifierProbeState.resetTimer = window.setTimeout(function () {
      classifierProbeState.resetTimer = 0;
      classifierProbeState.status = 'idle';
      classifierProbeState.loading = false;
      classifierProbeState.message = '';
      renderClassifierProbeButton();
    }, PROBE_RESULT_RESET_DELAY_MS);
  }

  function resetClassifierProbeState() {
    clearClassifierProbeResetTimer();
    classifierProbeState.status = 'idle';
    classifierProbeState.loading = false;
    classifierProbeState.message = '';
    classifierProbeState.validationActive = false;
    renderClassifierProbeButton();
  }

  function invalidateClassifierProbeState() {
    clearClassifierProbeResetTimer();
    classifierProbeState.status = 'idle';
    classifierProbeState.loading = false;
    classifierProbeState.message = '';
    renderClassifierProbeButton();
  }

  function setClassifierProbeState(status, message, loading) {
    clearClassifierProbeResetTimer();
    classifierProbeState.status = status || 'idle';
    classifierProbeState.message = message || '';
    classifierProbeState.loading = !!loading;
    renderClassifierProbeButton();
  }

  function renderClassifierProbeButton() {
    var button = byId('classifierProbeButton');
    var status = classifierProbeState.status || 'idle';
    var titleMap = {
      idle: 'Probe classifier model',
      ok: classifierProbeState.message || 'Classifier model probe succeeded',
      fail: classifierProbeState.message || 'Classifier model probe failed'
    };

    if (!button) {
      return;
    }

    button.disabled = !!classifierProbeState.loading || !(state && state.ui && state.ui.classifierEditorMode !== 'empty' && getClassifierFormModel());
    button.className = 'probe-button probe-button--' + (classifierProbeState.loading ? 'idle is-loading' : status);
    button.textContent = classifierProbeState.loading ? '...' : (status === 'ok' ? '✓' : (status === 'fail' ? '×' : '!'));
    button.title = classifierProbeState.loading ? 'Probing classifier model...' : (titleMap[status] || titleMap.idle);
    button.setAttribute('aria-label', button.title);
  }

  function getMissingClassifierProbeFields(classifier) {
    var missing = [];

    if (!classifier) {
      return missing;
    }
    if (!String(classifier.schema_family || '').trim()) {
      missing.push({ id: 'classifier_schema', label: 'Schema Family' });
    }
    if (!String(classifier.endpoint_url || '').trim()) {
      missing.push({ id: 'classifier_endpoint', label: 'Endpoint URL' });
    }
    if (!String(getSecretDisplayValue(classifier) || '').trim()) {
      missing.push({ id: 'classifier_api_key', label: 'API Key' });
    }
    if (!normalizeTagList(classifier.candidate_tags || []).length) {
      missing.push({ id: 'classifier_tags', label: 'Candidate Tags' });
    }
    if (classifier.classifier_type === 'classifier_llm') {
      if (!String(classifier.model_id || '').trim()) {
        missing.push({ id: 'classifier_model', label: 'Model ID' });
      }
      if (!String(classifier.classifier_prompt || '').trim()) {
        missing.push({ id: 'classifier_prompt', label: 'Classifier Prompt' });
      }
    }
    if (classifier.classifier_type === 'classifier_nli' && !String(classifier.hypothesis_template || '').trim()) {
      missing.push({ id: 'classifier_hypothesis', label: 'Hypothesis Template' });
    }

    return missing;
  }

  function validatePendingListenerDraftForConfirm() {
    var missingFields;

    if (!(state.ui && (state.ui.listenerEditorMode === 'create' || state.ui.listenerEditorMode === 'edit'))) {
      return false;
    }
    if (!pendingListenerDraft && state.ui.listenerEditorMode === 'edit') {
      ensureListenerEditDraft();
    }
    if (!pendingListenerDraft) {
      return false;
    }

    syncListenerFromForm(pendingListenerDraft);
    missingFields = getMissingListenerRequiredFields(pendingListenerDraft);
    pendingListenerValidationActive = true;
    setListenerRequiredErrors(missingFields);

    if (missingFields.length) {
      showToast('Virtual service requires ' + missingFields.map(function (field) { return field.label; }).join(', ') + '.', 'error');
      return false;
    }

    commitPendingListenerDraft();
    clearListenerRequiredErrors();
    renderAll();
    showCommitDone('listenerConfirmButton');
    showToast('Virtual service committed to draft.', 'success');
    return true;
  }

  function validatePendingBackendDraftForConfirm() {
    var missingFields;

    if (!(state.ui && (state.ui.backendEditorMode === 'create' || state.ui.backendEditorMode === 'edit'))) {
      return false;
    }
    if (!pendingBackendDraft && state.ui.backendEditorMode === 'edit') {
      ensureBackendEditDraft();
    }
    if (!pendingBackendDraft) {
      return false;
    }

    syncBackendFromForm(pendingBackendDraft);
    missingFields = getMissingBackendRequiredFields(pendingBackendDraft);
    pendingBackendValidationActive = true;
    setBackendRequiredErrors(missingFields);

    if (missingFields.length) {
      showToast('Backend target requires ' + missingFields.map(function (field) { return field.label; }).join(', ') + '.', 'error');
      return false;
    }

    commitPendingBackendDraft();
    clearBackendRequiredErrors();
    renderAll();
    showCommitDone('backendConfirmButton');
    showToast('Backend target committed to draft.', 'success');
    return true;
  }

  function validatePendingClassifierDraftForConfirm() {
    var missingFields;

    if (!(state.ui && (state.ui.classifierEditorMode === 'create' || state.ui.classifierEditorMode === 'edit'))) {
      return false;
    }
    if (!pendingClassifierDraft && state.ui.classifierEditorMode === 'edit') {
      ensureClassifierEditDraft();
    }
    if (!pendingClassifierDraft) {
      return false;
    }

    syncClassifierFromForm(pendingClassifierDraft);
    missingFields = getMissingClassifierRequiredFields(pendingClassifierDraft);
    pendingClassifierValidationActive = true;
    setClassifierRequiredErrors(missingFields);

    if (missingFields.length) {
      showToast('Classifier requires ' + missingFields.map(function (field) { return field.label; }).join(', ') + '.', 'error');
      return false;
    }

    commitPendingClassifierDraft();
    clearClassifierRequiredErrors();
    renderAll();
    showCommitDone('classifierConfirmButton');
    showToast('Classifier committed to draft.', 'success');
    return true;
  }

  function validatePendingPolicyDraftForConfirm() {
    var missingFields;
    var issues;

    if (!(state.ui && (state.ui.policyEditorMode === 'create' || state.ui.policyEditorMode === 'edit'))) {
      return false;
    }
    if (!pendingPolicyDraft && state.ui.policyEditorMode === 'edit') {
      ensurePolicyEditDraft();
    }
    if (!pendingPolicyDraft) {
      return false;
    }

    syncPolicyFromForm(pendingPolicyDraft);
    missingFields = getMissingPolicyRequiredFields(pendingPolicyDraft);
    issues = getPolicyValidationIssues(
      pendingPolicyDraft,
      pendingPolicyDraftId ? 'Routing Policy ' + (pendingPolicyDraft.policy_name || pendingPolicyDraftId) : 'New routing policy'
    );
    pendingPolicyValidationActive = true;
    setPolicyRequiredErrors(missingFields);

    if (missingFields.length || issues.length) {
      showToast((issues[0] || getPolicyRequiredIssues(pendingPolicyDraft, pendingPolicyDraftId ? 'Routing Policy ' + (pendingPolicyDraft.policy_name || pendingPolicyDraftId) : 'New routing policy')[0]), 'error');
      return false;
    }

    commitPendingPolicyDraft();
    clearPolicyRequiredErrors();
    renderAll();
    showCommitDone('policyConfirmButton');
    showToast('Routing policy committed to draft.', 'success');
    return true;
  }

  function commitPendingBackendDraft() {
    var newId;
    var wasCreate = state.ui && state.ui.backendEditorMode === 'create';

    if (!pendingBackendDraft) {
      return '';
    }

    if (byId('backendForm')) {
      syncBackendFromForm(pendingBackendDraft);
    }

    if (!isBackendComplete(pendingBackendDraft)) {
      return '';
    }

    newId = pendingBackendDraftId || state.activeIds.backend || buildBackendIdFromName(pendingBackendDraft.backend_target_name);
    if (wasCreate && state.backendTargets[newId]) {
      newId = buildBackendIdFromName(pendingBackendDraft.backend_target_name);
    }

    state.backendTargets[newId] = clone(pendingBackendDraft);
    state.activeIds.backend = newId;
    state.ui.backendEditorMode = 'edit';
    pendingBackendDraft = clone(state.backendTargets[newId]);
    pendingBackendDraftId = newId;
    pendingBackendCredentialSource = getBackendCredentialSourceValue(pendingBackendDraft);
    pendingBackendValidationActive = false;
    markDirty(wasCreate ? 'create backend' : 'commit backend');
    return newId;
  }

  function commitPendingClassifierDraft() {
    var newId;
    var wasCreate = state.ui && state.ui.classifierEditorMode === 'create';

    if (!pendingClassifierDraft) {
      return '';
    }

    if (byId('classifierForm')) {
      syncClassifierFromForm(pendingClassifierDraft);
    }

    if (!isClassifierComplete(pendingClassifierDraft)) {
      return '';
    }

    newId = pendingClassifierDraftId || state.activeIds.classifier || buildClassifierIdFromName(pendingClassifierDraft.classifier_name);
    if (wasCreate && state.classifiers[newId]) {
      newId = buildClassifierIdFromName(pendingClassifierDraft.classifier_name);
    }

    state.classifiers[newId] = clone(pendingClassifierDraft);
    state.activeIds.classifier = newId;
    state.ui.classifierEditorMode = 'edit';
    pendingClassifierDraft = clone(state.classifiers[newId]);
    pendingClassifierDraftId = newId;
    pendingClassifierValidationActive = false;
    markDirty(wasCreate ? 'create classifier' : 'commit classifier');
    return newId;
  }

  function commitPendingListenerDraft() {
    var newId;
    var wasCreate = state.ui && state.ui.listenerEditorMode === 'create';

    if (!pendingListenerDraft) {
      return '';
    }

    if (byId('listenerForm')) {
      syncListenerFromForm(pendingListenerDraft);
    }

    if (!isListenerComplete(pendingListenerDraft)) {
      return '';
    }

    pendingListenerDraft.listener_name = pendingListenerDraft.listener_name || pendingListenerDraft.virtual_service;
    newId = pendingListenerDraftId || state.activeIds.listener || buildListenerIdFromName(pendingListenerDraft.virtual_service);
    if (wasCreate && state.listeners[newId]) {
      newId = buildListenerIdFromName(pendingListenerDraft.virtual_service);
    }

    state.operatingMode = getValue('listener_operating_mode') || state.operatingMode || 'gateway';
    state.listeners[newId] = clone(pendingListenerDraft);
    state.activeIds.listener = newId;
    state.ui.listenerEditorMode = 'edit';
    pendingListenerDraft = clone(state.listeners[newId]);
    pendingListenerDraftId = newId;
    pendingListenerValidationActive = false;
    markDirty(wasCreate ? 'create listener' : 'commit listener');
    return newId;
  }

  function commitPendingPolicyDraft() {
    var newId;
    var wasCreate = state.ui && state.ui.policyEditorMode === 'create';

    if (!pendingPolicyDraft) {
      return '';
    }

    if (byId('policyForm')) {
      syncPolicyFromForm(pendingPolicyDraft);
    }

    if (getMissingPolicyRequiredFields(pendingPolicyDraft).length || getPolicyValidationIssues(pendingPolicyDraft).length) {
      return '';
    }

    newId = pendingPolicyDraftId || state.activeIds.policy || buildPolicyIdFromName(pendingPolicyDraft.policy_name);
    if (wasCreate && state.routingPolicies[newId]) {
      newId = buildPolicyIdFromName(pendingPolicyDraft.policy_name);
    }

    state.routingPolicies[newId] = clone(pendingPolicyDraft);
    state.activeIds.policy = newId;
    state.activeIds.ruleIndex = 0;
    state.ui.policyEditorMode = 'edit';
    pendingPolicyDraft = clone(state.routingPolicies[newId]);
    pendingPolicyDraftId = newId;
    pendingPolicyValidationActive = false;
    markDirty(wasCreate ? 'create policy' : 'commit policy');
    return newId;
  }

  function clearPendingListenerDraft() {
    pendingListenerDraft = null;
    pendingListenerDraftId = '';
    pendingListenerValidationActive = false;
    clearListenerRequiredErrors();
  }

  function discardPendingListenerDraft() {
    clearPendingListenerDraft();
  }

  function hasListenerDraftContent(listener) {
    var values = [
      listener && listener.virtual_service,
      listener && listener.vip,
      listener && listener.port,
      listener && listener.policy_ref
    ];

    return values.some(function (value) {
      return !!String(value || '').trim();
    });
  }

  function clearPendingBackendDraft() {
    pendingBackendDraft = null;
    pendingBackendDraftId = '';
    pendingBackendCredentialSource = '';
    pendingBackendValidationActive = false;
    clearBackendRequiredErrors();
  }

  function discardPendingBackendDraft() {
    clearPendingBackendDraft();
    resetBackendProbeState();
  }

  function hasBackendDraftContent(backend) {
    var values = [
      backend && backend.backend_target_name,
      backend && backend.endpoint_url,
      backend && getSecretDisplayValue(backend),
      backend && backend.credential_pool_ref,
      backend && backend.model_id,
      backend && backend.pool_name,
      backend && backend.backend_prompt
    ];

    return values.some(function (value) {
      return !!String(value || '').trim();
    });
  }

  function renderBackendList() {
    var host = byId('backendList');
    var selectAll = byId('backendSelectAll');
    var searchInput = byId('backendSearchInput');
    var visibleBackendIds = getVisibleBackendIds();
    var pageState = clampBackendPage(visibleBackendIds.length);
    var backendIds = isShowAllPage(pageState.currentPage)
      ? visibleBackendIds
      : visibleBackendIds.slice((pageState.currentPage - 1) * VIRTUAL_KEY_PAGE_SIZE, pageState.currentPage * VIRTUAL_KEY_PAGE_SIZE);
    var html = '';
    var selectedCount = 0;
    var statusModel;

    Object.keys(backendSelection).forEach(function (key) {
      if (!state.backendTargets[key]) {
        delete backendSelection[key];
      }
    });

    if (searchInput && searchInput.value !== backendSearchTerm) {
      searchInput.value = backendSearchTerm;
    }

    backendIds.forEach(function (key) {
      var backend = state.backendTargets[key];
      var active = key === state.activeIds.backend ? ' is-active' : '';
      var isSelected = !!backendSelection[key];

      if (isSelected) {
        selectedCount += 1;
      }

      statusModel = getBackendStatusModel(key, backend);
      html += '<tr class="' + active.trim() + '" data-backend="' + escapeHtml(key) + '">' +
        '<td class="backend-checkbox-col"><input type="checkbox" data-backend-select="' + escapeHtml(key) + '"' + (isSelected ? ' checked' : '') + ' aria-label="Select Backend Target ' + escapeHtml(backend.backend_target_name || key) + '"></td>' +
        '<td class="backend-status-cell">' + renderBackendDenseStatus(statusModel) + '</td>' +
        '<td>' +
        '<span class="table-primary">' + escapeHtml(backend.backend_target_name || 'target pending') + '</span>' +
        '</td>' +
        '<td><span class="table-secondary">' + escapeHtml(backend.pool_name || 'pool pending') + '</span></td>' +
        '<td><span class="table-secondary">' + escapeHtml(backend.model_id || 'model pending') + '</span></td>' +
        '<td><div class="row-action-group row-action-group--compact">' +
        '<button class="row-action-button virtual-key-config-button" type="button" data-backend-config="' + escapeHtml(key) + '" title="Configure backend target" aria-label="Configure backend target"></button>' +
        '<button class="row-action-button row-action-button--danger row-action-button--delete" type="button" data-backend-delete="' + escapeHtml(key) + '" aria-label="Delete backend target">&#x1F5D1;&#xFE0E;</button>' +
        '</div></td>' +
        '</tr>';
    });

    if (!html) {
      html = '<tr><td class="table-empty" colspan="6"><div class="empty-editor"><p class="eyebrow">No Backend Targets</p><h3>' +
        (Object.keys(state.backendTargets || {}).length ? 'No backend targets match the current search.' : 'Add the first backend target to begin.') +
        '</h3></div></td></tr>';
    }

    host.innerHTML = html;
    if (selectAll) {
      selectAll.checked = backendIds.length > 0 && selectedCount === backendIds.length;
      selectAll.indeterminate = selectedCount > 0 && selectedCount < backendIds.length;
    }
    renderBackendPagination(visibleBackendIds.length, pageState);
  }

  function renderBackendPagination(totalVisibleBackends, pageState) {
    var select = byId('backendPageSelect');

    if (!select) {
      return;
    }

    select.innerHTML = buildVirtualKeyPageOptions(totalVisibleBackends, pageState);
    select.disabled = totalVisibleBackends === 0;
  }

  function getPolicyDisplayName(policyId, policy) {
    return (policy && policy.policy_name) || policyId;
  }

  function getPolicyClassifierDisplayName(policy) {
    var classifierId = policy && policy.classifier_ref;
    var classifier = classifierId ? state.classifiers[classifierId] : null;

    return classifier ? (classifier.classifier_name || classifierId) : 'classifier pending';
  }

  function getPolicyDefaultRuleSummary(policy) {
    var defaultRule = policy && policy.default_rule ? policy.default_rule : {};
    var action = defaultRule.action || 'route';

    if (action === 'route') {
      return defaultRule.backend_target_ref || 'route pending';
    }

    return defaultRule.response_message || 'local response';
  }

  function getVisiblePolicyIds() {
    var term = normalizeSearchTerm(policySearchTerm);

    return Object.keys(state.routingPolicies || {}).filter(function (policyId) {
      var policy = state.routingPolicies[policyId] || {};
      var classifierName;
      var entryCount;
      var defaultRuleSummary;
      var haystack;

      if (!term) {
        return true;
      }

      classifierName = getPolicyClassifierDisplayName(policy);
      entryCount = (policy.rules || []).length + (policy.key_rules || []).length;
      defaultRuleSummary = getPolicyDefaultRuleSummary(policy);
      haystack = [
        policyId,
        policy.policy_name || '',
        policy.policy_type || '',
        policy.routing_mode || '',
        policy.classifier_ref || '',
        classifierName,
        defaultRuleSummary,
        String(entryCount),
        getPolicyEntryCountSummary(policy),
        entryCount + ' entries',
        entryCount + ' entry'
      ].map(normalizeSearchTerm).join(' ');

      return haystack.indexOf(term) >= 0;
    }).sort(function (left, right) {
      return getPolicyDisplayName(left, state.routingPolicies[left]).localeCompare(getPolicyDisplayName(right, state.routingPolicies[right]));
    });
  }

  function clampPolicyPage(totalVisiblePolicies) {
    var pageState = getPageState(totalVisiblePolicies, policyPage);

    policyPage = pageState.currentPage;
    return pageState;
  }

  function getCurrentPagePolicyIds() {
    var visiblePolicyIds = getVisiblePolicyIds();
    var pageState = clampPolicyPage(visiblePolicyIds.length);
    var startIndex;

    if (isShowAllPage(pageState.currentPage)) {
      return visiblePolicyIds;
    }

    startIndex = (pageState.currentPage - 1) * VIRTUAL_KEY_PAGE_SIZE;
    return visiblePolicyIds.slice(startIndex, startIndex + VIRTUAL_KEY_PAGE_SIZE);
  }

  function renderPolicyPagination(totalVisiblePolicies, pageState) {
    var select = byId('policyPageSelect');

    if (!select) {
      return;
    }

    select.innerHTML = buildVirtualKeyPageOptions(totalVisiblePolicies, pageState);
    select.disabled = totalVisiblePolicies === 0;
  }

  function prunePolicyPresentationState() {
    Object.keys(policySelection).forEach(function (policyId) {
      if (!state.routingPolicies[policyId]) {
        delete policySelection[policyId];
      }
    });
    clampPolicyPage(getVisiblePolicyIds().length);
  }

  function collectBackendPolicyReferences(backendId) {
    var refs = [];

    Object.keys(state.routingPolicies || {}).forEach(function (policyId) {
      var policy = state.routingPolicies[policyId] || {};
      var displayName = getPolicyDisplayName(policyId, policy);
      var defaultRule = policy.default_rule || {};

      if ((defaultRule.action || 'route') === 'route' && defaultRule.backend_target_ref === backendId) {
        refs.push('Routing Policy "' + displayName + '" default rule');
      }

      (policy.key_rules || []).forEach(function (rule, index) {
        if (policyUsesKeyStage(policy) && rule.action === 'route' && rule.backend_target_ref === backendId) {
          refs.push('Routing Policy "' + displayName + '" key rule #' + (index + 1));
        }
      });

      (policy.rules || []).forEach(function (rule, index) {
        if (policyUsesClassifierStage(policy) && rule.action === 'route' && rule.backend_target_ref === backendId) {
          refs.push('Routing Policy "' + displayName + '" entry #' + (index + 1));
        }
      });
    });

    return refs;
  }

  function deleteBackendTargets(backendIds) {
    var ids = [];
    var keys;
    var refLines = [];
    var refText;
    var activeDeleted = false;

    (backendIds || []).forEach(function (backendId) {
      if (backendId && state.backendTargets[backendId] && ids.indexOf(backendId) < 0) {
        ids.push(backendId);
      }
    });

    if (!ids.length) {
      return;
    }

    ids.forEach(function (backendId) {
      var refs = collectBackendPolicyReferences(backendId);
      var backendName = (state.backendTargets[backendId] && state.backendTargets[backendId].backend_target_name) || backendId;

      if (refs.length) {
        refLines.push(backendName + ': ' + refs.slice(0, 3).join('; ') +
          (refs.length > 3 ? '; and ' + (refs.length - 3) + ' more references' : ''));
      }
    });

    refText = refLines.length ? '\n\nThese Backend Targets are still used by:\n- ' + refLines.slice(0, 5).join('\n- ') +
      (refLines.length > 5 ? '\n- and ' + (refLines.length - 5) + ' more targets with references' : '') +
      '\n\nDeploy will be blocked until those policy references are updated.' : '';

    if (!window.confirm('Delete ' + formatCountLabel(ids.length, 'Backend Target', 'Backend Targets') + '?' + refText)) {
      return;
    }

    ids.forEach(function (backendId) {
      if (pendingBackendDraft && pendingBackendDraftId === backendId) {
        discardPendingBackendDraft();
      }
      if (state.activeIds.backend === backendId) {
        activeDeleted = true;
      }
      delete state.backendTargets[backendId];
      delete backendSelection[backendId];
    });

    keys = Object.keys(state.backendTargets);

    if (!keys.length) {
      state.activeIds.backend = '';
      state.ui.backendEditorMode = 'empty';
    } else if (activeDeleted) {
      state.activeIds.backend = keys[0];
      state.ui.backendEditorMode = 'empty';
    }

    markDirty(ids.length === 1 ? 'delete backend' : 'bulk delete backends');
    renderAll();
  }

  function deleteBackend(backendId) {
    deleteBackendTargets([backendId]);
  }

  function deleteSelectedBackends() {
    var ids = Object.keys(backendSelection).filter(function (backendId) {
      return backendSelection[backendId] && state.backendTargets[backendId];
    });

    if (!ids.length) {
      showToast('Select at least one Backend Target.', 'error');
      return;
    }

    deleteBackendTargets(ids);
  }

  function bindBackendListActions() {
    var searchInput = byId('backendSearchInput');
    var pageSelect = byId('backendPageSelect');

    if (searchInput) {
      searchInput.addEventListener('input', function () {
        backendSearchTerm = searchInput.value || '';
        backendPage = 1;
        backendSelection = {};
        renderBackendList();
      });
    }

    if (pageSelect) {
      pageSelect.addEventListener('change', function () {
        backendPage = pageSelect.value === 'all' ? 'all' : parseInt(pageSelect.value, 10) || 1;
        renderBackendList();
      });
    }
  }

  function renderBackendLayout() {
    var layout = byId('backendLayout');
    var editorCard = byId('backendEditorCard');
    var isExpanded = state.ui.backendEditorMode !== 'empty' && !!getActiveBackend();

    if (!layout || !editorCard) {
      return;
    }

    layout.classList.toggle('is-expanded', isExpanded);
    editorCard.hidden = !isExpanded;
  }

  function collapseBackendEditor() {
    if (state.ui.backendEditorMode === 'empty') {
      return;
    }

    state.ui.backendEditorMode = 'empty';
    renderAll();
  }

  function renderBackendRefreshButton(backend, editorMode) {
    var button = byId('refreshBackendStatusButton');
    var disabled = !backend || editorMode === 'create' || runtimeStatusState.loading;

    if (!button) {
      return;
    }

    button.disabled = disabled;
    button.classList.toggle('is-loading', runtimeStatusState.loading);
  }

  function getBackendMemberLabel(member, index) {
    return firstDefined([
      member && member.name,
      member && member.address,
      member && member.member,
      'Pool member ' + (index + 1)
    ]);
  }

  function getBackendMemberMeta(member) {
    return firstDefined([
      member && member.address,
      member && member.ip_address,
      member && member.endpoint,
      member && member.session,
      member && member.state
    ]);
  }

  function parseEndpointUrlForDisplay(endpointUrl) {
    var original = String(endpointUrl || '').trim();
    var protocol = 'https';
    var remainder = original;
    var slashIndex;
    var hostPort;
    var colonIndex;
    var hostname = '';

    if (!original) {
      return {
        protocol: '',
        hostname: ''
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
    colonIndex = hostPort.lastIndexOf(':');
    hostname = colonIndex > 0 ? hostPort.slice(0, colonIndex) : hostPort;

    return {
      protocol: protocol,
      hostname: hostname
    };
  }

  function collectPolicyRouteBackendRefs(policy) {
    var refs = {};
    var defaultRule = policy && policy.default_rule ? policy.default_rule : {};

    if ((defaultRule.action || 'route') === 'route' && defaultRule.backend_target_ref) {
      refs[defaultRule.backend_target_ref] = true;
    }

    ((policy && policy.key_rules) || []).forEach(function (rule) {
      if (policyUsesKeyStage(policy) && rule && rule.action === 'route' && rule.backend_target_ref) {
        refs[rule.backend_target_ref] = true;
      }
    });

    ((policy && policy.rules) || []).forEach(function (rule) {
      if (policyUsesClassifierStage(policy) && rule && rule.action === 'route' && rule.backend_target_ref) {
        refs[rule.backend_target_ref] = true;
      }
    });

    return refs;
  }

  function isBackendReferencedByListenerRoute(backendId) {
    var referenced = false;

    Object.keys(state.listeners || {}).forEach(function (listenerId) {
      var listener = state.listeners[listenerId] || {};
      var policy = state.routingPolicies && state.routingPolicies[listener.policy_ref];
      var refs;

      if (referenced || !policy) {
        return;
      }

      refs = collectPolicyRouteBackendRefs(policy);
      referenced = !!refs[backendId];
    });

    return referenced;
  }

  function getBackendTlsDisplayInfo(backendId, backend) {
    var endpoint = parseEndpointUrlForDisplay(backend && backend.endpoint_url);
    var protocol = String(endpoint.protocol || '').toLowerCase();
    var isHttps = protocol === 'https';
    var isReferenced = isBackendReferencedByListenerRoute(backendId);

    return {
      scheme: protocol ? protocol.toUpperCase() : '',
      sniHost: isHttps ? endpoint.hostname : '',
      profile: isHttps && isReferenced ? MANAGED_SERVER_SSL_PROFILE : (isHttps ? 'Pending until referenced by a Northbound Listener' : 'Not required for HTTP')
    };
  }

  function renderBackendStatusPanel(backend, editorMode) {
    var runtimeBackend;
    var statusEmpty = byId('backendStatusEmpty');
    var statusTitle = byId('backendStatusTitle');
    var statusList = byId('backendStatus');
    var membersCard = byId('backendMembersCard');
    var members;
    var statusModel;
    var tlsInfo;

    renderBackendRefreshButton(backend, editorMode);

    if (!statusEmpty || !statusTitle || !statusList || !membersCard) {
      return;
    }

    if (!backend) {
      statusEmpty.hidden = true;
      statusList.hidden = true;
      membersCard.hidden = true;
      statusTitle.textContent = 'Status';
      return;
    }

    if (editorMode === 'create') {
      statusEmpty.hidden = true;
      statusList.hidden = true;
      membersCard.hidden = true;
      statusTitle.textContent = 'Draft Status';
      return;
    }

    runtimeBackend = getRuntimeBackendView(state.activeIds.backend, backend);
    members = getRuntimeBackendMembers(state.activeIds.backend);
    statusModel = getBackendStatusModel(state.activeIds.backend, backend, editorMode);
    tlsInfo = getBackendTlsDisplayInfo(state.activeIds.backend, backend);

    statusTitle.textContent = 'Status';
    statusEmpty.hidden = true;
    statusList.hidden = false;
    membersCard.hidden = false;
    byId('backendStatus').innerHTML = [
      ['Schema Family', backend.schema_family],
      ['Credential Source', getBackendCredentialSourceValue(backend) === 'credential_pool' ? 'Model Key Pool' : 'Inline API Key'],
      ['Credential Pool', backend.credential_pool_ref || ''],
      ['Referenced Pool', backend.pool_name],
      ['Endpoint URL', backend.endpoint_url],
      ['Model ID', backend.model_id],
      ['Derived SNI Host', tlsInfo.sniHost],
      ['Auto Server SSL Profile', tlsInfo.profile]
    ].map(function (entry) {
      return '<div><dt>' + entry[0] + '</dt><dd>' + (entry[2] ? entry[1] : (entry[1] || '')) + '</dd></div>';
    }).join('');

    byId('backendMembers').innerHTML = members.length ? members.map(function (member, index) {
      var memberStatus = getMemberStatusModel(state.activeIds.backend, member);
      var memberMeta = getBackendMemberMeta(member);

      return '<div class="member-row">' +
        '<div>' +
        '<strong>' + escapeHtml(getBackendMemberLabel(member, index)) + '</strong>' +
        (memberMeta ? '<div class="member-meta">' + escapeHtml(memberMeta) + '</div>' : '') +
        '</div>' +
        '<div class="member-status-group">' + renderStatusBadge('Health', memberStatus.health) + '</div>' +
        '</div>';
    }).join('') : '<div class="empty-editor empty-editor--compact"><h3>No live pool members reported.</h3></div>';
  }

  function renderBackendForm() {
    var activeBackend = getActiveBackend();
    var backend = getBackendFormModel();
    var emptyState = byId('backendEmptyState');
    var editorPanel = byId('backendEditorPanel');
    var editorTitle = byId('backendEditorTitle');
    var confirmButton = byId('backendConfirmButton');
    var editorMode = state.ui.backendEditorMode;

    if (confirmButton) {
      confirmButton.hidden = true;
    }

    if (!backend) {
      renderBackendLayout();
      emptyState.hidden = false;
      editorPanel.hidden = true;
      renderBackendStatusPanel(backend, editorMode);
      return;
    }

    renderBackendLayout();
    if (editorMode === 'empty') {
      emptyState.hidden = false;
      editorPanel.hidden = true;
    } else {
      emptyState.hidden = true;
      editorPanel.hidden = false;
      editorTitle.textContent = editorMode === 'create' ? 'Add Backend Target' : 'Backend Target';
      if (confirmButton) {
        confirmButton.hidden = editorMode !== 'create' && editorMode !== 'edit';
        resetCommitButton(confirmButton);
      }
      renderBackendProbeButton();

      backend.schema_family = normalizeBackendSchemaFamily(backend.schema_family);
      setValue('backend_name', backend.backend_target_name);
      byId('backend_schema').innerHTML = buildBackendSchemaOptions(backend.schema_family);
      setValue('backend_endpoint', backend.endpoint_url);
      setValue('backend_credential_source', getBackendFormCredentialSource(backend));
      setValue('backend_api_key', getSecretDisplayValue(backend));
      if (byId('backend_credential_pool_ref')) {
        byId('backend_credential_pool_ref').innerHTML = buildProviderCredentialPoolOptions(backend.credential_pool_ref);
        setValue('backend_credential_pool_ref', backend.credential_pool_ref || '');
      }
      setValue('backend_model', backend.model_id);
      if (byId('backend_pool')) {
        byId('backend_pool').innerHTML = buildPoolOptions(backend.pool_name);
        setValue('backend_pool', getSelectedPoolValue(backend.pool_name));
      }
      renderBackendCredentialSourceFields(backend);
      renderPoolCatalogControls();
      setValue('backend_prompt', backend.backend_prompt);
      byId('backend_prompt_mode').value = backend.backend_prompt_mode;
      if (editorMode === 'create' && pendingBackendValidationActive) {
        setBackendRequiredErrors(getMissingBackendRequiredFields(backend));
      } else {
        clearBackendRequiredErrors();
      }
    }

    renderBackendStatusPanel(activeBackend, editorMode);
  }

  function buildBackendOptions(selected, placeholder) {
    var placeholderLabel = placeholder || 'Select backend target';
    var options = ['<option value=""' + (!selected ? ' selected' : '') + '>' + placeholderLabel + '</option>'];

    return options.concat(Object.keys(state.backendTargets).map(function (key) {
      var backend = state.backendTargets[key];
      var isSelected = key === selected ? ' selected' : '';
      return '<option value="' + key + '"' + isSelected + '>' + backend.backend_target_name + '</option>';
    })).join('');
  }

  function buildClassifierOptions(selected, placeholder) {
    var options = [];

    if (placeholder) {
      options.push('<option value=""' + (!selected ? ' selected' : '') + '>' + placeholder + '</option>');
    }

    return options.concat(Object.keys(state.classifiers).map(function (key) {
      var classifier = state.classifiers[key];
      var isSelected = key === selected ? ' selected' : '';
      return '<option value="' + key + '"' + isSelected + '>' + (classifier.classifier_name || key) + '</option>';
    })).join('');
  }

  function buildRoutingModeOptions(selected) {
    return [
      { value: 'classifier_only', label: 'Classifier Only' },
      { value: 'key_only', label: 'Key Only' },
      { value: 'key_then_classifier', label: 'Key Then Classifier' }
    ].map(function (option) {
      var isSelected = option.value === normalizeRoutingMode(selected) ? ' selected' : '';
      return '<option value="' + option.value + '"' + isSelected + '>' + option.label + '</option>';
    }).join('');
  }

  function buildPolicyTagOptions(classifierRef, selected) {
    var classifier = state.classifiers[classifierRef];
    var tags = classifier && Array.isArray(classifier.candidate_tags) ? normalizeTagList(classifier.candidate_tags) : [];
    var hasSelected = tags.indexOf(selected) !== -1;
    var options = [];

    if (!tags.length) {
      return '<option value="" selected>No classifier tags available</option>';
    }

    options.push('<option value=""' + (!selected ? ' selected' : '') + '>Select tag</option>');
    tags.forEach(function (tag) {
      var isSelected = tag === selected ? ' selected' : '';
      options.push('<option value="' + escapeHtml(tag) + '"' + isSelected + '>' + escapeHtml(tag) + '</option>');
    });

    if (selected && !hasSelected) {
      options.unshift('<option value="' + escapeHtml(selected) + '" selected>' + escapeHtml(selected) + ' (not in classifier tags)</option>');
    }

    return options.join('');
  }

  function buildPolicyKeyPoolOptions(selected) {
    var options = ['<option value=""' + (!selected ? ' selected' : '') + '>Select virtual key pool</option>'];

    return options.concat(Object.keys(state.virtualKeyPools || {}).map(function (poolRef) {
      var pool = state.virtualKeyPools[poolRef] || {};
      var isSelected = poolRef === selected ? ' selected' : '';
      return '<option value="' + escapeHtml(poolRef) + '"' + isSelected + '>' + escapeHtml(pool.pool_name || poolRef) + '</option>';
    })).join('');
  }

  function buildPolicyVirtualKeyOptions(selected) {
    var options = ['<option value=""' + (!selected ? ' selected' : '') + '>Select virtual key</option>'];

    return options.concat(Object.keys(state.virtualKeys || {}).map(function (keyRef) {
      var virtualKey = state.virtualKeys[keyRef] || {};
      var poolName = getVirtualKeyPoolName(virtualKey.virtual_key_pool_ref || '');
      var isSelected = keyRef === selected ? ' selected' : '';
      var suffix = poolName ? ' [' + poolName + ']' : '';

      return '<option value="' + escapeHtml(keyRef) + '"' + isSelected + '>' + escapeHtml((virtualKey.kid || keyRef) + suffix) + '</option>';
    })).join('');
  }

  function getPolicyVirtualKeyTags() {
    var seen = {};
    var tags = [];

    Object.keys(state.virtualKeys || {}).forEach(function (keyRef) {
      var tag = normalizeComparisonString((state.virtualKeys[keyRef] || {}).tag || '');

      if (tag && !seen[tag]) {
        seen[tag] = true;
        tags.push(tag);
      }
    });

    return tags.sort();
  }

  function buildPolicyVirtualKeyTagOptions(selected) {
    var tags = getPolicyVirtualKeyTags();
    var hasSelected = tags.indexOf(selected) !== -1;
    var options = [];

    if (!tags.length) {
      return '<option value="" selected>No virtual key tags available</option>';
    }

    options.push('<option value=""' + (!selected ? ' selected' : '') + '>Select key tag</option>');
    tags.forEach(function (tag) {
      var isSelected = tag === selected ? ' selected' : '';
      options.push('<option value="' + escapeHtml(tag) + '"' + isSelected + '>' + escapeHtml(tag) + '</option>');
    });

    if (selected && !hasSelected) {
      options.unshift('<option value="' + escapeHtml(selected) + '" selected>' + escapeHtml(selected) + ' (not found)</option>');
    }

    return options.join('');
  }

  function normalizePolicyKeySourceType(sourceType) {
    return sourceType === 'key' || sourceType === 'tag' ? sourceType : 'pool';
  }

  function getPolicyKeySourceType(match) {
    var normalizedMatch = match || {};

    if (normalizedMatch.virtual_key_ref) {
      return 'key';
    }
    if (normalizedMatch.virtual_key_tag) {
      return 'tag';
    }
    return 'pool';
  }

  function getPolicyKeySourceValue(match, sourceType) {
    var normalizedMatch = match || {};

    if (sourceType === 'key') {
      return normalizedMatch.virtual_key_ref || '';
    }
    if (sourceType === 'tag') {
      return normalizedMatch.virtual_key_tag || '';
    }
    return normalizedMatch.virtual_key_pool_ref || '';
  }

  function getPolicyKeyRuleSourceType(rule, match) {
    var normalizedMatch = match || {};
    var inferredSourceType = getPolicyKeySourceType(normalizedMatch);
    var inferredValue = getPolicyKeySourceValue(normalizedMatch, inferredSourceType);

    if (inferredValue) {
      return inferredSourceType;
    }

    return normalizePolicyKeySourceType(rule && rule.ui_source_type);
  }

  function buildPolicyKeySourceTypeOptions(selected) {
    return [
      { value: 'pool', label: 'Pool' },
      { value: 'key', label: 'Key' },
      { value: 'tag', label: 'Key Tag' }
    ].map(function (option) {
      var isSelected = option.value === selected ? ' selected' : '';
      return '<option value="' + option.value + '"' + isSelected + '>' + option.label + '</option>';
    }).join('');
  }

  function getPolicyKeySourceValueLabel(sourceType) {
    if (sourceType === 'key') {
      return 'Virtual Key';
    }
    if (sourceType === 'tag') {
      return 'Key Tag';
    }
    return 'Virtual Key Pool';
  }

  function buildPolicyKeySourceValueOptions(sourceType, selected) {
    if (sourceType === 'key') {
      return buildPolicyVirtualKeyOptions(selected);
    }
    if (sourceType === 'tag') {
      return buildPolicyVirtualKeyTagOptions(selected);
    }
    return buildPolicyKeyPoolOptions(selected);
  }

  function applyPolicyKeySourceMatch(rule, sourceType, sourceValue) {
    var normalizedSourceType = normalizePolicyKeySourceType(sourceType);
    var normalizedValue = normalizeComparisonString(sourceValue || '');

    if (!rule) {
      return;
    }

    rule.ui_source_type = normalizedSourceType;
    rule.match = {
      virtual_key_pool_ref: normalizedSourceType === 'pool' ? normalizedValue : '',
      virtual_key_ref: normalizedSourceType === 'key' ? normalizedValue : '',
      virtual_key_tag: normalizedSourceType === 'tag' ? normalizedValue : ''
    };
  }

  function buildPolicyOptions(selected) {
    return Object.keys(state.routingPolicies).map(function (key) {
      var policy = state.routingPolicies[key];
      var isSelected = key === selected ? ' selected' : '';
      return '<option value="' + key + '"' + isSelected + '>' + (policy.policy_name || key) + '</option>';
    }).join('');
  }

  function buildListenerPolicyOptions(selected) {
    var options = ['<option value=""' + (!selected ? ' selected' : '') + '>Select assigned policy</option>'];

    return options.concat(Object.keys(state.routingPolicies).map(function (key) {
      var policy = state.routingPolicies[key];
      var isSelected = key === selected ? ' selected' : '';
      return '<option value="' + key + '"' + isSelected + '>' + (policy.policy_name || key) + '</option>';
    })).join('');
  }

  function buildProviderCredentialPoolOptions(selected) {
    var options = ['<option value=""' + (!selected ? ' selected' : '') + '>Select credential pool</option>'];

    return options.concat(Object.keys(state.providerCredentialPools || {}).map(function (poolRef) {
      var pool = state.providerCredentialPools[poolRef] || {};
      var isSelected = poolRef === selected ? ' selected' : '';
      var suffix = pool.vendor ? ' [' + formatModelCredentialVendorLabel(pool.vendor) + ']' : '';

      return '<option value="' + escapeHtml(poolRef) + '"' + isSelected + (pool.enabled === false ? ' disabled' : '') + '>' +
        escapeHtml((pool.pool_name || poolRef) + suffix + (pool.enabled === false ? ' (Disabled)' : '')) +
        '</option>';
    })).join('');
  }

  function renderBackendCredentialSourceFields(backend) {
    var source = getBackendFormCredentialSource(backend);
    var inlineField = byId('backendInlineApiKeyField');
    var poolField = byId('backendCredentialPoolField');
    var apiKeyInput = byId('backend_api_key');
    var poolSelect = byId('backend_credential_pool_ref');

    if (inlineField) {
      inlineField.hidden = source === 'credential_pool';
    }
    if (poolField) {
      poolField.hidden = source !== 'credential_pool';
    }
    if (apiKeyInput) {
      apiKeyInput.disabled = source === 'credential_pool';
    }
    if (poolSelect) {
      poolSelect.disabled = source !== 'credential_pool';
    }
  }

  function buildVirtualKeyPoolOptions() {
    return Object.keys(state.virtualKeyPools || {}).map(function (key) {
      var pool = state.virtualKeyPools[key] || {};
      return '<option value="' + escapeHtml(key) + '"' + (pool.enabled === false ? ' disabled' : '') + '>' + escapeHtml(pool.pool_name || key) + (pool.enabled === false ? ' (Disabled)' : '') + '</option>';
    }).join('');
  }

  function renderPolicyList() {
    var host = byId('policyList');
    var selectAll = byId('policySelectAll');
    var searchInput = byId('policySearchInput');
    var visiblePolicyIds = getVisiblePolicyIds();
    var pageState = clampPolicyPage(visiblePolicyIds.length);
    var policyIds = isShowAllPage(pageState.currentPage)
      ? visiblePolicyIds
      : visiblePolicyIds.slice((pageState.currentPage - 1) * VIRTUAL_KEY_PAGE_SIZE, pageState.currentPage * VIRTUAL_KEY_PAGE_SIZE);
    var html = '';
    var selectedCount = 0;

    Object.keys(policySelection).forEach(function (key) {
      if (!state.routingPolicies[key]) {
        delete policySelection[key];
      }
    });

    if (searchInput && searchInput.value !== policySearchTerm) {
      searchInput.value = policySearchTerm;
    }

    policyIds.forEach(function (key) {
      var policy = state.routingPolicies[key];
      var active = key === state.activeIds.policy ? ' is-active' : '';
      var defaultRoute = getPolicyDefaultRuleSummary(policy);
      var classifierName = policyUsesClassifierStage(policy) ? getPolicyClassifierDisplayName(policy) : 'Key stage only';
      var entrySummary = getPolicyEntryCountSummary(policy);
      var isSelected = !!policySelection[key];

      if (isSelected) {
        selectedCount += 1;
      }

      html += '<tr class="' + active.trim() + '" data-policy="' + key + '">' +
        '<td class="virtual-key-checkbox-col"><input type="checkbox" data-policy-select="' + escapeHtml(key) + '"' + (isSelected ? ' checked' : '') + ' aria-label="Select Routing Policy ' + escapeHtml(policy.policy_name || key) + '"></td>' +
        '<td><span class="policy-type-badge ' + (policy.policy_type === 'orchestrator' ? 'orchestrator' : 'routing') + '">' + policy.policy_type + '</span></td>' +
        '<td><span class="table-primary">' + escapeHtml(policy.policy_name || key) + '</span></td>' +
        '<td><span class="table-secondary">' + escapeHtml(classifierName) + '</span></td>' +
        '<td><span class="table-secondary">' + escapeHtml(entrySummary) + '</span></td>' +
        '<td><span class="table-secondary">' + escapeHtml(defaultRoute) + '</span></td>' +
        '<td><div class="row-action-group row-action-group--compact">' +
        '<button class="row-action-button virtual-key-config-button" type="button" data-policy-config="' + key + '" title="Configure policy" aria-label="Configure policy"></button>' +
        '<button class="row-action-button row-action-button--danger row-action-button--delete" type="button" data-policy-delete="' + key + '" aria-label="Delete policy">&#x1F5D1;&#xFE0E;</button>' +
        '</div></td>' +
        '</tr>';
    });

    if (!html) {
      html = '<tr><td class="table-empty" colspan="7"><div class="empty-editor"><p class="eyebrow">No Policies</p><h3>' +
        (Object.keys(state.routingPolicies || {}).length ? 'No routing policies match the current search.' : 'Create the first routing policy to begin.') +
        '</h3></div></td></tr>';
    }

    host.innerHTML = html;
    if (selectAll) {
      selectAll.checked = policyIds.length > 0 && selectedCount === policyIds.length;
      selectAll.indeterminate = selectedCount > 0 && selectedCount < policyIds.length;
    }
    renderPolicyPagination(visiblePolicyIds.length, pageState);
  }

  function renderPolicyLayout() {
    var layout = byId('policyLayout');
    var editorCard = byId('policyEditorCard');
    var isExpanded = state.ui.policyEditorMode !== 'empty' && !!getActivePolicy();

    if (!layout || !editorCard) {
      return;
    }

    layout.classList.toggle('is-expanded', isExpanded);
    editorCard.hidden = !isExpanded;
  }

  function collapsePolicyEditor() {
    var policy;

    if (state.ui.policyEditorMode === 'empty') {
      return;
    }

    policy = getPolicyFormModel();
    if (policy && byId('policyForm')) {
      syncPolicyFromForm(policy);
    }

    state.ui.policyEditorMode = 'empty';
    renderAll();
  }

  function deletePolicies(policyIds, skipRender) {
    var ids = [];
    var keys;
    var activeDeleted = false;

    (policyIds || []).forEach(function (policyId) {
      if (policyId && state.routingPolicies[policyId] && ids.indexOf(policyId) < 0) {
        ids.push(policyId);
      }
    });

    if (!ids.length) {
      return;
    }

    if (!window.confirm('Delete ' + formatCountLabel(ids.length, 'Routing Policy', 'Routing Policies') + '?')) {
      return;
    }

    ids.forEach(function (policyId) {
      if (pendingPolicyDraft && pendingPolicyDraftId === policyId) {
        discardPendingPolicyDraft();
      }
      if (state.activeIds.policy === policyId) {
        activeDeleted = true;
      }
      delete state.routingPolicies[policyId];
      delete policySelection[policyId];
    });

    keys = Object.keys(state.routingPolicies);

    if (!keys.length) {
      state.activeIds.policy = '';
      state.activeIds.ruleIndex = 0;
      state.ui.policyEditorMode = 'empty';
    } else if (activeDeleted) {
      state.activeIds.policy = keys[0];
      state.activeIds.ruleIndex = 0;
      state.ui.policyEditorMode = 'empty';
    }

    markDirty(ids.length === 1 ? 'delete policy' : 'bulk delete policies');
    if (!skipRender) {
      renderAll();
    }
  }

  function deletePolicy(policyId) {
    deletePolicies([policyId]);
  }

  function deleteSelectedPolicies() {
    var ids = Object.keys(policySelection).filter(function (id) {
      return policySelection[id] && state.routingPolicies[id];
    });

    if (!ids.length) {
      showToast('Select at least one Routing Policy.', 'error');
      return;
    }

    deletePolicies(ids);
  }

  function renderPolicyStatus() {
    var policy = state.ui.policyEditorMode === 'create' || state.ui.policyEditorMode === 'edit'
      ? getPolicyFormModel()
      : getActivePolicy();
    var statusEmpty = byId('policyStatusEmpty');
    var statusTitle = byId('policyStatusTitle');
    var statusList = byId('policyStatus');
    var editorMode = state.ui.policyEditorMode;
    var classifierName;
    var validationIssues;

    if (!statusEmpty || !statusTitle || !statusList) {
      return;
    }

    if (!policy) {
      statusTitle.textContent = 'Status';
      statusEmpty.hidden = true;
      statusList.hidden = true;
      return;
    }

    policy.default_rule = policy.default_rule || { action: '', backend_target_ref: '', response_message: '' };
    statusTitle.textContent = editorMode === 'create' ? 'Draft Status' : 'Status';
    statusEmpty.hidden = true;
    statusList.hidden = false;
    classifierName = policy.classifier_ref && state.classifiers[policy.classifier_ref]
      ? state.classifiers[policy.classifier_ref].classifier_name
      : '';
    validationIssues = getPolicyValidationIssues(policy, policy.policy_name || 'Routing Policy');

    statusList.innerHTML = [
      ['Policy Name', policy.policy_name || ''],
      ['Policy Type', policy.policy_type],
      ['Routing Mode', getRoutingModeLabel(policy.routing_mode)],
      ['Classifier', policyUsesClassifierStage(policy) ? classifierName : ''],
      ['Key Rules', String((policy.key_rules || []).length)],
      ['Tag Rules', String((policy.rules || []).length)],
      [policyDefaultRuleLabelPrefix(policy) + ' Backend Target', policy.default_rule.backend_target_ref || ''],
      [policyDefaultRuleLabelPrefix(policy) + ' Local Response', policy.default_rule.response_message || ''],
      ['Fallback Backend Target', policy.fallback_backend_target_ref || ''],
      ['Validation', validationIssues[0] || '']
    ].map(function (entry) {
      return '<div><dt>' + entry[0] + '</dt><dd>' + (entry[1] || '') + '</dd></div>';
    }).join('');
  }

  function renderPolicyForm() {
    var policy = getPolicyFormModel();
    var editorPanel = byId('policyEditorPanel');
    var editorTitle = byId('policyEditorTitle');
    var emptyState = byId('policyEmptyState');
    var confirmButton = byId('policyConfirmButton');
    var editorMode = state.ui.policyEditorMode;

    renderPolicyLayout();
    renderPolicyStatus();

    if (!editorPanel || !editorTitle || !emptyState) {
      return;
    }

    if (!policy) {
      emptyState.hidden = false;
      editorPanel.hidden = true;
      if (confirmButton) {
        confirmButton.hidden = true;
      }
      return;
    }

    emptyState.hidden = true;
    editorPanel.hidden = false;
    policy = normalizePolicyRecord(policy, Object.keys(state.classifiers || {})[0] || '', { preserveUiSourceType: true });
    editorTitle.textContent = editorMode === 'create' ? 'Create Routing Policy' : 'Policy Definition';
    if (confirmButton) {
      confirmButton.hidden = !(editorMode === 'create' || editorMode === 'edit');
      resetCommitButton(confirmButton);
    }

    byId('policy_type').value = policy.policy_type;
    setValue('policy_name', policy.policy_name);
    byId('policy_routing_mode').innerHTML = buildRoutingModeOptions(policy.routing_mode);
    byId('policy_classifier_ref').innerHTML = buildClassifierOptions(policy.classifier_ref || '', 'Select classifier');
    byId('policy_default_backend_target').innerHTML = buildBackendOptions(policy.default_rule.backend_target_ref);
    setValue('policy_default_response_message', policy.default_rule.response_message || '');
    if (byId('policy_fallback_backend_target')) {
      byId('policy_fallback_backend_target').innerHTML = buildBackendOptions(policy.fallback_backend_target_ref || '', 'No fallback backend');
    }
    renderPolicyStageLayout(policy);
    renderPolicyDefaultRuleState(policy);
    if (pendingPolicyValidationActive) {
      setPolicyRequiredErrors(getMissingPolicyRequiredFields(policy));
    } else {
      clearPolicyRequiredErrors();
    }
    renderPolicyKeyEntries(policy);
    renderPolicyEntries(policy);
  }

  function renderPolicyEntries(policy) {
    var host = byId('policyEntries');
    var classifierRef = policy.classifier_ref || '';

    if (!host) {
      return;
    }

    if (!policyUsesClassifierStage(policy)) {
      host.innerHTML = '';
      return;
    }

    if (!policy.rules || !policy.rules.length) {
      host.innerHTML = '<div class="empty-editor"><p class="eyebrow">No Entries</p><h3>Add a policy entry to map tags to actions.</h3></div>';
      return;
    }

    host.innerHTML = policy.rules.map(function (rule, index) {
      var normalizedRule = normalizePolicyTagRule(rule, index);
      var isRespond = normalizedRule.action === 'respond';
      var ruleTagChip = normalizedRule.source_tag ? buildTagChip(normalizedRule.source_tag, 'tag-chip--compact') : '<span class="tag-chip tag-chip--empty tag-chip--compact">No tag selected</span>';
      var ruleName = normalizedRule.rule_name || ('rule_' + (index + 1));
      return '<div class="entry-card' + (normalizedRule.enabled ? '' : ' entry-card--disabled') + '" data-policy-entry-card="' + index + '">' +
        '<div class="entry-card-header">' +
        '<strong>' + escapeHtml(ruleName) + '</strong>' +
        '<div class="entry-card-actions">' +
        '<div class="entry-tag-preview" data-policy-entry-tag-preview="' + index + '">' + ruleTagChip + '</div>' +
        '<button class="row-action-button virtual-key-switch-button ' + (normalizedRule.enabled ? 'is-on' : '') + '" type="button" data-policy-entry-toggle="' + index + '" title="' + escapeHtml(normalizedRule.enabled ? 'Disable tag rule' : 'Enable tag rule') + '" aria-label="' + escapeHtml(normalizedRule.enabled ? 'Disable tag rule' : 'Enable tag rule') + '" aria-pressed="' + (normalizedRule.enabled ? 'true' : 'false') + '"><span></span></button>' +
        '<button class="row-action-button row-action-button--danger row-action-button--delete" type="button" data-policy-entry-delete="' + index + '" aria-label="Delete tag rule"></button>' +
        '</div>' +
        '</div>' +
        '<div class="entry-grid">' +
        '<label class="entry-field"><span>Source Tag</span><select data-policy-entry-field="source_tag" data-entry-index="' + index + '">' + buildPolicyTagOptions(classifierRef, normalizedRule.source_tag || '') + '</select></label>' +
        '<label class="entry-field"><span>Action</span><select data-policy-entry-field="action" data-entry-index="' + index + '">' +
        '<option value="route"' + (normalizedRule.action === 'route' ? ' selected' : '') + '>Route</option>' +
        '<option value="respond"' + (normalizedRule.action === 'respond' ? ' selected' : '') + '>Local Response</option>' +
        '</select></label>' +
        '<label class="entry-field"><span>BACKEND</span><select data-policy-entry-field="backend_target_ref" data-entry-index="' + index + '"' + (isRespond ? ' disabled' : '') + '>' + buildBackendOptions(normalizedRule.backend_target_ref || '') + '</select></label>' +
        '<label class="entry-field entry-field--wide"><span>Response Message</span><input data-policy-entry-field="response_message" data-entry-index="' + index + '" type="text" value="' + escapeHtml(normalizedRule.response_message || '') + '"' + (!isRespond ? ' disabled' : '') + '></label>' +
        '</div>' +
        '</div>';
    }).join('');
  }

  function buildPolicyKeySummary(match) {
    var normalizedMatch = match || {};

    if (normalizedMatch.virtual_key_ref) {
      return 'Key: ' + normalizedMatch.virtual_key_ref;
    }
    if (normalizedMatch.virtual_key_tag) {
      return 'Tag: ' + normalizedMatch.virtual_key_tag;
    }
    if (normalizedMatch.virtual_key_pool_ref) {
      return 'Pool: ' + (getVirtualKeyPoolName(normalizedMatch.virtual_key_pool_ref) || normalizedMatch.virtual_key_pool_ref);
    }

    return 'Key Rule';
  }

  function buildPolicyKeyMatchPreview(match) {
    var summary = buildPolicyKeySummary(match || {});
    var hasMatch = match && (match.virtual_key_pool_ref || match.virtual_key_ref || match.virtual_key_tag);

    return '<span class="entry-match-chip' + (hasMatch ? '' : ' entry-match-chip--empty') + '">' + escapeHtml(summary) + '</span>';
  }

  function renderPolicyKeyEntries(policy) {
    var host = byId('policyKeyEntries');

    if (!host) {
      return;
    }

    if (!policyUsesKeyStage(policy)) {
      host.innerHTML = '';
      return;
    }

    if (!policy.key_rules || !policy.key_rules.length) {
      host.innerHTML = '<div class="empty-editor"><p class="eyebrow">No Rules</p><h3>Add a key rule to match virtual keys before routing.</h3></div>';
      return;
    }

    host.innerHTML = policy.key_rules.map(function (rule, index) {
      var normalizedRule = normalizePolicyKeyRule(rule, index, { preserveUiSourceType: true });
      var sourceType = getPolicyKeyRuleSourceType(normalizedRule, normalizedRule.match || {});
      var sourceValue = getPolicyKeySourceValue(normalizedRule.match || {}, sourceType);
      var isRoute = normalizedRule.action === 'route';
      var isRespond = normalizedRule.action === 'respond';
      var isClassify = normalizedRule.action === 'classify';
      var allowClassify = isPolicyKeyActionAllowed(policy, 'classify');
      var targetFieldHtml = allowClassify && isClassify
        ? '<label class="entry-field"><span>Classifier</span><select data-policy-key-entry-field="classifier_ref" data-entry-index="' + index + '">' + buildClassifierOptions(normalizedRule.classifier_ref || '', 'Select classifier') + '</select></label>'
        : '<label class="entry-field"><span>BACKEND</span><select data-policy-key-entry-field="backend_target_ref" data-entry-index="' + index + '"' + (isRoute ? '' : ' disabled') + '>' + buildBackendOptions(normalizedRule.backend_target_ref || '') + '</select></label>';

      policy.key_rules[index] = normalizedRule;
      normalizedRule.ui_source_type = sourceType;

      return '<div class="entry-card' + (normalizedRule.enabled ? '' : ' entry-card--disabled') + '" data-policy-key-entry-card="' + index + '">' +
        '<div class="entry-card-header">' +
        '<strong>' + escapeHtml(normalizedRule.rule_name || ('key_rule_' + (index + 1))) + '</strong>' +
        '<div class="entry-card-actions">' +
        '<div class="entry-card-meta entry-card-meta--header" data-policy-key-entry-match-preview="' + index + '">' +
        buildPolicyKeyMatchPreview(normalizedRule.match || {}) +
        '</div>' +
        '<button class="row-action-button virtual-key-switch-button ' + (normalizedRule.enabled ? 'is-on' : '') + '" type="button" data-policy-key-entry-toggle="' + index + '" title="' + escapeHtml(normalizedRule.enabled ? 'Disable key rule' : 'Enable key rule') + '" aria-label="' + escapeHtml(normalizedRule.enabled ? 'Disable key rule' : 'Enable key rule') + '" aria-pressed="' + (normalizedRule.enabled ? 'true' : 'false') + '"><span></span></button>' +
        '<button class="row-action-button row-action-button--danger row-action-button--delete" type="button" data-policy-key-entry-delete="' + index + '" aria-label="Delete key rule"></button>' +
        '</div>' +
        '</div>' +
        '<div class="entry-grid">' +
        '<label class="entry-field"><span>Source</span><select data-policy-key-source-field="source_type" data-entry-index="' + index + '">' + buildPolicyKeySourceTypeOptions(sourceType) + '</select></label>' +
        '<label class="entry-field"><span>' + escapeHtml(getPolicyKeySourceValueLabel(sourceType)) + '</span><select data-policy-key-entry-field="source_value" data-policy-key-source-type="' + escapeHtml(sourceType) + '" data-entry-index="' + index + '">' + buildPolicyKeySourceValueOptions(sourceType, sourceValue) + '</select></label>' +
        '<label class="entry-field"><span>Action</span><select data-policy-key-entry-field="action" data-entry-index="' + index + '">' +
        '<option value="route"' + (isRoute ? ' selected' : '') + '>Route</option>' +
        '<option value="respond"' + (isRespond ? ' selected' : '') + '>Local Response</option>' +
        '<option value="classify"' + (isClassify ? ' selected' : '') + (allowClassify ? '' : ' disabled') + '>Classify</option>' +
        '</select></label>' +
        targetFieldHtml +
        '<label class="entry-field entry-field--full"><span>Response Message</span><input data-policy-key-entry-field="response_message" data-entry-index="' + index + '" type="text" value="' + escapeHtml(normalizedRule.response_message || '') + '"' + (isRespond ? '' : ' disabled') + '></label>' +
        '</div>' +
        '</div>';
    }).join('');
  }

  function scrollPolicyEntryIntoView(index) {
    var entryCard;

    if (typeof index !== 'number' || Number.isNaN(index)) {
      return;
    }

    entryCard = document.querySelector('[data-policy-entry-card="' + index + '"]');
    if (!entryCard) {
      return;
    }

    window.requestAnimationFrame(function () {
      entryCard.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth'
      });
    });
  }

  function updatePolicyEntryTagPreview(entryIndex, sourceTag) {
    var preview = document.querySelector('[data-policy-entry-tag-preview="' + entryIndex + '"]');
    var tagChip = sourceTag
      ? buildTagChip(sourceTag, 'tag-chip--compact')
      : '<span class="tag-chip tag-chip--empty tag-chip--compact">No tag selected</span>';

    if (!preview) {
      return;
    }

    preview.innerHTML = tagChip;
  }

  function updatePolicyEntryActionState(entryIndex, action) {
    var backendTargetSelect = document.querySelector('[data-policy-entry-field="backend_target_ref"][data-entry-index="' + entryIndex + '"]');
    var responseInput = document.querySelector('[data-policy-entry-field="response_message"][data-entry-index="' + entryIndex + '"]');
    var isRespond = action === 'respond';

    if (backendTargetSelect) {
      backendTargetSelect.disabled = isRespond;
      if (isRespond) {
        backendTargetSelect.value = '';
      }
    }
    if (responseInput) {
      responseInput.disabled = !isRespond;
      if (!isRespond) {
        responseInput.value = '';
      }
    }
  }

  function updatePolicyKeyEntryMatchPreview(entryIndex, match) {
    var preview = document.querySelector('[data-policy-key-entry-match-preview="' + entryIndex + '"]');

    if (!preview) {
      return;
    }

    preview.innerHTML = buildPolicyKeyMatchPreview(match || {});
  }

  function updatePolicyKeyEntryActionState(entryIndex, action) {
    var backendTargetSelect = document.querySelector('[data-policy-key-entry-field="backend_target_ref"][data-entry-index="' + entryIndex + '"]');
    var classifierSelect = document.querySelector('[data-policy-key-entry-field="classifier_ref"][data-entry-index="' + entryIndex + '"]');
    var responseInput = document.querySelector('[data-policy-key-entry-field="response_message"][data-entry-index="' + entryIndex + '"]');
    var isRoute = action === 'route';
    var isRespond = action === 'respond';
    var isClassify = action === 'classify';

    if (backendTargetSelect) {
      backendTargetSelect.disabled = !isRoute;
      if (!isRoute) {
        backendTargetSelect.value = '';
      }
    }
    if (classifierSelect) {
      classifierSelect.disabled = !isClassify;
      if (!isClassify) {
        classifierSelect.value = '';
      }
    }
    if (responseInput) {
      responseInput.disabled = !isRespond;
      if (!isRespond) {
        responseInput.value = '';
      }
    }
  }

  function copyPolicy(policyId) {
    var policy = state.routingPolicies[policyId];
    var newId;
    var cloned;

    if (!policy) {
      return;
    }

    cloned = JSON.parse(JSON.stringify(policy));
    newId = policyId + '_copy_' + Date.now();
    cloned.policy_name = (policy.policy_name || policyId) + ' Copy';
    state.routingPolicies[newId] = cloned;
    state.activeIds.policy = newId;
    state.activeIds.ruleIndex = 0;
    state.ui.policyEditorMode = 'edit';
    markDirty('copy policy');
    renderAll();
  }

  function getVirtualKeyPoolName(poolRef) {
    var pool = state.virtualKeyPools && state.virtualKeyPools[poolRef];
    return pool ? (pool.pool_name || poolRef) : poolRef;
  }

  function buildVirtualKeyPoolIdFromName(name) {
    var base = normalizeIdentifier(name, '');
    var candidate;
    var counter = 2;

    if (!base) {
      return '';
    }

    candidate = base;
    while (state.virtualKeyPools && state.virtualKeyPools[candidate]) {
      candidate = base + '_' + counter;
      counter += 1;
    }
    return candidate;
  }

  function buildMaskedVirtualKeyDetail(tag, kid, last4) {
    if (!tag || !kid) {
      return '';
    }
    return 'sk-aito-' + tag + '.' + kid + '.****' + (last4 || '????');
  }

  function buildFullVirtualKeyDetail(tag, kid, secret) {
    if (!tag || !kid || !secret) {
      return '';
    }
    return 'sk-aito-' + tag + '.' + kid + '.' + secret;
  }

  function getTodayDateString() {
    return new Date().toISOString().slice(0, 10);
  }

  function formatDateOnly(value, emptyLabel) {
    var text = String(value || '').trim();
    var match;
    var parsed;

    if (!text) {
      return emptyLabel || '';
    }

    match = text.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) {
      return match[1];
    }

    parsed = new Date(text);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }

    return emptyLabel || '';
  }

  function extractVirtualKeySecret(fullKey) {
    var parts = String(fullKey || '').split('.');

    return parts.length >= 3 ? parts.slice(2).join('.') : '';
  }

  function buildBlankVirtualKeyPoolDraft() {
    return {
      enabled: true,
      pool_name: '',
      description: ''
    };
  }

  function getDefaultVirtualKeyPoolRef() {
    var activePoolFilters = getActiveVirtualKeyPoolFilterRefs();

    if (activePoolFilters.length) {
      return activePoolFilters[0];
    }
    return Object.keys(state.virtualKeyPools || {})[0] || '';
  }

  function buildBlankVirtualKeyDraft() {
    return {
      enabled: true,
      kid: buildVirtualKeyObjectId('kid', state.virtualKeys),
      tag: '',
      virtual_key_pool_ref: getDefaultVirtualKeyPoolRef(),
      created_at: getTodayDateString(),
      last_used_at: '',
      secret: randomKeyPart(32),
      secret_last4: '',
      key_preview: '',
      isExisting: false,
      revealSecret: false
    };
  }

  function getVirtualKeyPoolDraftObjectId() {
    if (!pendingVirtualKeyPoolDraft) {
      return '';
    }
    if (pendingVirtualKeyPoolDraftId) {
      return pendingVirtualKeyPoolDraftId;
    }
    return buildVirtualKeyPoolIdFromName(pendingVirtualKeyPoolDraft.pool_name || '');
  }

  function getPendingVirtualKeyFullDetail() {
    if (!pendingVirtualKeyDraft) {
      return '';
    }
    if (!pendingVirtualKeyDraft.virtual_key_pool_ref || !pendingVirtualKeyDraft.secret) {
      return '';
    }
    return buildFullVirtualKeyDetail(pendingVirtualKeyDraft.tag, pendingVirtualKeyDraft.kid, pendingVirtualKeyDraft.secret);
  }

  function getPendingVirtualKeyMaskedDetail() {
    if (!pendingVirtualKeyDraft) {
      return '';
    }
    if (!pendingVirtualKeyDraft.virtual_key_pool_ref) {
      return '';
    }
    return buildMaskedVirtualKeyDetail(
      pendingVirtualKeyDraft.tag,
      pendingVirtualKeyDraft.kid,
      pendingVirtualKeyDraft.secret
        ? pendingVirtualKeyDraft.secret.slice(-4)
        : (pendingVirtualKeyDraft.secret_last4 || '')
    );
  }

  function getListenersReferencingVirtualKeyPool(poolRef) {
    return Object.keys(state.listeners || {}).filter(function (listenerId) {
      var listener = state.listeners[listenerId];
      return listener && Array.isArray(listener.allowed_virtual_key_pool_refs) && listener.allowed_virtual_key_pool_refs.indexOf(poolRef) >= 0;
    });
  }

  function getVirtualKeysReferencingPool(poolRef) {
    return Object.keys(state.virtualKeys || {}).filter(function (keyId) {
      var virtualKey = state.virtualKeys[keyId];
      return virtualKey && virtualKey.virtual_key_pool_ref === poolRef;
    });
  }

  function getVirtualKeyPoolFieldIssues(draft) {
    var issues = [];
    var name = String(draft && draft.pool_name || '').trim();

    if (!name) {
      issues.push({ id: 'virtualKeyPool_pool_name', label: 'Pool Name', message: 'Pool Name is required.' });
      return issues;
    }
    if (name.length > 64) {
      issues.push({ id: 'virtualKeyPool_pool_name', label: 'Pool Name', message: 'Pool Name must be 64 characters or less.' });
    }
    if (!VIRTUAL_KEY_POOL_NAME_PATTERN.test(name)) {
      issues.push({ id: 'virtualKeyPool_pool_name', label: 'Pool Name', message: 'Pool Name allows letters, numbers, spaces, underscore, hyphen, and dot only.' });
    }
    if (!buildVirtualKeyPoolIdFromName(name)) {
      issues.push({ id: 'virtualKeyPool_pool_name', label: 'Pool Name', message: 'Pool Name must normalize to a usable identifier.' });
    }
    return issues;
  }

  function getVirtualKeyFieldIssues(draft) {
    var issues = [];
    var tag = String(draft && draft.tag || '').trim();

    if (!draft || !draft.kid) {
      issues.push({ id: 'virtualKey_kid', label: 'Key ID', message: 'Key ID could not be generated.' });
    }
    if (!draft || (!draft.secret && !draft.isExisting)) {
      issues.push({ id: 'virtualKey_detail', label: 'Key Detail', message: 'Browser crypto API is not available.' });
    }
    if (!draft || !draft.virtual_key_pool_ref || !state.virtualKeyPools[draft.virtual_key_pool_ref]) {
      issues.push({ id: 'virtualKey_pool_ref', label: 'Pool Name', message: 'Select a valid Virtual Key Pool.' });
    }
    if (!tag) {
      issues.push({ id: 'virtualKey_tag', label: 'Tag', message: 'Tag is required.' });
    } else if (!VIRTUAL_KEY_TAG_PATTERN.test(tag)) {
      issues.push({ id: 'virtualKey_tag', label: 'Tag', message: 'Tag allows English letters, numbers, underscore, and hyphen only.' });
    }
    return issues;
  }

  function setVirtualKeyPoolFieldErrors(ids) {
    ['virtualKeyPool_pool_name'].forEach(function (id) {
      var element = byId(id);
      var wrapper = element && element.closest ? element.closest('.field') : null;
      var hasError = ids.indexOf(id) >= 0;
      if (element) {
        element.classList.toggle('is-invalid', hasError);
      }
      if (wrapper) {
        wrapper.classList.toggle('field--invalid', hasError);
      }
    });
  }

  function setVirtualKeyEditorFieldErrors(ids) {
    ['virtualKey_pool_ref', 'virtualKey_tag'].forEach(function (id) {
      var element = byId(id);
      var wrapper = element && element.closest ? element.closest('.field') : null;
      var hasError = ids.indexOf(id) >= 0;
      if (element) {
        element.classList.toggle('is-invalid', hasError);
      }
      if (wrapper) {
        wrapper.classList.toggle('field--invalid', hasError);
      }
    });
  }

  function clearVirtualKeyFieldErrors() {
    setVirtualKeyPoolFieldErrors([]);
    setVirtualKeyEditorFieldErrors([]);
  }

  function openVirtualKeyPoolEditor() {
    pendingVirtualKeyPoolDraft = buildBlankVirtualKeyPoolDraft();
    pendingVirtualKeyPoolDraftId = '';
    pendingVirtualKeyPoolValidationActive = false;
    resetCommitButton(byId('virtualKeyPoolConfirmButton'));
    clearVirtualKeyFieldErrors();
    renderVirtualKeyPoolEditor();
  }

  function openVirtualKeyPoolEditorForEdit(poolId) {
    var pool = state.virtualKeyPools && state.virtualKeyPools[poolId];

    if (!pool) {
      return;
    }

    pendingVirtualKeyPoolDraft = {
      enabled: pool.enabled !== false,
      pool_name: pool.pool_name || '',
      description: pool.description || ''
    };
    pendingVirtualKeyPoolDraftId = poolId;
    pendingVirtualKeyPoolValidationActive = false;
    resetCommitButton(byId('virtualKeyPoolConfirmButton'));
    clearVirtualKeyFieldErrors();
    renderVirtualKeyPoolEditor();
  }

  function closeVirtualKeyPoolEditor() {
    pendingVirtualKeyPoolDraft = null;
    pendingVirtualKeyPoolDraftId = '';
    pendingVirtualKeyPoolValidationActive = false;
    clearVirtualKeyFieldErrors();
    renderVirtualKeyPoolEditor();
  }

  function openVirtualKeyEditor() {
    if (!Object.keys(state.virtualKeyPools || {}).length) {
      showToast('Create a Virtual Key Pool first.', 'error');
      return;
    }
    pendingVirtualKeyDraft = buildBlankVirtualKeyDraft();
    pendingVirtualKeyDraftId = '';
    pendingVirtualKeyValidationActive = false;
    resetCommitButton(byId('virtualKeyConfirmButton'));
    clearVirtualKeyFieldErrors();
    renderVirtualKeyEditor();
  }

  function openVirtualKeyEditorForEdit(keyId) {
    var virtualKey = state.virtualKeys && state.virtualKeys[keyId];
    var fullKey = transientVirtualKeySecrets[keyId] && transientVirtualKeySecrets[keyId].fullKey;

    if (!virtualKey) {
      return;
    }

    pendingVirtualKeyDraft = {
      enabled: virtualKey.enabled !== false,
      kid: virtualKey.kid || keyId,
      tag: virtualKey.tag || '',
      virtual_key_pool_ref: virtualKey.virtual_key_pool_ref || getDefaultVirtualKeyPoolRef(),
      created_at: virtualKey.created_at || '',
      last_used_at: getVirtualKeyLastUsedAt(keyId, virtualKey),
      secret: fullKey ? extractVirtualKeySecret(fullKey) : '',
      secret_last4: virtualKey.secret_last4 || '',
      key_preview: virtualKey.key_preview || '',
      isExisting: true,
      revealSecret: false
    };
    pendingVirtualKeyDraftId = keyId;
    pendingVirtualKeyValidationActive = false;
    resetCommitButton(byId('virtualKeyConfirmButton'));
    clearVirtualKeyFieldErrors();
    renderVirtualKeyEditor();
  }

  function closeVirtualKeyEditor() {
    pendingVirtualKeyDraft = null;
    pendingVirtualKeyDraftId = '';
    pendingVirtualKeyValidationActive = false;
    setVirtualKeyCopyFeedback('draft', false);
    clearVirtualKeyFieldErrors();
    renderVirtualKeyEditor();
  }

  function syncVirtualKeyPoolDraftFromForm() {
    if (!pendingVirtualKeyPoolDraft) {
      return;
    }
    pendingVirtualKeyPoolDraft.enabled = !!(byId('virtualKeyPool_enabled') && byId('virtualKeyPool_enabled').checked);
    pendingVirtualKeyPoolDraft.pool_name = getValue('virtualKeyPool_pool_name');
    pendingVirtualKeyPoolDraft.description = getValue('virtualKeyPool_description');
  }

  function syncVirtualKeyDraftFromForm() {
    if (!pendingVirtualKeyDraft) {
      return;
    }
    pendingVirtualKeyDraft.enabled = !!(byId('virtualKey_enabled') && byId('virtualKey_enabled').checked);
    pendingVirtualKeyDraft.virtual_key_pool_ref = getValue('virtualKey_pool_ref');
    pendingVirtualKeyDraft.tag = String(getValue('virtualKey_tag') || '').trim();
  }

  function getActiveVirtualKeyPoolFilterRefs() {
    return activeVirtualKeyPoolFilters.filter(function (poolRef) {
      return !!state.virtualKeyPools[poolRef];
    });
  }

  function getVisibleVirtualKeyPoolIds() {
    var searchTerm = normalizeSearchTerm(virtualKeyPoolSearchTerm);

    return Object.keys(state.virtualKeyPools || {}).filter(function (poolId) {
      var pool = state.virtualKeyPools[poolId] || {};
      var haystack;

      if (!searchTerm) {
        return true;
      }

      haystack = [
        poolId,
        pool.pool_name || '',
        pool.description || ''
      ].map(normalizeSearchTerm).join(' ');

      return haystack.indexOf(searchTerm) >= 0;
    });
  }

  function getVisibleVirtualKeyIds() {
    var activePoolFilters = getActiveVirtualKeyPoolFilterRefs();
    var searchTerm = normalizeSearchTerm(virtualKeySearchTerm);

    return Object.keys(state.virtualKeys || {}).filter(function (keyId) {
      var virtualKey = state.virtualKeys[keyId];
      var poolName;
      var createdLabel;
      var lastUsedLabel;
      var haystack;
      if (!virtualKey) {
        return false;
      }
      if (!searchTerm && activePoolFilters.length && activePoolFilters.indexOf(virtualKey.virtual_key_pool_ref) < 0) {
        return false;
      }
      if (!searchTerm) {
        return true;
      }
      poolName = getVirtualKeyPoolName(virtualKey.virtual_key_pool_ref || '');
      createdLabel = formatDateOnly(virtualKey.created_at, 'Unknown');
      lastUsedLabel = formatDateOnly(getVirtualKeyLastUsedAt(keyId, virtualKey), 'Never');
      haystack = [
        keyId,
        virtualKey.kid || '',
        virtualKey.tag || '',
        virtualKey.virtual_key_pool_ref || '',
        poolName || '',
        virtualKey.key_preview || '',
        virtualKey.description || '',
        virtualKey.secret_last4 || '',
        virtualKey.created_at || '',
        getVirtualKeyLastUsedAt(keyId, virtualKey),
        createdLabel,
        lastUsedLabel
      ].map(normalizeSearchTerm).join(' ');
      if (haystack.indexOf(searchTerm) < 0) {
        return false;
      }
      return true;
    });
  }

  function getSortedVisibleVirtualKeyIds() {
    return getVisibleVirtualKeyIds().sort(function (left, right) {
      return (state.virtualKeys[left].kid || left).localeCompare(state.virtualKeys[right].kid || right);
    });
  }

  function isShowAllPage(pageValue) {
    return pageValue === 'all';
  }

  function getPageState(totalVisibleItems, currentPage) {
    var totalPages = Math.max(1, Math.ceil(totalVisibleItems / VIRTUAL_KEY_PAGE_SIZE));
    var pageValue = currentPage;

    if (isShowAllPage(pageValue)) {
      return {
        currentPage: 'all',
        totalPages: totalPages,
        pageItemsCount: totalVisibleItems
      };
    }

    if (typeof pageValue !== 'number' || isNaN(pageValue)) {
      pageValue = 1;
    }
    if (pageValue < 1) {
      pageValue = 1;
    }
    if (pageValue > totalPages) {
      pageValue = totalPages;
    }

    return {
      currentPage: pageValue,
      totalPages: totalPages,
      pageItemsCount: Math.min(VIRTUAL_KEY_PAGE_SIZE, Math.max(0, totalVisibleItems - ((pageValue - 1) * VIRTUAL_KEY_PAGE_SIZE)))
    };
  }

  function clampVirtualKeyPoolPage(totalVisiblePools) {
    var pageState = getPageState(totalVisiblePools, virtualKeyPoolPage);

    virtualKeyPoolPage = pageState.currentPage;
    return pageState;
  }

  function clampVirtualKeyPage(totalVisibleKeys) {
    var pageState = getPageState(totalVisibleKeys, virtualKeyPage);

    virtualKeyPage = pageState.currentPage;
    return pageState;
  }

  function getCurrentVirtualKeyPoolPageIds() {
    var visiblePoolIds = getVisibleVirtualKeyPoolIds().sort(function (left, right) {
      return getVirtualKeyPoolName(left).localeCompare(getVirtualKeyPoolName(right));
    });
    var pageState = clampVirtualKeyPoolPage(visiblePoolIds.length);
    var startIndex;

    if (isShowAllPage(pageState.currentPage)) {
      return visiblePoolIds;
    }

    startIndex = (pageState.currentPage - 1) * VIRTUAL_KEY_PAGE_SIZE;
    return visiblePoolIds.slice(startIndex, startIndex + VIRTUAL_KEY_PAGE_SIZE);
  }

  function getCurrentPageVirtualKeyIds() {
    var visibleKeys = getSortedVisibleVirtualKeyIds();
    var pageState = clampVirtualKeyPage(visibleKeys.length);
    var startIndex;

    if (isShowAllPage(pageState.currentPage)) {
      return visibleKeys;
    }

    startIndex = (pageState.currentPage - 1) * VIRTUAL_KEY_PAGE_SIZE;
    return visibleKeys.slice(startIndex, startIndex + VIRTUAL_KEY_PAGE_SIZE);
  }

  function getVisibleBackendIds() {
    var term = normalizeSearchTerm(backendSearchTerm);

    return Object.keys(state.backendTargets || {}).filter(function (id) {
      var backend = state.backendTargets[id] || {};
      var haystack;

      if (!term) {
        return true;
      }

      haystack = [
        id,
        backend.backend_target_name,
        backend.pool_name,
        backend.credential_pool_ref,
        backend.endpoint_url,
        backend.model_id,
        backend.schema_family
      ].map(function (value) {
        return normalizeSearchTerm(value);
      }).join(' ');

      return haystack.indexOf(term) >= 0;
    }).sort(function (left, right) {
      return (state.backendTargets[left].backend_target_name || left).localeCompare(state.backendTargets[right].backend_target_name || right);
    });
  }

  function clampBackendPage(totalVisibleBackends) {
    var pageState = getPageState(totalVisibleBackends, backendPage);

    backendPage = pageState.currentPage;
    return pageState;
  }

  function getCurrentPageBackendIds() {
    var visibleBackendIds = getVisibleBackendIds();
    var pageState = clampBackendPage(visibleBackendIds.length);
    var startIndex;

    if (isShowAllPage(pageState.currentPage)) {
      return visibleBackendIds;
    }

    startIndex = (pageState.currentPage - 1) * VIRTUAL_KEY_PAGE_SIZE;
    return visibleBackendIds.slice(startIndex, startIndex + VIRTUAL_KEY_PAGE_SIZE);
  }

  function setActiveVirtualKeyPoolFilter(poolRefs) {
    var nextFilters = Array.isArray(poolRefs) ? poolRefs.slice() : (poolRefs ? [poolRefs] : []);

    nextFilters = nextFilters.filter(function (poolRef, index) {
      return !!poolRef && nextFilters.indexOf(poolRef) === index && !!state.virtualKeyPools[poolRef];
    }).sort(function (left, right) {
      return getVirtualKeyPoolName(left).localeCompare(getVirtualKeyPoolName(right));
    });

    if (stableStringify(activeVirtualKeyPoolFilters) === stableStringify(nextFilters)) {
      return;
    }

    activeVirtualKeyPoolFilters = nextFilters;
    virtualKeyPage = 1;
    virtualKeySelection = {};
  }

  function isVirtualKeyLayoutStacked() {
    return window.innerWidth <= VIRTUAL_KEY_STACK_BREAKPOINT;
  }

  function pruneVirtualKeySelections() {
    Object.keys(virtualKeyPoolSelection).forEach(function (id) {
      if (!state.virtualKeyPools[id]) {
        delete virtualKeyPoolSelection[id];
      }
    });
    Object.keys(virtualKeySelection).forEach(function (id) {
      if (!state.virtualKeys[id]) {
        delete virtualKeySelection[id];
      }
    });
    Object.keys(transientVirtualKeySecrets).forEach(function (id) {
      if (!state.virtualKeys[id]) {
        delete transientVirtualKeySecrets[id];
      }
    });
    Object.keys(virtualKeyRevealState).forEach(function (id) {
      if (!state.virtualKeys[id] || !transientVirtualKeySecrets[id] || !transientVirtualKeySecrets[id].fullKey) {
        delete virtualKeyRevealState[id];
      }
    });
    Object.keys(virtualKeyCopyState).forEach(function (id) {
      if (id !== 'draft' && !state.virtualKeys[id]) {
        delete virtualKeyCopyState[id];
      }
    });
    if (activeVirtualKeyPoolFilters.length) {
      setActiveVirtualKeyPoolFilter(getActiveVirtualKeyPoolFilterRefs());
    }
    clampVirtualKeyPoolPage(getVisibleVirtualKeyPoolIds().length);
    clampVirtualKeyPage(getVisibleVirtualKeyIds().length);
  }

  function renderVirtualKeyPoolEditor() {
    var editor = byId('virtualKeyPoolEditor');
    var title = byId('virtualKeyPoolEditorTitle');
    var idInput = byId('virtualKeyPool_object_id');
    var hint = byId('virtualKeyPoolValidationHint');
    var confirmButton = byId('virtualKeyPoolConfirmButton');
    var issues;
    var nameIssues;

    if (!editor || !idInput || !title) {
      return;
    }

    if (!pendingVirtualKeyPoolDraft) {
      editor.hidden = true;
      if (confirmButton) {
        confirmButton.hidden = true;
      }
      return;
    }

    editor.hidden = false;
    if (confirmButton) {
      confirmButton.hidden = false;
      confirmButton.disabled = false;
    }
    title.textContent = pendingVirtualKeyPoolDraftId ? 'Edit Virtual Key Pool' : 'Add Virtual Key Pool';
    byId('virtualKeyPool_enabled').checked = pendingVirtualKeyPoolDraft.enabled !== false;
    setValue('virtualKeyPool_pool_name', pendingVirtualKeyPoolDraft.pool_name || '');
    setValue('virtualKeyPool_description', pendingVirtualKeyPoolDraft.description || '');
    idInput.value = getVirtualKeyPoolDraftObjectId() || 'Generated after valid name';
    issues = getVirtualKeyPoolFieldIssues(pendingVirtualKeyPoolDraft);
    nameIssues = issues.filter(function (issue) {
      return issue.id === 'virtualKeyPool_pool_name';
    });
    if (pendingVirtualKeyPoolValidationActive) {
      setVirtualKeyPoolFieldErrors(nameIssues.map(function (issue) { return issue.id; }));
    }
    if (hint) {
      hint.textContent = nameIssues.length ? nameIssues[0].message : 'Pool Name: 1-64 chars, letters, numbers, spaces, underscore, hyphen, and dot.';
    }
  }

  function renderVirtualKeyEditor() {
    var editor = byId('virtualKeyEditor');
    var title = editor ? editor.querySelector('h4') : null;
    var poolSelect = byId('virtualKey_pool_ref');
    var detailInput = byId('virtualKey_detail');
    var revealButton = byId('virtualKeyDetailRevealButton');
    var copyButton = byId('virtualKeyDetailCopyButton');
    var createdInput = byId('virtualKey_created_at');
    var lastUsedInput = byId('virtualKey_last_used_at');
    var hint = byId('virtualKeyValidationHint');
    var issues;
    var poolRefs;
    var optionsHtml = '';
    var detail;
    var fullDetail;

    if (!editor || !poolSelect || !detailInput || !revealButton || !copyButton) {
      return;
    }

    poolRefs = Object.keys(state.virtualKeyPools || {});
    if (!pendingVirtualKeyDraft) {
      editor.hidden = true;
      return;
    }

    editor.hidden = false;
    if (title) {
      title.textContent = pendingVirtualKeyDraftId ? 'Edit Virtual Key' : 'Add Virtual Key';
    }
    if (!pendingVirtualKeyDraft.virtual_key_pool_ref || !state.virtualKeyPools[pendingVirtualKeyDraft.virtual_key_pool_ref]) {
      pendingVirtualKeyDraft.virtual_key_pool_ref = getDefaultVirtualKeyPoolRef();
    }
    if (!pendingVirtualKeyDraft.secret && !pendingVirtualKeyDraft.isExisting) {
      pendingVirtualKeyDraft.secret = randomKeyPart(32);
    }
    optionsHtml = poolRefs.map(function (poolRef) {
      var pool = state.virtualKeyPools[poolRef] || {};
      return '<option value="' + escapeHtml(poolRef) + '">' +
        escapeHtml((pool.pool_name || poolRef) + ' (' + poolRef + ')') +
        '</option>';
    }).join('');
    poolSelect.innerHTML = optionsHtml;
    byId('virtualKey_enabled').checked = pendingVirtualKeyDraft.enabled !== false;
    setValue('virtualKey_kid', pendingVirtualKeyDraft.kid || '');
    if (!pendingVirtualKeyDraft.created_at && !pendingVirtualKeyDraftId) {
      pendingVirtualKeyDraft.created_at = getTodayDateString();
    }
    if (createdInput) {
      createdInput.value = formatDateOnly(pendingVirtualKeyDraft.created_at, 'Unknown');
    }
    if (lastUsedInput) {
      lastUsedInput.value = formatDateOnly(
        pendingVirtualKeyDraftId
          ? getVirtualKeyLastUsedAt(pendingVirtualKeyDraftId, pendingVirtualKeyDraft)
          : pendingVirtualKeyDraft.last_used_at,
        'Never'
      );
    }
    poolSelect.value = pendingVirtualKeyDraft.virtual_key_pool_ref || '';
    setValue('virtualKey_tag', pendingVirtualKeyDraft.tag || '');
    fullDetail = getPendingVirtualKeyFullDetail();
    detail = pendingVirtualKeyDraft.revealSecret ? getPendingVirtualKeyFullDetail() : getPendingVirtualKeyMaskedDetail();
    detailInput.value = detail || (pendingVirtualKeyDraftId ? 'Full key unavailable after reload' : 'Generated after Pool Name and Tag are set');
    revealButton.disabled = !fullDetail;
    copyButton.disabled = !fullDetail;
    revealButton.className = 'icon-action-button ' + (pendingVirtualKeyDraft.revealSecret ? 'icon-action-button--eye' : 'icon-action-button--eye-off');
    revealButton.title = fullDetail
      ? (pendingVirtualKeyDraft.revealSecret ? 'Hide full key' : 'Reveal full key')
      : 'Full key is unavailable after reload. Only keys generated in this browser session can be revealed.';
    revealButton.setAttribute('aria-label', revealButton.title);
    copyButton.className = 'icon-action-button ' + (virtualKeyCopyState.draft ? 'icon-action-button--check' : 'icon-action-button--copy');
    copyButton.title = virtualKeyCopyState.draft
      ? 'Copied'
      : (fullDetail
        ? 'Copy full key'
        : 'Full key is unavailable after reload. Only keys generated in this browser session can be copied.');
    copyButton.setAttribute('aria-label', copyButton.title);
    issues = getVirtualKeyFieldIssues(pendingVirtualKeyDraft);
    if (pendingVirtualKeyValidationActive) {
      setVirtualKeyEditorFieldErrors(issues.map(function (issue) { return issue.id; }));
    }
    if (hint) {
      hint.textContent = issues.length ? issues[0].message : 'Tag must use English letters, numbers, underscore, or hyphen only. Examples: RD, HQ, US.';
    }
  }

  function renderVirtualKeyLayout() {
    var layout = byId('virtualKeyLayout');
    var divider = byId('virtualKeyDivider');
    var paneMin = 340;
    var rightMin = 460;
    var maxLeft;
    var stacked;

    if (!layout) {
      return;
    }

    stacked = isVirtualKeyLayoutStacked();
    if (divider) {
      divider.tabIndex = stacked ? -1 : 0;
      divider.setAttribute('aria-hidden', stacked ? 'true' : 'false');
    }
    if (stacked) {
      layout.style.removeProperty('--virtual-key-left-width');
      if (virtualKeyPaneDragState) {
        virtualKeyPaneDragState = null;
        document.body.classList.remove('is-resizing-virtual-key');
      }
    } else {
      maxLeft = Math.max(paneMin, layout.clientWidth - rightMin - 18);
      if (virtualKeyPaneWidthPx < paneMin) {
        virtualKeyPaneWidthPx = paneMin;
      }
      if (virtualKeyPaneWidthPx > maxLeft) {
        virtualKeyPaneWidthPx = maxLeft;
      }
      layout.style.setProperty('--virtual-key-left-width', virtualKeyPaneWidthPx + 'px');
    }
  }

  function renderVirtualKeyPools() {
    var host = byId('virtualKeyPoolList');
    var selectAll = byId('virtualKeyPoolSelectAll');
    var searchInput = byId('virtualKeyPoolSearchInput');
    var visiblePoolIds = getVisibleVirtualKeyPoolIds().sort(function (left, right) {
      return getVirtualKeyPoolName(left).localeCompare(getVirtualKeyPoolName(right));
    });
    var pageState = clampVirtualKeyPoolPage(visiblePoolIds.length);
    var pagePoolIds = isShowAllPage(pageState.currentPage)
      ? visiblePoolIds
      : visiblePoolIds.slice((pageState.currentPage - 1) * VIRTUAL_KEY_PAGE_SIZE, pageState.currentPage * VIRTUAL_KEY_PAGE_SIZE);
    var activePoolFilters = getActiveVirtualKeyPoolFilterRefs();
    var html = '';
    var rows = 0;
    var selectedCount = 0;

    if (!host) {
      return;
    }
    if (searchInput && searchInput.value !== virtualKeyPoolSearchTerm) {
      searchInput.value = virtualKeyPoolSearchTerm;
    }

    pagePoolIds.forEach(function (key) {
      var pool = state.virtualKeyPools[key] || {};
      var poolStatusLabel = pool.enabled === false ? 'Disabled' : 'Enabled';
      var description = String(pool.description || '').trim();
      var isSelected = !!virtualKeyPoolSelection[key];

      rows += 1;
      if (isSelected) {
        selectedCount += 1;
      }

      html += '<tr class="' + (activePoolFilters.indexOf(key) >= 0 ? 'is-active ' : '') + 'virtual-key-row" data-vk-pool-row="' + escapeHtml(key) + '">' +
        '<td class="virtual-key-checkbox-col"><input type="checkbox" data-vk-pool-select="' + escapeHtml(key) + '"' + (isSelected ? ' checked' : '') + ' aria-label="Select Virtual Key Pool ' + escapeHtml(pool.pool_name || key) + '"></td>' +
        '<td><span class="virtual-key-pool-status-dot ' + (pool.enabled === false ? 'virtual-key-pool-status-dot--disabled' : 'virtual-key-pool-status-dot--enabled') + '" title="' + escapeHtml('Pool is ' + poolStatusLabel.toLowerCase() + '.') + '" aria-label="' + escapeHtml(poolStatusLabel) + '"></span></td>' +
        '<td><span class="table-primary">' + escapeHtml(pool.pool_name || key) + '</span></td>' +
        '<td>' + (description ? '<span class="virtual-key-pool-description" title="' + escapeHtml(description) + '">' + escapeHtml(description) + '</span>' : '') + '</td>' +
        '<td><div class="row-action-group row-action-group--compact">' +
        '<button class="row-action-button virtual-key-switch-button ' + (pool.enabled === false ? '' : 'is-on') + '" type="button" data-vk-pool-toggle="' + escapeHtml(key) + '" title="' + escapeHtml(pool.enabled === false ? 'Enable pool' : 'Disable pool') + '" aria-label="' + escapeHtml(pool.enabled === false ? 'Enable pool' : 'Disable pool') + '"><span></span></button>' +
        '<button class="row-action-button virtual-key-config-button" type="button" data-vk-pool-config="' + escapeHtml(key) + '" title="Configure pool" aria-label="Configure pool"></button>' +
        '<button class="row-action-button row-action-button--danger row-action-button--delete" type="button" data-vk-pool-delete="' + escapeHtml(key) + '" aria-label="Delete pool">&#x1F5D1;&#xFE0E;</button>' +
        '</div></td>' +
        '</tr>';
    });

    if (!html) {
      html = '<tr><td class="table-empty" colspan="5"><div class="empty-editor"><h3>' +
        (Object.keys(state.virtualKeyPools || {}).length ? 'No pools match the current search.' : 'Add a pool before creating keys.') +
        '</h3></div></td></tr>';
    }

    host.innerHTML = html;
    if (selectAll) {
      selectAll.checked = rows > 0 && selectedCount === rows;
      selectAll.indeterminate = selectedCount > 0 && selectedCount < rows;
    }
    renderVirtualKeyPoolPagination(visiblePoolIds.length, pageState);
  }

  function renderVirtualKeys() {
    var host = byId('virtualKeyList');
    var selectAll = byId('virtualKeySelectAll');
    var searchInput = byId('virtualKeySearchInput');
    var visibleKeys = getSortedVisibleVirtualKeyIds();
    var pageState;
    var pageKeys;
    var html = '';
    var selectedCount = 0;
    var totalVisibleKeys = visibleKeys.length;

    if (!host) {
      return;
    }
    if (searchInput && searchInput.value !== virtualKeySearchTerm) {
      searchInput.value = virtualKeySearchTerm;
    }

    pageState = clampVirtualKeyPage(totalVisibleKeys);
    pageKeys = isShowAllPage(pageState.currentPage)
      ? visibleKeys
      : visibleKeys.slice((pageState.currentPage - 1) * VIRTUAL_KEY_PAGE_SIZE, pageState.currentPage * VIRTUAL_KEY_PAGE_SIZE);

    pageKeys.forEach(function (key) {
      var virtualKey = state.virtualKeys[key] || {};
      var pool = state.virtualKeyPools[virtualKey.virtual_key_pool_ref || ''] || null;
      var preview = virtualKey.key_preview || buildMaskedVirtualKeyDetail(virtualKey.tag, virtualKey.kid || key, virtualKey.secret_last4 || '');
      var rowDetail = preview;
      var keyStatusLabel = virtualKey.enabled === false ? 'Disabled' : 'Enabled';
      var canAccessSecret = !!(transientVirtualKeySecrets[key] && transientVirtualKeySecrets[key].fullKey);
      var warningClass = '';
      var warningLabel = '';
      var warningTitle = '';
      var statusTitle;
      var copyTitle = canAccessSecret
        ? 'Copy full key'
        : 'Full key is unavailable after reload. Only keys generated in this browser session can be copied.';
      var isSelected = !!virtualKeySelection[key];
      var keyId = virtualKey.kid || key;
      var poolName = getVirtualKeyPoolName(virtualKey.virtual_key_pool_ref || '') || 'Missing Pool';
      var poolTitle = poolName;
      var tagValue = virtualKey.tag || '';
      var createdLabel = formatDateOnly(virtualKey.created_at, 'Unknown');
      var lastUsedLabel = formatDateOnly(getVirtualKeyLastUsedAt(key, virtualKey), 'Never');
      var detailTitle = rowDetail || 'Pending preview';
      var detailAria = canAccessSecret
        ? 'Masked virtual key preview. Copy available.'
        : 'Masked virtual key preview. Full key unavailable after reload.';
      var copyFeedbackActive = !!virtualKeyCopyState[key];

      if (!pool) {
        warningClass = 'virtual-key-warning-dot--danger';
        warningLabel = '!';
        warningTitle = 'Assigned pool reference "' + (virtualKey.virtual_key_pool_ref || 'missing') + '" is not defined.';
      } else if (pool.enabled === false) {
        warningClass = 'virtual-key-warning-dot--warn';
        warningLabel = '!';
        warningTitle = 'Assigned pool "' + (pool.pool_name || virtualKey.virtual_key_pool_ref || 'unknown') + '" is disabled.';
      }
      if (isSelected) {
        selectedCount += 1;
      }
      if (virtualKey.virtual_key_pool_ref) {
        poolTitle += ' (' + virtualKey.virtual_key_pool_ref + ')';
      }
      if (virtualKey.description) {
        detailTitle += ' | ' + virtualKey.description;
      }
      statusTitle = 'Virtual Key is ' + keyStatusLabel.toLowerCase() + '.';
      if (warningTitle) {
        statusTitle += ' ' + warningTitle;
      }

      html += '<tr class="virtual-key-row">' +
        '<td class="virtual-key-checkbox-col"><input type="checkbox" data-vk-select="' + escapeHtml(key) + '"' + (isSelected ? ' checked' : '') + ' aria-label="Select Virtual Key ' + escapeHtml(keyId) + '"></td>' +
        '<td><div class="virtual-key-dense-status" title="' + escapeHtml(statusTitle) + '">' +
        '<span class="virtual-key-pool-status-dot ' + (virtualKey.enabled === false ? 'virtual-key-pool-status-dot--disabled' : 'virtual-key-pool-status-dot--enabled') + '" aria-hidden="true"></span>' +
        (warningTitle
          ? '<span class="virtual-key-warning-dot ' + warningClass + '" title="' + escapeHtml(warningTitle) + '" aria-label="' + escapeHtml(warningTitle) + '">' + warningLabel + '</span>'
          : '') +
        '</div></td>' +
        '<td><span class="table-primary table-primary--mono virtual-key-clip" title="' + escapeHtml(keyId) + '">' + escapeHtml(keyId) + '</span></td>' +
        '<td><div class="virtual-key-pool-cell">' +
        '<span class="table-primary virtual-key-clip" title="' + escapeHtml(poolTitle) + '">' + escapeHtml(poolName) + '</span>' +
        (tagValue ? '<span class="virtual-key-inline-tag" title="' + escapeHtml(tagValue) + '">' + escapeHtml(tagValue) + '</span>' : '') +
        '</div></td>' +
        '<td><div class="virtual-key-detail-row">' +
        '<span class="virtual-key-clip virtual-key-clip--mono virtual-key-detail-value" title="' + escapeHtml(detailTitle) + '" aria-label="' + escapeHtml(detailAria) + '">' + escapeHtml(rowDetail || 'Pending preview') + '</span><div class="virtual-key-inline-actions">' +
        '<button class="icon-action-button ' + (copyFeedbackActive ? 'icon-action-button--check' : 'icon-action-button--copy') + '" type="button" data-vk-copy="' + escapeHtml(key) + '" title="' + escapeHtml(copyFeedbackActive ? 'Copied' : copyTitle) + '" aria-label="' + escapeHtml(copyFeedbackActive ? 'Copied' : copyTitle) + '"' + (canAccessSecret ? '' : ' disabled') + '></button>' +
        '</div></div></td>' +
        '<td><span class="virtual-key-clip" title="' + escapeHtml(createdLabel) + '">' + escapeHtml(createdLabel) + '</span></td>' +
        '<td><span class="virtual-key-clip" title="' + escapeHtml(lastUsedLabel) + '">' + escapeHtml(lastUsedLabel) + '</span></td>' +
        '<td><div class="row-action-group row-action-group--compact">' +
        '<button class="row-action-button virtual-key-switch-button ' + (virtualKey.enabled === false ? '' : 'is-on') + '" type="button" data-vk-toggle="' + escapeHtml(key) + '" title="' + escapeHtml(virtualKey.enabled === false ? 'Enable key' : 'Disable key') + '" aria-label="' + escapeHtml(virtualKey.enabled === false ? 'Enable key' : 'Disable key') + '"><span></span></button>' +
        '<button class="row-action-button virtual-key-config-button" type="button" data-vk-config="' + escapeHtml(key) + '" title="Configure key" aria-label="Configure key"></button>' +
        '<button class="row-action-button row-action-button--danger row-action-button--delete" type="button" data-vk-delete="' + escapeHtml(key) + '" aria-label="Delete key">&#x1F5D1;&#xFE0E;</button>' +
        '</div></td>' +
        '</tr>';
    });

    if (!html) {
      html = '<tr><td class="table-empty" colspan="8"><div class="empty-editor"><h3>' +
        (totalVisibleKeys
          ? 'No keys on this page.'
          : (getActiveVirtualKeyPoolFilterRefs().length || normalizeSearchTerm(virtualKeySearchTerm)
            ? 'No keys match the current filters.'
            : 'Add a key to enable northbound virtual key authentication.')) +
        '</h3></div></td></tr>';
    }

    host.innerHTML = html;
    if (selectAll) {
      selectAll.checked = pageKeys.length > 0 && selectedCount === pageKeys.length;
      selectAll.indeterminate = selectedCount > 0 && selectedCount < pageKeys.length;
    }
    renderVirtualKeyPagination(totalVisibleKeys, pageState);
  }

  function buildVirtualKeyPageOptions(totalVisibleItems, pageState) {
    var options = [];
    var pageIndex;
    var label;

    for (pageIndex = 1; pageIndex <= pageState.totalPages; pageIndex += 1) {
      label = pageIndex === 1 ? 'Page 1 of ' + pageState.totalPages : 'Page ' + pageIndex;
      options.push('<option value="' + pageIndex + '"' + (pageState.currentPage === pageIndex ? ' selected' : '') + '>' + label + '</option>');
    }

    options.push('<option value="all"' + (isShowAllPage(pageState.currentPage) ? ' selected' : '') + '>Show All (' + totalVisibleItems + ')</option>');
    return options.join('');
  }

  function renderVirtualKeyPoolPagination(totalVisiblePools, pageState) {
    var select = byId('virtualKeyPoolPageSelect');

    if (!select) {
      return;
    }

    select.innerHTML = buildVirtualKeyPageOptions(totalVisiblePools, pageState);
    select.disabled = totalVisiblePools === 0;
  }

  function renderVirtualKeyPagination(totalVisibleKeys, pageState) {
    var select = byId('virtualKeyPageSelect');

    if (!select) {
      return;
    }

    select.innerHTML = buildVirtualKeyPageOptions(totalVisibleKeys, pageState);
    select.disabled = totalVisibleKeys === 0;
  }

  function composeModelCredentialEntryId(poolRef, credentialId) {
    return String(poolRef || '') + '::' + String(credentialId || '');
  }

  function parseModelCredentialEntryId(entryId) {
    var normalized = String(entryId || '');
    var separatorIndex = normalized.indexOf('::');

    if (separatorIndex < 0) {
      return {
        poolRef: '',
        credentialId: normalized
      };
    }

    return {
      poolRef: normalized.slice(0, separatorIndex),
      credentialId: normalized.slice(separatorIndex + 2)
    };
  }

  function getModelCredentialPoolName(poolRef) {
    var pool = state.providerCredentialPools && state.providerCredentialPools[poolRef];

    return pool && pool.pool_name ? pool.pool_name : poolRef;
  }

  function getModelCredentialPoolVendor(poolRef) {
    var pool = state.providerCredentialPools && state.providerCredentialPools[poolRef];

    return pool && pool.vendor ? pool.vendor : '';
  }

  function formatModelCredentialVendorLabel(value) {
    var vendor = String(value || '').trim();
    var normalized = vendor.toLowerCase();
    var labels = {
      deepseek: 'DeepSeek',
      openai: 'OpenAI',
      anthropic: 'Anthropic',
      azure: 'Azure'
    };

    return labels[normalized] || vendor;
  }

  function getDefaultModelCredentialPoolRef() {
    return Object.keys(state.providerCredentialPools || {})[0] || '';
  }

  function getActiveModelCredentialPoolFilterRefs() {
    return (activeModelCredentialPoolFilters || []).filter(function (poolRef) {
      return !!(poolRef && state.providerCredentialPools && state.providerCredentialPools[poolRef]);
    });
  }

  function setActiveModelCredentialPoolFilter(poolRefs) {
    var nextFilters = Array.isArray(poolRefs) ? poolRefs.slice() : (poolRefs ? [poolRefs] : []);

    nextFilters = nextFilters.filter(function (poolRef, index) {
      return !!poolRef && nextFilters.indexOf(poolRef) === index && !!state.providerCredentialPools[poolRef];
    }).sort(function (left, right) {
      return getModelCredentialPoolName(left).localeCompare(getModelCredentialPoolName(right));
    });

    if (stableStringify(activeModelCredentialPoolFilters) === stableStringify(nextFilters)) {
      return;
    }

    activeModelCredentialPoolFilters = nextFilters;
    modelCredentialPage = 1;
    modelCredentialSelection = {};
  }

  function isModelCredentialLayoutStacked() {
    return window.innerWidth <= VIRTUAL_KEY_STACK_BREAKPOINT;
  }

  function buildProviderCredentialPoolId(name) {
    var base = normalizeIdentifier(name, '');
    var candidate;
    var counter = 2;

    if (!base) {
      return '';
    }

    candidate = base;
    while (state.providerCredentialPools && state.providerCredentialPools[candidate]) {
      candidate = base + '_' + counter;
      counter += 1;
    }

    return candidate;
  }

  function buildProviderCredentialId(displayName, poolRef, currentCredentialId) {
    var pool = poolRef && state.providerCredentialPools ? state.providerCredentialPools[poolRef] : null;
    var entries = Array.isArray(pool && pool.entries) ? pool.entries : [];
    var base = normalizeIdentifier(displayName, 'credential');
    var candidate = base;
    var counter = 2;

    while (entries.some(function (entry) {
      return entry && entry.credential_id === candidate && candidate !== currentCredentialId;
    })) {
      candidate = base + '_' + counter;
      counter += 1;
    }

    return candidate;
  }

  function getModelCredentialEntry(poolRef, credentialId) {
    var pool = poolRef && state.providerCredentialPools ? state.providerCredentialPools[poolRef] : null;
    var entries = Array.isArray(pool && pool.entries) ? pool.entries : [];
    var match = null;

    entries.some(function (entry) {
      if (entry && entry.credential_id === credentialId) {
        match = entry;
        return true;
      }
      return false;
    });

    return match;
  }

  function getNextModelCredentialPriority(poolRef) {
    var entries = getProviderCredentialEntriesForPool(poolRef || '');
    var highestPriority = 0;

    entries.forEach(function (entry) {
      var priority = parseInt(entry && entry.priority, 10);

      if (isFinite(priority) && priority > highestPriority) {
        highestPriority = priority;
      }
    });

    return highestPriority ? highestPriority + 100 : 100;
  }

  function buildBlankModelCredentialPoolDraft() {
    return {
      pool_name: '',
      vendor: '',
      auth_scheme: 'bearer',
      selection_mode: 'priority_failover',
      cooldown_seconds: 30,
      description: '',
      enabled: true,
      entries: []
    };
  }

  function buildBlankModelCredentialDraft(poolRef) {
    var selectedPoolRef = poolRef || getActiveModelCredentialPoolFilterRefs()[0] || getDefaultModelCredentialPoolRef();

    return {
      pool_ref: selectedPoolRef,
      display_name: '',
      credential_id: '',
      priority: getNextModelCredentialPriority(selectedPoolRef),
      api_key: '',
      enabled: true
    };
  }

  function getModelCredentialPoolDraftObjectId() {
    var poolName = String((pendingModelCredentialPoolDraft && pendingModelCredentialPoolDraft.pool_name) || '').trim();

    if (!poolName) {
      return '';
    }

    if (pendingModelCredentialPoolDraftId) {
      return pendingModelCredentialPoolDraftId;
    }

    return buildProviderCredentialPoolId(poolName);
  }

  function syncModelCredentialPoolDraftFromForm() {
    if (!pendingModelCredentialPoolDraft) {
      return null;
    }

    pendingModelCredentialPoolDraft.enabled = !!(byId('modelCredentialPool_enabled') && byId('modelCredentialPool_enabled').checked);
    pendingModelCredentialPoolDraft.pool_name = getValue('modelCredentialPool_pool_name');
    pendingModelCredentialPoolDraft.vendor = String(getValue('modelCredentialPool_vendor') || '').trim();
    pendingModelCredentialPoolDraft.selection_mode = normalizeProviderCredentialSelectionMode(getValue('modelCredentialPool_selection_mode'));
    pendingModelCredentialPoolDraft.cooldown_seconds = parseInt(getValue('modelCredentialPool_cooldown_seconds'), 10);
    if (!isFinite(pendingModelCredentialPoolDraft.cooldown_seconds) || pendingModelCredentialPoolDraft.cooldown_seconds < 0) {
      pendingModelCredentialPoolDraft.cooldown_seconds = 30;
    }
    pendingModelCredentialPoolDraft.description = getValue('modelCredentialPool_description');
    return pendingModelCredentialPoolDraft;
  }

  function syncModelCredentialDraftFromForm() {
    var currentCredentialId;

    if (!pendingModelCredentialDraft) {
      return null;
    }

    pendingModelCredentialDraft.enabled = !!(byId('modelCredential_enabled') && byId('modelCredential_enabled').checked);
    pendingModelCredentialDraft.display_name = String(getValue('modelCredential_display_name') || '').trim();
    pendingModelCredentialDraft.api_key = String(getValue('modelCredential_api_key') || '').trim();
    pendingModelCredentialDraft.priority = parseInt(getValue('modelCredential_priority'), 10);
    if (!isFinite(pendingModelCredentialDraft.priority)) {
      pendingModelCredentialDraft.priority = getNextModelCredentialPriority(pendingModelCredentialDraft.pool_ref);
    }
    currentCredentialId = pendingModelCredentialDraftId ? parseModelCredentialEntryId(pendingModelCredentialDraftId).credentialId : '';
    pendingModelCredentialDraft.credential_id = buildProviderCredentialId(
      pendingModelCredentialDraft.display_name || pendingModelCredentialDraft.credential_id,
      pendingModelCredentialDraft.pool_ref,
      currentCredentialId
    );
    return pendingModelCredentialDraft;
  }

  function getModelCredentialPoolFieldIssues(draft) {
    var issues = [];
    var poolName = String((draft && draft.pool_name) || '').trim();
    var vendor = String((draft && draft.vendor) || '').trim();
    var generatedId = getModelCredentialPoolDraftObjectId();

    if (!poolName) {
      issues.push({ id: 'modelCredentialPool_pool_name', message: 'Pool Name is required.' });
    } else if (poolName.length > 64) {
      issues.push({ id: 'modelCredentialPool_pool_name', message: 'Pool Name must be 64 characters or less.' });
    } else if (!PROVIDER_CREDENTIAL_POOL_NAME_PATTERN.test(poolName)) {
      issues.push({ id: 'modelCredentialPool_pool_name', message: 'Pool Name allows letters, numbers, spaces, underscore, hyphen, and dot only.' });
    } else if (!generatedId) {
      issues.push({ id: 'modelCredentialPool_pool_name', message: 'Pool Name must normalize to a usable identifier.' });
    }

    if (!vendor) {
      issues.push({ id: 'modelCredentialPool_vendor', message: 'Vendor is required.' });
    }

    return issues;
  }

  function setModelCredentialPoolFieldErrors(fieldIds) {
    ['modelCredentialPool_pool_name', 'modelCredentialPool_vendor', 'modelCredentialPool_selection_mode', 'modelCredentialPool_cooldown_seconds'].forEach(function (id) {
      var element = byId(id);
      var wrapper = element && element.closest ? element.closest('.field') : null;
      var isInvalid = fieldIds.indexOf(id) >= 0;

      if (element) {
        element.classList.toggle('is-invalid', isInvalid);
      }
      if (wrapper) {
        wrapper.classList.toggle('field--invalid', isInvalid);
      }
    });
  }

  function getModelCredentialFieldIssues(draft) {
    var issues = [];
    var pool = draft && draft.pool_ref ? state.providerCredentialPools[draft.pool_ref] : null;
    var currentId = pendingModelCredentialDraftId ? parseModelCredentialEntryId(pendingModelCredentialDraftId).credentialId : '';
    var duplicate = false;

    if (!draft || !draft.pool_ref || !pool) {
      issues.push({ id: 'modelCredential_display_name', message: 'Select a valid Credential Pool before adding credentials.' });
    }
    if (!String((draft && draft.display_name) || '').trim()) {
      issues.push({ id: 'modelCredential_display_name', message: 'Display Name is required.' });
    }
    if (!String((draft && draft.api_key) || '').trim()) {
      issues.push({ id: 'modelCredential_api_key', message: 'API Key is required.' });
    }
    if (!isFinite(parseInt(draft && draft.priority, 10))) {
      issues.push({ id: 'modelCredential_priority', message: 'Priority must be an integer.' });
    }
    if (!String((draft && draft.credential_id) || '').trim()) {
      issues.push({ id: 'modelCredential_credential_id', message: 'Credential ID could not be generated.' });
    }

    if (pool && Array.isArray(pool.entries)) {
      duplicate = pool.entries.some(function (entry) {
        return entry && entry.credential_id === draft.credential_id && entry.credential_id !== currentId;
      });
      if (duplicate) {
        issues.push({ id: 'modelCredential_credential_id', message: 'Credential ID must be unique within the selected pool.' });
      }
    }

    return issues;
  }

  function setModelCredentialFieldErrors(fieldIds) {
    ['modelCredential_display_name', 'modelCredential_credential_id', 'modelCredential_priority', 'modelCredential_api_key'].forEach(function (id) {
      var element = byId(id);
      var wrapper = element && element.closest ? element.closest('.field') : null;
      var isInvalid = fieldIds.indexOf(id) >= 0;

      if (element) {
        element.classList.toggle('is-invalid', isInvalid);
      }
      if (wrapper) {
        wrapper.classList.toggle('field--invalid', isInvalid);
      }
    });
  }

  function closeModelCredentialPoolEditor() {
    pendingModelCredentialPoolDraft = null;
    pendingModelCredentialPoolDraftId = '';
    pendingModelCredentialPoolValidationActive = false;
    setModelCredentialPoolFieldErrors([]);
    resetCommitButton(byId('modelCredentialPoolConfirmButton'));
    renderModelCredentialPoolEditor();
  }

  function closeModelCredentialEditor() {
    pendingModelCredentialDraft = null;
    pendingModelCredentialDraftId = '';
    pendingModelCredentialValidationActive = false;
    setModelCredentialFieldErrors([]);
    resetCommitButton(byId('modelCredentialConfirmButton'));
    renderModelCredentialEditor();
  }

  function openModelCredentialPoolCreate() {
    pendingModelCredentialPoolDraft = buildBlankModelCredentialPoolDraft();
    pendingModelCredentialPoolDraftId = '';
    pendingModelCredentialPoolValidationActive = false;
    resetCommitButton(byId('modelCredentialPoolConfirmButton'));
    renderModelCredentialPoolEditor();
  }

  function openModelCredentialPoolEdit(poolId) {
    var pool = state.providerCredentialPools && state.providerCredentialPools[poolId];

    if (!pool) {
      return;
    }

    pendingModelCredentialPoolDraft = {
      pool_name: pool.pool_name || '',
      vendor: pool.vendor || '',
      auth_scheme: pool.auth_scheme || 'bearer',
      selection_mode: pool.selection_mode || 'priority_failover',
      cooldown_seconds: Number(pool.cooldown_seconds !== undefined ? pool.cooldown_seconds : 30),
      description: pool.description || '',
      enabled: pool.enabled !== false
    };
    pendingModelCredentialPoolDraftId = poolId;
    pendingModelCredentialPoolValidationActive = false;
    resetCommitButton(byId('modelCredentialPoolConfirmButton'));
    renderModelCredentialPoolEditor();
  }

  function openModelCredentialCreate() {
    var poolRef = getActiveModelCredentialPoolFilterRefs()[0] || getDefaultModelCredentialPoolRef();

    if (!poolRef) {
      showToast('Add a Credential Pool before creating credentials.', 'error');
      return;
    }

    pendingModelCredentialDraft = buildBlankModelCredentialDraft(poolRef);
    pendingModelCredentialDraftId = '';
    pendingModelCredentialValidationActive = false;
    resetCommitButton(byId('modelCredentialConfirmButton'));
    renderModelCredentialEditor();
  }

  function openModelCredentialEdit(entryId) {
    var parts = parseModelCredentialEntryId(entryId);
    var entry = getModelCredentialEntry(parts.poolRef, parts.credentialId);

    if (!entry) {
      return;
    }

    pendingModelCredentialDraft = {
      pool_ref: parts.poolRef,
      display_name: entry.display_name || '',
      credential_id: entry.credential_id || parts.credentialId,
      priority: parseInt(entry.priority, 10),
      api_key: entry.api_key || '',
      enabled: entry.enabled !== false
    };
    if (!isFinite(pendingModelCredentialDraft.priority)) {
      pendingModelCredentialDraft.priority = getNextModelCredentialPriority(parts.poolRef);
    }
    pendingModelCredentialDraftId = entryId;
    pendingModelCredentialValidationActive = false;
    resetCommitButton(byId('modelCredentialConfirmButton'));
    renderModelCredentialEditor();
  }

  function getVisibleModelCredentialPoolIds() {
    var searchTerm = normalizeSearchTerm(modelCredentialPoolSearchTerm);

    return Object.keys(state.providerCredentialPools || {}).filter(function (poolId) {
      var pool = state.providerCredentialPools[poolId] || {};
      var haystack;

      if (!searchTerm) {
        return true;
      }

      haystack = [
        poolId,
        pool.pool_name,
        pool.vendor,
        pool.description
      ].map(function (value) {
        return normalizeSearchTerm(value);
      }).join(' ');

      return haystack.indexOf(searchTerm) >= 0;
    }).sort(function (left, right) {
      return getModelCredentialPoolName(left).localeCompare(getModelCredentialPoolName(right));
    });
  }

  function getProviderCredentialPreview(entry) {
    var apiKey = String((entry && entry.api_key) || '').trim();
    var last4 = apiKey ? apiKey.slice(-4) : '';

    return last4 ? '****' + last4 : 'Pending preview';
  }

  function getProviderCredentialRuntimeStateLabel(entry, poolRef) {
    var runtimeStatus = getRuntimeProviderCredential(poolRef, entry && entry.credential_id);
    var status = runtimeStatus || (entry && entry.status && typeof entry.status === 'object' ? entry.status : {});
    var stateLabel = String(
      status.state || status.runtime_state || status.runtimeState || (entry && entry.runtime_state) || (entry && entry.runtimeState) || ''
    ).trim().toLowerCase().replace(/-/g, '_');

    if (entry && entry.enabled === false) {
      return 'Disabled';
    }
    if (stateLabel === 'healthy' || stateLabel === 'available') {
      return 'Available';
    }
    if (stateLabel === 'cooling_down' || stateLabel === 'cooldown') {
      return 'Cooling Down';
    }
    if (stateLabel === 'auth_failed' || stateLabel === 'auth_failure' || stateLabel === 'unhealthy') {
      return 'Auth Failed';
    }
    if (stateLabel === 'rate_limited') {
      return 'Rate Limited';
    }
    if (stateLabel === 'disabled') {
      return 'Disabled';
    }
    if (stateLabel === 'degraded') {
      return 'Degraded';
    }

    return 'Unknown';
  }

  function getProviderCredentialLastFailure(entry, poolRef) {
    var runtimeStatus = getRuntimeProviderCredential(poolRef, entry && entry.credential_id);
    var status = runtimeStatus || (entry && entry.status && typeof entry.status === 'object' ? entry.status : {});

    return String(
      status.last_failure_reason ||
      status.lastFailureReason ||
      (entry && entry.last_failure_reason) ||
      (entry && entry.lastFailureReason) ||
      ''
    ).trim();
  }

  function getVisibleModelCredentialEntryIds() {
    var searchTerm = normalizeSearchTerm(modelCredentialSearchTerm);
    var activePoolFilters = getActiveModelCredentialPoolFilterRefs();
    var result = [];

    Object.keys(state.providerCredentialPools || {}).forEach(function (poolRef) {
      var pool = state.providerCredentialPools[poolRef] || {};

      if (!searchTerm && activePoolFilters.length && activePoolFilters.indexOf(poolRef) < 0) {
        return;
      }

      (pool.entries || []).forEach(function (entry) {
        var entryId;
        var haystack;

        if (!entry) {
          return;
        }

        entryId = composeModelCredentialEntryId(poolRef, entry.credential_id || '');
        if (!searchTerm) {
          result.push(entryId);
          return;
        }

        haystack = [
          poolRef,
          pool.pool_name,
          pool.vendor,
          entry.display_name,
          entry.credential_id,
          getProviderCredentialPreview(entry),
          getProviderCredentialRuntimeStateLabel(entry, poolRef),
          getProviderCredentialLastFailure(entry, poolRef)
        ].map(function (value) {
          return normalizeSearchTerm(value);
        }).join(' ');

        if (haystack.indexOf(searchTerm) >= 0) {
          result.push(entryId);
        }
      });
    });

    return result.sort(function (leftId, rightId) {
      var leftParts = parseModelCredentialEntryId(leftId);
      var rightParts = parseModelCredentialEntryId(rightId);
      var leftEntry = getModelCredentialEntry(leftParts.poolRef, leftParts.credentialId) || {};
      var rightEntry = getModelCredentialEntry(rightParts.poolRef, rightParts.credentialId) || {};
      var leftPriority = isFinite(Number(leftEntry.priority)) ? Number(leftEntry.priority) : 999999;
      var rightPriority = isFinite(Number(rightEntry.priority)) ? Number(rightEntry.priority) : 999999;

      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }

      return String(leftEntry.display_name || leftEntry.credential_id || leftId)
        .localeCompare(String(rightEntry.display_name || rightEntry.credential_id || rightId));
    });
  }

  function clampModelCredentialPoolPage(totalVisiblePools) {
    var pageState = getPageState(totalVisiblePools, modelCredentialPoolPage);

    modelCredentialPoolPage = pageState.currentPage;
    return pageState;
  }

  function clampModelCredentialPage(totalVisibleEntries) {
    var pageState = getPageState(totalVisibleEntries, modelCredentialPage);

    modelCredentialPage = pageState.currentPage;
    return pageState;
  }

  function pruneModelCredentialSelections() {
    Object.keys(modelCredentialPoolSelection).forEach(function (poolId) {
      if (!state.providerCredentialPools[poolId]) {
        delete modelCredentialPoolSelection[poolId];
      }
    });
    Object.keys(modelCredentialSelection).forEach(function (entryId) {
      var parts = parseModelCredentialEntryId(entryId);
      if (!getModelCredentialEntry(parts.poolRef, parts.credentialId)) {
        delete modelCredentialSelection[entryId];
      }
    });
    if (activeModelCredentialPoolFilters.length) {
      setActiveModelCredentialPoolFilter(getActiveModelCredentialPoolFilterRefs());
    }
    clampModelCredentialPoolPage(getVisibleModelCredentialPoolIds().length);
    clampModelCredentialPage(getVisibleModelCredentialEntryIds().length);
  }

  function renderModelCredentialLayout() {
    var layout = byId('modelCredentialLayout');
    var divider = byId('modelCredentialDivider');
    var paneMin = 340;
    var rightMin = 560;
    var maxLeft;
    var stacked;

    if (!layout) {
      return;
    }

    stacked = isModelCredentialLayoutStacked();
    if (divider) {
      divider.tabIndex = stacked ? -1 : 0;
      divider.setAttribute('aria-hidden', stacked ? 'true' : 'false');
    }
    if (stacked) {
      layout.style.removeProperty('--virtual-key-left-width');
      if (modelCredentialPaneDragState) {
        modelCredentialPaneDragState = null;
        document.body.classList.remove('is-resizing-virtual-key');
      }
    } else {
      maxLeft = Math.max(paneMin, layout.clientWidth - rightMin - 18);
      if (modelCredentialPaneWidthPx < paneMin) {
        modelCredentialPaneWidthPx = paneMin;
      }
      if (modelCredentialPaneWidthPx > maxLeft) {
        modelCredentialPaneWidthPx = maxLeft;
      }
      layout.style.setProperty('--virtual-key-left-width', modelCredentialPaneWidthPx + 'px');
    }
  }

  function renderModelCredentialPoolEditor() {
    var editor = byId('modelCredentialPoolEditor');
    var title = byId('modelCredentialPoolEditorTitle');
    var idInput = byId('modelCredentialPool_object_id');
    var hint = byId('modelCredentialPoolValidationHint');
    var confirmButton = byId('modelCredentialPoolConfirmButton');
    var issues;

    if (!editor || !title || !idInput) {
      return;
    }

    if (!pendingModelCredentialPoolDraft) {
      editor.hidden = true;
      if (confirmButton) {
        confirmButton.hidden = true;
      }
      return;
    }

    editor.hidden = false;
    if (confirmButton) {
      confirmButton.hidden = false;
      confirmButton.disabled = false;
    }
    title.textContent = pendingModelCredentialPoolDraftId ? 'Edit Credential Pool' : 'Add Credential Pool';
    byId('modelCredentialPool_enabled').checked = pendingModelCredentialPoolDraft.enabled !== false;
    setValue('modelCredentialPool_pool_name', pendingModelCredentialPoolDraft.pool_name || '');
    setValue('modelCredentialPool_vendor', pendingModelCredentialPoolDraft.vendor || '');
    setValue('modelCredentialPool_selection_mode', pendingModelCredentialPoolDraft.selection_mode || 'priority_failover');
    setValue('modelCredentialPool_cooldown_seconds', pendingModelCredentialPoolDraft.cooldown_seconds);
    setValue('modelCredentialPool_description', pendingModelCredentialPoolDraft.description || '');
    idInput.value = getModelCredentialPoolDraftObjectId() || 'Generated after valid name';
    issues = getModelCredentialPoolFieldIssues(pendingModelCredentialPoolDraft);
    if (pendingModelCredentialPoolValidationActive) {
      setModelCredentialPoolFieldErrors(issues.map(function (issue) { return issue.id; }));
    }
    if (hint) {
      hint.textContent = issues.length ? issues[0].message : 'Pool Name and Vendor are required. Priority Failover is the only V1 selection mode.';
    }
  }

  function renderModelCredentialEditor() {
    var editor = byId('modelCredentialEditor');
    var title = byId('modelCredentialEditorTitle');
    var vendorInput = byId('modelCredential_vendor');
    var hint = byId('modelCredentialValidationHint');
    var currentPool;
    var issues;

    if (!editor || !title || !vendorInput) {
      return;
    }

    if (!pendingModelCredentialDraft) {
      editor.hidden = true;
      return;
    }

    currentPool = state.providerCredentialPools[pendingModelCredentialDraft.pool_ref || ''] || null;
    if (!currentPool) {
      pendingModelCredentialDraft.pool_ref = getActiveModelCredentialPoolFilterRefs()[0] || getDefaultModelCredentialPoolRef();
      currentPool = state.providerCredentialPools[pendingModelCredentialDraft.pool_ref || ''] || null;
    }
    if (!pendingModelCredentialDraftId || !String(pendingModelCredentialDraft.credential_id || '').trim()) {
      pendingModelCredentialDraft.credential_id = buildProviderCredentialId(
        pendingModelCredentialDraft.display_name || pendingModelCredentialDraft.credential_id,
        pendingModelCredentialDraft.pool_ref,
        ''
      );
    }
    editor.hidden = false;
    title.textContent = pendingModelCredentialDraftId ? 'Edit Credential' : 'Add Credential';
    byId('modelCredential_enabled').checked = pendingModelCredentialDraft.enabled !== false;
    setValue('modelCredential_display_name', pendingModelCredentialDraft.display_name || '');
    setValue('modelCredential_credential_id', pendingModelCredentialDraft.credential_id || '');
    setValue('modelCredential_priority', pendingModelCredentialDraft.priority);
    setValue('modelCredential_api_key', pendingModelCredentialDraft.api_key || '');
    vendorInput.value = currentPool ? formatModelCredentialVendorLabel(currentPool.vendor || '') : '';
    issues = getModelCredentialFieldIssues(pendingModelCredentialDraft);
    if (pendingModelCredentialValidationActive) {
      setModelCredentialFieldErrors(issues.map(function (issue) { return issue.id; }));
    }
    if (hint) {
      hint.textContent = issues.length ? issues[0].message : 'Display Name, Priority, and API Key are required. Credential ID is generated from Display Name and remains stable for runtime tracking.';
    }
  }

  function renderModelCredentialPoolPagination(totalVisiblePools, pageState) {
    var select = byId('modelCredentialPoolPageSelect');

    if (!select) {
      return;
    }

    select.innerHTML = buildVirtualKeyPageOptions(totalVisiblePools, pageState);
    select.disabled = totalVisiblePools === 0;
  }

  function renderModelCredentialPagination(totalVisibleEntries, pageState) {
    var select = byId('modelCredentialPageSelect');

    if (!select) {
      return;
    }

    select.innerHTML = buildVirtualKeyPageOptions(totalVisibleEntries, pageState);
    select.disabled = totalVisibleEntries === 0;
  }

  function renderModelCredentialPools() {
    var host = byId('modelCredentialPoolList');
    var selectAll = byId('modelCredentialPoolSelectAll');
    var searchInput = byId('modelCredentialPoolSearchInput');
    var visiblePoolIds = getVisibleModelCredentialPoolIds();
    var pageState = clampModelCredentialPoolPage(visiblePoolIds.length);
    var pagePoolIds = isShowAllPage(pageState.currentPage)
      ? visiblePoolIds
      : visiblePoolIds.slice((pageState.currentPage - 1) * VIRTUAL_KEY_PAGE_SIZE, pageState.currentPage * VIRTUAL_KEY_PAGE_SIZE);
    var activeFilters = getActiveModelCredentialPoolFilterRefs();
    var html = '';
    var selectedCount = 0;

    if (!host) {
      return;
    }
    if (searchInput && searchInput.value !== modelCredentialPoolSearchTerm) {
      searchInput.value = modelCredentialPoolSearchTerm;
    }

    pagePoolIds.forEach(function (poolId) {
      var pool = state.providerCredentialPools[poolId] || {};
      var isSelected = !!modelCredentialPoolSelection[poolId];

      if (isSelected) {
        selectedCount += 1;
      }

      html += '<tr class="' + (activeFilters.indexOf(poolId) >= 0 ? 'is-active ' : '') + 'virtual-key-row" data-model-credential-pool-row="' + escapeHtml(poolId) + '">' +
        '<td class="virtual-key-checkbox-col"><input type="checkbox" data-model-credential-pool-select="' + escapeHtml(poolId) + '"' + (isSelected ? ' checked' : '') + ' aria-label="Select Credential Pool ' + escapeHtml(pool.pool_name || poolId) + '"></td>' +
        '<td><span class="virtual-key-pool-status-dot ' + (pool.enabled === false ? 'virtual-key-pool-status-dot--disabled' : 'virtual-key-pool-status-dot--enabled') + '" title="' + escapeHtml(pool.enabled === false ? 'Pool is disabled.' : 'Pool is enabled.') + '" aria-label="' + escapeHtml(pool.enabled === false ? 'Disabled' : 'Enabled') + '"></span></td>' +
        '<td><span class="table-primary" title="' + escapeHtml(pool.pool_name || poolId) + '">' + escapeHtml(pool.pool_name || poolId) + '</span></td>' +
        '<td><span class="table-secondary" title="' + escapeHtml(pool.vendor || '') + '">' + escapeHtml(pool.vendor ? formatModelCredentialVendorLabel(pool.vendor) : '-') + '</span></td>' +
        '<td><div class="row-action-group row-action-group--compact">' +
        '<button class="row-action-button virtual-key-switch-button ' + (pool.enabled === false ? '' : 'is-on') + '" type="button" data-model-credential-pool-toggle="' + escapeHtml(poolId) + '" title="' + escapeHtml(pool.enabled === false ? 'Enable pool' : 'Disable pool') + '" aria-label="' + escapeHtml(pool.enabled === false ? 'Enable pool' : 'Disable pool') + '"><span></span></button>' +
        '<button class="row-action-button virtual-key-config-button" type="button" data-model-credential-pool-config="' + escapeHtml(poolId) + '" title="Configure pool" aria-label="Configure pool"></button>' +
        '<button class="row-action-button row-action-button--danger row-action-button--delete" type="button" data-model-credential-pool-delete="' + escapeHtml(poolId) + '" aria-label="Delete pool">&#x1F5D1;&#xFE0E;</button>' +
        '</div></td>' +
        '</tr>';
    });

    if (!html) {
      html = '<tr><td class="table-empty" colspan="5"><div class="empty-editor"><h3>' +
        (Object.keys(state.providerCredentialPools || {}).length ? 'No credential pools match the current search.' : 'Add a credential pool before creating credentials.') +
        '</h3></div></td></tr>';
    }

    host.innerHTML = html;
    if (selectAll) {
      selectAll.checked = pagePoolIds.length > 0 && selectedCount === pagePoolIds.length;
      selectAll.indeterminate = selectedCount > 0 && selectedCount < pagePoolIds.length;
    }
    renderModelCredentialPoolPagination(visiblePoolIds.length, pageState);
  }

  function renderModelCredentials() {
    var host = byId('modelCredentialList');
    var selectAll = byId('modelCredentialSelectAll');
    var searchInput = byId('modelCredentialSearchInput');
    var visibleEntryIds = getVisibleModelCredentialEntryIds();
    var pageState = clampModelCredentialPage(visibleEntryIds.length);
    var pageEntryIds = isShowAllPage(pageState.currentPage)
      ? visibleEntryIds
      : visibleEntryIds.slice((pageState.currentPage - 1) * VIRTUAL_KEY_PAGE_SIZE, pageState.currentPage * VIRTUAL_KEY_PAGE_SIZE);
    var html = '';
    var selectedCount = 0;

    if (!host) {
      return;
    }
    if (searchInput && searchInput.value !== modelCredentialSearchTerm) {
      searchInput.value = modelCredentialSearchTerm;
    }

    pageEntryIds.forEach(function (entryId) {
      var parts = parseModelCredentialEntryId(entryId);
      var pool = state.providerCredentialPools[parts.poolRef] || null;
      var entry = getModelCredentialEntry(parts.poolRef, parts.credentialId) || {};
      var runtimeState = getProviderCredentialRuntimeStateLabel(entry, parts.poolRef);
      var lastFailure = getProviderCredentialLastFailure(entry, parts.poolRef);
      var preview = getProviderCredentialPreview(entry);
      var isSelected = !!modelCredentialSelection[entryId];
      var warningTitle = pool && pool.enabled === false ? 'Assigned pool is disabled.' : '';

      if (isSelected) {
        selectedCount += 1;
      }

      html += '<tr class="virtual-key-row">' +
        '<td class="virtual-key-checkbox-col"><input type="checkbox" data-model-credential-select="' + escapeHtml(entryId) + '"' + (isSelected ? ' checked' : '') + ' aria-label="Select Credential ' + escapeHtml(entry.display_name || parts.credentialId) + '"></td>' +
        '<td><div class="virtual-key-dense-status" title="' + escapeHtml(warningTitle || (entry.enabled === false ? 'Credential is disabled.' : 'Credential is enabled.')) + '">' +
        '<span class="virtual-key-pool-status-dot ' + (entry.enabled === false ? 'virtual-key-pool-status-dot--disabled' : 'virtual-key-pool-status-dot--enabled') + '" aria-hidden="true"></span>' +
        (warningTitle ? '<span class="virtual-key-warning-dot virtual-key-warning-dot--warn" title="' + escapeHtml(warningTitle) + '" aria-label="' + escapeHtml(warningTitle) + '">!</span>' : '') +
        '</div></td>' +
        '<td><span class="table-primary" title="' + escapeHtml(entry.display_name || parts.credentialId) + '">' + escapeHtml(entry.display_name || parts.credentialId) + '</span></td>' +
        '<td><span class="table-primary table-primary--mono virtual-key-clip" title="' + escapeHtml(entry.credential_id || parts.credentialId) + '">' + escapeHtml(entry.credential_id || parts.credentialId) + '</span></td>' +
        '<td><span class="table-secondary">' + escapeHtml(String(entry.priority)) + '</span></td>' +
        '<td><span class="virtual-key-clip virtual-key-clip--mono" title="' + escapeHtml(preview) + '">' + escapeHtml(preview) + '</span></td>' +
        '<td><span class="table-secondary" title="' + escapeHtml(runtimeState) + '">' + escapeHtml(runtimeState) + '</span></td>' +
        '<td><span class="table-secondary" title="' + escapeHtml(lastFailure || '') + '">' + escapeHtml(lastFailure || '-') + '</span></td>' +
        '<td><div class="row-action-group row-action-group--compact">' +
        '<button class="row-action-button virtual-key-switch-button ' + (entry.enabled === false ? '' : 'is-on') + '" type="button" data-model-credential-toggle="' + escapeHtml(entryId) + '" title="' + escapeHtml(entry.enabled === false ? 'Enable credential' : 'Disable credential') + '" aria-label="' + escapeHtml(entry.enabled === false ? 'Enable credential' : 'Disable credential') + '"><span></span></button>' +
        '<button class="row-action-button virtual-key-config-button" type="button" data-model-credential-config="' + escapeHtml(entryId) + '" title="Configure credential" aria-label="Configure credential"></button>' +
        '<button class="row-action-button row-action-button--danger row-action-button--delete" type="button" data-model-credential-delete="' + escapeHtml(entryId) + '" aria-label="Delete credential">&#x1F5D1;&#xFE0E;</button>' +
        '</div></td>' +
        '</tr>';
    });

    if (!html) {
      html = '<tr><td class="table-empty" colspan="9"><div class="empty-editor"><h3>' +
        (visibleEntryIds.length
          ? 'No credentials on this page.'
          : (getActiveModelCredentialPoolFilterRefs().length || normalizeSearchTerm(modelCredentialSearchTerm)
            ? 'No credentials match the current filters.'
            : 'Add a credential to enable southbound key failover.')) +
        '</h3></div></td></tr>';
    }

    host.innerHTML = html;
    if (selectAll) {
      selectAll.checked = pageEntryIds.length > 0 && selectedCount === pageEntryIds.length;
      selectAll.indeterminate = selectedCount > 0 && selectedCount < pageEntryIds.length;
    }
    renderModelCredentialPagination(visibleEntryIds.length, pageState);
  }

  function confirmCreateModelCredentialPool() {
    var issues;
    var poolId;
    var existingPool;
    var nextPool;
    var isEdit = !!pendingModelCredentialPoolDraftId;

    if (!pendingModelCredentialPoolDraft) {
      return;
    }

    syncModelCredentialPoolDraftFromForm();
    issues = getModelCredentialPoolFieldIssues(pendingModelCredentialPoolDraft);
    pendingModelCredentialPoolValidationActive = true;
    setModelCredentialPoolFieldErrors(issues.map(function (issue) { return issue.id; }));
    renderModelCredentialPoolEditor();
    if (issues.length) {
      showToast(issues[0].message, 'error');
      return;
    }

    poolId = getModelCredentialPoolDraftObjectId();
    existingPool = state.providerCredentialPools[poolId] || {};
    nextPool = {
      pool_name: String(pendingModelCredentialPoolDraft.pool_name || '').trim(),
      vendor: String(pendingModelCredentialPoolDraft.vendor || '').trim(),
      auth_scheme: 'bearer',
      selection_mode: 'priority_failover',
      cooldown_seconds: parseInt(pendingModelCredentialPoolDraft.cooldown_seconds, 10) || 30,
      description: String(pendingModelCredentialPoolDraft.description || '').trim(),
      enabled: pendingModelCredentialPoolDraft.enabled !== false,
      entries: Array.isArray(existingPool.entries) ? clone(existingPool.entries) : []
    };
    state.providerCredentialPools[poolId] = nextPool;
    setActiveModelCredentialPoolFilter(poolId);
    markDirty(isEdit ? 'edit credential pool' : 'create credential pool');
    showCommitDone('modelCredentialPoolConfirmButton');
    showToast('Credential Pool committed to draft.', 'success');
    pendingModelCredentialPoolDraft = buildBlankModelCredentialPoolDraft();
    pendingModelCredentialPoolDraftId = '';
    pendingModelCredentialPoolValidationActive = false;
    renderAll();
  }

  function confirmCreateModelCredential() {
    var issues;
    var parts;
    var pool;
    var entries;
    var nextEntry;
    var isEdit = !!pendingModelCredentialDraftId;

    if (!pendingModelCredentialDraft) {
      return;
    }

    syncModelCredentialDraftFromForm();
    issues = getModelCredentialFieldIssues(pendingModelCredentialDraft);
    pendingModelCredentialValidationActive = true;
    setModelCredentialFieldErrors(issues.map(function (issue) { return issue.id; }));
    renderModelCredentialEditor();
    if (issues.length) {
      showToast(issues[0].message, 'error');
      return;
    }

    pool = state.providerCredentialPools[pendingModelCredentialDraft.pool_ref || ''];
    if (!pool) {
      showToast('Select a valid Credential Pool before committing the credential.', 'error');
      return;
    }

    entries = Array.isArray(pool.entries) ? pool.entries.slice(0) : [];
    nextEntry = {
      credential_id: pendingModelCredentialDraft.credential_id,
      display_name: pendingModelCredentialDraft.display_name,
      enabled: pendingModelCredentialDraft.enabled !== false,
      priority: parseInt(pendingModelCredentialDraft.priority, 10),
      api_key: pendingModelCredentialDraft.api_key
    };

    if (isEdit) {
      parts = parseModelCredentialEntryId(pendingModelCredentialDraftId);
      entries = entries.filter(function (entry) {
        return !(entry && entry.credential_id === parts.credentialId);
      });
    }

    entries.push(nextEntry);
    pool.entries = entries.sort(function (left, right) {
      return Number(left.priority || 0) - Number(right.priority || 0);
    });
    setActiveModelCredentialPoolFilter(pendingModelCredentialDraft.pool_ref);
    markDirty(isEdit ? 'edit credential' : 'create credential');
    showCommitDone('modelCredentialConfirmButton');
    showToast('Credential committed to draft.', 'success');
    pendingModelCredentialDraft = buildBlankModelCredentialDraft(pendingModelCredentialDraft.pool_ref);
    pendingModelCredentialDraftId = '';
    pendingModelCredentialValidationActive = false;
    renderAll();
  }

  function getBackendTargetsReferencingCredentialPool(poolId) {
    return Object.keys(state.backendTargets || {}).filter(function (backendId) {
      var backend = state.backendTargets[backendId] || {};
      return backend.credential_pool_ref === poolId;
    }).map(function (backendId) {
      var backend = state.backendTargets[backendId] || {};
      return backend.backend_target_name || backendId;
    });
  }

  function deleteModelCredentialPool(poolId, skipConfirm) {
    var pool = state.providerCredentialPools[poolId];
    var backendRefs;
    var message;

    if (!pool) {
      return false;
    }

    backendRefs = getBackendTargetsReferencingCredentialPool(poolId);
    if (backendRefs.length) {
      showToast('Credential Pool "' + (pool.pool_name || poolId) + '" is still referenced by Backend Targets.', 'error');
      return false;
    }

    message = 'Delete Credential Pool "' + (pool.pool_name || poolId) + '"?\n\nThis removes all credentials in the pool.';
    if (!skipConfirm && !window.confirm(message)) {
      return false;
    }

    if (pendingModelCredentialPoolDraftId === poolId) {
      closeModelCredentialPoolEditor();
    }
    if (pendingModelCredentialDraft && pendingModelCredentialDraft.pool_ref === poolId) {
      closeModelCredentialEditor();
    }

    delete state.providerCredentialPools[poolId];
    delete modelCredentialPoolSelection[poolId];
    Object.keys(modelCredentialSelection).forEach(function (entryId) {
      if (parseModelCredentialEntryId(entryId).poolRef === poolId) {
        delete modelCredentialSelection[entryId];
      }
    });
    if (activeModelCredentialPoolFilters.indexOf(poolId) >= 0) {
      setActiveModelCredentialPoolFilter(activeModelCredentialPoolFilters.filter(function (nextPoolRef) {
        return nextPoolRef !== poolId;
      }));
    }
    markDirty('delete credential pool');
    renderAll();
    return true;
  }

  function deleteModelCredential(entryId, skipConfirm) {
    var parts = parseModelCredentialEntryId(entryId);
    var pool = state.providerCredentialPools[parts.poolRef];
    var entry = getModelCredentialEntry(parts.poolRef, parts.credentialId);

    if (!pool || !entry) {
      return false;
    }

    if (!skipConfirm && !window.confirm('Delete Credential "' + (entry.display_name || entry.credential_id || parts.credentialId) + '"?')) {
      return false;
    }

    pool.entries = (pool.entries || []).filter(function (candidate) {
      return !(candidate && candidate.credential_id === parts.credentialId);
    });
    if (pendingModelCredentialDraftId === entryId) {
      closeModelCredentialEditor();
    }
    delete modelCredentialSelection[entryId];
    markDirty('delete credential');
    renderAll();
    return true;
  }

  function bindModelCredentialActions() {
    var poolSearchInput = byId('modelCredentialPoolSearchInput');
    var credentialSearchInput = byId('modelCredentialSearchInput');
    var poolPageSelect = byId('modelCredentialPoolPageSelect');
    var credentialPageSelect = byId('modelCredentialPageSelect');
    var poolForm = byId('modelCredentialPoolForm');
    var credentialForm = byId('modelCredentialForm');
    var divider = byId('modelCredentialDivider');
    var layout = byId('modelCredentialLayout');
    var copyButton = byId('modelCredentialApiKeyCopyButton');

    if (byId('createModelCredentialPoolButton')) {
      byId('createModelCredentialPoolButton').addEventListener('click', function () {
        openModelCredentialPoolCreate();
      });
    }
    if (byId('cancelModelCredentialPoolButton')) {
      byId('cancelModelCredentialPoolButton').addEventListener('click', function () {
        closeModelCredentialPoolEditor();
      });
    }
    if (byId('modelCredentialPoolConfirmButton')) {
      byId('modelCredentialPoolConfirmButton').addEventListener('click', function () {
        confirmCreateModelCredentialPool();
      });
    }
    if (byId('createModelCredentialButton')) {
      byId('createModelCredentialButton').addEventListener('click', function () {
        openModelCredentialCreate();
      });
    }
    if (byId('cancelModelCredentialButton')) {
      byId('cancelModelCredentialButton').addEventListener('click', function () {
        closeModelCredentialEditor();
      });
    }
    if (byId('modelCredentialConfirmButton')) {
      byId('modelCredentialConfirmButton').addEventListener('click', function () {
        confirmCreateModelCredential();
      });
    }
    if (poolSearchInput) {
      poolSearchInput.addEventListener('input', function () {
        modelCredentialPoolSearchTerm = poolSearchInput.value || '';
        modelCredentialPoolPage = 1;
        modelCredentialPoolSelection = {};
        renderModelCredentialPools();
      });
    }
    if (credentialSearchInput) {
      credentialSearchInput.addEventListener('input', function () {
        modelCredentialSearchTerm = credentialSearchInput.value || '';
        modelCredentialPage = 1;
        modelCredentialSelection = {};
        renderModelCredentials();
        renderModelCredentialLayout();
      });
    }
    if (poolPageSelect) {
      poolPageSelect.addEventListener('change', function () {
        modelCredentialPoolPage = poolPageSelect.value === 'all' ? 'all' : parseInt(poolPageSelect.value, 10) || 1;
        renderModelCredentialPools();
      });
    }
    if (credentialPageSelect) {
      credentialPageSelect.addEventListener('change', function () {
        modelCredentialPage = credentialPageSelect.value === 'all' ? 'all' : parseInt(credentialPageSelect.value, 10) || 1;
        renderModelCredentials();
      });
    }
    if (poolForm) {
      poolForm.addEventListener('input', function () {
        syncModelCredentialPoolDraftFromForm();
        if (pendingModelCredentialPoolValidationActive) {
          setModelCredentialPoolFieldErrors(getModelCredentialPoolFieldIssues(pendingModelCredentialPoolDraft).map(function (issue) { return issue.id; }));
        }
        renderModelCredentialPoolEditor();
      });
      poolForm.addEventListener('change', function () {
        syncModelCredentialPoolDraftFromForm();
        if (pendingModelCredentialPoolValidationActive) {
          setModelCredentialPoolFieldErrors(getModelCredentialPoolFieldIssues(pendingModelCredentialPoolDraft).map(function (issue) { return issue.id; }));
        }
        renderModelCredentialPoolEditor();
      });
    }
    if (credentialForm) {
      credentialForm.addEventListener('input', function () {
        syncModelCredentialDraftFromForm();
        if (pendingModelCredentialValidationActive) {
          setModelCredentialFieldErrors(getModelCredentialFieldIssues(pendingModelCredentialDraft).map(function (issue) { return issue.id; }));
        }
        renderModelCredentialEditor();
      });
      credentialForm.addEventListener('change', function () {
        syncModelCredentialDraftFromForm();
        if (pendingModelCredentialValidationActive) {
          setModelCredentialFieldErrors(getModelCredentialFieldIssues(pendingModelCredentialDraft).map(function (issue) { return issue.id; }));
        }
        renderModelCredentialEditor();
      });
    }
    if (copyButton) {
      copyButton.addEventListener('click', function () {
        var apiKey = String(getValue('modelCredential_api_key') || '').trim();

        if (!apiKey) {
          showToast('No credential API key to copy.', 'error');
          return;
        }

        copyTextToClipboard(apiKey).then(function () {
          showToast('Credential API key copied.', 'success');
        }).catch(function () {
          showToast('Unable to copy credential API key.', 'error');
        });
      });
    }
    if (byId('showModelCredentialPoolsButton')) {
      byId('showModelCredentialPoolsButton').addEventListener('click', function () {
        var ids = Object.keys(modelCredentialPoolSelection).filter(function (poolId) {
          return modelCredentialPoolSelection[poolId] && state.providerCredentialPools[poolId];
        });

        setActiveModelCredentialPoolFilter(ids);
        renderAll();
      });
    }
    if (byId('modelCredentialPoolSelectAll')) {
      byId('modelCredentialPoolSelectAll').addEventListener('change', function () {
        getVisibleModelCredentialPoolIds().slice(
          isShowAllPage(modelCredentialPoolPage) ? 0 : (modelCredentialPoolPage - 1) * VIRTUAL_KEY_PAGE_SIZE,
          isShowAllPage(modelCredentialPoolPage) ? undefined : modelCredentialPoolPage * VIRTUAL_KEY_PAGE_SIZE
        ).forEach(function (poolId) {
          modelCredentialPoolSelection[poolId] = !!byId('modelCredentialPoolSelectAll').checked;
        });
        renderModelCredentialPools();
      });
    }
    if (byId('modelCredentialSelectAll')) {
      byId('modelCredentialSelectAll').addEventListener('change', function () {
        getVisibleModelCredentialEntryIds().slice(
          isShowAllPage(modelCredentialPage) ? 0 : (modelCredentialPage - 1) * VIRTUAL_KEY_PAGE_SIZE,
          isShowAllPage(modelCredentialPage) ? undefined : modelCredentialPage * VIRTUAL_KEY_PAGE_SIZE
        ).forEach(function (entryId) {
          modelCredentialSelection[entryId] = !!byId('modelCredentialSelectAll').checked;
        });
        renderModelCredentials();
      });
    }
    ['enableModelCredentialPoolsButton', 'disableModelCredentialPoolsButton'].forEach(function (buttonId) {
      var enabled = buttonId.indexOf('enable') === 0;
      var button = byId(buttonId);

      if (!button) {
        return;
      }

      button.addEventListener('click', function () {
        var ids = Object.keys(modelCredentialPoolSelection).filter(function (poolId) {
          return modelCredentialPoolSelection[poolId] && state.providerCredentialPools[poolId];
        });

        if (!ids.length) {
          showToast('Select at least one Credential Pool.', 'error');
          return;
        }

        ids.forEach(function (poolId) {
          state.providerCredentialPools[poolId].enabled = enabled;
        });
        markDirty(enabled ? 'enable credential pools' : 'disable credential pools');
        renderAll();
      });
    });
    if (byId('deleteModelCredentialPoolsButton')) {
      byId('deleteModelCredentialPoolsButton').addEventListener('click', function () {
        var ids = Object.keys(modelCredentialPoolSelection).filter(function (poolId) {
          return modelCredentialPoolSelection[poolId] && state.providerCredentialPools[poolId];
        });

        if (!ids.length) {
          showToast('Select at least one Credential Pool.', 'error');
          return;
        }
        if (!window.confirm('Delete ' + formatCountLabel(ids.length, 'Credential Pool', 'Credential Pools') + '?')) {
          return;
        }
        ids.forEach(function (poolId) {
          deleteModelCredentialPool(poolId, true);
        });
        renderAll();
      });
    }
    ['enableModelCredentialsButton', 'disableModelCredentialsButton'].forEach(function (buttonId) {
      var enabled = buttonId.indexOf('enable') === 0;
      var button = byId(buttonId);

      if (!button) {
        return;
      }

      button.addEventListener('click', function () {
        var ids = Object.keys(modelCredentialSelection).filter(function (entryId) {
          var parts = parseModelCredentialEntryId(entryId);
          return modelCredentialSelection[entryId] && !!getModelCredentialEntry(parts.poolRef, parts.credentialId);
        });

        if (!ids.length) {
          showToast('Select at least one Credential.', 'error');
          return;
        }

        ids.forEach(function (entryId) {
          var parts = parseModelCredentialEntryId(entryId);
          var entry = getModelCredentialEntry(parts.poolRef, parts.credentialId);

          if (entry) {
            entry.enabled = enabled;
          }
        });
        markDirty(enabled ? 'enable credentials' : 'disable credentials');
        renderAll();
      });
    });
    if (byId('deleteModelCredentialsButton')) {
      byId('deleteModelCredentialsButton').addEventListener('click', function () {
        var ids = Object.keys(modelCredentialSelection).filter(function (entryId) {
          var parts = parseModelCredentialEntryId(entryId);
          return modelCredentialSelection[entryId] && !!getModelCredentialEntry(parts.poolRef, parts.credentialId);
        });

        if (!ids.length) {
          showToast('Select at least one Credential.', 'error');
          return;
        }
        if (!window.confirm('Delete ' + formatCountLabel(ids.length, 'Credential', 'Credentials') + '?')) {
          return;
        }
        ids.forEach(function (entryId) {
          deleteModelCredential(entryId, true);
        });
        renderAll();
      });
    }
    if (divider && layout) {
      divider.addEventListener('mousedown', function (event) {
        var maxLeft;

        if (isModelCredentialLayoutStacked()) {
          return;
        }

        event.preventDefault();
        maxLeft = Math.max(340, layout.clientWidth - 560 - 18);
        modelCredentialPaneDragState = {
          startX: event.clientX,
          startWidth: Math.max(340, Math.min(maxLeft, modelCredentialPaneWidthPx))
        };
        document.body.classList.add('is-resizing-virtual-key');
      });
      window.addEventListener('mousemove', function (event) {
        var maxLeft;
        var nextWidth;

        if (!modelCredentialPaneDragState || !layout || isModelCredentialLayoutStacked()) {
          if (modelCredentialPaneDragState) {
            modelCredentialPaneDragState = null;
            document.body.classList.remove('is-resizing-virtual-key');
          }
          return;
        }

        maxLeft = Math.max(340, layout.clientWidth - 560 - 18);
        nextWidth = modelCredentialPaneDragState.startWidth + (event.clientX - modelCredentialPaneDragState.startX);
        modelCredentialPaneWidthPx = Math.max(340, Math.min(maxLeft, nextWidth));
        renderModelCredentialLayout();
      });
      window.addEventListener('mouseup', function () {
        if (!modelCredentialPaneDragState) {
          return;
        }
        modelCredentialPaneDragState = null;
        document.body.classList.remove('is-resizing-virtual-key');
      });
      window.addEventListener('resize', renderModelCredentialLayout);
    }
    document.body.addEventListener('click', function (event) {
      var poolSelect = event.target.closest('[data-model-credential-pool-select]');
      var entrySelect = event.target.closest('[data-model-credential-select]');
      var poolRow = event.target.closest('[data-model-credential-pool-row]');
      var poolConfig = event.target.closest('[data-model-credential-pool-config]');
      var poolToggle = event.target.closest('[data-model-credential-pool-toggle]');
      var poolDelete = event.target.closest('[data-model-credential-pool-delete]');
      var entryConfig = event.target.closest('[data-model-credential-config]');
      var entryToggle = event.target.closest('[data-model-credential-toggle]');
      var entryDelete = event.target.closest('[data-model-credential-delete]');
      var poolId;
      var entryId;
      var entry;

      if (poolSelect) {
        poolId = poolSelect.getAttribute('data-model-credential-pool-select');
        modelCredentialPoolSelection[poolId] = !!poolSelect.checked;
        renderModelCredentialPools();
        return;
      }
      if (entrySelect) {
        entryId = entrySelect.getAttribute('data-model-credential-select');
        modelCredentialSelection[entryId] = !!entrySelect.checked;
        renderModelCredentials();
        return;
      }
      if (poolConfig) {
        poolId = poolConfig.getAttribute('data-model-credential-pool-config');
        openModelCredentialPoolEdit(poolId);
        setActiveModelCredentialPoolFilter(poolId);
        renderAll();
        return;
      }
      if (poolToggle) {
        poolId = poolToggle.getAttribute('data-model-credential-pool-toggle');
        if (state.providerCredentialPools[poolId]) {
          state.providerCredentialPools[poolId].enabled = state.providerCredentialPools[poolId].enabled === false;
          markDirty('toggle credential pool');
          renderAll();
        }
        return;
      }
      if (poolDelete) {
        deleteModelCredentialPool(poolDelete.getAttribute('data-model-credential-pool-delete'));
        return;
      }
      if (entryConfig) {
        entryId = entryConfig.getAttribute('data-model-credential-config');
        openModelCredentialEdit(entryId);
        setActiveModelCredentialPoolFilter(parseModelCredentialEntryId(entryId).poolRef);
        renderAll();
        return;
      }
      if (entryToggle) {
        entryId = entryToggle.getAttribute('data-model-credential-toggle');
        entry = getModelCredentialEntry(parseModelCredentialEntryId(entryId).poolRef, parseModelCredentialEntryId(entryId).credentialId);
        if (entry) {
          entry.enabled = entry.enabled === false;
          markDirty('toggle credential');
          renderAll();
        }
        return;
      }
      if (entryDelete) {
        deleteModelCredential(entryDelete.getAttribute('data-model-credential-delete'));
        return;
      }
      if (poolRow) {
        poolId = poolRow.getAttribute('data-model-credential-pool-row');
        setActiveModelCredentialPoolFilter(poolId);
        renderAll();
      }
    });
  }

  function confirmCreateVirtualKeyPool() {
    var issues;
    var poolId;
    var isEdit = !!pendingVirtualKeyPoolDraftId;

    if (!pendingVirtualKeyPoolDraft) {
      return;
    }

    syncVirtualKeyPoolDraftFromForm();
    issues = getVirtualKeyPoolFieldIssues(pendingVirtualKeyPoolDraft);
    pendingVirtualKeyPoolValidationActive = true;
    setVirtualKeyPoolFieldErrors(issues.map(function (issue) { return issue.id; }));
    renderVirtualKeyPoolEditor();
    if (issues.length) {
      showToast(issues[0].message, 'error');
      return;
    }

    poolId = getVirtualKeyPoolDraftObjectId();
    state.virtualKeyPools[poolId] = {
      pool_name: String(pendingVirtualKeyPoolDraft.pool_name || '').trim(),
      description: String(pendingVirtualKeyPoolDraft.description || '').trim(),
      enabled: pendingVirtualKeyPoolDraft.enabled !== false
    };
    setActiveVirtualKeyPoolFilter(poolId);
    markDirty(isEdit ? 'edit virtual key pool' : 'create virtual key pool');
    showCommitDone('virtualKeyPoolConfirmButton');
    showToast('Virtual Key Pool committed to draft.', 'success');
    if (isEdit) {
      pendingVirtualKeyPoolDraft = {
        enabled: state.virtualKeyPools[poolId].enabled !== false,
        pool_name: state.virtualKeyPools[poolId].pool_name || '',
        description: state.virtualKeyPools[poolId].description || ''
      };
      pendingVirtualKeyPoolDraftId = poolId;
    } else {
      pendingVirtualKeyPoolDraft = buildBlankVirtualKeyPoolDraft();
      pendingVirtualKeyPoolDraftId = '';
    }
    pendingVirtualKeyPoolValidationActive = false;
    renderAll();
  }

  function confirmCreateVirtualKey() {
    var issues;
    var fullKey;
    var secret;
    var kid;
    var existingKey;
    var isEdit = !!pendingVirtualKeyDraftId;

    if (!pendingVirtualKeyDraft) {
      return;
    }

    syncVirtualKeyDraftFromForm();
    issues = getVirtualKeyFieldIssues(pendingVirtualKeyDraft);
    pendingVirtualKeyValidationActive = true;
    setVirtualKeyEditorFieldErrors(issues.map(function (issue) { return issue.id; }));
    renderVirtualKeyEditor();
    if (issues.length) {
      showToast(issues[0].message, 'error');
      return;
    }

    kid = pendingVirtualKeyDraft.kid;
    existingKey = isEdit ? state.virtualKeys[pendingVirtualKeyDraftId] || {} : null;
    secret = pendingVirtualKeyDraft.secret;
    fullKey = buildFullVirtualKeyDetail(pendingVirtualKeyDraft.tag, kid, secret);

    function finalizeVirtualKey(hashValue) {
      var previewLast4 = secret ? secret.slice(-4) : (pendingVirtualKeyDraft.secret_last4 || existingKey.secret_last4 || '');
      var nextKey = {
        kid: kid,
        tag: pendingVirtualKeyDraft.tag,
        virtual_key_pool_ref: pendingVirtualKeyDraft.virtual_key_pool_ref,
        enabled: pendingVirtualKeyDraft.enabled !== false,
        description: existingKey && existingKey.description ? existingKey.description : '',
        created_at: (existingKey && existingKey.created_at) || pendingVirtualKeyDraft.created_at || getTodayDateString(),
        last_used_at: (existingKey && existingKey.last_used_at) || '',
        secret_hash_alg: 'sha256',
        secret_hash: hashValue || (existingKey.secret_hash || ''),
        key_preview: buildMaskedVirtualKeyDetail(pendingVirtualKeyDraft.tag, kid, previewLast4),
        secret_last4: previewLast4
      };

      state.virtualKeys[pendingVirtualKeyDraftId || kid] = nextKey;
      if (pendingVirtualKeyDraftId && pendingVirtualKeyDraftId !== kid) {
        delete state.virtualKeys[pendingVirtualKeyDraftId];
        delete transientVirtualKeySecrets[pendingVirtualKeyDraftId];
        delete virtualKeyRevealState[pendingVirtualKeyDraftId];
        delete virtualKeyCopyState[pendingVirtualKeyDraftId];
      }
      if (fullKey) {
        transientVirtualKeySecrets[pendingVirtualKeyDraftId || kid] = {
          fullKey: fullKey
        };
      }
      virtualKeySelection = {};
      setActiveVirtualKeyPoolFilter(pendingVirtualKeyDraft.virtual_key_pool_ref);
      markDirty(isEdit ? 'edit virtual key' : 'create virtual key');
      showCommitDone('virtualKeyConfirmButton');
      showToast('Virtual Key committed to draft.', 'success');
      pendingVirtualKeyDraft = buildBlankVirtualKeyDraft();
      pendingVirtualKeyDraftId = '';
      pendingVirtualKeyValidationActive = false;
      setVirtualKeyCopyFeedback('draft', false);
      renderAll();
    }

    if (secret) {
      sha256Hex(secret).then(function (hashValue) {
        finalizeVirtualKey('sha256:' + hashValue);
      }).catch(function (error) {
        showToast(error.message || 'Unable to hash Virtual Key secret.', 'error');
      });
      return;
    }

    finalizeVirtualKey(existingKey.secret_hash || '');
  }

  function deleteVirtualKeyPool(id, skipConfirm) {
    var pool = state.virtualKeyPools[id];
    var listenerRefs;
    var keyRefs;
    var message;

    if (!pool) {
      return false;
    }

    listenerRefs = getListenersReferencingVirtualKeyPool(id);
    keyRefs = getVirtualKeysReferencingPool(id);
    message = 'Delete Virtual Key Pool "' + (pool.pool_name || id) + '"?\n\n' +
      'This will also delete ' + formatCountLabel(keyRefs.length, 'Virtual Key', 'Virtual Keys') + '.';
    if (listenerRefs.length) {
      message += '\n\nReferenced by ' + formatCountLabel(listenerRefs.length, 'Northbound Listener', 'Northbound Listeners') + ':\n- ' + listenerRefs.join('\n- ') +
        '\n\nThose allowlist references will be removed.';
    }
    if (!skipConfirm && !window.confirm(message)) {
      return false;
    }

    if (pendingVirtualKeyPoolDraftId === id) {
      closeVirtualKeyPoolEditor();
    }

    delete state.virtualKeyPools[id];
    delete virtualKeyPoolSelection[id];
    if (activeVirtualKeyPoolFilters.indexOf(id) >= 0) {
      setActiveVirtualKeyPoolFilter(activeVirtualKeyPoolFilters.filter(function (poolRef) {
        return poolRef !== id;
      }));
    }
    Object.keys(state.listeners || {}).forEach(function (listenerId) {
      var listener = state.listeners[listenerId];
      if (!listener || !Array.isArray(listener.allowed_virtual_key_pool_refs)) {
        return;
      }
      listener.allowed_virtual_key_pool_refs = listener.allowed_virtual_key_pool_refs.filter(function (poolRef) {
        return poolRef !== id;
      });
    });
    if (pendingListenerDraft && Array.isArray(pendingListenerDraft.allowed_virtual_key_pool_refs)) {
      pendingListenerDraft.allowed_virtual_key_pool_refs = pendingListenerDraft.allowed_virtual_key_pool_refs.filter(function (poolRef) {
        return poolRef !== id;
      });
    }
    keyRefs.forEach(function (keyId) {
      delete state.virtualKeys[keyId];
      delete virtualKeySelection[keyId];
      delete transientVirtualKeySecrets[keyId];
      delete virtualKeyRevealState[keyId];
      delete virtualKeyCopyState[keyId];
    });
    if (pendingVirtualKeyDraft && (pendingVirtualKeyDraft.virtual_key_pool_ref === id || keyRefs.indexOf(pendingVirtualKeyDraftId) >= 0)) {
      closeVirtualKeyEditor();
    }
    return true;
  }

  function deleteVirtualKey(id, skipConfirm) {
    var virtualKey = state.virtualKeys[id];

    if (!virtualKey) {
      return false;
    }
    if (!skipConfirm && !window.confirm(
      'Delete Virtual Key "' + (virtualKey.kid || id) + '"?\n\n' +
      'Preview: ' + (virtualKey.key_preview || 'n/a') + '\n' +
      'Pool: ' + (getVirtualKeyPoolName(virtualKey.virtual_key_pool_ref || '') || virtualKey.virtual_key_pool_ref || 'Missing Pool')
    )) {
      return false;
    }

    delete state.virtualKeys[id];
    delete virtualKeySelection[id];
    delete transientVirtualKeySecrets[id];
    delete virtualKeyRevealState[id];
    delete virtualKeyCopyState[id];
    if (pendingVirtualKeyDraftId === id) {
      closeVirtualKeyEditor();
    }
    return true;
  }

  function renderAll() {
    if (restoreDeployedIfCommittedConfigurationInvalid()) {
      renderAll();
      return;
    }
    renderMode();
    renderNav();
    renderListenerLayout();
    renderListenerList();
    renderListenerForm();
    renderClassifierList();
    renderClassifierForm();
    renderBackendLayout();
    renderBackendList();
    renderBackendForm();
    renderPolicyLayout();
    prunePolicyPresentationState();
    renderPolicyList();
    renderPolicyForm();
    pruneVirtualKeySelections();
    pruneModelCredentialSelections();
    renderVirtualKeyLayout();
    renderVirtualKeyPoolEditor();
    renderVirtualKeyEditor();
    renderVirtualKeyPools();
    renderVirtualKeys();
    renderModelCredentialLayout();
    renderModelCredentialPoolEditor();
    renderModelCredentialEditor();
    renderModelCredentialPools();
    renderModelCredentials();
    updateRuntimeSummary();
  }

  function renderRuntimeStatusOnly() {
    renderListenerList();
    renderListenerStatusPanel(getActiveListener(), state.ui.listenerEditorMode);
    renderClassifierList();
    renderBackendList();
    renderBackendStatusPanel(getActiveBackend(), state.ui.backendEditorMode);
    renderVirtualKeys();
    renderVirtualKeyEditor();
    renderModelCredentials();
  }

  function exportDraft() {
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    var url = window.URL.createObjectURL(blob);
    var anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = 'ai-traffic-orchestrator-draft.json';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.URL.revokeObjectURL(url);
    showToast('Draft exported.', 'success');
  }

  function loadState(newState, source) {
    discardPendingListenerDraft();
    discardPendingBackendDraft();
    discardPendingClassifierDraft();
    discardPendingPolicyDraft();
    closeModelCredentialPoolEditor();
    closeModelCredentialEditor();
    state = normalizeLoadedState(newState);
    state.meta.source = source || state.meta.source || 'sample';
    startClassifierFormHydrationGuard();
    restoreActivePagePreference();
    renderAll();
  }

  function migrateDeprecatedSecretRefsFromDeployed(draft, deployed) {
    [
      ['classifiers', 'classifier_name'],
      ['backendTargets', 'backend_target_name']
    ].forEach(function (tuple) {
      var collectionName = tuple[0];
      var draftCollection = draft && draft[collectionName] ? draft[collectionName] : {};
      var deployedCollection = deployed && deployed[collectionName] ? deployed[collectionName] : {};

      Object.keys(draftCollection).forEach(function (key) {
        var record = draftCollection[key] || {};
        var deployedRecord = deployedCollection[key] || {};
        var hadDeprecatedRef = !!(record.api_key_env || record.apiKeyEnv || record.secret_ref || record.secretRef);

        if (hadDeprecatedRef && !record.api_key && !record.apiKey && (deployedRecord.api_key || deployedRecord.apiKey)) {
          record.api_key = deployedRecord.api_key || deployedRecord.apiKey;
        }
      });
    });

    return draft;
  }

  function loadLocalDraft() {
    var raw = window.localStorage.getItem(STORAGE_KEY);
    var envelope;
    var draft;
    var baseSource;

    if (!raw) {
      return false;
    }

    baseSource = sampleState && sampleState.meta && sampleState.meta.source ? sampleState.meta.source : 'deployed';

    try {
      envelope = parseStoredDraft(raw);
      if (!isStoredDraftSchemaCurrent(envelope)) {
        archiveStoredDraft(raw);
        loadState(sampleState, baseSource);
        clearDirty(baseSource);
        return true;
      }
      envelope.draft = migrateDeprecatedSecretRefsFromDeployed(envelope.draft, sampleState);
      draft = normalizeLoadedState(envelope.draft);
      draft.ui.classifierEditorMode = 'empty';
      draft.ui.listenerEditorMode = 'empty';
      draft.ui.backendEditorMode = 'empty';
      draft.ui.policyEditorMode = 'empty';
      if (hasInvalidCommittedConfiguration(draft)) {
        archiveStoredDraft(raw);
        loadState(sampleState, baseSource);
        clearDirty(baseSource);
        return true;
      }
      if (sampleState && deepEqual(
        sanitizeBlockForConfigComparison(draft),
        sanitizeBlockForConfigComparison(sampleState)
      )) {
        window.localStorage.removeItem(STORAGE_KEY);
        loadState(sampleState, baseSource);
        clearDirty(baseSource);
        return true;
      }
      if (!isStoredDraftCurrent(envelope, draft)) {
        archiveStoredDraft(raw);
        loadState(sampleState, baseSource);
        clearDirty(baseSource);
        showToast('Discarded stale local draft. Loaded deployed configuration.');
        return true;
      }
      loadState(draft, 'local draft');
      return true;
    } catch (error) {
      showToast('Stored draft is invalid. Reverting to sample.', 'error');
      window.localStorage.removeItem(STORAGE_KEY);
      return false;
    }
  }

  function resetToSample() {
    var baseSource = sampleState && sampleState.meta && sampleState.meta.source ? sampleState.meta.source : 'deployed';
    window.localStorage.removeItem(STORAGE_KEY);
    loadState(sampleState, baseSource);
    clearDirty(baseSource);
    refreshRuntimeStatus({ silent: true, force: true });
    showToast('Reset to ' + baseSource + ' configuration.', 'success');
  }

  function parseJsonResponse(response) {
    return response.text().then(function (text) {
      var payload = {};
      if (text) {
        try {
          payload = parseJson(text);
        } catch (error) {
          payload = { ok: false, message: text };
        }
      }
      return {
        ok: response.ok,
        status: response.status,
        payload: payload
      };
    });
  }

  function fetchWithTimeout(url, options, timeoutMs, timeoutMessage) {
    var controller;
    var timer;
    var requestOptions = options || {};

    if (!window.AbortController) {
      return window.fetch(url, requestOptions);
    }

    controller = new window.AbortController();
    requestOptions.signal = controller.signal;
    timer = window.setTimeout(function () {
      controller.abort();
    }, timeoutMs || 15000);

    return window.fetch(url, requestOptions).then(function (response) {
      window.clearTimeout(timer);
      return response;
    }).catch(function (error) {
      window.clearTimeout(timer);
      if (error && error.name === 'AbortError') {
        throw new Error(timeoutMessage || 'Request timed out.');
      }
      throw error;
    });
  }

  function collectApiKeyReferenceIssues() {
    var issues = [];

    Object.keys(state.classifiers || {}).forEach(function (key) {
      var classifier = state.classifiers[key] || {};
      var value = getSecretDisplayValue(classifier);
      if (value && looksLikeEnvReference(value)) {
        issues.push('Classifier ' + (classifier.classifier_name || key) + ' API Key must be pasted directly, not ENV/Secret Ref.');
      }
    });

    Object.keys(state.backendTargets || {}).forEach(function (key) {
      var backend = state.backendTargets[key] || {};
      var value = getSecretDisplayValue(backend);
      if (value && looksLikeEnvReference(value)) {
        issues.push('Backend ' + (backend.backend_target_name || key) + ' API Key must be pasted directly, not ENV/Secret Ref.');
      }
    });

    return issues;
  }

  function collectPolicyBackendReferenceIssues() {
    var issues = [];
    var backendTargets = state.backendTargets || {};

    Object.keys(state.routingPolicies || {}).forEach(function (policyId) {
      var policy = state.routingPolicies[policyId] || {};
      var policyName = getPolicyDisplayName(policyId, policy);
      var defaultRule = policy.default_rule || {};

      if ((defaultRule.action || 'route') === 'route') {
        if (!defaultRule.backend_target_ref) {
          issues.push('Routing Policy "' + policyName + '" default rule is set to Route but has no Backend Target selected.');
        } else if (!backendTargets[defaultRule.backend_target_ref]) {
          issues.push('Routing Policy "' + policyName + '" default rule still routes to deleted Backend Target "' + defaultRule.backend_target_ref + '".');
        }
      }

      if (policy.fallback_backend_target_ref && !backendTargets[policy.fallback_backend_target_ref]) {
        issues.push('Routing Policy "' + policyName + '" fallback backend target still points to deleted Backend Target "' + policy.fallback_backend_target_ref + '".');
      }

      (policy.key_rules || []).forEach(function (rule, index) {
        if (!policyUsesKeyStage(policy) || rule.enabled === false || rule.action !== 'route') {
          return;
        }

        if (!rule.backend_target_ref) {
          issues.push('Routing Policy "' + policyName + '" key rule #' + (index + 1) + ' is set to Route but has no Backend Target selected.');
        } else if (!backendTargets[rule.backend_target_ref]) {
          issues.push('Routing Policy "' + policyName + '" key rule #' + (index + 1) + ' still routes to deleted Backend Target "' + rule.backend_target_ref + '".');
        }
      });

      (policy.rules || []).forEach(function (rule, index) {
        if (!policyUsesClassifierStage(policy) || rule.enabled === false || rule.action !== 'route') {
          return;
        }

        if (!rule.backend_target_ref) {
          issues.push('Routing Policy "' + policyName + '" entry #' + (index + 1) + ' is set to Route but has no Backend Target selected.');
        } else if (!backendTargets[rule.backend_target_ref]) {
          issues.push('Routing Policy "' + policyName + '" entry #' + (index + 1) + ' still routes to deleted Backend Target "' + rule.backend_target_ref + '".');
        }
      });
    });

    return issues;
  }

  function formatPolicyBackendReferenceError(issues) {
    if (!issues.length) {
      return '';
    }

    return 'Deploy blocked: ' + issues[0] +
      ' Open Routing Policy Setting and select an existing Backend Target, or change the action to Local Response.' +
      (issues.length > 1 ? ' ' + (issues.length - 1) + ' more policy reference issue(s).' : '');
  }

  function prepareBackendTargetsForPersistence() {
    var issues = [];

    if (pendingBackendDraft) {
      if (shouldSyncPendingEditorFromForm('backend', 'backendEditorMode', 'backendForm')) {
        syncBackendFromForm(pendingBackendDraft);
      }
      if (
        pendingBackendDraftId &&
        state.backendTargets[pendingBackendDraftId] &&
        deepEqual(
          sanitizeBackendForConfigComparison(pendingBackendDraft),
          sanitizeBackendForConfigComparison(state.backendTargets[pendingBackendDraftId])
        )
      ) {
        clearBackendRequiredErrors();
      } else if (!pendingBackendDraftId && !hasBackendDraftContent(pendingBackendDraft)) {
        clearBackendRequiredErrors();
      } else {
        pendingBackendValidationActive = true;
        setBackendRequiredErrors(getMissingBackendRequiredFields(pendingBackendDraft));
        issues = getBackendRequiredIssues(
          pendingBackendDraft,
          pendingBackendDraftId ? 'Backend ' + (pendingBackendDraft.backend_target_name || pendingBackendDraftId || state.activeIds.backend) : 'New backend target'
        );
        if (!issues.length) {
          issues.push('Click Commit to apply the backend target changes to draft before saving or deploying.');
        }
        return issues;
      }
    }

    Object.keys(state.backendTargets || {}).forEach(function (key) {
      var backend = state.backendTargets[key] || {};
      issues = issues.concat(getBackendRequiredIssues(backend, 'Backend ' + (backend.backend_target_name || key)));
    });

    return issues;
  }

  function prepareClassifiersForPersistence() {
    var issues = [];

    discardPendingClassifierDraftIfSynced();

    if (pendingClassifierDraft) {
      if (shouldSyncPendingEditorFromForm('classifier', 'classifierEditorMode', 'classifierForm')) {
        syncClassifierFromForm(pendingClassifierDraft);
      }
      if (
        pendingClassifierDraftId &&
        state.classifiers[pendingClassifierDraftId] &&
        deepEqual(
          sanitizeClassifierForConfigComparison(pendingClassifierDraft),
          sanitizeClassifierForConfigComparison(state.classifiers[pendingClassifierDraftId])
        )
      ) {
        clearClassifierRequiredErrors();
      } else if (!pendingClassifierDraftId && !hasClassifierDraftContent(pendingClassifierDraft)) {
        clearClassifierRequiredErrors();
      } else {
        pendingClassifierValidationActive = true;
        setClassifierRequiredErrors(getMissingClassifierRequiredFields(pendingClassifierDraft));
        issues = getClassifierRequiredIssues(
          pendingClassifierDraft,
          pendingClassifierDraftId ? 'Classifier ' + (pendingClassifierDraft.classifier_name || pendingClassifierDraftId || state.activeIds.classifier) : 'New classifier'
        );
        if (!issues.length) {
          issues.push('Click Commit to apply the classifier changes to draft before deploying.');
        }
        return issues;
      }
    }

    Object.keys(state.classifiers || {}).forEach(function (key) {
      var classifier = state.classifiers[key] || {};
      issues = issues.concat(getClassifierRequiredIssues(classifier, 'Classifier ' + (classifier.classifier_name || key)));
    });

    return issues;
  }

  function preparePoliciesForPersistence() {
    var issues = [];

    discardPendingPolicyDraftIfSynced();

    if (pendingPolicyDraft) {
      if (shouldSyncPendingEditorFromForm('policy', 'policyEditorMode', 'policyForm')) {
        syncPolicyFromForm(pendingPolicyDraft);
      }
      if (discardPendingPolicyDraftIfSynced()) {
        clearPolicyRequiredErrors();
      } else if (
        pendingPolicyDraftId &&
        state.routingPolicies[pendingPolicyDraftId] &&
        deepEqual(
          sanitizePolicyForConfigComparison(pendingPolicyDraft),
          sanitizePolicyForConfigComparison(state.routingPolicies[pendingPolicyDraftId])
        )
      ) {
        clearPolicyRequiredErrors();
      } else if (!pendingPolicyDraftId && !hasPolicyDraftContent(pendingPolicyDraft)) {
        clearPolicyRequiredErrors();
      } else {
        pendingPolicyValidationActive = true;
        setPolicyRequiredErrors(getMissingPolicyRequiredFields(pendingPolicyDraft));
        issues = getPolicyRequiredIssues(
          pendingPolicyDraft,
          pendingPolicyDraftId ? 'Routing Policy ' + (pendingPolicyDraft.policy_name || pendingPolicyDraftId || state.activeIds.policy) : 'New routing policy'
        );
        if (!issues.length) {
          issues.push('Click Commit to apply the routing policy changes to draft before saving or deploying.');
        }
        return issues;
      }
    }

    Object.keys(state.routingPolicies || {}).forEach(function (key) {
      var policy = state.routingPolicies[key] || {};
      issues = issues.concat(getPolicyRequiredIssues(policy, 'Routing Policy ' + (policy.policy_name || key)));
    });

    return issues;
  }

  function prepareListenersForPersistence() {
    var issues = [];

    if (pendingListenerDraft) {
      if (shouldSyncPendingEditorFromForm('listener', 'listenerEditorMode', 'listenerForm')) {
        syncListenerFromForm(pendingListenerDraft);
      }
      if (
        pendingListenerDraftId &&
        state.listeners[pendingListenerDraftId] &&
        deepEqual(
          sanitizeListenerForConfigComparison(pendingListenerDraft),
          sanitizeListenerForConfigComparison(state.listeners[pendingListenerDraftId])
        )
      ) {
        clearListenerRequiredErrors();
      } else if (!pendingListenerDraftId && !hasListenerDraftContent(pendingListenerDraft)) {
        clearListenerRequiredErrors();
      } else {
        pendingListenerValidationActive = true;
        setListenerRequiredErrors(getMissingListenerRequiredFields(pendingListenerDraft));
        issues = getListenerRequiredIssues(
          pendingListenerDraft,
          pendingListenerDraftId ? 'Virtual Service ' + (pendingListenerDraft.virtual_service || pendingListenerDraftId || state.activeIds.listener) : 'New virtual service'
        );
        if (!issues.length) {
          issues.push('Click Commit to apply the virtual service changes to draft before saving or deploying.');
        }
        return issues;
      }
    }

    Object.keys(state.listeners || {}).forEach(function (key) {
      var listener = state.listeners[key] || {};
      issues = issues.concat(getListenerRequiredIssues(listener, 'Virtual Service ' + (listener.virtual_service || key)));
    });

    return issues;
  }

  function deployChanges() {
    var listenerIssues = prepareListenersForPersistence();
    var backendIssues = prepareBackendTargetsForPersistence();
    var classifierIssues = prepareClassifiersForPersistence();
    var policyIssues = preparePoliciesForPersistence();
    var policyBackendIssues;
    var apiKeyIssues;

    if (listenerIssues.length) {
      showToast(listenerIssues[0], 'error');
      return;
    }

    if (backendIssues.length) {
      showToast(backendIssues[0], 'error');
      return;
    }

    if (classifierIssues.length) {
      showToast(classifierIssues[0], 'error');
      return;
    }

    if (policyIssues.length) {
      showToast(policyIssues[0], 'error');
      return;
    }

    policyBackendIssues = collectPolicyBackendReferenceIssues();

    if (policyBackendIssues.length) {
      showToast(formatPolicyBackendReferenceError(policyBackendIssues), 'error');
      return;
    }

    apiKeyIssues = collectApiKeyReferenceIssues();

    if (apiKeyIssues.length) {
      showToast(apiKeyIssues[0], 'error');
      return;
    }

    setButtonBusy('deployButton', true, 'Deploying...', 'Deploy Changes');

    window.fetch(DEPLOY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'same-origin',
      body: buildDeployRequestBody()
    }).then(parseJsonResponse).then(function (result) {
      var payload = result.payload || {};
      var issueText;
      if (!result.ok || payload.ok === false) {
        issueText = (payload.issues && payload.issues.length && payload.issues[0]) || payload.message || 'Deploy failed.';
        throw new Error(issueText);
      }

      sampleState = normalizeLoadedState(payload.block || state);
      window.localStorage.removeItem(STORAGE_KEY);
      loadState(sampleState, 'deployed');
      clearDirty('deployed');
      refreshRuntimeStatus({ silent: true, force: true });
      showToast(
        'Deployed ' +
        ((payload.summary && payload.summary.listeners) || 0) + ' listeners, ' +
        ((payload.summary && payload.summary.backendTargets) || 0) + ' backend targets, ' +
        ((payload.summary && payload.summary.routingPolicies) || 0) + ' policies.',
        'success'
      );
    }).catch(function (error) {
      showToast(error.message || 'Deploy failed.', 'error');
    }).then(function () {
      setButtonBusy('deployButton', false, 'Deploying...', 'Deploy Changes');
    });
  }

  function importJsonFile(file) {
    var reader = new FileReader();

    reader.onload = function () {
      try {
        loadState(parseJson(reader.result), 'imported');
        markDirty('imported');
        refreshRuntimeStatus({ silent: true, force: true });
        showToast('Draft imported.', 'success');
      } catch (error) {
        showToast('Import failed: invalid JSON.', 'error');
      }
    };

    reader.readAsText(file);
  }

  function parseTagList(raw) {
    return raw.split(/[,\uFF0C]/).map(function (item) {
      return item.trim();
    }).filter(function (item) {
      return !!item;
    });
  }

  function bindNav() {
    document.querySelectorAll('.nav-item').forEach(function (button) {
      button.addEventListener('click', function () {
        state.activePage = button.getAttribute('data-page');
        persistActivePage();
        renderNav();
      });
    });

  }

  function bindPageLocation() {
    window.addEventListener('hashchange', function () {
      var hashPage = window.location.hash.replace(/^#/, '');
      if (!getValidPages()[hashPage] || state.activePage === hashPage) {
        return;
      }
      state.activePage = hashPage;
      renderNav();
    });
  }

  function bindHelpTooltips() {
    document.addEventListener('click', function (event) {
      var helpIcon = event.target && event.target.closest ? event.target.closest('.help-icon') : null;
      if (!helpIcon) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    }, true);
  }

  function bindPointerOriginTracking() {
    document.addEventListener('mousedown', function (event) {
      lastPointerDownTarget = event.target || null;
      lastPointerDownPage = state && state.activePage ? state.activePage : '';
      lastPointerDownAt = Date.now();
    }, true);
    document.addEventListener('touchstart', function (event) {
      lastPointerDownTarget = event.target || null;
      lastPointerDownPage = state && state.activePage ? state.activePage : '';
      lastPointerDownAt = Date.now();
    }, true);
  }

  function hasActiveTextSelection(target) {
    function elementHasSelection(element) {
      return !!(
        element &&
        typeof element.selectionStart === 'number' &&
        element.selectionStart !== element.selectionEnd
      );
    }

    var tagName = target && target.tagName ? target.tagName.toLowerCase() : '';
    var selection;

    if ((tagName === 'input' || tagName === 'textarea') && elementHasSelection(target)) {
      return true;
    }

    if (!window.getSelection) {
      return false;
    }

    selection = window.getSelection();
    return !!(selection && !selection.isCollapsed && String(selection).length);
  }

  function targetMatchesAnySelector(target, selectors) {
    var index;

    if (!target || !target.closest) {
      return false;
    }

    for (index = 0; index < selectors.length; index += 1) {
      if (target.closest(selectors[index])) {
        return true;
      }
    }

    return false;
  }

  function getEditorCollapseSafeSelectors(pageName) {
    if (pageName === 'listener') {
      return [
        '[data-listener]',
        '[data-listener-config]',
        '.list-card--listener',
        '#listenerEditorCard',
        '#listenerEditorPanel',
        '#createListenerButton',
        '#page-listener .status-card'
      ];
    }
    if (pageName === 'backend') {
      return [
        '[data-backend]',
        '[data-backend-config]',
        '.list-card--backend',
        '#backendEditorCard',
        '#backendEditorPanel',
        '#refreshBackendStatusButton',
        '#createBackendButton',
        '#page-backend .status-card'
      ];
    }
    if (pageName === 'policy') {
      return [
        '[data-policy]',
        '[data-policy-config]',
        '.list-card--policy',
        '#policyEditorCard',
        '#policyEditorPanel',
        '#createPolicyButton',
        '#page-policy .status-card'
      ];
    }
    if (pageName === 'classifier') {
      return [
        '.editor-card--classifier',
        '#classifierForm',
        '.classifier-test-panel'
      ];
    }
    if (pageName === 'virtual-key') {
      return [
        '#virtualKeyPoolEditor',
        '#virtualKeyPoolForm',
        '#virtualKeyEditor',
        '#virtualKeyForm'
      ];
    }
    if (pageName === 'model-credential') {
      return [
        '#modelCredentialPoolEditor',
        '#modelCredentialPoolForm',
        '#modelCredentialEditor',
        '#modelCredentialForm'
      ];
    }
    return [];
  }

  function getEditorSurfaceSelectors(pageName) {
    if (pageName === 'listener') {
      return ['#listenerEditorCard', '#listenerEditorPanel', '#listenerForm'];
    }
    if (pageName === 'backend') {
      return ['#backendEditorCard', '#backendEditorPanel', '#backendForm'];
    }
    if (pageName === 'policy') {
      return ['#policyEditorCard', '#policyEditorPanel', '#policyForm'];
    }
    if (pageName === 'classifier') {
      return ['.editor-card--classifier', '#classifierForm', '.classifier-test-panel'];
    }
    if (pageName === 'virtual-key') {
      return ['#virtualKeyPoolEditor', '#virtualKeyPoolForm', '#virtualKeyEditor', '#virtualKeyForm'];
    }
    if (pageName === 'model-credential') {
      return ['#modelCredentialPoolEditor', '#modelCredentialPoolForm', '#modelCredentialEditor', '#modelCredentialForm'];
    }
    return [];
  }

  function hasOpenPageEditor(pageName) {
    if (!state || !state.ui) {
      return false;
    }
    if (pageName === 'listener') {
      return state.ui.listenerEditorMode !== 'empty';
    }
    if (pageName === 'backend') {
      return state.ui.backendEditorMode !== 'empty';
    }
    if (pageName === 'policy') {
      return state.ui.policyEditorMode !== 'empty';
    }
    if (pageName === 'classifier') {
      return state.ui.classifierEditorMode !== 'empty';
    }
    if (pageName === 'virtual-key') {
      return !!(pendingVirtualKeyPoolDraft || pendingVirtualKeyDraft);
    }
    if (pageName === 'model-credential') {
      return !!(pendingModelCredentialPoolDraft || pendingModelCredentialDraft);
    }
    return false;
  }

  function getRecentPointerDownTarget(pageName) {
    if (!lastPointerDownTarget || lastPointerDownPage !== pageName) {
      return null;
    }
    if (Date.now() - lastPointerDownAt > BLANK_COLLAPSE_POINTER_WINDOW_MS) {
      return null;
    }
    return lastPointerDownTarget;
  }

  function isOutsideEditorCollapseClick(event, pageName) {
    var pointerStartTarget = getRecentPointerDownTarget(pageName);
    var safeSelectors = getEditorCollapseSafeSelectors(pageName);

    if (!event || !event.target) {
      return false;
    }
    if (targetMatchesAnySelector(event.target, safeSelectors)) {
      return false;
    }
    if (pointerStartTarget && targetMatchesAnySelector(pointerStartTarget, safeSelectors)) {
      return false;
    }

    return true;
  }

  function shouldIgnoreEditorDragReleaseClick(event) {
    var pageName = state && state.activePage ? state.activePage : '';
    var pointerStartTarget = getRecentPointerDownTarget(pageName);
    var editorSelectors = getEditorSurfaceSelectors(pageName);

    if (!event || !event.target || !pointerStartTarget || !hasOpenPageEditor(pageName)) {
      return false;
    }
    if (!editorSelectors.length || !targetMatchesAnySelector(pointerStartTarget, editorSelectors)) {
      return false;
    }
    return !targetMatchesAnySelector(event.target, editorSelectors);
  }

  function bindListSelection() {
    document.body.addEventListener('click', function (event) {
      var listenerButton = event.target.closest('[data-listener]');
      var listenerConfigButton = event.target.closest('[data-listener-config]');
      var listenerDeleteButton = event.target.closest('[data-listener-delete]');
      var listenerSelectAll = event.target.closest('#listenerSelectAll');
      var listenerSelectInput = event.target.closest('[data-listener-select]');
      var listenerEnableBulkButton = event.target.closest('#enableListenersButton');
      var listenerDisableBulkButton = event.target.closest('#disableListenersButton');
      var listenerBulkDeleteButton = event.target.closest('#deleteListenersButton');
      var classifierButton = event.target.closest('[data-classifier]');
      var classifierBypassButton = event.target.closest('[data-classifier-bypass]');
      var classifierDeleteButton = event.target.closest('[data-classifier-delete]');
      var backendButton = event.target.closest('[data-backend]');
      var backendConfigButton = event.target.closest('[data-backend-config]');
      var backendDeleteButton = event.target.closest('[data-backend-delete]');
      var backendSelectAll = event.target.closest('#backendSelectAll');
      var backendSelectInput = event.target.closest('[data-backend-select]');
      var backendBulkDeleteButton = event.target.closest('#deleteSelectedBackendsButton');
      var policyButton = event.target.closest('[data-policy]');
      var policyConfigButton = event.target.closest('[data-policy-config]');
      var policyDeleteButton = event.target.closest('[data-policy-delete]');
      var policySelectInput = event.target.closest('[data-policy-select]');
      var listenerId;
      var listenerIds;
      var classifierId;
      var backendId;
      var policyId;

      if (shouldIgnoreEditorDragReleaseClick(event)) {
        return;
      }

      if (listenerConfigButton) {
        listenerId = listenerConfigButton.getAttribute('data-listener-config');
        if (!(pendingListenerDraft && pendingListenerDraftId === listenerId)) {
          discardPendingListenerDraft();
        }
        state.activeIds.listener = listenerId;
        state.ui.listenerEditorMode = 'edit';
        ensureListenerEditDraft();
        renderAll();
        return;
      }
      if (listenerDeleteButton) {
        deleteListener(listenerDeleteButton.getAttribute('data-listener-delete'));
        return;
      }
      if (listenerSelectAll) {
        getVisibleListenerIds().slice(
          isShowAllPage(listenerPage) ? 0 : (listenerPage - 1) * VIRTUAL_KEY_PAGE_SIZE,
          isShowAllPage(listenerPage) ? undefined : listenerPage * VIRTUAL_KEY_PAGE_SIZE
        ).forEach(function (id) {
          listenerSelection[id] = !!listenerSelectAll.checked;
        });
        renderListenerList();
        return;
      }
      if (listenerSelectInput) {
        listenerId = listenerSelectInput.getAttribute('data-listener-select');
        listenerSelection[listenerId] = !!listenerSelectInput.checked;
        renderListenerList();
        return;
      }
      if (listenerEnableBulkButton) {
        listenerIds = Object.keys(listenerSelection).filter(function (id) {
          return listenerSelection[id] && state.listeners[id];
        });
        if (!listenerIds.length) {
          showToast('Select at least one Virtual Server.', 'error');
          return;
        }
        listenerIds.forEach(function (id) {
          setListenerEnabledState(id, true);
        });
        markDirty('bulk enable listeners');
        renderAll();
        return;
      }
      if (listenerDisableBulkButton) {
        listenerIds = Object.keys(listenerSelection).filter(function (id) {
          return listenerSelection[id] && state.listeners[id];
        });
        if (!listenerIds.length) {
          showToast('Select at least one Virtual Server.', 'error');
          return;
        }
        listenerIds.forEach(function (id) {
          setListenerEnabledState(id, false);
        });
        markDirty('bulk disable listeners');
        renderAll();
        return;
      }
      if (listenerBulkDeleteButton) {
        deleteSelectedListeners();
        return;
      }
      if (listenerButton) {
        state.activeIds.listener = listenerButton.getAttribute('data-listener');
        if (state.ui.listenerEditorMode !== 'empty') {
          state.ui.listenerEditorMode = 'empty';
        }
        renderAll();
      }
      if (classifierBypassButton) {
        classifierId = classifierBypassButton.getAttribute('data-classifier-bypass');
        if (!classifierId || !state.classifiers[classifierId]) {
          return;
        }
        setClassifierBypass(classifierId, !getClassifierListBypassState(classifierId));
        return;
      }
      if (classifierButton) {
        if (!(pendingClassifierDraft && pendingClassifierDraftId === classifierButton.getAttribute('data-classifier'))) {
          discardPendingClassifierDraft();
        }
        state.activeIds.classifier = classifierButton.getAttribute('data-classifier');
        state.ui.classifierEditorMode = 'edit';
        ensureClassifierEditDraft();
        resetClassifierProbeState();
        clearClassifierTestResult();
        renderClassifierList();
        renderClassifierForm();
      }
      if (classifierDeleteButton) {
        deleteClassifier(classifierDeleteButton.getAttribute('data-classifier-delete'));
        return;
      }
      if (backendConfigButton) {
        backendId = backendConfigButton.getAttribute('data-backend-config');
        if (!(pendingBackendDraft && pendingBackendDraftId === backendId)) {
          discardPendingBackendDraft();
        }
        state.activeIds.backend = backendId;
        state.ui.backendEditorMode = 'edit';
        ensureBackendEditDraft();
        renderAll();
        return;
      }
      if (backendSelectAll) {
        getCurrentPageBackendIds().forEach(function (id) {
          backendSelection[id] = !!backendSelectAll.checked;
        });
        renderBackendList();
        return;
      }
      if (backendSelectInput) {
        backendId = backendSelectInput.getAttribute('data-backend-select');
        backendSelection[backendId] = !!backendSelectInput.checked;
        renderBackendList();
        return;
      }
      if (backendBulkDeleteButton) {
        deleteSelectedBackends();
        return;
      }
      if (backendDeleteButton) {
        deleteBackend(backendDeleteButton.getAttribute('data-backend-delete'));
        return;
      }
      if (backendButton) {
        backendId = backendButton.getAttribute('data-backend');
        if (!(pendingBackendDraft && pendingBackendDraftId === backendId)) {
          discardPendingBackendDraft();
        }
        state.activeIds.backend = backendId;
        renderAll();
      }
      if (policySelectInput) {
        policyId = policySelectInput.getAttribute('data-policy-select');
        policySelection[policyId] = !!policySelectInput.checked;
        renderPolicyList();
        return;
      }
      if (policyConfigButton) {
        policyId = policyConfigButton.getAttribute('data-policy-config');
        if (!(pendingPolicyDraft && pendingPolicyDraftId === policyId)) {
          discardPendingPolicyDraft();
        }
        state.activeIds.policy = policyId;
        state.activeIds.ruleIndex = 0;
        state.ui.policyEditorMode = 'edit';
        ensurePolicyEditDraft();
        renderAll();
        return;
      }
      if (policyDeleteButton) {
        deletePolicy(policyDeleteButton.getAttribute('data-policy-delete'));
        return;
      }
      if (policyButton) {
        policyId = policyButton.getAttribute('data-policy');
        if (!(pendingPolicyDraft && pendingPolicyDraftId === policyId)) {
          discardPendingPolicyDraft();
        }
        state.activeIds.policy = policyId;
        state.activeIds.ruleIndex = 0;
        renderAll();
        return;
      }

      if (hasActiveTextSelection(event.target)) {
        return;
      }

      if (
        state.activePage === 'listener' &&
        state.ui.listenerEditorMode !== 'empty' &&
        isOutsideEditorCollapseClick(event, 'listener')
      ) {
        collapseListenerEditor();
      }
      if (
        state.activePage === 'backend' &&
        state.ui.backendEditorMode !== 'empty' &&
        isOutsideEditorCollapseClick(event, 'backend')
      ) {
        collapseBackendEditor();
      }
      if (
        state.activePage === 'policy' &&
        state.ui.policyEditorMode !== 'empty' &&
        isOutsideEditorCollapseClick(event, 'policy')
      ) {
        collapsePolicyEditor();
      }
    });
  }

  function bindToggles() {
    document.querySelectorAll('.toggle').forEach(function (button) {
      button.addEventListener('click', function () {
        var toggleId = button.getAttribute('data-toggle');
        var next = !button.classList.contains('is-on');
        var listener;
        var classifier;

        if (toggleId === 'listener_streaming') {
          listener = getListenerFormModel();
          if (!listener) {
            return;
          }
          listener.streaming = next;
          setToggle(toggleId, next);
          if (state.ui.listenerEditorMode === 'empty') {
            markDirty('inline edit');
          }
          return;
        }
        if (toggleId === 'classifier_rules_first') {
          classifier = getClassifierFormModel();
          if (!classifier) {
            return;
          }
          classifier.use_built_in_rules_first = next;
          setToggle(toggleId, next);
          return;
        }
        if (toggleId === 'classifier_bypass') {
          classifier = getClassifierFormModel();
          if (!classifier) {
            return;
          }
          if (next && !confirmClassifierBypass(classifier.classifier_name || state.activeIds.classifier || 'classifier')) {
            setToggle(toggleId, false);
            return;
          }
          classifier.bypass_enabled = next;
          setToggle(toggleId, next);
          renderClassifierList();
          return;
        }
        if (toggleId === 'classifier_multi_label') {
          classifier = getClassifierFormModel();
          if (!classifier) {
            return;
          }
          classifier.multi_label = next;
          setToggle(toggleId, next);
        }
      });
    });
  }

  function bindSecretToggles() {
    document.querySelectorAll('[data-secret-toggle]').forEach(function (button) {
      button.addEventListener('click', function () {
        var input = byId(button.getAttribute('data-secret-toggle'));
        var usesIconToggle = button.classList.contains('icon-action-button');
        var shouldReveal;

        if (!input) {
          return;
        }

        shouldReveal = input.type === 'password';
        input.type = shouldReveal ? 'text' : 'password';
        button.classList.toggle('is-revealed', shouldReveal);
        if (usesIconToggle) {
          button.textContent = '';
          button.classList.toggle('icon-action-button--eye', shouldReveal);
          button.classList.toggle('icon-action-button--eye-off', !shouldReveal);
          button.setAttribute('title', shouldReveal ? 'Hide API key' : 'Show API key');
        } else {
          button.textContent = shouldReveal ? 'Hide' : 'Show';
        }
        button.setAttribute('aria-label', shouldReveal ? 'Hide API key' : 'Show API key');
      });
    });
  }

  function bindForms() {
    var listenerForm = byId('listenerForm');
    var classifierForm = byId('classifierForm');
    var backendForm = byId('backendForm');
    var backendCredentialSourceGroup = byId('backendCredentialSourceGroup');
    var policyForm = byId('policyForm');

    listenerForm.addEventListener('input', function () {
      var listener = getListenerFormModel();
      if (!listener) {
        return;
      }
      syncListenerFromForm(listener);
      if (pendingListenerValidationActive) {
        setListenerRequiredErrors(getMissingListenerRequiredFields(listener));
      }
      if (state.ui.listenerEditorMode === 'empty') {
        markDirty('inline edit');
        renderListenerList();
      }
    });
    listenerForm.addEventListener('change', function (event) {
      var listener = getListenerFormModel();
      if (!listener) {
        return;
      }
      syncListenerFromForm(listener);
      if (event.target && event.target.id === 'listener_client_auth') {
        renderListenerForm();
        return;
      }
      if (pendingListenerValidationActive) {
        setListenerRequiredErrors(getMissingListenerRequiredFields(listener));
      }
      if (state.ui.listenerEditorMode === 'empty') {
        state.operatingMode = getValue('listener_operating_mode');
        markDirty('inline edit');
      }
      renderMode();
    });

    classifierForm.addEventListener('pointerdown', armClassifierFormUserInteraction, true);
    classifierForm.addEventListener('keydown', armClassifierFormUserInteraction, true);

    classifierForm.addEventListener('input', function (event) {
      var classifier = getClassifierFormModel();
      var isNli;
      if (shouldIgnoreClassifierHydrationEvent(event)) {
        restoreClassifierFormAfterHydrationEvent();
        return;
      }
      if (
        !classifier ||
        state.activePage !== 'classifier' ||
        (state.ui.classifierEditorMode !== 'create' && state.ui.classifierEditorMode !== 'edit')
      ) {
        return;
      }
      syncClassifierFromForm(classifier);
      isNli = classifier.classifier_type === 'classifier_nli';
      invalidateClassifierProbeState();
      clearClassifierTestResult();
      renderClassifierTagSection(classifier, isNli);
      renderClassifierFallbackOptions(classifier);
      if (pendingClassifierValidationActive) {
        setClassifierRequiredErrors(getMissingClassifierRequiredFields(classifier));
      } else if (classifierProbeState.validationActive) {
        setClassifierRequiredErrors(getMissingClassifierProbeFields(classifier));
      }
    });
    classifierForm.addEventListener('change', function (event) {
      var classifier = getClassifierFormModel();
      var isNli;

      if (shouldIgnoreClassifierHydrationEvent(event)) {
        restoreClassifierFormAfterHydrationEvent();
        return;
      }
      if (
        !classifier ||
        state.activePage !== 'classifier' ||
        (state.ui.classifierEditorMode !== 'create' && state.ui.classifierEditorMode !== 'edit')
      ) {
        return;
      }

      syncClassifierFromForm(classifier);
      isNli = classifier.classifier_type === 'classifier_nli';
      invalidateClassifierProbeState();
      clearClassifierTestResult();
      renderClassifierForm();
      if (pendingClassifierValidationActive) {
        setClassifierRequiredErrors(getMissingClassifierRequiredFields(classifier));
      } else if (classifierProbeState.validationActive) {
        setClassifierRequiredErrors(getMissingClassifierProbeFields(classifier));
      }
    });

    backendForm.addEventListener('input', function (event) {
      var backend = getBackendFormModel();

      if (!backend || state.activePage !== 'backend' || (state.ui.backendEditorMode !== 'create' && state.ui.backendEditorMode !== 'edit')) {
        return;
      }
      syncBackendFromForm(backend);
      invalidateBackendProbeState();
      if (event && event.target && event.target.name === 'backend_credential_source') {
        renderBackendForm();
        return;
      }
      if (pendingBackendValidationActive) {
        setBackendRequiredErrors(getMissingBackendRequiredFields(backend));
      } else if (backendProbeState.validationActive) {
        setBackendRequiredErrors(getMissingBackendProbeFields(backend));
      }
    });
    backendForm.addEventListener('change', function (event) {
      var backend = getBackendFormModel();

      if (!backend || state.activePage !== 'backend' || (state.ui.backendEditorMode !== 'create' && state.ui.backendEditorMode !== 'edit')) {
        return;
      }
      syncBackendFromForm(backend);
      invalidateBackendProbeState();
      if (event && event.target && event.target.name === 'backend_credential_source') {
        renderBackendForm();
        return;
      }
      if (pendingBackendValidationActive) {
        setBackendRequiredErrors(getMissingBackendRequiredFields(backend));
      } else if (backendProbeState.validationActive) {
        setBackendRequiredErrors(getMissingBackendProbeFields(backend));
      }
    });

    if (backendCredentialSourceGroup) {
      backendCredentialSourceGroup.addEventListener('click', function (event) {
        var chip = event.target && event.target.closest ? event.target.closest('.choice-chip') : null;
        var input = chip ? chip.querySelector('input[name="backend_credential_source"]') : null;

        if (!input) {
          return;
        }

        window.setTimeout(function () {
          input.checked = true;
          applyBackendCredentialSourceSelection(input.value);
        }, 0);
      });
      backendCredentialSourceGroup.addEventListener('change', function (event) {
        if (!event.target || event.target.name !== 'backend_credential_source') {
          return;
        }
        applyBackendCredentialSourceSelection(event.target.value);
      });
    }

    policyForm.addEventListener('input', function () {
      var policy;

      if (!shouldSyncPendingEditorFromForm('policy', 'policyEditorMode', 'policyForm')) {
        return;
      }
      policy = getPolicyFormModel();
      if (!policy) {
        return;
      }

      syncPolicyFromForm(policy);
      renderPolicyStageLayout(policy);
      renderPolicyDefaultRuleState(policy);
      if (pendingPolicyValidationActive) {
        setPolicyRequiredErrors(getMissingPolicyRequiredFields(policy));
      }
      renderPolicyStatus();
    });
    policyForm.addEventListener('change', function () {
      var policy;

      if (!shouldSyncPendingEditorFromForm('policy', 'policyEditorMode', 'policyForm')) {
        return;
      }
      policy = getPolicyFormModel();
      if (!policy) {
        return;
      }

      syncPolicyFromForm(policy);
      renderPolicyStageLayout(policy);
      renderPolicyDefaultRuleState(policy);
      if (pendingPolicyValidationActive) {
        setPolicyRequiredErrors(getMissingPolicyRequiredFields(policy));
      }
      renderPolicyStatus();
      renderPolicyKeyEntries(policy);
      renderPolicyEntries(policy);
    });
  }

  function bindDraftActions() {
    var resetButton = byId('resetButton');
    var deployButton = byId('deployButton');
    var exportButton = byId('exportButton');
    var importButton = byId('importButton');
    var importInput = byId('importFileInput');

    if (resetButton) {
      resetButton.addEventListener('click', resetToSample);
    }
    if (deployButton) {
      deployButton.addEventListener('click', deployChanges);
    }
    if (exportButton) {
      exportButton.addEventListener('click', exportDraft);
    }
    if (importButton && importInput) {
      importButton.addEventListener('click', function () {
        importInput.click();
      });
    }
    if (importInput) {
      importInput.addEventListener('change', function (event) {
        var file = event.target.files && event.target.files[0];
        if (file) {
          importJsonFile(file);
        }
        event.target.value = '';
      });
    }
  }

  function bindStatusActions() {
    var refreshButton = byId('refreshBackendStatusButton');
    var refreshPoolButton = byId('refreshPoolCatalogButton');
    var refreshClassifierPoolButton = byId('refreshClassifierPoolCatalogButton');

    if (refreshButton) {
      refreshButton.addEventListener('click', function () {
        refreshRuntimeStatus({ manual: true, force: true });
      });
    }

    [refreshPoolButton, refreshClassifierPoolButton].forEach(function (button) {
      if (!button) {
        return;
      }
      button.addEventListener('click', function () {
        refreshPoolCatalog({ manual: true, force: true });
      });
    });
  }

  function bindListenerCreateAction() {
    byId('createListenerButton').addEventListener('click', function () {
      if (!(pendingListenerDraft && pendingListenerDraftId === '')) {
        discardPendingListenerDraft();
        pendingListenerDraft = buildBlankListener();
        pendingListenerDraftId = '';
        pendingListenerValidationActive = false;
      }
      state.activeIds.listener = '';
      state.ui.listenerEditorMode = 'create';
      renderAll();
    });
  }

  function bindListenerConfirmAction() {
    var button = byId('listenerConfirmButton');

    if (!button) {
      return;
    }

    button.addEventListener('click', validatePendingListenerDraftForConfirm);
  }

  function bindListenerAllowedPoolSelector() {
    var selectedFilter = byId('listener_allowed_virtual_key_pools_selected_filter');
    var availableFilter = byId('listener_allowed_virtual_key_pools_available_filter');
    var addButton = byId('listenerAllowedPoolsAddButton');
    var removeButton = byId('listenerAllowedPoolsRemoveButton');

    if (selectedFilter) {
      selectedFilter.addEventListener('input', function () {
        listenerPoolSearchState.selected = selectedFilter.value;
        renderListenerAllowedPoolSelector(getListenerFormModel());
      });
    }
    if (availableFilter) {
      availableFilter.addEventListener('input', function () {
        listenerPoolSearchState.available = availableFilter.value;
        renderListenerAllowedPoolSelector(getListenerFormModel());
      });
    }
    if (addButton) {
      addButton.addEventListener('click', function () {
        moveListenerAllowedPools('add');
      });
    }
    if (removeButton) {
      removeButton.addEventListener('click', function () {
        moveListenerAllowedPools('remove');
      });
    }
  }

  function bindListenerListActions() {
    var searchInput = byId('listenerSearchInput');
    var pageSelect = byId('listenerPageSelect');

    if (searchInput) {
      searchInput.addEventListener('input', function () {
        listenerSearchTerm = searchInput.value || '';
        listenerPage = 1;
        listenerSelection = {};
        renderListenerList();
      });
    }

    if (pageSelect) {
      pageSelect.addEventListener('change', function () {
        listenerPage = pageSelect.value === 'all' ? 'all' : parseInt(pageSelect.value, 10) || 1;
        renderListenerList();
      });
    }
  }

  function bindBackendCreateAction() {
    byId('createBackendButton').addEventListener('click', function () {
      if (!(pendingBackendDraft && pendingBackendDraftId === '')) {
        discardPendingBackendDraft();
        pendingBackendDraft = buildBlankBackend();
        pendingBackendDraftId = '';
        pendingBackendCredentialSource = 'inline_api_key';
        pendingBackendValidationActive = false;
      }
      state.activeIds.backend = '';
      state.ui.backendEditorMode = 'create';
      renderAll();
    });
  }

  function bindClassifierCreateAction() {
    var button = byId('createClassifierButton');

    if (!button) {
      return;
    }

    button.addEventListener('click', function () {
      if (!(pendingClassifierDraft && pendingClassifierDraftId === '')) {
        discardPendingClassifierDraft();
        pendingClassifierDraft = buildBlankClassifier();
        pendingClassifierDraftId = '';
        pendingClassifierValidationActive = false;
      }
      state.activeIds.classifier = '';
      state.ui.classifierEditorMode = 'create';
      resetClassifierProbeState();
      clearClassifierTestResult();
      renderAll();
    });
  }

  function bindClassifierConfirmAction() {
    var button = byId('classifierConfirmButton');

    if (!button) {
      return;
    }

    button.addEventListener('click', validatePendingClassifierDraftForConfirm);
  }

  function bindBackendConfirmAction() {
    var button = byId('backendConfirmButton');

    if (!button) {
      return;
    }

    button.addEventListener('click', validatePendingBackendDraftForConfirm);
  }

  function runBackendModelProbe() {
    var backend = getBackendFormModel();
    var missingFields;
    var apiKey;

    if (!backend) {
      showToast('No backend target selected.', 'error');
      return;
    }

    syncBackendFromForm(backend);
    apiKey = getBackendProbeApiKey(backend);
    missingFields = getMissingBackendProbeFields(backend);
    backendProbeState.validationActive = true;
    if (!pendingBackendValidationActive) {
      setBackendRequiredErrors(missingFields);
    }

    if (missingFields.length) {
      setBackendProbeState('fail', 'Missing ' + missingFields.map(function (field) { return field.label; }).join(', ') + '.', false);
      scheduleBackendProbeReset();
      showToast('Backend probe blocked: missing ' + missingFields.map(function (field) { return field.label; }).join(', ') + '.', 'error');
      return;
    }

    if (looksLikeEnvReference(apiKey)) {
      setBackendProbeState('fail', 'API Key must be pasted directly.', false);
      scheduleBackendProbeReset();
      showToast('API Key must be pasted directly, not ENV/Secret Ref.', 'error');
      return;
    }

    if (!pendingBackendValidationActive) {
      clearBackendRequiredErrors();
    }
    backendProbeState.validationActive = false;
    setBackendProbeState('idle', 'Probing backend model...', true);

    fetchWithTimeout(TEST_BACKEND_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'same-origin',
      body: buildUtf8JsonRequestBody({
        backend_id: state.activeIds.backend || pendingBackendDraftId || '',
        backend: {
          backend_target_name: backend.backend_target_name || '',
          schema_family: normalizeBackendSchemaFamily(backend.schema_family),
          endpoint_url: backend.endpoint_url || '',
          api_key: apiKey,
          credential_pool_ref: backend.credential_pool_ref || '',
          model_id: backend.model_id || ''
        }
      })
    }, 15000, 'Backend model probe timed out.').then(parseJsonResponse).then(function (result) {
      var payload = result.payload || {};
      var error;

      if (!result.ok || payload.ok === false) {
        error = new Error(payload.message || 'Backend model probe failed.');
        error.payload = payload;
        throw error;
      }

      setBackendProbeState('ok', 'Backend model responded.', false);
      scheduleBackendProbeReset();
      showToast('Backend model probe succeeded.', 'success');
    }).catch(function (error) {
      var payload = error && error.payload ? error.payload : { message: error.message || 'Backend model probe failed.' };
      setBackendProbeState('fail', payload.message || 'Backend model probe failed.', false);
      scheduleBackendProbeReset();
      showToast(payload.message || 'Backend model probe failed.', 'error');
    });
  }

  function bindBackendProbeAction() {
    var button = byId('backendProbeButton');

    if (!button) {
      return;
    }

    button.addEventListener('click', runBackendModelProbe);
  }

  function bindBackendSecretCopyAction() {
    var button = byId('backendApiKeyCopyButton');

    if (!button) {
      return;
    }

    button.addEventListener('click', function () {
      var value = String(getValue('backend_api_key') || '').trim();

      if (!value) {
        showToast('No backend API key to copy.', 'error');
        return;
      }

      copyTextToClipboard(value).then(function () {
        showToast('Backend API key copied.', 'success');
      }).catch(function () {
        showToast('Unable to copy backend API key.', 'error');
      });
    });
  }

  function runClassifierModelProbe() {
    var classifier = getClassifierFormModel();
    var missingFields;
    var apiKey;

    if (!classifier) {
      showToast('No classifier selected.', 'error');
      return;
    }

    syncClassifierFromForm(classifier);
    apiKey = getValue('classifier_api_key').trim();
    if (normalizeClassifierMaxTokensForTest(classifier)) {
      showToast('Max Tokens was raised to 128 for this DeepSeek classifier probe.', 'success');
    }

    missingFields = getMissingClassifierProbeFields(classifier);
    classifierProbeState.validationActive = true;
    if (!pendingClassifierValidationActive) {
      setClassifierRequiredErrors(missingFields);
    }

    if (missingFields.length) {
      setClassifierProbeState('fail', 'Missing ' + missingFields.map(function (field) { return field.label; }).join(', ') + '.', false);
      scheduleClassifierProbeReset();
      showToast('Classifier probe blocked: missing ' + missingFields.map(function (field) { return field.label; }).join(', ') + '.', 'error');
      return;
    }

    if (looksLikeEnvReference(apiKey)) {
      setClassifierProbeState('fail', 'API Key must be pasted directly.', false);
      scheduleClassifierProbeReset();
      showToast('API Key must be pasted directly, not ENV/Secret Ref.', 'error');
      return;
    }

    setSecretValue(classifier, apiKey);
    if (!pendingClassifierValidationActive) {
      clearClassifierRequiredErrors();
    }
    classifierProbeState.validationActive = false;
    setClassifierProbeState('idle', 'Probing classifier model...', true);

    fetchWithTimeout(TEST_CLASSIFIER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'same-origin',
      body: buildUtf8JsonRequestBody({
        classifier_id: state.activeIds.classifier || pendingClassifierDraftId || '',
        classifier: classifier,
        input_text: '你好'
      })
    }, 15000, 'Classifier model probe timed out.').then(parseJsonResponse).then(function (result) {
      var payload = result.payload || {};
      var error;
      if (!result.ok || payload.ok === false) {
        error = new Error(payload.message || 'Classifier model probe failed.');
        error.payload = payload;
        throw error;
      }
      setClassifierProbeState('ok', 'Classifier model responded.', false);
      scheduleClassifierProbeReset();
      showToast('Classifier model probe succeeded.', 'success');
    }).catch(function (error) {
      var payload = error && error.payload ? error.payload : { message: error.message || 'Classifier model probe failed.' };
      setClassifierProbeState('fail', payload.message || 'Classifier model probe failed.', false);
      scheduleClassifierProbeReset();
      showToast(payload.message || 'Classifier model probe failed.', 'error');
    });
  }

  function bindClassifierProbeAction() {
    var button = byId('classifierProbeButton');

    if (!button) {
      return;
    }

    button.addEventListener('click', runClassifierModelProbe);
  }

  function bindPolicyHeaderActions() {
    var createPolicyButton = byId('createPolicyButton');
    var searchInput = byId('policySearchInput');
    var pageSelect = byId('policyPageSelect');
    var selectAll = byId('policySelectAll');
    var bulkDeleteButton = byId('deleteSelectedPoliciesButton');

    createPolicyButton.addEventListener('click', function () {
      if (!(pendingPolicyDraft && pendingPolicyDraftId === '')) {
        discardPendingPolicyDraft();
        pendingPolicyDraft = buildBlankPolicy();
        pendingPolicyDraftId = '';
        pendingPolicyValidationActive = false;
      }
      state.activeIds.policy = '';
      state.activeIds.ruleIndex = 0;
      state.ui.policyEditorMode = 'create';
      renderAll();
    });

    if (searchInput) {
      searchInput.addEventListener('input', function () {
        policySearchTerm = searchInput.value || '';
        policyPage = 1;
        policySelection = {};
        renderPolicyList();
      });
    }

    if (pageSelect) {
      pageSelect.addEventListener('change', function () {
        policyPage = pageSelect.value === 'all' ? 'all' : parseInt(pageSelect.value, 10) || 1;
        renderPolicyList();
      });
    }

    if (selectAll) {
      selectAll.addEventListener('change', function () {
        getCurrentPagePolicyIds().forEach(function (id) {
          policySelection[id] = selectAll.checked;
        });
        renderPolicyList();
      });
    }

    if (bulkDeleteButton) {
      bulkDeleteButton.addEventListener('click', deleteSelectedPolicies);
    }
  }

  function bindPolicyConfirmAction() {
    var button = byId('policyConfirmButton');

    if (!button) {
      return;
    }

    button.addEventListener('click', validatePendingPolicyDraftForConfirm);
  }

  function bindPolicyEntryActions() {
    var host = byId('policyEntries');
    var keyHost = byId('policyKeyEntries');

    if (!host) {
      return;
    }

    host.addEventListener('click', function (event) {
      var deleteButton = event.target.closest('[data-policy-entry-delete]');
      var toggleButton = event.target.closest('[data-policy-entry-toggle]');
      var policy;
      var index;

      if (toggleButton) {
        event.preventDefault();
        event.stopPropagation();
        policy = getPolicyFormModel();
        if (!policy || !Array.isArray(policy.rules)) {
          return;
        }
        index = parseInt(toggleButton.getAttribute('data-policy-entry-toggle'), 10);
        if (Number.isNaN(index) || !policy.rules[index]) {
          return;
        }
        policy.rules[index] = normalizePolicyTagRule(policy.rules[index], index);
        policy.rules[index].enabled = !policy.rules[index].enabled;
        renderPolicyEntries(policy);
        renderPolicyStatus();
        return;
      }

      if (!deleteButton) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      policy = getPolicyFormModel();
      if (!policy || !Array.isArray(policy.rules)) {
        return;
      }

      index = parseInt(deleteButton.getAttribute('data-policy-entry-delete'), 10);
      if (Number.isNaN(index)) {
        return;
      }

      if (!window.confirm('Delete this policy entry?')) {
        return;
      }

      policy.rules.splice(index, 1);
      state.activeIds.ruleIndex = 0;
      renderPolicyForm();
    });

    host.addEventListener('change', function (event) {
      var field = event.target.getAttribute('data-policy-entry-field');
      var index = parseInt(event.target.getAttribute('data-entry-index'), 10);
      var policy = getPolicyFormModel();
      var rule;

      if (!field || Number.isNaN(index) || !policy || !policy.rules || !policy.rules[index]) {
        return;
      }

      rule = policy.rules[index];

      if (field === 'source_tag') {
        rule.source_tag = event.target.value;
        updatePolicyEntryTagPreview(index, rule.source_tag);
      } else if (field === 'action') {
        rule.action = event.target.value;
        if (rule.action === 'respond') {
          rule.backend_target_ref = '';
        } else {
          rule.response_message = '';
        }
        renderPolicyEntries(policy);
      } else if (field === 'backend_target_ref') {
        rule.backend_target_ref = event.target.value;
      }

      renderPolicyStatus();
    });

    host.addEventListener('input', function (event) {
      var field = event.target.getAttribute('data-policy-entry-field');
      var index = parseInt(event.target.getAttribute('data-entry-index'), 10);
      var policy = getPolicyFormModel();

      if (field !== 'response_message' || Number.isNaN(index) || !policy || !policy.rules || !policy.rules[index]) {
        return;
      }

      policy.rules[index].response_message = event.target.value;
      renderPolicyStatus();
    });

    byId('addPolicyEntryButton').addEventListener('click', function () {
      var policy = getPolicyFormModel();

      if (!policy) {
        return;
      }

      policy.rules = policy.rules || [];
      policy.rules.push({
        rule_name: '',
        source_tag: '',
        action: 'route',
        backend_target_ref: '',
        response_message: '',
        enabled: true
      });
      state.activeIds.ruleIndex = policy.rules.length - 1;
      renderPolicyForm();
      scrollPolicyEntryIntoView(state.activeIds.ruleIndex);
    });

    if (keyHost) {
      keyHost.addEventListener('click', function (event) {
        var deleteButton = event.target.closest('[data-policy-key-entry-delete]');
        var toggleButton = event.target.closest('[data-policy-key-entry-toggle]');
        var policy;
        var index;

        if (toggleButton) {
          event.preventDefault();
          event.stopPropagation();
          policy = getPolicyFormModel();
          if (!policy || !Array.isArray(policy.key_rules)) {
            return;
          }
          index = parseInt(toggleButton.getAttribute('data-policy-key-entry-toggle'), 10);
          if (Number.isNaN(index) || !policy.key_rules[index]) {
            return;
          }
          policy.key_rules[index] = normalizePolicyKeyRule(policy.key_rules[index], index, { preserveUiSourceType: true });
          policy.key_rules[index].enabled = !policy.key_rules[index].enabled;
          renderPolicyKeyEntries(policy);
          renderPolicyStatus();
          return;
        }

        if (!deleteButton) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();

        policy = getPolicyFormModel();
        if (!policy || !Array.isArray(policy.key_rules)) {
          return;
        }

        index = parseInt(deleteButton.getAttribute('data-policy-key-entry-delete'), 10);
        if (Number.isNaN(index)) {
          return;
        }

        if (!window.confirm('Delete this key rule?')) {
          return;
        }

        policy.key_rules.splice(index, 1);
        renderPolicyForm();
      });

      keyHost.addEventListener('change', function (event) {
        var field = event.target.getAttribute('data-policy-key-entry-field');
        var sourceField = event.target.getAttribute('data-policy-key-source-field');
        var sourceType = event.target.getAttribute('data-policy-key-source-type');
        var index = parseInt(event.target.getAttribute('data-entry-index'), 10);
        var policy = getPolicyFormModel();
        var rule;

        if ((!field && !sourceField) || Number.isNaN(index) || !policy || !policy.key_rules || !policy.key_rules[index]) {
          return;
        }

        rule = policy.key_rules[index];
        rule.match = rule.match || {};

        if (sourceField === 'source_type') {
          applyPolicyKeySourceMatch(rule, event.target.value, '');
          renderPolicyKeyEntries(policy);
        } else if (field === 'source_value') {
          applyPolicyKeySourceMatch(rule, sourceType, event.target.value);
          updatePolicyKeyEntryMatchPreview(index, rule.match);
        } else if (field === 'action') {
          rule.action = normalizePolicyKeyAction(event.target.value);
          if (!isPolicyKeyActionAllowed(policy, rule.action)) {
            rule.action = 'route';
          }
          if (rule.action === 'route') {
            rule.response_message = '';
            rule.classifier_ref = '';
          } else if (rule.action === 'respond') {
            rule.backend_target_ref = '';
            rule.classifier_ref = '';
          } else {
            rule.backend_target_ref = '';
            rule.response_message = '';
          }
          renderPolicyKeyEntries(policy);
        } else if (field === 'virtual_key_pool_ref' || field === 'virtual_key_ref' || field === 'virtual_key_tag') {
          applyPolicyKeySourceMatch(
            rule,
            field === 'virtual_key_ref' ? 'key' : (field === 'virtual_key_tag' ? 'tag' : 'pool'),
            event.target.value
          );
          updatePolicyKeyEntryMatchPreview(index, rule.match);
        } else if (field === 'backend_target_ref' || field === 'classifier_ref') {
          rule[field] = event.target.value;
        }

        renderPolicyStatus();
      });

      keyHost.addEventListener('input', function (event) {
        var field = event.target.getAttribute('data-policy-key-entry-field');
        var index = parseInt(event.target.getAttribute('data-entry-index'), 10);
        var policy = getPolicyFormModel();
        var rule;

        if (!field || Number.isNaN(index) || !policy || !policy.key_rules || !policy.key_rules[index]) {
          return;
        }

        rule = policy.key_rules[index];
        rule.match = rule.match || {};

        if (field === 'rule_name') {
          rule.rule_name = event.target.value;
        } else if (field === 'virtual_key_tag') {
          applyPolicyKeySourceMatch(rule, 'tag', event.target.value);
          updatePolicyKeyEntryMatchPreview(index, rule.match);
        } else if (field === 'response_message') {
          rule.response_message = event.target.value;
        } else {
          return;
        }

        renderPolicyStatus();
      });
    }

    if (byId('addPolicyKeyEntryButton')) {
      byId('addPolicyKeyEntryButton').addEventListener('click', function () {
        var policy = getPolicyFormModel();

        if (!policy) {
          return;
        }

        policy.key_rules = policy.key_rules || [];
        policy.key_rules.push({
          rule_name: 'key_rule_' + (policy.key_rules.length + 1),
          enabled: true,
          match: {
            virtual_key_pool_ref: '',
            virtual_key_ref: '',
            virtual_key_tag: ''
          },
          ui_source_type: 'pool',
          action: 'route',
          backend_target_ref: '',
          response_message: '',
          classifier_ref: ''
        });
        renderPolicyForm();
      });
    }
  }

  function bindVirtualKeyActions() {
    var createPoolButton = byId('createVirtualKeyPoolButton');
    var createKeyButton = byId('createVirtualKeyButton');
    var cancelPoolButton = byId('cancelVirtualKeyPoolButton');
    var confirmPoolButton = byId('virtualKeyPoolConfirmButton');
    var cancelKeyButton = byId('cancelVirtualKeyButton');
    var confirmKeyButton = byId('virtualKeyConfirmButton');
    var clearFilterButton = byId('clearVirtualKeyPoolFilterButton');
    var showKeysButton = byId('showVirtualKeyPoolsButton');
    var poolSearchInput = byId('virtualKeyPoolSearchInput');
    var keySearchInput = byId('virtualKeySearchInput');
    var poolPageSelect = byId('virtualKeyPoolPageSelect');
    var keyPageSelect = byId('virtualKeyPageSelect');
    var poolForm = byId('virtualKeyPoolForm');
    var keyForm = byId('virtualKeyForm');
    var poolSelectAll = byId('virtualKeyPoolSelectAll');
    var keySelectAll = byId('virtualKeySelectAll');
    var revealDraftButton = byId('virtualKeyDetailRevealButton');
    var copyDraftButton = byId('virtualKeyDetailCopyButton');
    var poolEnableBulkButton = byId('enableVirtualKeyPoolsButton');
    var poolDisableBulkButton = byId('disableVirtualKeyPoolsButton');
    var poolDeleteBulkButton = byId('deleteVirtualKeyPoolsButton');
    var keyEnableBulkButton = byId('enableVirtualKeysButton');
    var keyDisableBulkButton = byId('disableVirtualKeysButton');
    var keyDeleteBulkButton = byId('deleteVirtualKeysButton');
    var divider = byId('virtualKeyDivider');
    var layout = byId('virtualKeyLayout');

    if (createPoolButton) {
      createPoolButton.addEventListener('click', openVirtualKeyPoolEditor);
    }
    if (createKeyButton) {
      createKeyButton.addEventListener('click', openVirtualKeyEditor);
    }
    if (cancelPoolButton) {
      cancelPoolButton.addEventListener('click', closeVirtualKeyPoolEditor);
    }
    if (confirmPoolButton) {
      confirmPoolButton.addEventListener('click', confirmCreateVirtualKeyPool);
    }
    if (cancelKeyButton) {
      cancelKeyButton.addEventListener('click', closeVirtualKeyEditor);
    }
    if (confirmKeyButton) {
      confirmKeyButton.addEventListener('click', confirmCreateVirtualKey);
    }
    if (clearFilterButton) {
      clearFilterButton.addEventListener('click', function () {
        setActiveVirtualKeyPoolFilter('');
        renderAll();
      });
    }
    if (showKeysButton) {
      showKeysButton.addEventListener('click', function () {
        var ids = Object.keys(virtualKeyPoolSelection).filter(function (id) {
          return virtualKeyPoolSelection[id] && state.virtualKeyPools[id];
        });
        if (!ids.length) {
          showToast('Select at least one Virtual Key Pool.', 'error');
          return;
        }
        setActiveVirtualKeyPoolFilter(ids);
        renderAll();
      });
    }
    if (poolSearchInput) {
      poolSearchInput.addEventListener('input', function () {
        virtualKeyPoolSearchTerm = poolSearchInput.value || '';
        virtualKeyPoolPage = 1;
        virtualKeyPoolSelection = {};
        renderVirtualKeyPools();
      });
    }
    if (keySearchInput) {
      keySearchInput.addEventListener('input', function () {
        virtualKeySearchTerm = keySearchInput.value || '';
        virtualKeyPage = 1;
        virtualKeySelection = {};
        renderVirtualKeys();
        renderVirtualKeyLayout();
      });
    }
    if (poolPageSelect) {
      poolPageSelect.addEventListener('change', function () {
        virtualKeyPoolPage = poolPageSelect.value === 'all' ? 'all' : parseInt(poolPageSelect.value, 10) || 1;
        renderVirtualKeyPools();
      });
    }
    if (keyPageSelect) {
      keyPageSelect.addEventListener('change', function () {
        virtualKeyPage = keyPageSelect.value === 'all' ? 'all' : parseInt(keyPageSelect.value, 10) || 1;
        renderVirtualKeys();
      });
    }
    if (poolForm) {
      poolForm.addEventListener('input', function () {
        var issues;
        syncVirtualKeyPoolDraftFromForm();
        issues = getVirtualKeyPoolFieldIssues(pendingVirtualKeyPoolDraft);
        if (pendingVirtualKeyPoolValidationActive) {
          setVirtualKeyPoolFieldErrors(issues.map(function (issue) { return issue.id; }));
        }
        renderVirtualKeyPoolEditor();
      });
      poolForm.addEventListener('submit', function (event) {
        event.preventDefault();
        confirmCreateVirtualKeyPool();
      });
    }
    if (keyForm) {
      keyForm.addEventListener('input', function () {
        var issues;
        syncVirtualKeyDraftFromForm();
        issues = getVirtualKeyFieldIssues(pendingVirtualKeyDraft);
        if (pendingVirtualKeyValidationActive) {
          setVirtualKeyEditorFieldErrors(issues.map(function (issue) { return issue.id; }));
        }
        renderVirtualKeyEditor();
      });
      keyForm.addEventListener('change', function () {
        var issues;
        syncVirtualKeyDraftFromForm();
        issues = getVirtualKeyFieldIssues(pendingVirtualKeyDraft);
        if (pendingVirtualKeyValidationActive) {
          setVirtualKeyEditorFieldErrors(issues.map(function (issue) { return issue.id; }));
        }
        renderVirtualKeyEditor();
      });
      keyForm.addEventListener('submit', function (event) {
        event.preventDefault();
        confirmCreateVirtualKey();
      });
    }
    if (revealDraftButton) {
      revealDraftButton.addEventListener('click', function () {
        if (!pendingVirtualKeyDraft) {
          return;
        }
        pendingVirtualKeyDraft.revealSecret = !pendingVirtualKeyDraft.revealSecret;
        renderVirtualKeyEditor();
      });
    }
    if (copyDraftButton) {
      copyDraftButton.addEventListener('click', function () {
        var detail = getPendingVirtualKeyFullDetail();
        if (!detail) {
          showToast('Full key is not ready yet.', 'error');
          return;
        }
        copyTextToClipboard(detail).then(function () {
          setVirtualKeyCopyFeedback('draft', true);
          scheduleVirtualKeyCopyFeedbackReset('draft', renderVirtualKeyEditor);
          renderVirtualKeyEditor();
          showToast('Virtual Key copied.', 'success');
        }).catch(function () {
          showToast('Clipboard copy failed.', 'error');
        });
      });
    }
    if (poolSelectAll) {
      poolSelectAll.addEventListener('change', function () {
        getCurrentVirtualKeyPoolPageIds().forEach(function (id) {
          virtualKeyPoolSelection[id] = poolSelectAll.checked;
        });
        renderVirtualKeyPools();
      });
    }
    if (keySelectAll) {
      keySelectAll.addEventListener('change', function () {
        getCurrentPageVirtualKeyIds().forEach(function (id) {
          virtualKeySelection[id] = keySelectAll.checked;
        });
        renderVirtualKeys();
      });
    }
    if (poolEnableBulkButton) {
      poolEnableBulkButton.addEventListener('click', function () {
        var ids = Object.keys(virtualKeyPoolSelection).filter(function (id) {
          return virtualKeyPoolSelection[id] && state.virtualKeyPools[id];
        });
        if (!ids.length) {
          showToast('Select at least one Virtual Key Pool.', 'error');
          return;
        }
        ids.forEach(function (id) {
          if (virtualKeyPoolSelection[id] && state.virtualKeyPools[id]) {
            state.virtualKeyPools[id].enabled = true;
          }
        });
        markDirty('bulk enable virtual key pools');
        renderAll();
      });
    }
    if (poolDisableBulkButton) {
      poolDisableBulkButton.addEventListener('click', function () {
        var ids = Object.keys(virtualKeyPoolSelection).filter(function (id) {
          return virtualKeyPoolSelection[id] && state.virtualKeyPools[id];
        });
        if (!ids.length) {
          showToast('Select at least one Virtual Key Pool.', 'error');
          return;
        }
        ids.forEach(function (id) {
          if (virtualKeyPoolSelection[id] && state.virtualKeyPools[id]) {
            state.virtualKeyPools[id].enabled = false;
          }
        });
        markDirty('bulk disable virtual key pools');
        renderAll();
      });
    }
    if (poolDeleteBulkButton) {
      poolDeleteBulkButton.addEventListener('click', function () {
        var ids = Object.keys(virtualKeyPoolSelection).filter(function (id) {
          return virtualKeyPoolSelection[id] && state.virtualKeyPools[id];
        });
        if (!ids.length) {
          showToast('Select at least one Virtual Key Pool.', 'error');
          return;
        }
        if (!window.confirm('Delete ' + formatCountLabel(ids.length, 'Virtual Key Pool', 'Virtual Key Pools') + ' and any keys assigned to them?')) {
          return;
        }
        ids.forEach(function (id) {
          deleteVirtualKeyPool(id, true);
        });
        markDirty('bulk delete virtual key pools');
        renderAll();
      });
    }
    if (keyEnableBulkButton) {
      keyEnableBulkButton.addEventListener('click', function () {
        var ids = Object.keys(virtualKeySelection).filter(function (id) {
          return virtualKeySelection[id] && state.virtualKeys[id];
        });
        if (!ids.length) {
          showToast('Select at least one Virtual Key.', 'error');
          return;
        }
        ids.forEach(function (id) {
          if (virtualKeySelection[id] && state.virtualKeys[id]) {
            state.virtualKeys[id].enabled = true;
          }
        });
        markDirty('bulk enable virtual keys');
        renderAll();
      });
    }
    if (keyDisableBulkButton) {
      keyDisableBulkButton.addEventListener('click', function () {
        var ids = Object.keys(virtualKeySelection).filter(function (id) {
          return virtualKeySelection[id] && state.virtualKeys[id];
        });
        if (!ids.length) {
          showToast('Select at least one Virtual Key.', 'error');
          return;
        }
        ids.forEach(function (id) {
          if (virtualKeySelection[id] && state.virtualKeys[id]) {
            state.virtualKeys[id].enabled = false;
          }
        });
        markDirty('bulk disable virtual keys');
        renderAll();
      });
    }
    if (keyDeleteBulkButton) {
      keyDeleteBulkButton.addEventListener('click', function () {
        var ids = Object.keys(virtualKeySelection).filter(function (id) {
          return virtualKeySelection[id] && state.virtualKeys[id];
        });
        if (!ids.length) {
          showToast('Select at least one Virtual Key.', 'error');
          return;
        }
        if (!window.confirm('Delete ' + formatCountLabel(ids.length, 'Virtual Key', 'Virtual Keys') + '?')) {
          return;
        }
        ids.forEach(function (id) {
          deleteVirtualKey(id, true);
        });
        markDirty('bulk delete virtual keys');
        renderAll();
      });
    }
    if (divider && layout) {
      divider.addEventListener('mousedown', function (event) {
        if (isVirtualKeyLayoutStacked()) {
          return;
        }
        virtualKeyPaneDragState = {
          startX: event.clientX,
          startWidth: virtualKeyPaneWidthPx
        };
        document.body.classList.add('is-resizing-virtual-key');
        event.preventDefault();
      });
      window.addEventListener('mousemove', function (event) {
        var nextWidth;
        var maxLeft;
        if (!virtualKeyPaneDragState || !layout || isVirtualKeyLayoutStacked()) {
          if (virtualKeyPaneDragState) {
            virtualKeyPaneDragState = null;
            document.body.classList.remove('is-resizing-virtual-key');
          }
          return;
        }
        maxLeft = Math.max(340, layout.clientWidth - 460 - 18);
        nextWidth = virtualKeyPaneDragState.startWidth + (event.clientX - virtualKeyPaneDragState.startX);
        virtualKeyPaneWidthPx = Math.max(340, Math.min(maxLeft, nextWidth));
        renderVirtualKeyLayout();
      });
      window.addEventListener('mouseup', function () {
        if (!virtualKeyPaneDragState) {
          return;
        }
        virtualKeyPaneDragState = null;
        document.body.classList.remove('is-resizing-virtual-key');
      });
      window.addEventListener('resize', renderVirtualKeyLayout);
    }

    document.body.addEventListener('click', function (event) {
      var poolRow = event.target.closest('[data-vk-pool-row]');
      var poolSelect = event.target.closest('[data-vk-pool-select]');
      var poolToggleButton = event.target.closest('[data-vk-pool-toggle]');
      var poolConfigButton = event.target.closest('[data-vk-pool-config]');
      var poolDeleteButton = event.target.closest('[data-vk-pool-delete]');
      var keySelect = event.target.closest('[data-vk-select]');
      var keyToggleButton = event.target.closest('[data-vk-toggle]');
      var keyConfigButton = event.target.closest('[data-vk-config]');
      var keyDeleteButton = event.target.closest('[data-vk-delete]');
      var keyCopyButton = event.target.closest('[data-vk-copy]');
      var id;

      if (shouldIgnoreEditorDragReleaseClick(event)) {
        return;
      }

      if (poolSelect) {
        id = poolSelect.getAttribute('data-vk-pool-select');
        virtualKeyPoolSelection[id] = !!poolSelect.checked;
        renderVirtualKeyPools();
        return;
      }
      if (keySelect) {
        id = keySelect.getAttribute('data-vk-select');
        virtualKeySelection[id] = !!keySelect.checked;
        renderVirtualKeys();
        return;
      }
      if (poolRow && !event.target.closest('button') && !event.target.closest('input')) {
        id = poolRow.getAttribute('data-vk-pool-row');
        setActiveVirtualKeyPoolFilter(getActiveVirtualKeyPoolFilterRefs().length === 1 && getActiveVirtualKeyPoolFilterRefs()[0] === id ? [] : [id]);
        renderAll();
        return;
      }

      if (poolToggleButton) {
        id = poolToggleButton.getAttribute('data-vk-pool-toggle');
        if (state.virtualKeyPools[id]) {
          state.virtualKeyPools[id].enabled = state.virtualKeyPools[id].enabled === false;
          markDirty('toggle virtual key pool');
          renderAll();
        }
        return;
      }
      if (poolConfigButton) {
        id = poolConfigButton.getAttribute('data-vk-pool-config');
        openVirtualKeyPoolEditorForEdit(id);
        return;
      }
      if (poolDeleteButton) {
        id = poolDeleteButton.getAttribute('data-vk-pool-delete');
        if (deleteVirtualKeyPool(id, false)) {
          markDirty('delete virtual key pool');
          renderAll();
        }
        return;
      }
      if (keyCopyButton) {
        if (keyCopyButton.disabled) {
          return;
        }
        id = keyCopyButton.getAttribute('data-vk-copy');
        if (!transientVirtualKeySecrets[id] || !transientVirtualKeySecrets[id].fullKey) {
          return;
        }
        copyTextToClipboard(transientVirtualKeySecrets[id].fullKey).then(function () {
          setVirtualKeyCopyFeedback(id, true);
          scheduleVirtualKeyCopyFeedbackReset(id, renderVirtualKeys);
          renderVirtualKeys();
          showToast('Virtual Key copied.', 'success');
        }).catch(function () {
          showToast('Clipboard copy failed.', 'error');
        });
        return;
      }
      if (keyToggleButton) {
        id = keyToggleButton.getAttribute('data-vk-toggle');
        if (state.virtualKeys[id]) {
          state.virtualKeys[id].enabled = state.virtualKeys[id].enabled === false;
          markDirty('toggle virtual key');
          renderAll();
        }
        return;
      }
      if (keyConfigButton) {
        id = keyConfigButton.getAttribute('data-vk-config');
        openVirtualKeyEditorForEdit(id);
        return;
      }
      if (keyDeleteButton) {
        id = keyDeleteButton.getAttribute('data-vk-delete');
        if (deleteVirtualKey(id, false)) {
          markDirty('delete virtual key');
          renderAll();
        }
        return;
      }
    });
  }

  function bindClassifierActions() {
    document.addEventListener('click', function (event) {
      var button = event.target && event.target.closest ? event.target.closest('#testClassifierButton') : null;
      var classifier;
      var inputText;
      var apiKey;
      var missing = [];

      if (!button) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      renderClassifierTestPending('Preparing classifier test request...');

      classifier = syncActiveClassifierFromForm();
      inputText = getValue('classifier_test_input');
      apiKey = getValue('classifier_api_key').trim();
      if (normalizeClassifierMaxTokensForTest(classifier)) {
        showToast('Max Tokens was raised to 128 for this DeepSeek classifier test.', 'success');
      }

      if (!classifier) {
        showToast('No classifier selected.', 'error');
        renderClassifierTestResult({ message: 'No classifier selected.' }, true);
        return;
      }

      if (!classifier.schema_family) {
        missing.push('schema family');
      }
      if (!classifier.endpoint_url) {
        missing.push('endpoint URL');
      }
      if (!(classifier.candidate_tags || []).length) {
        missing.push('candidate tags');
      }
      if (!apiKey) {
        missing.push('API key');
      }

      if (classifier.classifier_type === 'classifier_llm') {
        if (!classifier.model_id) {
          missing.push('model ID');
        }
        if (!classifier.classifier_prompt) {
          missing.push('classifier prompt');
        }
      }

      if (classifier.classifier_type === 'classifier_nli' && !classifier.hypothesis_template) {
        missing.push('hypothesis template');
      }
      if (!inputText.trim()) {
        missing.push('test input');
      }

      if (missing.length) {
        showToast('Classifier test blocked: missing ' + missing.join(', ') + '.', 'error');
        renderClassifierTestResult({ message: 'Missing ' + missing.join(', ') + '.' }, true);
        return;
      }

      if (looksLikeEnvReference(apiKey)) {
        renderClassifierTestResult({ message: 'API Key must be pasted directly. ENV/Secret Ref is not supported.' }, true);
        showToast('API Key must be pasted directly, not ENV/Secret Ref.', 'error');
        return;
      }

      setSecretValue(classifier, apiKey);
      setButtonBusy('testClassifierButton', true, 'Testing...', 'Test Classifier');
      clearClassifierTestResult();

      renderClassifierTestPending('Sending request to classifier endpoint...');

      fetchWithTimeout(TEST_CLASSIFIER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'same-origin',
        body: buildUtf8JsonRequestBody({
          classifier_id: state.activeIds.classifier,
          classifier: classifier,
          input_text: inputText
        })
      }, 15000, 'Classifier test timed out.').then(parseJsonResponse).then(function (result) {
        var payload = result.payload || {};
        var error;
        if (!result.ok || payload.ok === false) {
          error = new Error(payload.message || 'Classifier test failed.');
          error.payload = payload;
          throw error;
        }
        renderClassifierTestResult(payload, false);
        showToast('Classifier test matched tag "' + (payload.tag || 'unknown') + '".', 'success');
      }).catch(function (error) {
        var payload = error && error.payload ? error.payload : { message: error.message || 'Classifier test failed.' };
        renderClassifierTestResult(payload, true);
        showToast(payload.message || 'Classifier test failed.', 'error');
      }).then(function () {
        setButtonBusy('testClassifierButton', false, 'Testing...', 'Test Classifier');
      });
    });
  }

  function bootstrap(sample) {
    var baseSource;
    sampleState = normalizeLoadedState(sample);
    baseSource = sampleState.meta && sampleState.meta.source ? sampleState.meta.source : 'deployed';
    if (!loadLocalDraft()) {
      loadState(sampleState, baseSource);
      clearDirty(baseSource);
    }
    bindNav();
    bindPageLocation();
    bindHelpTooltips();
    bindPointerOriginTracking();
    bindListSelection();
    bindToggles();
    bindSecretToggles();
    bindForms();
    bindDraftActions();
    bindStatusActions();
    bindClassifierActions();
    bindClassifierCreateAction();
    bindClassifierConfirmAction();
    bindListenerCreateAction();
    bindListenerConfirmAction();
    bindListenerAllowedPoolSelector();
    bindListenerListActions();
    bindBackendCreateAction();
    bindBackendConfirmAction();
    bindBackendListActions();
    bindBackendProbeAction();
    bindBackendSecretCopyAction();
    bindClassifierProbeAction();
    bindPolicyHeaderActions();
    bindPolicyConfirmAction();
    bindPolicyEntryActions();
    bindVirtualKeyActions();
    bindModelCredentialActions();
    renderAll();
    finishBootstrapShell();
    refreshPoolCatalog({ silent: true, force: true });
    refreshRuntimeStatus({ silent: true, force: true });
    startStatusPolling();
  }

  function refreshPoolCatalog(options) {
    var requestOptions = options || {};

    if (poolCatalogState.loading && !requestOptions.force) {
      return Promise.resolve(false);
    }

    poolCatalogState.loading = true;
    poolCatalogState.error = '';
    renderPoolCatalogControls();

    return window.fetch(POOLS_URL, {
      credentials: 'same-origin'
    }).then(parseJsonResponse).then(function (result) {
      var payload = result.payload || {};

      if (!result.ok || payload.ok === false) {
        throw new Error(payload.message || 'Pool catalog refresh failed.');
      }

      poolCatalogState.pools = Array.isArray(payload.pools) ? payload.pools : [];
      poolCatalogState.loaded = true;
      poolCatalogState.lastUpdatedAt = Date.now();
      poolCatalogState.error = '';
      return true;
    }).catch(function (error) {
      poolCatalogState.error = error.message || 'Pool catalog refresh failed.';
      if (requestOptions.manual || !requestOptions.silent) {
        showToast(poolCatalogState.error, 'error');
      }
      return false;
    }).then(function (didRefresh) {
      poolCatalogState.loading = false;
      if (state && state.activePage === 'backend') {
        renderBackendForm();
      } else if (state && state.activePage === 'classifier') {
        renderClassifierForm();
      } else {
        renderPoolCatalogControls();
      }
      if (didRefresh && requestOptions.manual) {
        showToast('BIG-IP pool list refreshed.', 'success');
      }
      return didRefresh;
    });
  }

  function refreshRuntimeStatus(options) {
    var requestOptions = options || {};

    if (runtimeStatusState.loading) {
      return Promise.resolve(false);
    }

    runtimeStatusState.loading = true;
    renderBackendRefreshButton(getActiveBackend(), state && state.ui ? state.ui.backendEditorMode : 'empty');

    return window.fetch(STATUS_URL, {
      credentials: 'same-origin'
    }).then(parseJsonResponse).then(function (result) {
      var payload = result.payload || {};
      var issueText;
      var normalizedStatus;

      if (!result.ok || payload.ok === false) {
        issueText = payload.message || 'Status refresh failed.';
        throw new Error(issueText);
      }

      normalizedStatus = normalizeStatusPayload(getStatusResponsePayload(payload));
      runtimeStatusState = {
        listeners: normalizedStatus.listeners,
        backendTargets: normalizedStatus.backendTargets,
        classifiers: normalizedStatus.classifiers,
        providerCredentialPools: normalizedStatus.providerCredentialPools,
        virtualKeys: normalizedStatus.virtualKeys,
        loading: true,
        lastUpdatedAt: Date.now()
      };
      renderRuntimeStatusOnly();
      return true;
    }).catch(function (error) {
      if (requestOptions.manual || !requestOptions.silent) {
        showToast(error.message || 'Status refresh failed.', 'error');
      }
      return false;
    }).then(function (didRefresh) {
      runtimeStatusState.loading = false;
      renderBackendRefreshButton(getActiveBackend(), state && state.ui ? state.ui.backendEditorMode : 'empty');
      if (didRefresh && requestOptions.manual) {
        showToast('Live status refreshed.', 'success');
      }
      return didRefresh;
    });
  }

  function startStatusPolling() {
    if (statusPollTimer) {
      window.clearInterval(statusPollTimer);
    }

    statusPollTimer = window.setInterval(function () {
      refreshRuntimeStatus({ silent: true });
    }, STATUS_POLL_INTERVAL_MS);
  }

  function loadSample() {
    return window.fetch(CONFIG_URL, {
      credentials: 'same-origin'
    }).then(function (response) {
      if (!response.ok) {
        throw new Error('Failed to load deployed configuration.');
      }
      return response.json();
    }).catch(function () {
      return window.fetch(SAMPLE_URL).then(function (response) {
        if (!response.ok) {
          throw new Error('Failed to load sample data.');
        }
        return response.json();
      });
    }).catch(function () {
      if (window.__AITO_SAMPLE_STATE__) {
        return clone(window.__AITO_SAMPLE_STATE__);
      }
      throw new Error('Failed to load sample data.');
    });
  }

  loadSample().then(function (sample) {
    bootstrap(sample);
  }).catch(function () {
    bootstrap({
      operatingMode: 'gateway',
      activeIds: {
        listener: '',
        classifier: '',
        backend: '',
        policy: '',
        ruleIndex: 0
      },
      listeners: {},
      classifiers: {},
      backendTargets: {},
      providerCredentialPools: {},
      virtualKeys: {},
      routingPolicies: {}
    });
    showToast('Sample data could not be loaded. Empty draft initialized.', 'error');
  });
}());
