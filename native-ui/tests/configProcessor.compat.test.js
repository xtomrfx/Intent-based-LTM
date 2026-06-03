'use strict';

var assert = require('assert');
var configProcessor = require('../iapps-lx/ai-traffic-orchestrator/nodejs/configProcessor');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildLegacyConfig() {
  return {
    operatingMode: 'gateway',
    activeIds: {
      listener: 'listener_legacy',
      classifier: 'classifier_main',
      backend: 'backend_general',
      policy: 'routing_main',
      ruleIndex: 0
    },
    ui: {
      listenerEditorMode: 'edit',
      backendEditorMode: 'empty',
      policyEditorMode: 'edit'
    },
    listeners: {
      listener_legacy: {
        listener_name: 'listener_legacy',
        virtual_service: 'vs_legacy_gateway',
        vip: '10.10.10.10',
        port: 8080,
        policy_ref: 'routing_main',
        streaming: true,
        advanced: {
          max_payload_bytes: 77777,
          decision_timeout_ms: 4500,
          request_id_mode: 'preserve'
        },
        status: {
          northbound_api_mode: 'OpenAI-compatible',
          supported_paths: [
            '/',
            '/v1',
            '/v1/models',
            '/models',
            '/model/list',
            '/v1/chat/completions',
            '/chat/completions',
            '/v1/responses',
            '/responses'
          ],
          chat_completions_support: 'full',
          responses_support: 'partial',
          assigned_irule: 'llm_semantic_route_phase2',
          status: 'active'
        }
      }
    },
    classifiers: {
      classifier_main: {
        classifier_name: 'classifier_main',
        classifier_type: 'classifier_llm',
        schema_family: 'openai_chat_compatible',
        endpoint_url: 'https://classifier.example.local/chat/completions',
        api_key: '',
        pool_name: 'pool_classifier_main',
        model_id: 'classifier-model',
        temperature: 0,
        max_tokens: 64,
        classifier_prompt: 'Choose the best route tag.',
        candidate_tags: ['general', 'priority'],
        fallback_tag: 'general',
        bypass_enabled: false,
        use_built_in_rules_first: true,
        timeout_ms: 2500,
        min_confidence: 0.55,
        multi_label: false,
        hypothesis_template: 'This text is about {}.',
        min_margin: 0.12
      }
    },
    backendTargets: {
      backend_general: {
        backend_target_name: 'backend_general',
        schema_family: 'openai_compatible_chat',
        endpoint_url: 'https://backend.example.local/v1/chat/completions',
        api_key: '',
        model_id: 'backend-general-model',
        pool_name: 'pool_backend_general',
        backend_prompt: 'Provide a concise answer.',
        backend_prompt_mode: 'append'
      },
      backend_priority: {
        backend_target_name: 'backend_priority',
        schema_family: 'openai_chat_compatible',
        endpoint_url: 'https://backend-priority.example.local/v1/chat/completions',
        api_key: '',
        model_id: 'backend-priority-model',
        pool_name: 'pool_backend_priority',
        backend_prompt: 'Prioritize urgent requests.',
        backend_prompt_mode: 'append'
      }
    },
    routingPolicies: {
      routing_main: {
        policy_type: 'routing',
        policy_name: 'routing_main',
        classifier_ref: 'classifier_main',
        fallback_backend_target_ref: 'backend_priority',
        default_rule: {
          action: 'route',
          backend_target_ref: 'backend_general',
          response_message: ''
        },
        rules: [
          {
            rule_name: 'priority_route',
            source_tag: 'priority',
            action: 'route',
            backend_target_ref: 'backend_priority',
            response_message: '',
            enabled: true
          },
          {
            rule_name: 'general_response',
            source_tag: 'general',
            action: 'respond',
            backend_target_ref: '',
            response_message: 'handled locally',
            enabled: true
          }
        ]
      }
    }
  };
}

