'use strict';

var assert = require('assert');
var childProcess = require('child_process');
var fs = require('fs');
var configProcessor = require('../iapps-lx/ai-traffic-orchestrator/nodejs/configProcessor');
var deployHelper = require('../iapps-lx/ai-traffic-orchestrator/nodejs/deployHelper');
var testApi = deployHelper._test;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildBaseConfig() {
  return {
    operatingMode: 'gateway',
    listeners: {
      listener_main: {
        listener_name: 'listener_main',
        virtual_service: 'vs_main',
        vip: '10.10.10.10',
        port: 8080,
        policy_ref: 'policy_main',
        client_auth_type: 'none',
        allowed_virtual_key_pool_refs: [],
        status: {
          assigned_irule: 'llm_semantic_route_phase2'
        }
      }
    },
    classifiers: {
      classifier_main: {
        classifier_name: 'classifier_main',
        classifier_type: 'classifier_llm',
        schema_family: 'openai_chat_compatible',
        endpoint_url: 'https://classifier.example.local/v1/chat/completions',
        api_key: '',
        pool_name: '/Common/pool_classifier',
        model_id: 'classifier-model',
        classifier_prompt: 'Choose the best route tag.',
        candidate_tags: ['general'],
        fallback_tag: 'general'
      }
    },
    backendTargets: {
      backend_main: {
        backend_target_name: 'backend_main',
        schema_family: 'openai_chat_compatible',
        endpoint_url: 'http://backend.example.local/v1/chat/completions',
        api_key: '',
        model_id: 'backend-model',
        pool_name: '/Common/pool_backend'
      }
    },
    routingPolicies: {
      policy_main: {
        policy_type: 'routing',
        policy_name: 'policy_main',
        classifier_ref: 'classifier_main',
        default_rule: {
          action: 'route',
          backend_target_ref: 'backend_main',
          response_message: ''
        },
        rules: []
      }
    },
    virtualKeyPools: {},
    virtualKeys: {}
  };
}

function buildBaseKeyOnlyConfig() {
  var config = buildBaseConfig();

  config.routingPolicies.policy_main.routing_mode = 'key_only';
  config.routingPolicies.policy_main.classifier_ref = '';
  config.routingPolicies.policy_main.rules = [];
  config.routingPolicies.policy_main.key_rules = [
    {
      rule_name: 'pool_route',
      enabled: true,
      match: {
        virtual_key_pool_ref: 'pool_alpha'
      },
      action: 'route',
      backend_target_ref: 'backend_main',
      response_message: '',
      classifier_ref: ''
    }
  ];
  config.virtualKeyPools.pool_alpha = {
    pool_name: 'Pool Alpha',
    description: 'Allowlisted keys',
    enabled: true
  };
  config.virtualKeys.key_one = {
    kid: 'kid-one',
    tag: 'general',
    virtual_key_pool_ref: 'pool_alpha',
    enabled: true,
    secret_hash_alg: 'sha256',
    secret_hash: 'sha256:abcdef123456'
  };

  return config;
}

function assertAuthOnlyScopeClassification() {
  var previous = buildBaseConfig();
  var requested = clone(previous);
  var scope;

  requested.listeners.listener_main.client_auth_type = 'virtual_key';
  requested.listeners.listener_main.allowed_virtual_key_pool_refs = ['pool_alpha'];
  requested.virtualKeyPools.pool_alpha = {
    pool_name: 'Pool Alpha',
    description: 'Allowlisted keys',
    enabled: true
  };
  requested.virtualKeys.key_one = {
    kid: 'kid-one',
    tag: 'general',
    virtual_key_pool_ref: 'pool_alpha',
    enabled: true,
    secret_hash_alg: 'sha256',
    secret_hash: 'sha256:abcdef123456'
  };

  scope = testApi.classifyDeployScope(previous, requested);

  assert.strictEqual(scope.type, 'auth_data_groups_only');
  assert.deepStrictEqual(scope.changed_sections, ['virtual_keys', 'virtual_key_pools', 'listener_auth']);
  assert.deepStrictEqual(scope.changed_keys.virtual_keys, ['key_one']);
  assert.deepStrictEqual(scope.changed_keys.virtual_key_pools, ['pool_alpha']);
  assert.deepStrictEqual(scope.changed_keys.listener_auth, ['listener_main']);
  assert.strictEqual(scope.key_counts.virtual_keys.changed, 1);
  assert.strictEqual(scope.key_counts.virtual_key_pools.changed, 1);
  assert.strictEqual(scope.key_counts.listener_auth.changed, 1);
  assert.ok(scope.recommendations.indexOf('data_group_fast_path') >= 0);
  assert.ok(scope.recommendations.indexOf('tmsh_save_retained') >= 0);
  assert.ok(scope.recommendations.indexOf('no_ltm_virtual_apply') >= 0);
  assert.strictEqual(scope.recommendations.indexOf('full_apply_retained'), -1);
}

function assertListenerLtmScopeClassification() {
  var previous = buildBaseConfig();
  var requested = clone(previous);
  var scope;

  requested.listeners.listener_main.vip = '10.10.10.11';
  scope = testApi.classifyDeployScope(previous, requested);

  assert.strictEqual(scope.type, 'listener_ltm');
  assert.deepStrictEqual(scope.changed_sections, ['listener_ltm', 'classifier_egress']);
  assert.deepStrictEqual(scope.changed_keys.listener_ltm, ['listener_main']);
  assert.deepStrictEqual(scope.changed_keys.classifier_egress, ['classifier_main']);
  assert.ok(scope.recommendations.indexOf('listener_virtual_changes_detected') >= 0);
}

function assertListenerDisableScopeClassification() {
  var previous = buildBaseConfig();
  var requested = clone(previous);
  var scope;

  requested.listeners.listener_main.enabled = false;
  scope = testApi.classifyDeployScope(previous, requested);

  assert.strictEqual(scope.type, 'listener_ltm');
  assert.deepStrictEqual(scope.changed_sections, ['listener_ltm']);
  assert.deepStrictEqual(scope.changed_keys.listener_ltm, ['listener_main']);
  assert.ok(scope.recommendations.indexOf('listener_virtual_changes_detected') >= 0);
}

function assertClassifierEgressScopeClassification() {
  var previous = buildBaseConfig();
  var requested = clone(previous);
  var scope;

  requested.classifiers.classifier_main.endpoint_url = 'http://classifier.example.local/classify';
  scope = testApi.classifyDeployScope(previous, requested);

  assert.strictEqual(scope.type, 'classifier_egress');
  assert.deepStrictEqual(scope.changed_sections, ['classifiers', 'classifier_egress']);
  assert.deepStrictEqual(scope.changed_keys.classifiers, ['classifier_main']);
  assert.deepStrictEqual(scope.changed_keys.classifier_egress, ['classifier_main']);
  assert.ok(scope.recommendations.indexOf('classifier_egress_fast_path') >= 0);
  assert.ok(scope.recommendations.indexOf('classifier_egress_dg_irule_virtual_apply') >= 0);
  assert.ok(scope.recommendations.indexOf('no_listener_virtual_apply') >= 0);
  assert.ok(scope.recommendations.indexOf('no_virtual_key_data_group_apply') >= 0);
}

function assertUnknownScopeClassification() {
  var previous = buildBaseConfig();
  var requested = clone(previous);
  var scope;

  requested.listeners.listener_main.advanced = {
    future_runtime_knob: 'not-supported-yet'
  };
  scope = testApi.classifyDeployScope(previous, requested);

  assert.strictEqual(scope.type, 'unknown');
  assert.deepStrictEqual(scope.changed_sections, ['unknown']);
  assert.deepStrictEqual(scope.changed_keys.unknown, ['listener:listener_main']);
  assert.ok(scope.recommendations.indexOf('review_unknown_change_before_fast_path') >= 0);
}

