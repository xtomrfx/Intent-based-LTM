'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');

var appPath = path.join(__dirname, '../iapps-lx/ai-traffic-orchestrator/presentation/app.js');
var appSource = fs.readFileSync(appPath, 'utf8');

assert.ok(
  appSource.indexOf('document.activeElement === tagInput') >= 0 &&
    appSource.indexOf('if (!isEditingTagInput)') >= 0,
  'NLI Candidate Tags input should preserve in-progress typing instead of reformatting on every keystroke'
);

assert.ok(
  appSource.indexOf('raw.split(/[,\\uFF0C]/)') >= 0,
  'NLI Candidate Tags parser should accept both English and Chinese commas as separators'
);

assert.ok(
  appSource.indexOf("DEFAULT_NLI_HYPOTHESIS_TEMPLATE = 'This text is about {}.'") >= 0 &&
    appSource.indexOf('ensureClassifierNliDefaultHypothesis(classifier)') >= 0,
  'NLI classifier form should default Hypothesis Template when the field is empty'
);

process.stdout.write('PASS classifier NLI Candidate Tags UI static checks\n');