function assertLegacyNormalizationAndValidation() {
  var legacy = buildLegacyConfig();
  var normalized = configProcessor.normalizeBlock(legacy);
  var validation = configProcessor.validateBlock(legacy);

  assert.deepStrictEqual(normalized.virtualKeyPools, {});
  assert.deepStrictEqual(normalized.virtualKeys, {});
  assert.deepStrictEqual(normalized.providerCredentialPools, {});
  assert.strictEqual(normalized.listeners.listener_legacy.enabled, true);
  assert.strictEqual(normalized.listeners.listener_legacy.client_auth_type, 'none');
  assert.deepStrictEqual(normalized.listeners.listener_legacy.allowed_virtual_key_pool_refs, []);
  assert.strictEqual(normalized.backendTargets.backend_general.schema_family, 'openai_chat_compatible');
  assert.strictEqual(validation.valid, true);
  assert.deepStrictEqual(validation.issues, []);
}

function assertLegacyArtifactsStayCleanAndPreserveData() {
  var artifacts = configProcessor.buildArtifacts(buildLegacyConfig());
  var listenerRefs = artifacts.dataGroups.listener_refs.records;
  var listenerSettings = artifacts.dataGroups.listener_settings.records;
  var classifiers = artifacts.ifiles.classifiers.content.classifiers;
  var backends = artifacts.ifiles.backend_targets.content.backendTargets;
  var providerCredentialPools = artifacts.ifiles.provider_credential_pools.content.providerCredentialPools;
  var policies = artifacts.ifiles.routing_policies.content.routingPolicies;
  var snapshot = artifacts.ifiles.config_snapshot.content.block;

  assert.deepStrictEqual(artifacts.dataGroups.virtual_keys.records, {});
  assert.deepStrictEqual(artifacts.dataGroups.virtual_key_pools.records, {});
  assert.deepStrictEqual(artifacts.dataGroups.listener_virtual_key_pool_allowlist.records, {});
  assert.deepStrictEqual(providerCredentialPools, {});

  assert.strictEqual(listenerRefs.vs_legacy_gateway, 'listener_legacy');
  assert.strictEqual(listenerRefs['/Common/vs_legacy_gateway'], 'listener_legacy');
  assert.strictEqual(listenerSettings['listener_legacy.max_payload_bytes'], '77777');
  assert.strictEqual(listenerSettings['listener_legacy.decision_timeout_ms'], '4500');
  assert.strictEqual(listenerSettings['listener_legacy.request_id_mode'], 'preserve');
  assert.strictEqual(listenerSettings['listener_legacy.northbound_api_mode'], 'OpenAI-compatible');
  assert.strictEqual(listenerSettings['listener_legacy.chat_completions_support'], 'full');
  assert.strictEqual(listenerSettings['listener_legacy.responses_support'], 'partial');
  assert.strictEqual(listenerSettings['listener_legacy.client_auth_type'], 'none');
  assert.strictEqual(listenerSettings['listener_legacy.allowed_virtual_key_pool_refs'], '');

  assert.strictEqual(classifiers.classifier_main.classifier_name, 'classifier_main');
  assert.strictEqual(classifiers.classifier_main.pool_name, 'pool_classifier_main');
  assert.deepStrictEqual(classifiers.classifier_main.candidate_tags, ['general', 'priority']);

  assert.strictEqual(backends.backend_general.schema_family, 'openai_chat_compatible');
  assert.strictEqual(backends.backend_general.endpoint_url, 'https://backend.example.local/v1/chat/completions');
  assert.strictEqual(backends.backend_general.model_id, 'backend-general-model');
  assert.strictEqual(backends.backend_general.pool_name, 'pool_backend_general');
  assert.strictEqual(backends.backend_priority.pool_name, 'pool_backend_priority');

  assert.strictEqual(policies.routing_main.classifier_ref, 'classifier_main');
  assert.strictEqual(policies.routing_main.fallback_backend_target_ref, 'backend_priority');
  assert.strictEqual(policies.routing_main.default_rule.backend_target_ref, 'backend_general');
  assert.strictEqual(policies.routing_main.rules.length, 2);
  assert.strictEqual(policies.routing_main.rules[0].backend_target_ref, 'backend_priority');
  assert.strictEqual(policies.routing_main.rules[1].response_message, 'handled locally');

  assert.deepStrictEqual(snapshot.virtualKeyPools, {});
  assert.deepStrictEqual(snapshot.virtualKeys, {});
  assert.deepStrictEqual(snapshot.providerCredentialPools, {});
  assert.strictEqual(snapshot.listeners.listener_legacy.client_auth_type, 'none');
  assert.deepStrictEqual(snapshot.listeners.listener_legacy.allowed_virtual_key_pool_refs, []);
}