function assertListenerSettingsScopeClassification() {
  var previous = buildBaseConfig();
  var requested = clone(previous);
  var scope;

  previous.listeners.listener_main.advanced = {
    decision_timeout_ms: 3000,
    max_payload_bytes: 65535,
    request_id_mode: 'auto'
  };
  requested.listeners.listener_main.advanced = {
    decision_timeout_ms: 3500,
    max_payload_bytes: 65535,
    request_id_mode: 'auto'
  };
  scope = testApi.classifyDeployScope(previous, requested);

  assert.strictEqual(scope.type, 'listener_data_groups_only');
  assert.deepStrictEqual(scope.changed_sections, ['listener_settings']);
  assert.deepStrictEqual(scope.changed_keys.listener_settings, ['listener_main']);
  assert.ok(scope.recommendations.indexOf('data_group_fast_path') >= 0);
  assert.ok(scope.recommendations.indexOf('tmsh_save_retained') >= 0);
  assert.ok(scope.recommendations.indexOf('no_ifile_publish') >= 0);
}

function assertRuntimeArtifactsOnlyScopeClassification() {
  var previous = buildBaseConfig();
  var requested = clone(previous);
  var scope;

  requested.routingPolicies.policy_main.rules = [
    {
      rule_name: 'general_response',
      source_tag: 'general',
      action: 'respond',
      backend_target_ref: '',
      response_message: 'handled locally',
      enabled: true
    }
  ];
  scope = testApi.classifyDeployScope(previous, requested);

  assert.strictEqual(scope.type, 'runtime_artifacts_only');
  assert.deepStrictEqual(scope.changed_sections, ['routing_policies']);
  assert.deepStrictEqual(scope.changed_keys.routing_policies, ['policy_main']);
  assert.ok(scope.recommendations.indexOf('runtime_artifacts_fast_path') >= 0);
  assert.ok(scope.recommendations.indexOf('publish_active_native_files') >= 0);
  assert.ok(scope.recommendations.indexOf('no_tmsh_save') >= 0);
  assert.ok(scope.recommendations.indexOf('no_ilx_restart') >= 0);
  assert.strictEqual(scope.recommendations.indexOf('full_apply_retained'), -1);
}

function assertProviderCredentialPoolsScopeClassification() {
  var previous = buildBaseConfig();
  var requested = clone(previous);
  var scope;

  requested.providerCredentialPools = {
    pool_openai: {
      pool_name: 'OpenAI Pool',
      selection_mode: 'priority_failover',
      entries: [
        {
          credential_id: 'cred_a',
          enabled: true,
          priority: 100,
          api_key: 'sk-primary'
        }
      ]
    }
  };

  scope = testApi.classifyDeployScope(previous, requested);

  assert.strictEqual(scope.type, 'runtime_artifacts_only');
  assert.deepStrictEqual(scope.changed_sections, ['provider_credential_pools']);
  assert.deepStrictEqual(scope.changed_keys.provider_credential_pools, ['pool_openai']);
  assert.ok(scope.recommendations.indexOf('runtime_artifacts_fast_path') >= 0);
}

function assertBackendCredentialPoolReferenceScopeClassification() {
  var previous = buildBaseConfig();
  var requested = clone(previous);
  var scope;

  requested.providerCredentialPools = {
    pool_openai: {
      pool_name: 'OpenAI Pool',
      selection_mode: 'priority_failover',
      entries: [
        {
          credential_id: 'cred_a',
          enabled: true,
          priority: 100,
          api_key: 'sk-primary'
        }
      ]
    }
  };
  delete requested.backendTargets.backend_main.api_key;
  requested.backendTargets.backend_main.credential_pool_ref = 'pool_openai';

  scope = testApi.classifyDeployScope(previous, requested);

  assert.strictEqual(scope.type, 'runtime_artifacts_only');
  assert.deepStrictEqual(scope.changed_sections, ['backend_targets', 'provider_credential_pools']);
  assert.deepStrictEqual(scope.changed_keys.backend_targets, ['backend_main']);
  assert.deepStrictEqual(scope.changed_keys.provider_credential_pools, ['pool_openai']);
  assert.ok(scope.recommendations.indexOf('publish_active_native_files') >= 0);
  assert.ok(scope.recommendations.indexOf('no_tmsh_save') >= 0);
}

function assertKeyOnlyRoutingPolicyStaysRuntimeArtifactsOnlyWithoutClassifierRefs() {
  var previous = buildBaseKeyOnlyConfig();
  var requested = clone(previous);
  var scope;

  requested.routingPolicies.policy_main.key_rules[0].response_message = 'route if needed';
  requested.routingPolicies.policy_main.key_rules.push({
    rule_name: 'tag_response',
    enabled: true,
    match: {
      virtual_key_tag: 'vip'
    },
    action: 'respond',
    backend_target_ref: '',
    response_message: 'handled by key rule',
    classifier_ref: ''
  });
  scope = testApi.classifyDeployScope(previous, requested);

  assert.strictEqual(scope.type, 'runtime_artifacts_only');
  assert.deepStrictEqual(scope.changed_sections, ['routing_policies']);
  assert.deepStrictEqual(scope.changed_keys.routing_policies, ['policy_main']);
  assert.deepStrictEqual(scope.changed_keys.classifier_egress, []);
}

function assertKeyOnlyStalePolicyClassifierAliasDoesNotDirtyScope() {
  var previous = buildBaseKeyOnlyConfig();
  var requested = clone(previous);
  var scope;

  previous.routingPolicies.policy_main.classifierRef = 'classifier_main';
  previous.listeners.listener_main.classifier_ref = 'classifier_main';
  previous.listeners.listener_main.classifierRef = 'classifier_main';
  delete previous.routingPolicies.policy_main.classifier_ref;

  scope = testApi.classifyDeployScope(previous, requested);

  assert.strictEqual(scope.type, 'none');
  assert.deepStrictEqual(scope.changed_sections, []);
  assert.deepStrictEqual(scope.changed_keys.routing_policies, []);
  assert.ok(scope.recommendations.indexOf('no_change_detected') >= 0);
}

function assertKeyOnlyClassifyRuleTriggersClassifierEgressScope() {
  var previous = buildBaseKeyOnlyConfig();
  var requested = clone(previous);
  var scope;

  requested.routingPolicies.policy_main.key_rules[0] = {
    rule_name: 'pool_classify',
    enabled: true,
    match: {
      virtual_key_pool_ref: 'pool_alpha'
    },
    action: 'classify',
    backend_target_ref: '',
    response_message: '',
    classifier_ref: 'classifier_main'
  };
  scope = testApi.classifyDeployScope(previous, requested);

  assert.strictEqual(scope.type, 'classifier_egress');
  assert.deepStrictEqual(scope.changed_sections, ['routing_policies', 'classifier_egress']);
  assert.deepStrictEqual(scope.changed_keys.routing_policies, ['policy_main']);
  assert.deepStrictEqual(scope.changed_keys.classifier_egress, ['classifier_main']);
}

function assertBackendTargetNameOnlyScopeClassification() {
  var previous = buildBaseConfig();
  var requested = clone(previous);
  var scope;

  requested.backendTargets.backend_main.backend_target_name = 'backend_main_renamed';
  scope = testApi.classifyDeployScope(previous, requested);

  assert.strictEqual(scope.type, 'runtime_artifacts_only');
  assert.deepStrictEqual(scope.changed_sections, ['backend_targets']);
  assert.deepStrictEqual(scope.changed_keys.backend_targets, ['backend_main']);
  assert.ok(scope.recommendations.indexOf('runtime_artifacts_fast_path') >= 0);
  assert.ok(scope.recommendations.indexOf('publish_active_native_files') >= 0);
  assert.ok(scope.recommendations.indexOf('no_tmsh_save') >= 0);
  assert.ok(scope.recommendations.indexOf('no_ilx_restart') >= 0);
  assert.strictEqual(scope.recommendations.indexOf('full_apply_retained'), -1);
}

