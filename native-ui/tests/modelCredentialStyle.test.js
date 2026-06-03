'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');

var stylePath = path.join(__dirname, '../iapps-lx/ai-traffic-orchestrator/presentation/styles.css');
var appPath = path.join(__dirname, '../iapps-lx/ai-traffic-orchestrator/presentation/app.js');
var indexPath = path.join(__dirname, '../iapps-lx/ai-traffic-orchestrator/presentation/index.html');
var styleSource = fs.readFileSync(stylePath, 'utf8');
var appSource = fs.readFileSync(appPath, 'utf8');
var indexSource = fs.readFileSync(indexPath, 'utf8');

assert.ok(
  /\.virtual-key-table--model-credential-pools thead th,\s*\.virtual-key-table--model-credentials thead th\s*\{[^}]*white-space:\s*nowrap;/m.test(styleSource),
  'Model Credential table headers should stay on one line'
);

assert.ok(
  /\.virtual-key-table--model-credential-pools \.table-primary,\s*\.virtual-key-table--model-credentials \.table-primary\s*\{[^}]*font-size:\s*0\.8rem;[^}]*font-weight:\s*500;/m.test(styleSource),
  'Model Credential primary cells should match Virtual Key compact table typography'
);

assert.ok(
  /#virtualKeyPoolEditor #virtualKeyPoolForm \.field span,\s*#modelCredentialPoolEditor #modelCredentialPoolForm \.field span\s*\{[^}]*font-size:\s*0\.71rem;/m.test(styleSource) &&
    /#virtualKeyPoolEditor #virtualKeyPoolForm input,\s*#modelCredentialPoolEditor #modelCredentialPoolForm input,\s*#modelCredentialPoolEditor #modelCredentialPoolForm select\s*\{[^}]*font-size:\s*0\.82rem;/m.test(styleSource),
  'Model Credential pool editor fields should match Virtual Key Pool compact typography'
);

assert.ok(
  /\.virtual-key-table--model-credential-pools\s*\{[^}]*min-width:\s*32rem;/m.test(styleSource),
  'Model Credential pool table should keep enough width to avoid header collapse'
);

assert.ok(
  /\.virtual-key-table--model-credential-pools th:nth-child\(3\),\s*\.virtual-key-table--model-credential-pools td:nth-child\(3\)\s*\{[^}]*width:\s*9\.25rem;/m.test(styleSource) &&
    /\.virtual-key-table--model-credential-pools th:nth-child\(4\),\s*\.virtual-key-table--model-credential-pools td:nth-child\(4\)\s*\{[^}]*width:\s*auto;/m.test(styleSource),
  'Model Credential pool table should keep Pool Name close to Vendor'
);

assert.ok(
  appSource.indexOf("deepseek: 'DeepSeek'") >= 0 &&
    appSource.indexOf('formatModelCredentialVendorLabel(pool.vendor)') >= 0,
  'Model Credential vendor labels should use display names for known vendors'
);

assert.ok(
  indexSource.indexOf('class="icon-action-button icon-action-button--eye-off" type="button" data-secret-toggle="modelCredential_api_key"') >= 0 &&
    appSource.indexOf("button.classList.toggle('icon-action-button--eye', shouldReveal)") >= 0 &&
    appSource.indexOf("button.classList.toggle('icon-action-button--eye-off', !shouldReveal)") >= 0,
  'Model Credential API key reveal should use the same icon toggle pattern as Virtual Key'
);

assert.ok(
  indexSource.indexOf('<input id="modelCredentialPool_object_id" type="text" readonly>') >= 0 &&
    appSource.indexOf("var base = normalizeIdentifier(name, '');") >= 0 &&
    appSource.indexOf("return buildProviderCredentialPoolId(poolName);") >= 0 &&
    appSource.indexOf("idInput.value = getModelCredentialPoolDraftObjectId() || 'Generated after valid name';") >= 0,
  'Model Credential Pool ID should be read-only and generated from Pool Name like Virtual Key Pool ID'
);

process.stdout.write('PASS model credential table style static checks\n');
