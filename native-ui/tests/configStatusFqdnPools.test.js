'use strict';

var assert = require('assert');
var childProcess = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');
var deployHelper = require('../iapps-lx/ai-traffic-orchestrator/nodejs/deployHelper');

function buildBlock() {
  return {
    operatingMode: 'gateway',
    activeIds: {
      listener: '',
      classifier: 'classifier_main',
      backend: 'glm5',
      policy: '',
      ruleIndex: 0
    },
    ui: {
      classifierEditorMode: 'empty',
      listenerEditorMode: 'empty',
      backendEditorMode: 'edit',
      policyEditorMode: 'empty'
    },
    listeners: {},
    classifiers: {
      classifier_main: {
        classifier_name: 'classifier_main',
        classifier_type: 'classifier_llm',
        schema_family: 'openai_chat_compatible',
        endpoint_url: 'https://classifier.example.local/v1/chat/completions',
        api_key: '',
        pool_name: '/Common/classifier_pool',
        model_id: 'classifier-model',
        classifier_prompt: 'classify'
      }
    },
    backendTargets: {
      glm5: {
        backend_target_name: 'glm5',
        schema_family: 'openai_chat_compatible',
        endpoint_url: 'https://glm5.example.local/v1/chat/completions',
        api_key: '',
        model_id: 'glm-5',
        pool_name: '/Common/glm5_pool',
        backend_prompt: '',
        backend_prompt_mode: 'append'
      }
    },
    routingPolicies: {},
    virtualKeyPools: {},
    virtualKeys: {}
  };
}

function withExecFileSyncStub(fakeOutput, fn) {
  var original = childProcess.execFileSync;

  childProcess.execFileSync = function () {
    return fakeOutput;
  };

  try {
    fn();
  } finally {
    childProcess.execFileSync = original;
  }
}

function withTemporaryDeployedConfig(block, fn) {
  var filePath = deployHelper.DEPLOYED_CONFIG_FILE;
  var backupPath = filePath + '.bak-test-' + process.pid;
  var hadExisting = false;

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath)) {
    fs.copyFileSync(filePath, backupPath);
    hadExisting = true;
  }

  fs.writeFileSync(filePath, JSON.stringify(block, null, 2), 'utf8');

  try {
    fn();
  } finally {
    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      if (!error || error.code !== 'ENOENT') {
        throw error;
      }
    }

    if (hadExisting) {
      fs.renameSync(backupPath, filePath);
    }
  }
}