function assertClassifierRuntimeOnlyScopeClassification() {
  var previous = buildBaseConfig();
  var requested = clone(previous);
  var scope;

  requested.classifiers.classifier_main.classifier_prompt = 'Choose one tag and return compact JSON only.';
  requested.classifiers.classifier_main.model_id = 'classifier-model-v2';
  requested.classifiers.classifier_main.api_key = 'sk-classifier-test';
  scope = testApi.classifyDeployScope(previous, requested);

  assert.strictEqual(scope.type, 'runtime_artifacts_only');
  assert.deepStrictEqual(scope.changed_sections, ['classifiers']);
  assert.deepStrictEqual(scope.changed_keys.classifiers, ['classifier_main']);
  assert.ok(scope.recommendations.indexOf('runtime_artifacts_fast_path') >= 0);
  assert.ok(scope.recommendations.indexOf('publish_active_native_files') >= 0);
  assert.ok(scope.recommendations.indexOf('no_tmsh_save') >= 0);
  assert.ok(scope.recommendations.indexOf('no_ilx_restart') >= 0);
  assert.strictEqual(scope.recommendations.indexOf('full_apply_retained'), -1);
}

function assertBackendEndpointTlsUpgradeScopeClassification() {
  var previous = buildBaseConfig();
  var requested = clone(previous);
  var scope;

  requested.backendTargets.backend_main.endpoint_url = 'https://backend.example.local/v1/chat/completions';
  scope = testApi.classifyDeployScope(previous, requested);

  assert.strictEqual(scope.type, 'listener_ltm');
  assert.deepStrictEqual(scope.changed_sections, ['listener_ltm', 'backend_targets']);
  assert.deepStrictEqual(scope.changed_keys.listener_ltm, ['listener_main']);
  assert.deepStrictEqual(scope.changed_keys.backend_targets, ['backend_main']);
  assert.ok(scope.recommendations.indexOf('listener_virtual_changes_detected') >= 0);
  assert.ok(scope.recommendations.indexOf('runtime_artifacts_changed') >= 0);
  assert.strictEqual(scope.recommendations.indexOf('runtime_artifacts_fast_path'), -1);
}

function assertClassifierBypassScopeExcludedFromRuntimeArtifactsOnly() {
  var previous = buildBaseConfig();
  var requested = clone(previous);
  var scope;

  requested.classifiers.classifier_main.bypass_enabled = true;
  scope = testApi.classifyDeployScope(previous, requested);

  assert.strictEqual(scope.type, 'classifier_egress');
  assert.deepStrictEqual(scope.changed_sections, ['classifiers', 'classifier_egress']);
  assert.deepStrictEqual(scope.changed_keys.classifiers, ['classifier_main']);
  assert.deepStrictEqual(scope.changed_keys.classifier_egress, ['classifier_main']);
  assert.strictEqual(scope.recommendations.indexOf('runtime_artifacts_fast_path'), -1);
  assert.ok(scope.recommendations.indexOf('classifier_egress_fast_path') >= 0);
  assert.ok(scope.recommendations.indexOf('classifier_egress_dg_irule_virtual_apply') >= 0);
  assert.ok(scope.recommendations.indexOf('no_listener_virtual_apply') >= 0);
}

function assertStreamingOnlyScopeClassification() {
  var previous = buildBaseConfig();
  var requested = clone(previous);
  var scope;

  previous.listeners.listener_main.streaming = true;
  requested.listeners.listener_main.streaming = false;
  scope = testApi.classifyDeployScope(previous, requested);

  assert.strictEqual(scope.type, 'none');
  assert.deepStrictEqual(scope.changed_sections, []);
  assert.ok(scope.recommendations.indexOf('no_change_detected') >= 0);
  assert.ok(scope.recommendations.indexOf('no_runtime_apply') >= 0);
  assert.strictEqual(scope.recommendations.indexOf('full_apply_retained'), -1);
}

function assertDataGroupFastPathScriptIsMinimal() {
  var script = testApi.buildDataGroupFastPathApplyScript(
    {
      type: 'auth_data_groups_only',
      changed_sections: ['virtual_keys', 'virtual_key_pools', 'listener_auth']
    },
    {
      vs_main: 'listener_main',
      '/Common/vs_main': 'listener_main'
    },
    {
      'listener_main.client_auth_type': 'virtual_key'
    },
    {
      'listener_main~pool_alpha': 'enabled'
    },
    {
      kid_one: 'enabled,pool_alpha,general,sha256,abc'
    },
    {
      pool_alpha: 'enabled,Pool Alpha'
    },
    {
      exists: false,
      records: {}
    }
  );

  assert.ok(script.indexOf('/Common/dg_ai_gateway_listener_settings') >= 0);
  assert.strictEqual(script.indexOf('/Common/dg_ai_gateway_listener_refs'), -1);
  assert.ok(script.indexOf('/Common/dg_ai_gateway_listener_vk_pool_allowlist') >= 0);
  assert.ok(script.indexOf('/Common/dg_ai_gateway_virtual_keys') >= 0);
  assert.ok(script.indexOf('/Common/dg_ai_gateway_virtual_key_pools') >= 0);
  assert.ok(script.indexOf('tmsh save sys config') >= 0);
  assert.strictEqual(script.indexOf('restart_ilx_plugin'), -1);
  assert.strictEqual(script.indexOf('publish_plugin_store_file'), -1);
  assert.strictEqual(script.indexOf('tmsh modify ltm virtual'), -1);
  assert.strictEqual(script.indexOf('tmsh create ltm virtual'), -1);
  assert.strictEqual(script.indexOf('sys file ifile'), -1);
}

function assertRuntimeArtifactsFastPathScriptIsMinimal() {
  var script = testApi.buildRuntimeArtifactsFastPathApplyScript(testApi.buildNativeFileSpecs({
    ifiles: {
      classifiers: {
        name: '/Common/ifile_ai_gateway_classifiers.json'
      },
      backend_targets: {
        name: '/Common/ifile_ai_gateway_backend_targets.json'
      },
      routing_policies: {
        name: '/Common/ifile_ai_gateway_routing_policies.json'
      },
      config_snapshot: {
        name: '/Common/ifile_ai_gateway_config_snapshot.json'
      }
    }
  }));

  assert.ok(script.indexOf('publish_native_file') >= 0);
  assert.ok(script.indexOf('publish_plugin_store_file') >= 0);
  assert.ok(script.indexOf('ifile_ai_gateway_routing_policies.json') >= 0);
  assert.ok(script.indexOf('ifile_ai_gateway_config_snapshot.json') >= 0);
  assert.strictEqual(script.indexOf('tmsh save sys config'), -1);
  assert.strictEqual(script.indexOf('restart_ilx_plugin'), -1);
  assert.strictEqual(script.indexOf('sys file ifile'), -1);
  assert.strictEqual(script.indexOf('tmsh modify ltm virtual'), -1);
  assert.strictEqual(script.indexOf('tmsh create ltm virtual'), -1);
  assert.strictEqual(script.indexOf('ltm data-group'), -1);
}

function assertListenerSettingsFastPathScriptIsMinimal() {
  var script = testApi.buildDataGroupFastPathApplyScript(
    {
      type: 'listener_data_groups_only',
      changed_sections: ['listener_settings']
    },
    {
      vs_main: 'listener_main',
      '/Common/vs_main': 'listener_main'
    },
    {
      'listener_main.max_payload_bytes': '70000',
      'listener_main.request_id_mode': 'preserve'
    },
    {},
    {},
    {},
    {
      exists: false,
      records: {}
    }
  );

  assert.ok(script.indexOf('/Common/dg_ai_gateway_listener_refs') >= 0);
  assert.ok(script.indexOf('/Common/dg_ai_gateway_listener_settings') >= 0);
  assert.strictEqual(script.indexOf('/Common/dg_ai_gateway_listener_vk_pool_allowlist'), -1);
  assert.strictEqual(script.indexOf('/Common/dg_ai_gateway_virtual_keys'), -1);
  assert.strictEqual(script.indexOf('/Common/dg_ai_gateway_virtual_key_pools'), -1);
  assert.ok(script.indexOf('tmsh save sys config') >= 0);
  assert.strictEqual(script.indexOf('restart_ilx_plugin'), -1);
  assert.strictEqual(script.indexOf('publish_plugin_store_file'), -1);
  assert.strictEqual(script.indexOf('tmsh modify ltm virtual'), -1);
  assert.strictEqual(script.indexOf('tmsh create ltm virtual'), -1);
  assert.strictEqual(script.indexOf('sys file ifile'), -1);
}