function assertProviderCredentialPoolsNormalizeValidateAndPublish() {
  var config = buildLegacyConfig();
  var normalized;
  var validation;
  var artifacts;

  config.providerCredentialPools = {
    pool_openai: {
      poolName: 'OpenAI Pool',
      vendor: 'OpenAI',
      authScheme: 'bearer',
      selectionMode: 'priority-failover',
      cooldownSeconds: 45,
      entries: [
        {
          credentialId: 'cred_b',
          displayName: 'Backup',
          enabled: true,
          priority: 200,
          apiKey: 'sk-backup'
        },
        {
          credentialId: 'cred_a',
          displayName: 'Primary',
          enabled: true,
          priority: 100,
          apiKey: 'sk-primary'
        }
      ]
    }
  };
  delete config.backendTargets.backend_general.api_key;
  config.backendTargets.backend_general.credentialPoolRef = 'pool_openai';

  normalized = configProcessor.normalizeBlock(config);
  validation = configProcessor.validateBlock(config);
  artifacts = configProcessor.buildArtifacts(config);

  assert.strictEqual(normalized.backendTargets.backend_general.credential_pool_ref, 'pool_openai');
  assert.strictEqual(normalized.providerCredentialPools.pool_openai.selection_mode, 'priority_failover');
  assert.strictEqual(normalized.providerCredentialPools.pool_openai.auth_scheme, 'bearer');
  assert.strictEqual(normalized.providerCredentialPools.pool_openai.entries.length, 2);
  assert.strictEqual(validation.valid, true);
  assert.strictEqual(artifacts.ifiles.backend_targets.content.backendTargets.backend_general.credential_pool_ref, 'pool_openai');
  assert.strictEqual(artifacts.ifiles.provider_credential_pools.content.providerCredentialPools.pool_openai.pool_name, 'OpenAI Pool');
  assert.strictEqual(artifacts.ifiles.provider_credential_pools.content.providerCredentialPools.pool_openai.entries[0].credential_id, 'cred_b');
}

function assertProviderCredentialPoolValidationRejectsConflictsAndEmptyPools() {
  var config = buildLegacyConfig();
  var validation;

  config.providerCredentialPools = {
    pool_openai: {
      pool_name: 'OpenAI Pool',
      selection_mode: 'priority_failover',
      entries: [
        {
          credential_id: 'dup',
          enabled: false,
          priority: 100,
          api_key: 'sk-one'
        },
        {
          credential_id: 'dup',
          enabled: true,
          priority: 'bad',
          api_key: ''
        }
      ]
    }
  };
  config.backendTargets.backend_general.api_key = 'inline-key';
  config.backendTargets.backend_general.credential_pool_ref = 'pool_openai';
  config.backendTargets.backend_priority.credential_pool_ref = 'missing_pool';

  validation = configProcessor.validateBlock(config);

  assert.strictEqual(validation.valid, false);
  assert.ok(validation.issues.indexOf('Backend Target "backend_general" cannot set both credential_pool_ref and inline api_key. Choose one credential source.') >= 0);
  assert.ok(validation.issues.indexOf('Backend Target "backend_priority" references unknown credential_pool_ref "missing_pool".') >= 0);
  assert.ok(validation.issues.indexOf('Provider Credential Pool "pool_openai" has duplicate credential_id "dup".') >= 0);
  assert.ok(validation.issues.indexOf('Provider Credential Pool "pool_openai" entry #2 is enabled but missing api_key.') >= 0);
  assert.ok(validation.issues.indexOf('Provider Credential Pool "pool_openai" entry #2 has invalid priority "NaN".') >= 0);
}

