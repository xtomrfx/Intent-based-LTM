"use strict";

var deployHelper = require("./deployHelper");

function PoolWorker() {
    this.WORKER_URI_PATH = "iapps/AITrafficOrchestrator/pools";
    this.isPublic = true;
    this.isPassThrough = true;
}

function completeJson(worker, restOperation, statusCode, payload) {
    if (typeof restOperation.setHeaders === "function") {
        restOperation.setHeaders({
            "Content-Type": "application/json; charset=UTF-8"
        });
    }

    restOperation.setStatusCode(statusCode);
    restOperation.setBody(payload);

    if (typeof worker.completeRestOperation === "function") {
        worker.completeRestOperation(restOperation);
    } else if (typeof restOperation.complete === "function") {
        restOperation.complete();
    }
}

PoolWorker.prototype.onGet = function(restOperation) {
    var payload;

    try {
        payload = deployHelper.listBigIpPools();
        completeJson(this, restOperation, 200, payload);
    } catch (error) {
        completeJson(this, restOperation, 500, {
            ok: false,
            message: error.message || "Unable to list BIG-IP pools.",
            pools: []
        });
    }
};

module.exports = PoolWorker;