function assertListenerEnabledStateIsAppliedToVirtualServer() {
  var previous = buildBaseConfig();
  var requested = clone(previous);
  var normalizedPrevious;
  var normalizedRequested;
  var previousDesiredState;
  var requestedDesiredState;
  var artifacts;
  var script;

  requested.listeners.listener_main.enabled = false;
  normalizedPrevious = configProcessor.normalizeBlock(previous);
  normalizedRequested = configProcessor.normalizeBlock(requested);
  previousDesiredState = testApi.buildDesiredState(normalizedPrevious);
  requestedDesiredState = testApi.buildDesiredState(normalizedRequested, previousDesiredState);
  artifacts = configProcessor.buildArtifacts(requested);

  script = testApi.buildApplyScript(
    requestedDesiredState,
    previousDesiredState,
    artifacts.dataGroups.listener_refs.records,
    artifacts.dataGroups.listener_settings.records,
    artifacts.dataGroups.listener_virtual_key_pool_allowlist.records,
    artifacts.dataGroups.virtual_keys.records,
    artifacts.dataGroups.virtual_key_pools.records,
    {
      exists: false,
      records: {}
    },
    testApi.buildNativeFileSpecs(artifacts)
  );

  assert.ok(script.indexOf('tmsh modify ltm virtual /Common/vs_main disabled') >= 0);
  assert.strictEqual(script.indexOf('tmsh delete ltm virtual /Common/vs_main'), -1);
  assert.ok(script.indexOf('tmsh modify ltm virtual /Common/vs_main enabled') < 0);
}

function withStubbedExecFileSync(stub, fn) {
  var original = childProcess.execFileSync;
  var originalExistsSync = fs.existsSync;

  try {
    childProcess.execFileSync = stub;
    fs.existsSync = function (targetPath) {
      if (targetPath === deployHelper.APP_ROOT) {
        return true;
      }
      return originalExistsSync.apply(fs, arguments);
    };
    return fn();
  } finally {
    childProcess.execFileSync = original;
    fs.existsSync = originalExistsSync;
  }
}

function createFastPathExecStub(capturedScripts) {
  return function (command, args) {
    var scriptPath = args[3];
    var script = fs.readFileSync(scriptPath, 'utf8');

    capturedScripts.push(script);

    if (script.indexOf('list ltm pool recursive one-line') >= 0) {
      return [
        'ltm pool /Common/pool_backend { members { } }',
        'ltm pool /Common/pool_classifier { members { } }'
      ].join('\n');
    }

    if (script.indexOf('list ltm virtual recursive one-line') >= 0) {
      return '';
    }

    if (script.indexOf('list ltm data-group internal ' + testApi.VIRTUAL_KEYS_DG + ' one-line') >= 0) {
      return 'The requested value list /Common/dg_ai_gateway_virtual_keys was not found';
    }

    if (script.indexOf('emit_section') >= 0) {
      return '';
    }

    if (script.indexOf('publish_plugin_store_file') >= 0 && script.indexOf('sys file ifile') < 0) {
      return 'RUNTIME_ARTIFACTS_FAST_PATH_OK\n';
    }

    if (script.indexOf('tmsh save sys config') >= 0) {
      return 'FAST_PATH_OK\n';
    }

    return '';
  };
}

function assertAuthDataGroupFastPathApplyProfile() {
  var previous = buildBaseConfig();
  var requested = clone(previous);
  var originalContent = null;
  var response;
  var capturedScripts = [];
  var appliedScript;

  requested.listeners.listener_main.client_auth_type = 'virtual_key';
  requested.listeners.listener_main.allowed_virtual_key_pool_refs = ['pool_alpha'];
  requested.virtualKeyPools.pool_alpha = {
    pool_name: 'Pool Alpha',
    description: 'Allowlisted keys',
    enabled: true
  };
  requested.virtualKeys.key_one = {
    kid: 'kid-one',
    tag: 'general',
    virtual_key_pool_ref: 'pool_alpha',
    enabled: true,
    secret_hash_alg: 'sha256',
    secret_hash: 'sha256:abcdef123456'
  };

  fs.mkdirSync(deployHelper.RUNTIME_DIR, {
    recursive: true
  });

  if (fs.existsSync(deployHelper.DEPLOYED_CONFIG_FILE)) {
    originalContent = fs.readFileSync(deployHelper.DEPLOYED_CONFIG_FILE, 'utf8');
  }

  try {
    fs.writeFileSync(deployHelper.DEPLOYED_CONFIG_FILE, JSON.stringify(previous, null, 2));
    response = withStubbedExecFileSync(createFastPathExecStub(capturedScripts), function () {
      return deployHelper.applyConfig(requested);
    });
    appliedScript = capturedScripts.filter(function (script) {
      return script.indexOf('tmsh save sys config') >= 0 &&
        script.indexOf('list ltm pool recursive one-line') < 0 &&
        script.indexOf('emit_section') < 0;
    }).pop() || '';

    assert.strictEqual(response.ok, true);
    assert.strictEqual(response.profile.scope.type, 'auth_data_groups_only');
    assert.deepStrictEqual(response.profile.steps.map(function (step) {
      return step.name;
    }), [
      'validate_config',
      'normalize_block',
      'build_desired_state',
      'validate_pools',
      'validate_virtual_destinations',
      'build_artifacts',
      'inspect_virtual_key_dg',
      'build_data_group_fast_path_script',
      'run_data_group_fast_path_apply',
      'write_deployed_config',
      'cleanup'
    ]);
    assert.ok(/FAST_PATH_OK/.test(String(response.output || '')));
    assert.ok(appliedScript.indexOf('/Common/dg_ai_gateway_listener_settings') >= 0);
    assert.strictEqual(appliedScript.indexOf('/Common/dg_ai_gateway_listener_refs'), -1);
    assert.ok(appliedScript.indexOf('/Common/dg_ai_gateway_listener_vk_pool_allowlist') >= 0);
    assert.ok(appliedScript.indexOf('/Common/dg_ai_gateway_virtual_keys') >= 0);
    assert.ok(appliedScript.indexOf('/Common/dg_ai_gateway_virtual_key_pools') >= 0);
    assert.strictEqual(appliedScript.indexOf('publish_plugin_store_file'), -1);
    assert.strictEqual(appliedScript.indexOf('restart_ilx_plugin'), -1);
    assert.strictEqual(appliedScript.indexOf('sys file ifile'), -1);
  } finally {
    if (originalContent === null) {
      try {
        fs.unlinkSync(deployHelper.DEPLOYED_CONFIG_FILE);
      } catch (error) {
        if (!error || error.code !== 'ENOENT') {
          throw error;
        }
      }
    } else {
      fs.writeFileSync(deployHelper.DEPLOYED_CONFIG_FILE, originalContent);
    }
  }
}

