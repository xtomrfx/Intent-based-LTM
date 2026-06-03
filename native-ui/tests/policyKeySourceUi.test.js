'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');

var appPath = path.join(__dirname, '../iapps-lx/ai-traffic-orchestrator/presentation/app.js');
var appSource = fs.readFileSync(appPath, 'utf8');

assert.ok(
  appSource.indexOf('data-policy-key-source-field="source_type"') >= 0,
  'key-rule UI should expose a single Source type select'
);
assert.ok(
  appSource.indexOf('data-policy-key-entry-field="source_value"') >= 0,
  'key-rule UI should expose a single Source value select'
);
assert.ok(
  appSource.indexOf('buildPolicyVirtualKeyTagOptions') >= 0,
  'key-rule UI should build tag options from existing virtual keys'
);
assert.ok(
  appSource.indexOf('ui_source_type = normalizedSourceType') >= 0,
  'key-rule Source type changes should be retained as UI-only draft state'
);
assert.ok(
  appSource.indexOf('normalizePolicyKeyRule(rule, index, { preserveUiSourceType: true })') >= 0,
  'key-rule renderer should preserve UI-only Source type through rerenders'
);
assert.ok(
  appSource.indexOf('normalizePolicyRecord(policy, Object.keys(state.classifiers || {})[0] || \'\', { preserveUiSourceType: true })') >= 0,
  'policy form render should preserve UI-only Source type during full form rerenders'
);
assert.strictEqual(
  appSource.indexOf('Match Pool</span><select data-policy-key-entry-field="virtual_key_pool_ref"'),
  -1,
  'key-rule UI should not render the legacy Match Pool field'
);
assert.strictEqual(
  appSource.indexOf('Match Key</span><select data-policy-key-entry-field="virtual_key_ref"'),
  -1,
  'key-rule UI should not render the legacy Match Key field'
);
assert.strictEqual(
  appSource.indexOf('Match Key Tag</span><input'),
  -1,
  'key-rule UI should not render a free-text Match Key Tag input'
);

process.stdout.write('PASS policy key Source UI static checks\n');
