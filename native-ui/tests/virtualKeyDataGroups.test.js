'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var configProcessor = require('../iapps-lx/ai-traffic-orchestrator/nodejs/configProcessor');

function buildVirtualKeyConfig() {
  return {
    operatingMode: 'gateway',
    listeners: {
      listener_vk: {
        listener_name: 'listener_vk',
        virtual_service: 'vs_vk',
        vip: '10.0.0.1',
        port: 8080,
        policy_ref: 'routing_main',
        client_auth_type: 'virtual_key',
        allowed_virtual_key_pool_refs: ['pool_alpha']
      },
      listener_none: {
        listener_name: 'listener_none',
        virtual_service: 'vs_none',
        vip: '10.0.0.2',
        port: 8081,
        policy_ref: 'routing_main',
        client_auth_type: 'none',
        allowed_virtual_key_pool_refs: ['pool_alpha']
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
        candidate_tags: ['RD'],
        fallback_tag: 'RD'
      }
    },
    backendTargets: {
      backend_general: {
        backend_target_name: 'backend_general',
        schema_family: 'openai_chat_compatible',
        endpoint_url: 'https://backend.example.local/v1/chat/completions',
        api_key: '',
        model_id: 'backend-model',
        pool_name: '/Common/pool_backend'
      }
    },
    routingPolicies: {
      routing_main: {
        policy_type: 'routing',
        policy_name: 'routing_main',
        classifier_ref: 'classifier_main',
        default_rule: {
          action: 'route',
          backend_target_ref: 'backend_general',
          response_message: ''
        },
        rules: []
      }
    },
    virtualKeyPools: {
      pool_alpha: {
        pool_name: 'Pool|One,Name',
        description: 'Pool|desc, "quoted" \\ slash { brace }',
        enabled: true
      }
    },
    virtualKeys: {
      key_one: {
        kid: 'kid-one',
        tag: 'RD',
        virtual_key_pool_ref: 'pool_alpha',
        enabled: true,
        description: 'Key|desc, "quoted" \\ slash { brace }',
        created_at: '2026-04-01T12:30:45.000Z',
        createdAt: '2024-01-01T00:00:00.000Z',
        lastUsedAt: 1712144445000,
        secret_hash_alg: 'sha256',
        secret_hash: 'sha256:abcdef123456',
        plaintextSecret: 'vk-plain-secret'
      },
      key_two: {
        kid: 'kid-two',
        tag: 'RD',
        virtual_key_pool_ref: 'pool_alpha',
        enabled: false,
        description: '',
        secret_hash_alg: 'sha256',
        secret_hash: 'sha256:fedcba654321'
      }
    }
  };
}

function assertVirtualKeyRecordsUseCommaDelimiter() {
  var artifacts = configProcessor.buildArtifacts(buildVirtualKeyConfig());
  var keyRecord = artifacts.dataGroups.virtual_keys.records['kid-one'];
  var poolRecord = artifacts.dataGroups.virtual_key_pools.records.pool_alpha;
  var snapshotKeyOne = artifacts.ifiles.config_snapshot.content.block.virtualKeys.key_one;
  var snapshotKeyTwo = artifacts.ifiles.config_snapshot.content.block.virtualKeys.key_two;
  var keyParts = keyRecord.split(',');
  var poolParts = poolRecord.split(',');

  assert.strictEqual(keyRecord.indexOf('|'), -1);
  assert.strictEqual(poolRecord.indexOf('|'), -1);

  assert.deepStrictEqual(keyParts.slice(0, 6), [
    'v=1',
    'state=enabled',
    'tag=RD',
    'pool=pool_alpha',
    'alg=sha256',
    'hash=abcdef123456'
  ]);
  assert.strictEqual(keyParts.length, 7);
  assert.strictEqual(keyParts[6].indexOf('desc='), 0);
  assert.strictEqual(keyParts[6].indexOf('|'), -1);
  assert.strictEqual(keyParts[6].indexOf(','), -1);
  assert.ok(keyParts[6].indexOf('"quoted"') >= 0);
  assert.ok(keyParts[6].indexOf('\\ slash') >= 0);
  assert.ok(keyParts[6].indexOf('{ brace }') >= 0);

  assert.deepStrictEqual(poolParts.slice(0, 2), [
    'v=1',
    'state=enabled'
  ]);
  assert.strictEqual(poolParts.length, 4);
  assert.strictEqual(poolParts[2].indexOf('name='), 0);
  assert.strictEqual(poolParts[3].indexOf('desc='), 0);
  assert.strictEqual(poolParts[2].indexOf('|'), -1);
  assert.strictEqual(poolParts[2].indexOf(','), -1);
  assert.strictEqual(poolParts[3].indexOf('|'), -1);
  assert.strictEqual(poolParts[3].indexOf(','), -1);

  assert.strictEqual(snapshotKeyOne.created_at, '2026-04-01T12:30:45.000Z');
  assert.strictEqual(snapshotKeyOne.last_used_at, '1712144445000');
  assert.strictEqual(snapshotKeyOne.createdAt, undefined);
  assert.strictEqual(snapshotKeyOne.lastUsedAt, undefined);
  assert.strictEqual(snapshotKeyOne.plaintextSecret, undefined);
  assert.strictEqual(snapshotKeyTwo.created_at, '');
  assert.strictEqual(snapshotKeyTwo.last_used_at, '');

  assert.strictEqual(keyRecord.indexOf('2026-04-01T12:30:45.000Z'), -1);
  assert.strictEqual(keyRecord.indexOf('1712144445000'), -1);
  assert.strictEqual(keyRecord.indexOf('vk-plain-secret'), -1);
}