function assertListenerSettingsFastPathApplyProfile() {
  var previous = buildBaseConfig();
  var requested = clone(previous);
  var originalContent = null;
  var response;
  var capturedScripts = [];
  var appliedScript;

  requested.listeners.listener_main.advanced = {
    max_payload_bytes: 70000,
    decision_timeout_ms: 3500,
    request_id_mode: 'preserve'
  };
  requested.listeners.listener_main.runtime_paths = {
    root_paths: ['/'],
    model_paths: ['/v1/models'],
    chat_paths: ['/v1/chat/completions'],
    responses_paths: ['/v1/responses']
  };
  requested.listeners.listener_main.status = {
    assigned_irule: 'llm_semantic_route_phase2',
    northbound_api_mode: 'OpenAI-compatible',
    chat_completions_support: 'full',
    responses_support: 'partial'
  };

  fs.mkdirSync(deployHelper.RUNTIME_DIR, {
    recursive: true
  });

  if (fs.existsSync(deployHelper.DEPLOYED_CONFIG_FILE)) {
    originalContent = fs.readFileSync(deployHelper.DEPLOYED_CONFIG_FILE, 'utf8');
  }

  try {
    fs.writeFileSync(deployHelper.DEPLOYED_CONFIG_FILE, JSON.stringify(previous, null, 2));
    response = withStubbedExecFileSync(createFastPathExecStub(capturedScripts), function () {
      return deployHelper.applyConfig(requested);
    });
    appliedScript = capturedScripts.filter(function (script) {
      return script.indexOf('tmsh save sys config') >= 0 &&
        script.indexOf('list ltm pool recursive one-line') < 0 &&
        script.indexOf('emit_section') < 0;
    }).pop() || '';

    assert.strictEqual(response.ok, true);
    assert.strictEqual(response.profile.scope.type, 'listener_data_groups_only');
    assert.deepStrictEqual(response.profile.steps.map(function (step) {
      return step.name;
    }), [
      'validate_config',
      'normalize_block',
      'build_desired_state',
      'validate_pools',
      'validate_virtual_destinations',
      'build_artifacts',
      'build_data_group_fast_path_script',
      'run_data_group_fast_path_apply',
      'write_deployed_config',
      'cleanup'
    ]);
    assert.ok(/FAST_PATH_OK/.test(String(response.output || '')));
    assert.ok(appliedScript.indexOf('/Common/dg_ai_gateway_listener_refs') >= 0);
    assert.ok(appliedScript.indexOf('/Common/dg_ai_gateway_listener_settings') >= 0);
    assert.strictEqual(appliedScript.indexOf('/Common/dg_ai_gateway_listener_vk_pool_allowlist'), -1);
    assert.strictEqual(appliedScript.indexOf('/Common/dg_ai_gateway_virtual_keys'), -1);
    assert.strictEqual(appliedScript.indexOf('/Common/dg_ai_gateway_virtual_key_pools'), -1);
    assert.strictEqual(appliedScript.indexOf('publish_plugin_store_file'), -1);
    assert.strictEqual(appliedScript.indexOf('restart_ilx_plugin'), -1);
    assert.strictEqual(appliedScript.indexOf('sys file ifile'), -1);
  } finally {
    if (originalContent === null) {
      try {
        fs.unlinkSync(deployHelper.DEPLOYED_CONFIG_FILE);
      } catch (error) {
        if (!error || error.code !== 'ENOENT') {
          throw error;
        }
      }
    } else {
      fs.writeFileSync(deployHelper.DEPLOYED_CONFIG_FILE, originalContent);
    }
  }
}

function assertRuntimeArtifactsFastPathApplyProfile() {
  var previous = buildBaseConfig();
  var requested = clone(previous);
  var originalContent = null;
  var response;
  var capturedScripts = [];
  var appliedScript;

  requested.routingPolicies.policy_main.rules = [
    {
      rule_name: 'general_response',
      source_tag: 'general',
      action: 'respond',
      backend_target_ref: '',
      response_message: 'handled locally',
      enabled: true
    }
  ];

  fs.mkdirSync(deployHelper.RUNTIME_DIR, {
    recursive: true
  });

  if (fs.existsSync(deployHelper.DEPLOYED_CONFIG_FILE)) {
    originalContent = fs.readFileSync(deployHelper.DEPLOYED_CONFIG_FILE, 'utf8');
  }

  try {
    fs.writeFileSync(deployHelper.DEPLOYED_CONFIG_FILE, JSON.stringify(previous, null, 2));
    response = withStubbedExecFileSync(createFastPathExecStub(capturedScripts), function () {
      return deployHelper.applyConfig(requested);
    });
    appliedScript = capturedScripts.filter(function (script) {
      return script.indexOf('publish_plugin_store_file') >= 0 &&
        script.indexOf('sys file ifile') < 0 &&
        script.indexOf('list ltm pool recursive one-line') < 0 &&
        script.indexOf('emit_section') < 0;
    }).pop() || '';

    assert.strictEqual(response.ok, true);
    assert.strictEqual(response.profile.scope.type, 'runtime_artifacts_only');
    assert.deepStrictEqual(response.profile.steps.map(function (step) {
      return step.name;
    }), [
      'validate_config',
      'normalize_block',
      'build_desired_state',
      'validate_pools',
      'validate_virtual_destinations',
      'build_artifacts',
      'write_runtime_files',
      'build_runtime_artifacts_fast_path_script',
      'run_runtime_artifacts_fast_path_apply',
      'write_deployed_config',
      'cleanup'
    ]);
    assert.ok(/RUNTIME_ARTIFACTS_FAST_PATH_OK/.test(String(response.output || '')));
    assert.ok(appliedScript.indexOf('publish_native_file') >= 0);
    assert.ok(appliedScript.indexOf('publish_plugin_store_file') >= 0);
    assert.ok(appliedScript.indexOf('ifile_ai_gateway_routing_policies.json') >= 0);
    assert.ok(appliedScript.indexOf('ifile_ai_gateway_config_snapshot.json') >= 0);
    assert.strictEqual(appliedScript.indexOf('tmsh save sys config'), -1);
    assert.strictEqual(appliedScript.indexOf('restart_ilx_plugin'), -1);
    assert.strictEqual(appliedScript.indexOf('sys file ifile'), -1);
    assert.strictEqual(appliedScript.indexOf('tmsh modify ltm virtual'), -1);
    assert.strictEqual(appliedScript.indexOf('tmsh create ltm virtual'), -1);
    assert.strictEqual(appliedScript.indexOf('ltm data-group'), -1);
    assert.strictEqual(response.profile.steps.map(function (step) {
      return step.name;
    }).indexOf('run_apply_script'), -1);
  } finally {
    if (originalContent === null) {
      try {
        fs.unlinkSync(deployHelper.DEPLOYED_CONFIG_FILE);
      } catch (error) {
        if (!error || error.code !== 'ENOENT') {
          throw error;
        }
      }
    } else {
      fs.writeFileSync(deployHelper.DEPLOYED_CONFIG_FILE, originalContent);
    }
  }
}

function assertBackendTargetsRuntimeArtifactsFastPathApplyProfile() {
  var previous = buildBaseConfig();
  var requested = clone(previous);
  var originalContent = null;
  var response;
  var capturedScripts = [];
  var appliedScript;

  requested.backendTargets.backend_main.model_id = 'backend-model-v2';
  requested.backendTargets.backend_main.api_key = 'sk-test';
  requested.backendTargets.backend_main.backend_prompt = 'Prefer concise JSON output.';

  fs.mkdirSync(deployHelper.RUNTIME_DIR, {
    recursive: true
  });

  if (fs.existsSync(deployHelper.DEPLOYED_CONFIG_FILE)) {
    originalContent = fs.readFileSync(deployHelper.DEPLOYED_CONFIG_FILE, 'utf8');
  }

  try {
    fs.writeFileSync(deployHelper.DEPLOYED_CONFIG_FILE, JSON.stringify(previous, null, 2));
    response = withStubbedExecFileSync(createFastPathExecStub(capturedScripts), function () {
      return deployHelper.applyConfig(requested);
    });
    appliedScript = capturedScripts.filter(function (script) {
      return script.indexOf('publish_plugin_store_file') >= 0 &&
        script.indexOf('sys file ifile') < 0 &&
        script.indexOf('list ltm pool recursive one-line') < 0 &&
        script.indexOf('emit_section') < 0;
    }).pop() || '';

    assert.strictEqual(response.ok, true);
    assert.strictEqual(response.profile.scope.type, 'runtime_artifacts_only');
    assert.deepStrictEqual(response.profile.steps.map(function (step) {
      return step.name;
    }), [
      'validate_config',
      'normalize_block',
      'build_desired_state',
      'validate_pools',
      'validate_virtual_destinations',
      'build_artifacts',
      'write_runtime_files',
      'build_runtime_artifacts_fast_path_script',
      'run_runtime_artifacts_fast_path_apply',
      'write_deployed_config',
      'cleanup'
    ]);
    assert.ok(/RUNTIME_ARTIFACTS_FAST_PATH_OK/.test(String(response.output || '')));
    assert.ok(appliedScript.indexOf('publish_native_file') >= 0);
    assert.ok(appliedScript.indexOf('publish_plugin_store_file') >= 0);
    assert.ok(appliedScript.indexOf('ifile_ai_gateway_backend_targets.json') >= 0);
    assert.strictEqual(appliedScript.indexOf('tmsh save sys config'), -1);
    assert.strictEqual(appliedScript.indexOf('restart_ilx_plugin'), -1);
    assert.strictEqual(appliedScript.indexOf('sys file ifile'), -1);
    assert.strictEqual(appliedScript.indexOf('ltm data-group'), -1);
    assert.strictEqual(response.profile.steps.map(function (step) {
      return step.name;
    }).indexOf('run_apply_script'), -1);
    assert.strictEqual(response.profile.steps.map(function (step) {
      return step.name;
    }).indexOf('inspect_virtual_key_dg'), -1);
  } finally {
    if (originalContent === null) {
      try {
        fs.unlinkSync(deployHelper.DEPLOYED_CONFIG_FILE);
      } catch (error) {
        if (!error || error.code !== 'ENOENT') {
          throw error;
        }
      }
    } else {
      fs.writeFileSync(deployHelper.DEPLOYED_CONFIG_FILE, originalContent);
    }
  }
}

