'use strict';

var assert = require('assert');
var deployHelper = require('../iapps-lx/ai-traffic-orchestrator/nodejs/deployHelper');
var testApi = deployHelper._test;

function buildNumberedRecords(count, prefix) {
  var records = {};
  var i;

  for (i = 0; i < count; i += 1) {
    records[prefix + i] = 'v=' + i;
  }

  return records;
}

function renderDiffScript(desired, current, options) {
  var lines = [];

  testApi.appendDataGroupDiffApplyScript(lines, testApi.VIRTUAL_KEYS_DG, desired, current, options || {
    replaceThreshold: testApi.DATA_GROUP_DIFF_REPLACE_THRESHOLD
  });

  return lines.join('\n');
}

function assertDiffCalculation() {
  var current = {
    kid_a: 'old',
    kid_b: 'same',
    kid_c: 'delete'
  };
  var desired = {
    kid_a: 'new',
    kid_b: 'same',
    kid_d: 'add'
  };
  var diff = testApi.diffDataGroupRecords(current, desired);

  assert.deepStrictEqual(diff.add, { kid_d: 'add' });
  assert.deepStrictEqual(diff.update, { kid_a: 'new' });
  assert.deepStrictEqual(diff.deleteKeys, ['kid_c']);
  assert.strictEqual(diff.currentCount, 3);
  assert.strictEqual(diff.desiredCount, 3);
  assert.strictEqual(diff.changedCount, 3);
  assert.strictEqual(diff.changedRatio, 1);
}

function assertMissingDataGroupCreatesFullRecords() {
  var script = renderDiffScript({
    kid_a: 'v=1,state=enabled'
  }, {
    exists: false,
    records: {}
  });

  assert.ok(script.indexOf('tmsh create ltm data-group internal /Common/dg_ai_gateway_virtual_keys type string records add') >= 0);
  assert.ok(script.indexOf('kid_a { data "v=1,state=enabled" }') >= 0);
}

function assertEmptyDesiredDeletesDataGroup() {
  var script = renderDiffScript({}, {
    exists: true,
    records: {
      kid_a: 'v=1'
    }
  });

  assert.ok(script.indexOf('tmsh delete ltm data-group internal /Common/dg_ai_gateway_virtual_keys') >= 0);
  assert.strictEqual(script.indexOf('replace-all-with'), -1);
}

function assertSmallDiffUsesMutations() {
  var current = buildNumberedRecords(10, 'kid_');
  var desired = buildNumberedRecords(10, 'kid_');
  var script;

  delete desired.kid_9;
  desired.kid_1 = 'v=updated';
  desired.kid_10 = 'v=10';

  script = renderDiffScript(desired, {
    exists: true,
    records: current
  });

  assert.ok(script.indexOf('records delete { kid_9 }') >= 0);
  assert.ok(script.indexOf('records modify { kid_1 { data "v=updated" } }') >= 0);
  assert.ok(script.indexOf('records add { kid_10 { data "v=10" } }') >= 0);
  assert.strictEqual(script.indexOf('replace-all-with'), -1);
}

function assertLargeDiffFallsBackToReplaceAll() {
  var current = buildNumberedRecords(10, 'kid_');
  var desired = buildNumberedRecords(10, 'kid_');
  var script;

  desired.kid_0 = 'v=updated0';
  desired.kid_1 = 'v=updated1';
  desired.kid_2 = 'v=updated2';
  desired.kid_3 = 'v=updated3';

  script = renderDiffScript(desired, {
    exists: true,
    records: current
  });

  assert.ok(script.indexOf('records replace-all-with') >= 0);
  assert.strictEqual(script.indexOf('records modify'), -1);
  assert.strictEqual(script.indexOf('records add'), -1);
  assert.strictEqual(script.indexOf('records delete'), -1);
}

function assertNoopDoesNotMutate() {
  var script = renderDiffScript({
    kid_a: 'v=1'
  }, {
    exists: true,
    records: {
      kid_a: 'v=1'
    }
  });

  assert.ok(script.indexOf('already in sync') >= 0);
  assert.strictEqual(script.indexOf('tmsh modify'), -1);
  assert.strictEqual(script.indexOf('tmsh create'), -1);
  assert.strictEqual(script.indexOf('tmsh delete'), -1);
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

runTest('data-group diff calculation tracks add update and delete', assertDiffCalculation);
runTest('missing virtual key data-group creates full records', assertMissingDataGroupCreatesFullRecords);
runTest('empty desired virtual key records delete the data-group', assertEmptyDesiredDeletesDataGroup);
runTest('small virtual key data-group diffs use record mutations', assertSmallDiffUsesMutations);
runTest('large virtual key data-group diffs fall back to replace-all-with', assertLargeDiffFallsBackToReplaceAll);
runTest('in-sync virtual key data-group emits no mutation commands', assertNoopDoesNotMutate);

if (!process.exitCode) {
  process.stdout.write('All data-group diff deploy tests passed.\n');
}