function assertListenerVirtualKeyPoolAllowlistArtifacts() {
  var config = buildVirtualKeyConfig();
  var allowlistDataGroup;

  config.listeners.listener_vk.allowed_virtual_key_pool_refs = ['pool_alpha', 'pool_alpha', 'pool_missing'];
  allowlistDataGroup = configProcessor.buildArtifacts(config).dataGroups.listener_virtual_key_pool_allowlist;

  assert.strictEqual(allowlistDataGroup.name, '/Common/dg_ai_gateway_listener_vk_pool_allowlist');
  assert.deepStrictEqual(allowlistDataGroup.records, {
    'listener_vk~pool_alpha': 'enabled'
  });
}

function assertIRuleUsesExactListenerPoolLookup() {
  var irulePath = path.join(__dirname, '..', '..', 'llm_semantic_route.tcl');
  var iruleSource = fs.readFileSync(irulePath, 'utf8');

  assert.ok(iruleSource.indexOf('set static::llm_semantic_dg_listener_vk_pool_allowlist "/Common/dg_ai_gateway_listener_vk_pool_allowlist"') >= 0);
  assert.ok(iruleSource.indexOf('split $llm_semantic_vk_record ","') >= 0);
  assert.ok(iruleSource.indexOf('split $llm_semantic_vk_pool_record ","') >= 0);
  assert.ok(iruleSource.indexOf('set llm_semantic_vk_listener_pool_key "${llm_semantic_listener_ref}~${llm_semantic_vk_pool}"') >= 0);
  assert.ok(iruleSource.indexOf('if { $llm_semantic_listener_ref ne "" && $llm_semantic_vk_pool ne "" } {') >= 0);
  assert.ok(iruleSource.indexOf('class match -value -- $llm_semantic_vk_listener_pool_key equals $static::llm_semantic_dg_listener_vk_pool_allowlist') >= 0);
  assert.ok(iruleSource.indexOf('foreach llm_semantic_allowed_pool [split $llm_semantic_cfg_allowed_virtual_key_pool_refs ","') < 0);
}

function assertIRuleModelsEndpointAndCredentialRuntimeContracts() {
  var irulePath = path.join(__dirname, '..', '..', 'llm_semantic_route.tcl');
  var iruleSource = fs.readFileSync(irulePath, 'utf8');

  assert.ok(iruleSource.indexOf('Method not allowed for models endpoint.') >= 0);
  assert.ok(iruleSource.indexOf('"Allow" "GET, HEAD, OPTIONS"') >= 0);
  assert.ok(iruleSource.indexOf('Method not allowed for chat or responses endpoint.') >= 0);
  assert.ok(iruleSource.indexOf('"Allow" "POST, OPTIONS"') >= 0);
  assert.ok(iruleSource.indexOf('Endpoint is not supported by this AI Gateway listener.') >= 0);
  assert.ok(iruleSource.indexOf('"code":"not_found"') >= 0);
  assert.ok(iruleSource.indexOf('set llm_semantic_bad_request_body') >= 0);
  assert.ok(iruleSource.indexOf('invalid_json') >= 0);
  assert.ok(iruleSource.indexOf('"Content-Type" "application/json; charset=utf-8"') >= 0);
  assert.ok(iruleSource.indexOf('set llm_semantic_credential_pool_ref [lindex $llm_semantic_fields 23]') >= 0);
  assert.ok(iruleSource.indexOf('recordCredentialRuntime') >= 0);
  assert.ok(iruleSource.indexOf('set llm_semantic_response_credential_scope "${llm_semantic_credential_pool_ref}|${llm_semantic_upstream_host}"') >= 0);
  assert.ok(iruleSource.indexOf('when LB_FAILED') >= 0);
  assert.ok(iruleSource.indexOf('recordCredentialRuntime') > iruleSource.indexOf('when HTTP_RESPONSE'));
}

function assertRuntimeInvalidJsonAndCredentialRefreshContracts() {
  var runtimePath = path.join(__dirname, '..', '..', 'index.js');
  var runtimeSource = fs.readFileSync(runtimePath, 'utf8');

  assert.ok(runtimeSource.indexOf("action: 'bad_request'") >= 0);
  assert.ok(runtimeSource.indexOf("source: 'json_parse_error'") >= 0);
  assert.ok(runtimeSource.indexOf('JSON request body must be an object.') >= 0);
  assert.ok(runtimeSource.indexOf('normalizeUsageDate(current.last_used_at) === today') >= 0);
  assert.ok(runtimeSource.indexOf('String(current.upstream_host || \'\') === upstreamHost') >= 0);
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

runTest('virtual key data groups use comma-delimited records without pipe characters', assertVirtualKeyRecordsUseCommaDelimiter);
runTest('listener virtual key pool allowlist artifacts use exact listener and pool keys', assertListenerVirtualKeyPoolAllowlistArtifacts);
runTest('virtual key iRule parsing uses exact listener/pool lookup with comma-delimited metadata records', assertIRuleUsesExactListenerPoolLookup);
runTest('iRule models endpoint and provider credential runtime contracts stay stable', assertIRuleModelsEndpointAndCredentialRuntimeContracts);
runTest('runtime invalid JSON and credential refresh contracts stay stable', assertRuntimeInvalidJsonAndCredentialRefreshContracts);

if (!process.exitCode) {
  process.stdout.write('All virtual key data-group tests passed.\n');
}