function assertClassifierRuntimeOnlyApplyUsesRuntimeArtifactsFastPath() {
  var previous = buildBaseConfig();
  var requested = clone(previous);
  var originalContent = null;
  var response;
  var capturedScripts = [];
  var appliedScript;

  requested.classifiers.classifier_main.classifier_prompt = 'Choose the best route tag and return JSON only.';
  requested.classifiers.classifier_main.model_id = 'classifier-model-v2';
  requested.classifiers.classifier_main.api_key = 'sk-classifier-test';

  fs.mkdirSync(deployHelper.RUNTIME_DIR, {
    recursive: true
  });

  if (fs.existsSync(deployHelper.DEPLOYED_CONFIG_FILE)) {
    originalContent = fs.readFileSync(deployHelper.DEPLOYED_CONFIG_FILE, 'utf8');
  }

  try {
    fs.writeFileSync(deployHelper.DEPLOYED_CONFIG_FILE, JSON.stringify(previous, null, 2));
    response = withStubbedExecFileSync(createFastPathExecStub(capturedScripts), function () {
      return deployHelper.applyConfig(requested);
    });
    appliedScript = capturedScripts.filter(function (script) {
      return script.indexOf('publish_plugin_store_file') >= 0 &&
        script.indexOf('sys file ifile') < 0 &&
        script.indexOf('list ltm pool recursive one-line') < 0 &&
        script.indexOf('emit_section') < 0;
    }).pop() || '';

    assert.strictEqual(response.ok, true);
    assert.strictEqual(response.profile.scope.type, 'runtime_artifacts_only');
    assert.deepStrictEqual(response.profile.steps.map(function (step) {
      return step.name;
    }), [
      'validate_config',
      'normalize_block',
      'build_desired_state',
      'validate_pools',
      'validate_virtual_destinations',
      'build_artifacts',
      'write_runtime_files',
      'build_runtime_artifacts_fast_path_script',
      'run_runtime_artifacts_fast_path_apply',
      'write_deployed_config',
      'cleanup'
    ]);
    assert.ok(/RUNTIME_ARTIFACTS_FAST_PATH_OK/.test(String(response.output || '')));
    assert.ok(appliedScript.indexOf('ifile_ai_gateway_classifiers.json') >= 0);
    assert.strictEqual(appliedScript.indexOf('tmsh save sys config'), -1);
    assert.strictEqual(appliedScript.indexOf('restart_ilx_plugin'), -1);
    assert.strictEqual(appliedScript.indexOf('sys file ifile'), -1);
    assert.strictEqual(appliedScript.indexOf('ltm data-group'), -1);
    assert.strictEqual(response.profile.steps.map(function (step) {
      return step.name;
    }).indexOf('run_apply_script'), -1);
  } finally {
    if (originalContent === null) {
      try {
        fs.unlinkSync(deployHelper.DEPLOYED_CONFIG_FILE);
      } catch (error) {
        if (!error || error.code !== 'ENOENT') {
          throw error;
        }
      }
    } else {
      fs.writeFileSync(deployHelper.DEPLOYED_CONFIG_FILE, originalContent);
    }
  }
}

function assertClassifierEndpointApplyUsesClassifierEgressFastPath() {
  var previous = buildBaseConfig();
  var requested = clone(previous);
  var originalContent = null;
  var response;
  var capturedScripts = [];
  var appliedScript;

  requested.classifiers.classifier_main.endpoint_url = 'https://classifier.example.local/new-classify';

  fs.mkdirSync(deployHelper.RUNTIME_DIR, {
    recursive: true
  });

  if (fs.existsSync(deployHelper.DEPLOYED_CONFIG_FILE)) {
    originalContent = fs.readFileSync(deployHelper.DEPLOYED_CONFIG_FILE, 'utf8');
  }

  try {
    fs.writeFileSync(deployHelper.DEPLOYED_CONFIG_FILE, JSON.stringify(previous, null, 2));
    response = withStubbedExecFileSync(createFastPathExecStub(capturedScripts), function () {
      return deployHelper.applyConfig(requested);
    });
    appliedScript = capturedScripts.filter(function (script) {
      return script.indexOf('tmsh save sys config') >= 0 &&
        script.indexOf('list ltm pool recursive one-line') < 0 &&
        script.indexOf('emit_section') < 0;
    }).pop() || '';

    assert.strictEqual(response.ok, true);
    assert.strictEqual(response.profile.scope.type, 'classifier_egress');
    assert.ok(response.profile.steps.map(function (step) {
      return step.name;
    }).indexOf('run_classifier_egress_fast_path_apply') >= 0);
    assert.strictEqual(response.profile.steps.map(function (step) {
      return step.name;
    }).indexOf('run_apply_script'), -1);
    assert.ok(appliedScript.indexOf('publish_plugin_store_file') >= 0);
    assert.ok(appliedScript.indexOf('/Common/dg_ai_gateway_classifier_egress_settings') >= 0);
    assert.ok(appliedScript.indexOf('tmsh load sys config merge file /var/tmp/aito_classifier_egress.conf') >= 0);
    assert.ok(appliedScript.indexOf('tmsh modify ltm virtual /Common/aito_cls_egress_classifier_main') >= 0);
    assert.ok(appliedScript.indexOf('tmsh save sys config') >= 0);
    assert.strictEqual(appliedScript.indexOf('sys file ifile'), -1);
    assert.strictEqual(appliedScript.indexOf('restart_ilx_plugin'), -1);
    assert.strictEqual(appliedScript.indexOf('tmsh modify ltm virtual /Common/vs_main'), -1);
    assert.strictEqual(appliedScript.indexOf('/Common/dg_ai_gateway_listener_vk_pool_allowlist'), -1);
    assert.strictEqual(appliedScript.indexOf('/Common/dg_ai_gateway_virtual_keys'), -1);
    assert.strictEqual(appliedScript.indexOf('/Common/dg_ai_gateway_virtual_key_pools'), -1);
  } finally {
    if (originalContent === null) {
      try {
        fs.unlinkSync(deployHelper.DEPLOYED_CONFIG_FILE);
      } catch (error) {
        if (!error || error.code !== 'ENOENT') {
          throw error;
        }
      }
    } else {
      fs.writeFileSync(deployHelper.DEPLOYED_CONFIG_FILE, originalContent);
    }
  }
}

