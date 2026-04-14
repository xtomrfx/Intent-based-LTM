'use strict';

var fs = require('fs');
var path = require('path');
var lib = require('./gateway_config_lib');

function main() {
  var targetPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, 'gateway-config.json');
  var raw;
  var parsed;
  var normalized;

  try {
    raw = fs.readFileSync(targetPath, 'utf8');
  } catch (err) {
    console.error('Unable to read config: ' + err.message);
    process.exit(1);
    return;
  }

  try {
    parsed = JSON.parse(raw);
  } catch (err2) {
    console.error('Invalid JSON: ' + err2.message);
    process.exit(1);
    return;
  }

  try {
    normalized = lib.validateAndNormalizeConfig(parsed);
  } catch (err3) {
    if (err3.details && err3.details.length) {
      console.error('Config validation failed:');
      err3.details.forEach(function(item) {
        console.error('- ' + item);
      });
    } else {
      console.error('Config validation failed: ' + err3.message);
    }
    process.exit(1);
    return;
  }

  console.log(JSON.stringify({
    status: 'ok',
    path: targetPath,
    summary: lib.summarizeConfig(normalized)
  }, null, 2));
}

main();