function assertVirtualKeyAllowlistValidationFailure() {
  var invalid = clone(buildLegacyConfig());
  var validation;

  invalid.listeners.listener_legacy.client_auth_type = 'virtual_key';
  validation = configProcessor.validateBlock(invalid);

  assert.strictEqual(validation.valid, false);
  assert.ok(
    validation.issues.indexOf('Listener "listener_legacy" uses Virtual Key authentication but has no allowed Virtual Key Pool selected.') >= 0,
    'expected missing allowlist validation issue'
  );
}

function assertStaleActiveIdsNormalizeToExistingRecords() {
  var legacy = buildLegacyConfig();
  var normalized;

  legacy.activeIds.listener = 'missing_listener';
  legacy.activeIds.classifier = 'missing_classifier';
  legacy.activeIds.backend = 'missing_backend';
  legacy.activeIds.policy = 'missing_policy';
  legacy.activeIds.ruleIndex = '7';
  legacy.ui.classifierEditorMode = 'edit';
  legacy.ui.listenerEditorMode = 'edit';
  legacy.ui.backendEditorMode = 'edit';
  legacy.ui.policyEditorMode = 'edit';

  normalized = configProcessor.normalizeBlock(legacy);

  assert.strictEqual(normalized.activeIds.listener, '');
  assert.strictEqual(normalized.activeIds.classifier, 'classifier_main');
  assert.strictEqual(normalized.activeIds.backend, '');
  assert.strictEqual(normalized.activeIds.policy, 'routing_main');
  assert.strictEqual(normalized.activeIds.ruleIndex, 0);
  assert.strictEqual(normalized.ui.classifierEditorMode, 'edit');
  assert.strictEqual(normalized.ui.listenerEditorMode, 'empty');
  assert.strictEqual(normalized.ui.backendEditorMode, 'empty');
  assert.strictEqual(normalized.ui.policyEditorMode, 'edit');
}

function assertListenerEnabledNormalizesToBooleanAndDefaultsTrue() {
  var legacy = buildLegacyConfig();
  var normalized;

  legacy.listeners.listener_legacy.enabled = false;
  normalized = configProcessor.normalizeBlock(legacy);
  assert.strictEqual(normalized.listeners.listener_legacy.enabled, false);

  delete legacy.listeners.listener_legacy.enabled;
  normalized = configProcessor.normalizeBlock(legacy);
  assert.strictEqual(normalized.listeners.listener_legacy.enabled, true);
}

function assertRoutingPolicyDefaultsIncludeClassifierOnlyAndEmptyKeyRules() {
  var normalized = configProcessor.normalizeBlock(buildLegacyConfig());
  var policyArtifacts = configProcessor.buildArtifacts(buildLegacyConfig()).ifiles.routing_policies.content.routingPolicies;

  assert.strictEqual(normalized.routingPolicies.routing_main.routing_mode, 'classifier_only');
  assert.deepStrictEqual(normalized.routingPolicies.routing_main.key_rules, []);
  assert.strictEqual(policyArtifacts.routing_main.routing_mode, 'classifier_only');
  assert.deepStrictEqual(policyArtifacts.routing_main.key_rules, []);
}

function assertKeyOnlyPoliciesCanSkipPolicyClassifierUntilKeyClassifyIsUsed() {
  var config = buildLegacyConfig();
  var validation;

  config.routingPolicies.routing_main.routing_mode = 'key_only';
  config.routingPolicies.routing_main.classifier_ref = '';
  config.routingPolicies.routing_main.rules = [];
  config.routingPolicies.routing_main.key_rules = [
    {
      rule_name: 'pool_route',
      enabled: true,
      match: {
        virtual_key_pool_ref: 'vk_pool_shared'
      },
      action: 'route',
      backend_target_ref: 'backend_priority'
    }
  ];
  config.virtualKeyPools = {
    vk_pool_shared: {
      pool_name: 'Shared',
      enabled: true
    }
  };
  config.listeners.listener_legacy.client_auth_type = 'virtual_key';
  config.listeners.listener_legacy.allowed_virtual_key_pool_refs = ['vk_pool_shared'];

  validation = configProcessor.validateBlock(config);
  assert.strictEqual(validation.valid, true);

  config.routingPolicies.routing_main.key_rules[0] = {
    rule_name: 'pool_classify',
    enabled: true,
    match: {
      virtual_key_pool_ref: 'vk_pool_shared'
    },
    action: 'classify'
  };
  validation = configProcessor.validateBlock(config);
  assert.strictEqual(validation.valid, false);
  assert.ok(
    validation.issues.indexOf('Routing Policy "routing_main" key entry #1 is set to Classify but has no Classifier selected.') >= 0,
    'expected missing classifier issue for key classify rule'
  );
}