function assertClassifierBypassApplyUsesClassifierEgressFastPath() {
  var previous = buildBaseConfig();
  var requested = clone(previous);
  var originalContent = null;
  var response;
  var capturedScripts = [];
  var appliedScript;

  requested.classifiers.classifier_main.bypass_enabled = true;

  fs.mkdirSync(deployHelper.RUNTIME_DIR, {
    recursive: true
  });

  if (fs.existsSync(deployHelper.DEPLOYED_CONFIG_FILE)) {
    originalContent = fs.readFileSync(deployHelper.DEPLOYED_CONFIG_FILE, 'utf8');
  }

  try {
    fs.writeFileSync(deployHelper.DEPLOYED_CONFIG_FILE, JSON.stringify(previous, null, 2));
    response = withStubbedExecFileSync(createFastPathExecStub(capturedScripts), function () {
      return deployHelper.applyConfig(requested);
    });
    appliedScript = capturedScripts.filter(function (script) {
      return script.indexOf('tmsh save sys config') >= 0 &&
        script.indexOf('list ltm pool recursive one-line') < 0 &&
        script.indexOf('emit_section') < 0;
    }).pop() || '';

    assert.strictEqual(response.ok, true);
    assert.strictEqual(response.profile.scope.type, 'classifier_egress');
    assert.ok(response.profile.steps.map(function (step) {
      return step.name;
    }).indexOf('run_classifier_egress_fast_path_apply') >= 0);
    assert.strictEqual(response.profile.steps.map(function (step) {
      return step.name;
    }).indexOf('run_apply_script'), -1);
    assert.strictEqual(response.profile.steps.map(function (step) {
      return step.name;
    }).indexOf('run_runtime_artifacts_fast_path_apply'), -1);
    assert.ok(appliedScript.indexOf('publish_plugin_store_file') >= 0);
    assert.ok(appliedScript.indexOf('/Common/dg_ai_gateway_classifier_egress_settings') >= 0);
    assert.ok(appliedScript.indexOf('/Common/aito_cls_egress_classifier_main') >= 0);
    assert.ok(appliedScript.indexOf('tmsh save sys config') >= 0);
    assert.strictEqual(appliedScript.indexOf('sys file ifile'), -1);
    assert.strictEqual(appliedScript.indexOf('restart_ilx_plugin'), -1);
    assert.strictEqual(appliedScript.indexOf('tmsh modify ltm virtual /Common/vs_main'), -1);
    assert.strictEqual(appliedScript.indexOf('/Common/dg_ai_gateway_listener_vk_pool_allowlist'), -1);
    assert.strictEqual(appliedScript.indexOf('/Common/dg_ai_gateway_virtual_keys'), -1);
    assert.strictEqual(appliedScript.indexOf('/Common/dg_ai_gateway_virtual_key_pools'), -1);
  } finally {
    if (originalContent === null) {
      try {
        fs.unlinkSync(deployHelper.DEPLOYED_CONFIG_FILE);
      } catch (error) {
        if (!error || error.code !== 'ENOENT') {
          throw error;
        }
      }
    } else {
      fs.writeFileSync(deployHelper.DEPLOYED_CONFIG_FILE, originalContent);
    }
  }
}

function assertBackendEndpointTlsUpgradeApplyUsesFullPathWithoutVirtualKeyWork() {
  var previous = buildBaseConfig();
  var requested = clone(previous);
  var originalContent = null;
  var response;
  var capturedScripts = [];
  var appliedScript;

  requested.backendTargets.backend_main.endpoint_url = 'https://backend.example.local/v1/chat/completions';

  fs.mkdirSync(deployHelper.RUNTIME_DIR, {
    recursive: true
  });

  if (fs.existsSync(deployHelper.DEPLOYED_CONFIG_FILE)) {
    originalContent = fs.readFileSync(deployHelper.DEPLOYED_CONFIG_FILE, 'utf8');
  }

  try {
    fs.writeFileSync(deployHelper.DEPLOYED_CONFIG_FILE, JSON.stringify(previous, null, 2));
    response = withStubbedExecFileSync(createFastPathExecStub(capturedScripts), function () {
      return deployHelper.applyConfig(requested);
    });
    appliedScript = capturedScripts.filter(function (script) {
      return script.indexOf('tmsh save sys config') >= 0 &&
        script.indexOf('list ltm pool recursive one-line') < 0 &&
        script.indexOf('emit_section') < 0;
    }).pop() || '';

    assert.strictEqual(response.ok, true);
    assert.strictEqual(response.profile.scope.type, 'listener_ltm');
    assert.ok(response.profile.steps.map(function (step) {
      return step.name;
    }).indexOf('run_apply_script') >= 0);
    assert.strictEqual(response.profile.steps.map(function (step) {
      return step.name;
    }).indexOf('run_runtime_artifacts_fast_path_apply'), -1);
    assert.strictEqual(response.profile.steps.map(function (step) {
      return step.name;
    }).indexOf('inspect_virtual_key_dg'), -1);
    assert.ok(appliedScript.indexOf('sys file ifile') >= 0);
    assert.ok(appliedScript.indexOf('restart_ilx_plugin') >= 0);
    assert.strictEqual(appliedScript.indexOf('/Common/dg_ai_gateway_listener_vk_pool_allowlist'), -1);
    assert.strictEqual(appliedScript.indexOf('/Common/dg_ai_gateway_virtual_keys'), -1);
    assert.strictEqual(appliedScript.indexOf('/Common/dg_ai_gateway_virtual_key_pools'), -1);
  } finally {
    if (originalContent === null) {
      try {
        fs.unlinkSync(deployHelper.DEPLOYED_CONFIG_FILE);
      } catch (error) {
        if (!error || error.code !== 'ENOENT') {
          throw error;
        }
      }
    } else {
      fs.writeFileSync(deployHelper.DEPLOYED_CONFIG_FILE, originalContent);
    }
  }
}

function assertStreamingOnlyApplyShortCircuitPersistsMetadata() {
  var previous = buildBaseConfig();
  var requested = clone(previous);
  var originalContent = null;
  var response;
  var persisted;

  previous.listeners.listener_main.streaming = true;
  requested.listeners.listener_main.streaming = false;

  fs.mkdirSync(deployHelper.RUNTIME_DIR, {
    recursive: true
  });

  if (fs.existsSync(deployHelper.DEPLOYED_CONFIG_FILE)) {
    originalContent = fs.readFileSync(deployHelper.DEPLOYED_CONFIG_FILE, 'utf8');
  }

  try {
    fs.writeFileSync(deployHelper.DEPLOYED_CONFIG_FILE, JSON.stringify(previous, null, 2));
    response = deployHelper.applyConfig(requested);

    assert.strictEqual(response.ok, true);
    assert.ok(response.profile);
    assert.strictEqual(response.profile.scope.type, 'none');
    assert.deepStrictEqual(response.profile.steps.map(function (step) {
      return step.name;
    }), ['validate_config', 'normalize_block', 'build_desired_state', 'write_deployed_config', 'skip_no_runtime_apply']);
    assert.strictEqual(response.block.listeners.listener_main.streaming, false);
    assert.ok(/No BIG-IP runtime changes/i.test(String(response.output || '')));

    persisted = JSON.parse(fs.readFileSync(deployHelper.DEPLOYED_CONFIG_FILE, 'utf8'));
    assert.strictEqual(persisted.listeners.listener_main.streaming, false);
    assert.strictEqual(persisted.meta.source, 'deployed');
    assert.strictEqual(persisted.meta.dirty, false);
  } finally {
    if (originalContent === null) {
      try {
        fs.unlinkSync(deployHelper.DEPLOYED_CONFIG_FILE);
      } catch (error) {
        if (!error || error.code !== 'ENOENT') {
          throw error;
        }
      }
    } else {
      fs.writeFileSync(deployHelper.DEPLOYED_CONFIG_FILE, originalContent);
    }
  }
}

function assertInvalidApplyDoesNotMutateExistingDeployedConfig() {
  var previous = buildBaseConfig();
  var originalContent = null;
  var before;
  var after;
  var response;

  fs.mkdirSync(deployHelper.RUNTIME_DIR, {
    recursive: true
  });

  if (fs.existsSync(deployHelper.DEPLOYED_CONFIG_FILE)) {
    originalContent = fs.readFileSync(deployHelper.DEPLOYED_CONFIG_FILE, 'utf8');
  }

  before = JSON.stringify(previous, null, 2);

  try {
    fs.writeFileSync(deployHelper.DEPLOYED_CONFIG_FILE, before);
    response = deployHelper.applyConfig({
      listeners: {
        listener_bad: {}
      }
    });

    assert.strictEqual(response.ok, false);
    after = fs.readFileSync(deployHelper.DEPLOYED_CONFIG_FILE, 'utf8');
    assert.strictEqual(after, before);
  } finally {
    if (originalContent === null) {
      try {
        fs.unlinkSync(deployHelper.DEPLOYED_CONFIG_FILE);
      } catch (error) {
        if (!error || error.code !== 'ENOENT') {
          throw error;
        }
      }
    } else {
      fs.writeFileSync(deployHelper.DEPLOYED_CONFIG_FILE, originalContent);
    }
  }
}

