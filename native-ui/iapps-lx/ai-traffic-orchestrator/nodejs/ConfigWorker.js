"use strict";

var deployHelper = require("./deployHelper");

function ConfigWorker() {
    this.WORKER_URI_PATH = "iapps/AITrafficOrchestrator/config";
    this.isPublic = true;
    this.isPassThrough = true;
}

ConfigWorker.prototype.onGet = function(restOperation) {
    var payload = deployHelper.loadCurrentConfigWithStatus();

    if (typeof restOperation.setHeaders === "function") {
        restOperation.setHeaders({
            "Content-Type": "application/json; charset=UTF-8"
        });
    }
    restOperation.setStatusCode(200);
    restOperation.setBody(payload);
    if (typeof this.completeRestOperation === "function") {
        this.completeRestOperation(restOperation);
    } else if (typeof restOperation.complete === "function") {
        restOperation.complete();
    }
};

module.exports = ConfigWorker;
