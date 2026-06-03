'use strict';

var assert = require('assert');
var DeployWorker = require('../iapps-lx/ai-traffic-orchestrator/nodejs/DeployWorker');

function buildRestOperation(body) {
  return {
    body: body,
    statusCode: 0,
    responseBody: null,
    completed: false,
    failed: null,
    getBody: function () {
      return this.body;
    },
    setHeaders: function () {},
    setStatusCode: function (statusCode) {
      this.statusCode = statusCode;
    },
    setBody: function (responseBody) {
      this.responseBody = responseBody;
    },
    complete: function () {
      this.completed = true;
    },
    fail: function (error) {
      this.failed = error;
    }
  };
}

function assertHandledDeployFailureUsesJsonBody() {
  var worker = new DeployWorker();
  var operation = buildRestOperation({
    listeners: {
      listener_bad: {}
    }
  });

  worker.onPost(operation);

  assert.strictEqual(operation.failed, null);
  assert.strictEqual(operation.completed, true);
  assert.strictEqual(operation.statusCode, 200);
  assert.strictEqual(operation.responseBody.ok, false);
  assert.ok(Array.isArray(operation.responseBody.issues));
  assert.ok(operation.responseBody.issues.length > 0);
  assert.ok(operation.responseBody.profile);
}

assertHandledDeployFailureUsesJsonBody();
process.stdout.write('All DeployWorker response tests passed.\n');
