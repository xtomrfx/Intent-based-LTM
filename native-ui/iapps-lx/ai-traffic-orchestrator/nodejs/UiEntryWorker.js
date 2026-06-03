"use strict";

var fs = require("fs");
var path = require("path");

var APP_ROOT = "/var/config/rest/iapps/AITrafficOrchestrator/presentation";

function readPresentationFile(name) {
    return fs.readFileSync(path.join(APP_ROOT, name), "utf8");
}

function escapeInlineScript(source) {
    return String(source || "").replace(/<\/script/gi, "<\\/script");
}

function UiEntryWorker() {
    this.WORKER_URI_PATH = "iapps/AITrafficOrchestrator";
    this.isPublic = true;
    this.isPassThrough = true;
}

UiEntryWorker.prototype.onGet = function(restOperation) {
    try {
        var html = readPresentationFile("index.html");
        var css = readPresentationFile("styles.css");
        var js = readPresentationFile("app.js");
        var sample = readPresentationFile("data/sample-config.json");

        html = html.replace(
            '<link rel="stylesheet" href="./styles.css">',
            "<style>\n" + css + "\n</style>"
        );
        html = html.replace(
            '<script src="./app.js"></script>',
            '<script>window.__AITO_SAMPLE_STATE__ = ' + escapeInlineScript(sample) + ';</script>\n' +
            '<script>\n' + escapeInlineScript(js) + '\n</script>'
        );

        if (typeof restOperation.setHeaders === "function") {
            restOperation.setHeaders({
                "Content-Type": "text/html; charset=UTF-8",
                "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
                "Pragma": "no-cache"
            });
        }
        restOperation.setStatusCode(200);
        restOperation.setBody(html);
        if (typeof this.completeRestOperation === "function") {
            this.completeRestOperation(restOperation);
        } else if (typeof restOperation.complete === "function") {
            restOperation.complete();
        }
    } catch (err) {
        restOperation.fail(new Error("UI Entry Worker Error: " + err.message));
    }
};

module.exports = UiEntryWorker;
