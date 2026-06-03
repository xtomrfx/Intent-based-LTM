"use strict";

var deployHelper = require("./deployHelper");

function DeployWorker() {
    this.WORKER_URI_PATH = "iapps/AITrafficOrchestrator/deploy";
    this.isPublic = true;
    this.isPassThrough = true;
}

function readRequestBody(restOperation) {
    var body = typeof restOperation.getBody === "function" ? restOperation.getBody() : null;
    if (typeof body === "string") {
        body = JSON.parse(body);
    }

    if (body && body.encoding === "base64-json-v1" && typeof body.payload === "string") {
        return JSON.parse(bufferFromBase64(body.payload).toString("utf8"));
    }

    return body || {};
}

function bufferFromBase64(value) {
    if (typeof Buffer.from === "function") {
        return Buffer.from(value, "base64");
    }
    return new Buffer(value, "base64");
}

DeployWorker.prototype.onPost = function(restOperation) {
    var requestBody;
    var result;

    try {
        requestBody = readRequestBody(restOperation);
        result = deployHelper.applyConfig(requestBody);

        if (typeof restOperation.setHeaders === "function") {
            restOperation.setHeaders({
                "Content-Type": "application/json; charset=UTF-8"
            });
        }

        // iApps LX wraps non-2xx worker responses in a Java ProtocolException.
        // Keep handled deploy failures in the JSON body so the UI can show the
        // real issue text and profile instead of a transport-layer wrapper.
        restOperation.setStatusCode(200);
        restOperation.setBody(result);

        if (typeof this.completeRestOperation === "function") {
            this.completeRestOperation(restOperation);
        } else if (typeof restOperation.complete === "function") {
            restOperation.complete();
        }
    } catch (err) {
        restOperation.fail(new Error("Deploy Worker Error: " + err.message));
    }
};

module.exports = DeployWorker;