function withTemporaryVirtualKeyUsage(payload, fn) {
  var files = deployHelper._test.VIRTUAL_KEY_USAGE_FILES || [];
  var originalFiles = files.slice();
  var tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aito-vk-usage-'));
  var tempFiles = originalFiles.map(function (filePath, index) {
    return path.join(tempRoot, index + '-' + path.basename(filePath));
  });
  var backups;

  files.splice.apply(files, [0, files.length].concat(tempFiles));
  backups = tempFiles.map(function (filePath) {
    return {
      filePath: filePath,
      backupPath: filePath + '.bak-test-' + process.pid,
      hadExisting: fs.existsSync(filePath)
    };
  });

  backups.forEach(function (entry) {
    fs.mkdirSync(path.dirname(entry.filePath), { recursive: true });
    if (entry.hadExisting) {
      fs.copyFileSync(entry.filePath, entry.backupPath);
    }
    try {
      fs.unlinkSync(entry.filePath);
    } catch (error) {
      if (!error || error.code !== 'ENOENT') {
        throw error;
      }
    }
  });

  try {
    fs.writeFileSync(files[0], JSON.stringify(payload, null, 2), 'utf8');
    fn();
  } finally {
    backups.forEach(function (entry) {
      try {
        fs.unlinkSync(entry.filePath);
      } catch (error) {
        if (!error || error.code !== 'ENOENT') {
          throw error;
        }
      }
      if (entry.hadExisting) {
        fs.renameSync(entry.backupPath, entry.filePath);
      }
    });
    files.splice.apply(files, [0, files.length].concat(originalFiles));
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function withTemporaryProviderCredentialRuntime(payload, fn) {
  var files = deployHelper._test.PROVIDER_CREDENTIAL_RUNTIME_FILES || [];
  var originalFiles = files.slice();
  var tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aito-credential-runtime-'));
  var tempFiles = originalFiles.map(function (filePath, index) {
    return path.join(tempRoot, index + '-' + path.basename(filePath));
  });
  var backups;

  files.splice.apply(files, [0, files.length].concat(tempFiles));
  backups = tempFiles.map(function (filePath) {
    return {
      filePath: filePath,
      backupPath: filePath + '.bak-test-' + process.pid,
      hadExisting: fs.existsSync(filePath)
    };
  });

  backups.forEach(function (entry) {
    fs.mkdirSync(path.dirname(entry.filePath), { recursive: true });
    if (entry.hadExisting) {
      fs.copyFileSync(entry.filePath, entry.backupPath);
    }
    try {
      fs.unlinkSync(entry.filePath);
    } catch (error) {
      if (!error || error.code !== 'ENOENT') {
        throw error;
      }
    }
  });

  try {
    fs.writeFileSync(files[0], JSON.stringify(payload, null, 2), 'utf8');
    fn();
  } finally {
    backups.forEach(function (entry) {
      try {
        fs.unlinkSync(entry.filePath);
      } catch (error) {
        if (!error || error.code !== 'ENOENT') {
          throw error;
        }
      }
      if (entry.hadExisting) {
        fs.renameSync(entry.backupPath, entry.filePath);
      }
    });
    files.splice.apply(files, [0, files.length].concat(originalFiles));
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function assertFqdnRuntimeHealthDoesNotFlipBackendConfigStatus() {
  var block = buildBlock();
  var annotated;

  withExecFileSyncStub([
    '__AITO_SECTION__ pool:glm5',
    'Ltm::Pool: /Common/glm5_pool',
    '| Availability : available',
    '| State : enabled',
    'Ltm::Pool Member: fqdn-member.example.com:443',
    '| Monitor Status : down',
    '| Session Status : enabled',
    '| State : enabled',
    '| Reason : FQDN template member',
    'Ltm::Pool Member: _auto_203.0.113.10:443',
    '| Monitor Status : up',
    '| Session Status : enabled',
    '| State : enabled',
    '| Reason : monitor up',
    ''
  ].join('\n'), function () {
    annotated = deployHelper.annotateBlockWithStatuses(block, block);
  });

  assert.strictEqual(annotated.backendTargets.glm5.config_status, 'deployed_synced');
  assert.strictEqual(annotated.backendTargets.glm5.status.config_status, 'deployed_synced');
}

function assertConfigLoadCanonicalizesPersistedUiModes() {
  var block = buildBlock();
  var payload;

  block.ui.classifierEditorMode = 'empty';
  block.ui.listenerEditorMode = 'edit';
  block.ui.backendEditorMode = 'edit';
  block.ui.policyEditorMode = 'edit';

  withTemporaryDeployedConfig(block, function () {
    withExecFileSyncStub('', function () {
      payload = deployHelper.loadCurrentConfigWithStatus();
    });
  });

  assert.strictEqual(payload.ui.classifierEditorMode, 'edit');
  assert.strictEqual(payload.ui.listenerEditorMode, 'empty');
  assert.strictEqual(payload.ui.backendEditorMode, 'empty');
  assert.strictEqual(payload.ui.policyEditorMode, 'empty');
}

function assertVirtualKeyLastUsedRuntimeStatusUsesUsageFile() {
  var block = buildBlock();
  var payload;

  block.virtualKeyPools = {
    vk_pool_rd: {
      pool_name: 'R&D',
      enabled: true
    }
  };
  block.virtualKeys = {
    kid_used: {
      kid: 'kid_used',
      tag: 'rd',
      virtual_key_pool_ref: 'vk_pool_rd',
      last_used_at: ''
    },
    alias_record: {
      kid: 'kid_alias',
      tag: 'rd',
      virtual_key_pool_ref: 'vk_pool_rd',
      last_used_at: ''
    }
  };

  withTemporaryDeployedConfig(block, function () {
    withTemporaryVirtualKeyUsage({
      version: 1,
      virtualKeys: {
        kid_used: {
          last_used_at: '2026-05-11T12:34:56Z'
        },
        kid_alias: {
          lastUsedAt: '2026-05-10'
        }
      }
    }, function () {
      withExecFileSyncStub('', function () {
        payload = deployHelper.loadCurrentRuntimeHealth();
      });
    });
  });

  assert.strictEqual(payload.virtualKeys.kid_used.last_used_at, '2026-05-11');
  assert.strictEqual(payload.virtualKeys.alias_record.last_used_at, '2026-05-10');
}

function assertProviderCredentialRuntimeStatusUsesRuntimeFile() {
  var block = buildBlock();
  var payload;

  block.providerCredentialPools = {
    deepseekp: {
      pool_name: 'DeepSeek',
      vendor: 'deepseek',
      selection_mode: 'priority_failover',
      cooldown_seconds: 30,
      enabled: true,
      entries: [
        {
          credential_id: 'primary',
          display_name: 'Primary',
          enabled: true,
          priority: 100,
          api_key: 'sk-primary'
        },
        {
          credential_id: 'backup',
          display_name: 'Backup',
          enabled: true,
          priority: 200,
          api_key: 'sk-backup'
        }
      ]
    }
  };

  withTemporaryDeployedConfig(block, function () {
    withTemporaryProviderCredentialRuntime({
      version: 1,
      providerCredentialPools: {
        deepseekp: {
          credentials: {
            primary: {
              runtime_state: 'rate_limited',
              status_code: 429,
              last_failure_reason: 'Retry-After 30s',
              last_failure_at: '2026-05-18T10:00:00.000Z',
              cooldown_until: '2026-05-18T10:00:30.000Z',
              cooldown_until_epoch: 1779079230,
              fallback_count: 2,
              updated_at: '2026-05-18T10:00:01.000Z'
            },
            backup: {
              runtime_state: 'available',
              status_code: 200,
              last_used_at: '2026-05-18T10:00:02.000Z',
              updated_at: '2026-05-18T10:00:02.000Z'
            }
          }
        }
      }
    }, function () {
      withExecFileSyncStub('', function () {
        payload = deployHelper.loadCurrentRuntimeHealth();
      });
    });
  });

  assert.strictEqual(payload.providerCredentialPools.deepseekp.credentials.primary.runtime_state, 'rate_limited');
  assert.strictEqual(payload.providerCredentialPools.deepseekp.credentials.primary.last_failure_reason, 'Retry-After 30s');
  assert.strictEqual(payload.providerCredentialPools.deepseekp.credentials.primary.fallback_count, 2);
  assert.strictEqual(payload.providerCredentialPools.deepseekp.credentials.backup.runtime_state, 'available');
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

runTest('FQDN runtime pool members do not mark deployed backend config as draft', assertFqdnRuntimeHealthDoesNotFlipBackendConfigStatus);
runTest('config load canonicalizes persisted UI editor modes', assertConfigLoadCanonicalizesPersistedUiModes);
runTest('virtual key last-used status is read from runtime usage state', assertVirtualKeyLastUsedRuntimeStatusUsesUsageFile);
runTest('provider credential runtime status is read from runtime state', assertProviderCredentialRuntimeStatusUsesRuntimeFile);

if (!process.exitCode) {
  process.stdout.write('All FQDN config status tests passed.\n');
}