function assertKeyRulesRequireExactlyOneSource() {
  var config = buildLegacyConfig();
  var validation;

  config.routingPolicies.routing_main.routing_mode = 'key_only';
  config.routingPolicies.routing_main.classifier_ref = '';
  config.routingPolicies.routing_main.rules = [];
  config.routingPolicies.routing_main.key_rules = [
    {
      rule_name: 'empty_source',
      enabled: true,
      match: {},
      action: 'route',
      backend_target_ref: 'backend_priority'
    }
  ];
  config.virtualKeyPools = {
    pool_alpha: {
      pool_name: 'Alpha',
      enabled: true
    }
  };
  config.listeners.listener_legacy.client_auth_type = 'virtual_key';
  config.listeners.listener_legacy.allowed_virtual_key_pool_refs = ['pool_alpha'];

  validation = configProcessor.validateBlock(config);
  assert.strictEqual(validation.valid, false);
  assert.ok(
    validation.issues.indexOf('Routing Policy "routing_main" key entry #1 requires exactly one Source: Pool, Key, or Key Tag.') >= 0,
    'expected missing key source validation issue'
  );

  config.routingPolicies.routing_main.key_rules[0].match = {
    virtual_key_pool_ref: 'pool_alpha',
    virtual_key_tag: 'vip'
  };

  validation = configProcessor.validateBlock(config);
  assert.strictEqual(validation.valid, false);
  assert.ok(
    validation.issues.indexOf('Routing Policy "routing_main" key entry #1 requires exactly one Source: Pool, Key, or Key Tag.') >= 0,
    'expected multiple key source validation issue'
  );
}

function assertKeyOnlyPoliciesDropStalePolicyClassifierRef() {
  var config = buildLegacyConfig();
  var artifacts;
  var normalized;

  config.routingPolicies.routing_main.routing_mode = 'key_only';
  config.routingPolicies.routing_main.classifier_ref = 'classifier_main';
  config.routingPolicies.routing_main.classifierRef = 'classifier_main';
  config.routingPolicies.routing_main.rules = [];
  config.routingPolicies.routing_main.key_rules = [
    {
      rule_name: 'vip_response',
      enabled: true,
      match: {
        virtual_key_tag: 'vip'
      },
      action: 'respond',
      response_message: 'vip'
    }
  ];
  config.listeners.listener_legacy.classifier_ref = 'classifier_main';
  config.listeners.listener_legacy.classifierRef = 'classifier_main';

  normalized = configProcessor.normalizeBlock(config);
  assert.strictEqual(normalized.routingPolicies.routing_main.classifier_ref, '');
  assert.strictEqual(normalized.routingPolicies.routing_main.classifierRef, undefined);
  assert.strictEqual(normalized.listeners.listener_legacy.classifier_ref, '');
  assert.strictEqual(normalized.listeners.listener_legacy.classifierRef, undefined);

  artifacts = configProcessor.buildArtifacts(normalized);
  assert.strictEqual(artifacts.ifiles.routing_policies.content.routingPolicies.routing_main.classifier_ref, '');
  assert.strictEqual(artifacts.ifiles.config_snapshot.content.block.routingPolicies.routing_main.classifierRef, undefined);
  assert.strictEqual(artifacts.ifiles.config_snapshot.content.block.listeners.listener_legacy.classifier_ref, '');
}