function assertStreamingOnlyWriteFailurePreservesExistingDeployedConfig() {
  var previous = buildBaseConfig();
  var requested = clone(previous);
  var originalContent = null;
  var originalRenameSync = fs.renameSync;
  var response;
  var after;
  var tempFiles;

  previous.listeners.listener_main.streaming = true;
  requested.listeners.listener_main.streaming = false;

  fs.mkdirSync(deployHelper.RUNTIME_DIR, {
    recursive: true
  });

  if (fs.existsSync(deployHelper.DEPLOYED_CONFIG_FILE)) {
    originalContent = fs.readFileSync(deployHelper.DEPLOYED_CONFIG_FILE, 'utf8');
  }

  try {
    fs.writeFileSync(deployHelper.DEPLOYED_CONFIG_FILE, JSON.stringify(previous, null, 2));
    fs.renameSync = function (sourcePath, targetPath) {
      if (targetPath === deployHelper.DEPLOYED_CONFIG_FILE) {
        throw new Error('simulated rename failure');
      }
      return originalRenameSync.apply(fs, arguments);
    };

    response = deployHelper.applyConfig(requested);

    assert.strictEqual(response.ok, false);
    assert.ok(Array.isArray(response.issues));
    assert.ok(/Unable to write deployed config snapshot: simulated rename failure/.test(String(response.issues[0] || '')));

    after = JSON.parse(fs.readFileSync(deployHelper.DEPLOYED_CONFIG_FILE, 'utf8'));
    assert.strictEqual(after.listeners.listener_main.streaming, true);

    tempFiles = fs.readdirSync(deployHelper.RUNTIME_DIR).filter(function (name) {
      return /^deployed-config\.json\.tmp-/.test(name);
    });
    assert.deepStrictEqual(tempFiles, []);
  } finally {
    fs.renameSync = originalRenameSync;

    if (originalContent === null) {
      try {
        fs.unlinkSync(deployHelper.DEPLOYED_CONFIG_FILE);
      } catch (error) {
        if (!error || error.code !== 'ENOENT') {
          throw error;
        }
      }
    } else {
      fs.writeFileSync(deployHelper.DEPLOYED_CONFIG_FILE, originalContent);
    }
  }
}

function assertInvalidApplyIncludesProfile() {
  var response = deployHelper.applyConfig({
    listeners: {
      listener_bad: {}
    }
  });

  assert.strictEqual(response.ok, false);
  assert.ok(Array.isArray(response.issues));
  assert.ok(response.issues.length > 0);
  assert.ok(response.profile);
  assert.strictEqual(typeof response.profile.total_ms, 'number');
  assert.strictEqual(response.profile.scope, null);
  assert.deepStrictEqual(response.profile.steps.map(function (step) {
    return step.name;
  }), ['validate_config']);
  assert.ok(response.profile.steps[0].duration_ms >= 0);
}

function runTest(name, fn) {
  try {
    fn();
    process.stdout.write('PASS ' + name + '\n');
  } catch (error) {
    process.stderr.write('FAIL ' + name + '\n');
    process.stderr.write(String(error && error.stack || error) + '\n');
    process.exitCode = 1;
  }
}

runTest('deploy scope classifies auth-only changes for virtual keys and listener auth', assertAuthOnlyScopeClassification);
runTest('deploy scope classifies listener LTM changes when VIP changes', assertListenerLtmScopeClassification);
runTest('deploy scope classifies listener enabled-state changes as listener LTM changes', assertListenerDisableScopeClassification);
runTest('deploy scope classifies classifier endpoint changes as classifier egress changes', assertClassifierEgressScopeClassification);
runTest('deploy scope classifies remaining listener changes as unknown', assertUnknownScopeClassification);
runTest('deploy scope classifies listener DG-only settings changes', assertListenerSettingsScopeClassification);
runTest('deploy scope classifies routing-policy-only changes as runtime-artifacts-only', assertRuntimeArtifactsOnlyScopeClassification);
runTest('deploy scope classifies provider credential pool changes as runtime-artifacts-only', assertProviderCredentialPoolsScopeClassification);
runTest('deploy scope keeps backend credential pool reference changes on runtime-artifacts-only', assertBackendCredentialPoolReferenceScopeClassification);
runTest('deploy scope keeps pure key-only routing-policy edits on runtime-artifacts-only when classifier refs do not change', assertKeyOnlyRoutingPolicyStaysRuntimeArtifactsOnlyWithoutClassifierRefs);
runTest('deploy scope ignores stale key-only policy classifier aliases', assertKeyOnlyStalePolicyClassifierAliasDoesNotDirtyScope);
runTest('deploy scope elevates key-only classify-rule changes when classifier egress changes', assertKeyOnlyClassifyRuleTriggersClassifierEgressScope);
runTest('deploy scope classifies backend-target-name-only changes as runtime-artifacts-only', assertBackendTargetNameOnlyScopeClassification);
runTest('deploy scope classifies classifier runtime-only changes as runtime-artifacts-only', assertClassifierRuntimeOnlyScopeClassification);
runTest('deploy scope keeps backend endpoint TLS upgrades on the full apply path', assertBackendEndpointTlsUpgradeScopeClassification);
runTest('deploy scope excludes classifier bypass egress changes from runtime-artifacts-only', assertClassifierBypassScopeExcludedFromRuntimeArtifactsOnly);
runTest('deploy scope ignores streaming-only listener changes', assertStreamingOnlyScopeClassification);
runTest('data-group fast path script excludes ILX restart and iFile publish', assertDataGroupFastPathScriptIsMinimal);
runTest('runtime-artifacts fast path script publishes native JSON only', assertRuntimeArtifactsFastPathScriptIsMinimal);
runTest('listener-settings fast path script stays DG-only', assertListenerSettingsFastPathScriptIsMinimal);
runTest('full apply script disables an existing listener virtual when listener enabled is false', assertListenerEnabledStateIsAppliedToVirtualServer);
runTest('applyConfig uses auth DG fast path profile without iFile publish', assertAuthDataGroupFastPathApplyProfile);
runTest('applyConfig uses listener-settings fast path profile without virtual changes', assertListenerSettingsFastPathApplyProfile);
runTest('applyConfig uses runtime-artifacts fast path profile without LTM or iFile changes', assertRuntimeArtifactsFastPathApplyProfile);
runTest('applyConfig uses runtime-artifacts fast path for backend-target runtime-only changes', assertBackendTargetsRuntimeArtifactsFastPathApplyProfile);
runTest('applyConfig uses runtime-artifacts fast path for classifier runtime-only changes', assertClassifierRuntimeOnlyApplyUsesRuntimeArtifactsFastPath);
runTest('applyConfig keeps backend endpoint TLS upgrades on full apply without virtual-key data-group work', assertBackendEndpointTlsUpgradeApplyUsesFullPathWithoutVirtualKeyWork);
runTest('applyConfig uses classifier-egress fast path for classifier endpoint changes', assertClassifierEndpointApplyUsesClassifierEgressFastPath);
runTest('applyConfig uses classifier-egress fast path for classifier bypass egress changes', assertClassifierBypassApplyUsesClassifierEgressFastPath);
runTest('applyConfig short-circuits streaming-only listener changes and persists metadata', assertStreamingOnlyApplyShortCircuitPersistsMetadata);
runTest('applyConfig validation failures do not mutate deployed config', assertInvalidApplyDoesNotMutateExistingDeployedConfig);
runTest('applyConfig snapshot write failures preserve existing deployed config', assertStreamingOnlyWriteFailurePreservesExistingDeployedConfig);
runTest('applyConfig validation failures include a profiling object', assertInvalidApplyIncludesProfile);

if (!process.exitCode) {
  process.stdout.write('All deploy profile and scope tests passed.\n');
}
