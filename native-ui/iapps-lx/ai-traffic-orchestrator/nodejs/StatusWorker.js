"use strict";

var deployHelper = require("./deployHelper");

function StatusWorker() {
    this.WORKER_URI_PATH = "iapps/AITrafficOrchestrator/status";
    this.isPublic = true;
    this.isPassThrough = true;
}

StatusWorker.prototype.onGet = function(restOperation) {
    var payload = deployHelper.loadCurrentRuntimeHealth();

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

module.exports = StatusWorker;