function assertDisabledPolicyEntriesDoNotBlockValidation() {
  var config = buildLegacyConfig();
  var validation;

  config.routingPolicies.routing_main.routing_mode = 'key_then_classifier';
  config.listeners.listener_legacy.client_auth_type = 'virtual_key';
  config.listeners.listener_legacy.allowed_virtual_key_pool_refs = ['vk_pool_shared'];
  config.virtualKeyPools = {
    vk_pool_shared: {
      pool_name: 'Shared',
      enabled: true
    }
  };
  config.routingPolicies.routing_main.rules.push({
    rule_name: '',
    source_tag: '',
    action: 'route',
    backend_target_ref: '',
    response_message: '',
    enabled: false
  });

  config.routingPolicies.routing_main.key_rules = [
    {
      rule_name: '',
      enabled: false,
      match: {
        virtual_key_tag: 'vip'
      },
      action: 'route',
      backend_target_ref: ''
    }
  ];

  validation = configProcessor.validateBlock(config);
  assert.strictEqual(validation.valid, true);
  assert.deepStrictEqual(validation.issues, []);
}

function assertPolicyClassifiersMustShareTagSetForV1VirtualKeyRouting() {
  var config = buildLegacyConfig();
  var validation;

  config.classifiers.classifier_alt = {
    classifier_name: 'classifier_alt',
    classifier_type: 'classifier_llm',
    schema_family: 'openai_chat_compatible',
    endpoint_url: 'https://classifier-alt.example.local/chat/completions',
    api_key: '',
    pool_name: 'pool_classifier_alt',
    model_id: 'classifier-alt-model',
    classifier_prompt: 'Choose the best route tag.',
    candidate_tags: ['general', 'vip'],
    fallback_tag: 'general'
  };
  config.routingPolicies.routing_main.routing_mode = 'key_then_classifier';
  config.routingPolicies.routing_main.key_rules = [
    {
      rule_name: 'vip_classify',
      enabled: true,
      match: {
        virtual_key_tag: 'vip'
      },
      action: 'classify',
      classifier_ref: 'classifier_alt'
    }
  ];

  validation = configProcessor.validateBlock(config);
  assert.strictEqual(validation.valid, false);
  assert.ok(
    validation.issues.indexOf('Policy "routing_main" references classifiers with different Candidate Tags or Fallback Tag. V1 requires all classifiers in one policy to share the same tag set.') >= 0,
    'expected classifier tag-set consistency validation issue'
  );
}

function assertKeyRulesWithVirtualKeyRefMustMatchActualKeyMetadata() {
  var config = buildLegacyConfig();
  var validation;

  config.listeners.listener_legacy.client_auth_type = 'virtual_key';
  config.listeners.listener_legacy.allowed_virtual_key_pool_refs = ['pool_alpha'];
  config.virtualKeyPools = {
    pool_alpha: {
      pool_name: 'Alpha',
      enabled: true
    },
    pool_beta: {
      pool_name: 'Beta',
      enabled: true
    }
  };
  config.virtualKeys = {
    key_hq: {
      kid: 'kid_hq',
      tag: 'HQ',
      virtual_key_pool_ref: 'pool_alpha',
      enabled: true,
      secret_hash_alg: 'sha256',
      secret_hash: 'sha256:abcdef'
    }
  };
  config.routingPolicies.routing_main.routing_mode = 'key_only';
  config.routingPolicies.routing_main.classifier_ref = '';
  config.routingPolicies.routing_main.rules = [];
  config.routingPolicies.routing_main.key_rules = [
    {
      rule_name: 'hq_route',
      enabled: true,
      match: {
        virtual_key_ref: 'key_hq',
        virtual_key_tag: 'SingHQ',
        virtual_key_pool_ref: 'pool_beta'
      },
      action: 'route',
      backend_target_ref: 'backend_priority'
    }
  ];

  validation = configProcessor.validateBlock(config);
  assert.strictEqual(validation.valid, false);
  assert.ok(
    validation.issues.indexOf('Routing Policy "routing_main" key entry #1 references Virtual Key "key_hq" with tag "SingHQ", but the key tag is "HQ". Update the key rule tag or clear the tag match.') >= 0,
    'expected key tag mismatch validation issue'
  );
  assert.ok(
    validation.issues.indexOf('Routing Policy "routing_main" key entry #1 references Virtual Key "key_hq" with pool "pool_beta", but the key pool is "pool_alpha". Update the key rule pool or clear the pool match.') >= 0,
    'expected key pool mismatch validation issue'
  );
}

function assertUnusedPoliciesDoNotBlockListenerCutoverFromInvalidKeyRules() {
  var config = buildLegacyConfig();
  var validation;

  config.virtualKeyPools = {
    pool_alpha: {
      pool_name: 'Alpha',
      enabled: true
    },
    pool_beta: {
      pool_name: 'Beta',
      enabled: true
    }
  };
  config.virtualKeys = {
    key_hq: {
      kid: 'kid_hq',
      tag: 'HQ',
      virtual_key_pool_ref: 'pool_alpha',
      enabled: true,
      secret_hash_alg: 'sha256',
      secret_hash: 'sha256:abcdef'
    }
  };
  config.routingPolicies.routing_unused = {
    policy_type: 'routing',
    policy_name: 'routing_unused',
    routing_mode: 'key_only',
    classifier_ref: '',
    default_rule: {
      action: 'route',
      backend_target_ref: 'backend_general',
      response_message: ''
    },
    rules: [],
    key_rules: [
      {
        rule_name: 'stale_hq_route',
        enabled: true,
        match: {
          virtual_key_ref: 'key_hq',
          virtual_key_tag: 'SingHQ',
          virtual_key_pool_ref: 'pool_beta'
        },
        action: 'route',
        backend_target_ref: 'backend_priority'
      }
    ]
  };

  validation = configProcessor.validateBlock(config);
  assert.strictEqual(validation.valid, true);
  assert.strictEqual(
    validation.issues.indexOf('Routing Policy "routing_unused" key entry #1 references Virtual Key "key_hq" with tag "SingHQ", but the key tag is "HQ". Update the key rule tag or clear the tag match.'),
    -1,
    'unused policy key tag mismatch should not block deploy'
  );
  assert.strictEqual(
    validation.issues.indexOf('Routing Policy "routing_unused" key entry #1 references Virtual Key "key_hq" with pool "pool_beta", but the key pool is "pool_alpha". Update the key rule pool or clear the pool match.'),
    -1,
    'unused policy key pool mismatch should not block deploy'
  );
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

runTest('legacy config normalizes missing virtual key collections and listener defaults', assertLegacyNormalizationAndValidation);
runTest('legacy config artifacts omit virtual key data groups and preserve existing runtime data', assertLegacyArtifactsStayCleanAndPreserveData);
runTest('virtual key listeners without an allowlist fail validation clearly', assertVirtualKeyAllowlistValidationFailure);
runTest('stale persisted activeIds and edit modes are normalized to valid records', assertStaleActiveIdsNormalizeToExistingRecords);
runTest('listener enabled flag normalizes to boolean and defaults to enabled', assertListenerEnabledNormalizesToBooleanAndDefaultsTrue);
runTest('routing policy defaults preserve classifier-only mode and empty key rules', assertRoutingPolicyDefaultsIncludeClassifierOnlyAndEmptyKeyRules);
runTest('key-only policies can omit a policy classifier until a key classify rule needs one', assertKeyOnlyPoliciesCanSkipPolicyClassifierUntilKeyClassifyIsUsed);
runTest('key rules require exactly one Source', assertKeyRulesRequireExactlyOneSource);
runTest('key-only policies drop stale policy classifier refs during normalization', assertKeyOnlyPoliciesDropStalePolicyClassifierRef);
runTest('disabled policy entries do not block validation', assertDisabledPolicyEntriesDoNotBlockValidation);
runTest('virtual-key routing classifiers within one policy must share the same tag set', assertPolicyClassifiersMustShareTagSetForV1VirtualKeyRouting);
runTest('key rules with a Virtual Key ref must match the actual key tag and pool', assertKeyRulesWithVirtualKeyRefMustMatchActualKeyMetadata);
runTest('unused policies do not block listener cutover from invalid key rules', assertUnusedPoliciesDoNotBlockListenerCutoverFromInvalidKeyRules);
runTest('provider credential pools normalize, validate, and publish into managed ifiles', assertProviderCredentialPoolsNormalizeValidateAndPublish);
runTest('provider credential pools reject conflicting backend auth sources and invalid pool entries', assertProviderCredentialPoolValidationRejectsConflictsAndEmptyPools);

if (!process.exitCode) {
  process.stdout.write('All configProcessor compatibility tests passed.\n');
}
