'use strict';

module.exports = {
    UiEntryWorker: require('./UiEntryWorker'),
    ConfigWorker: require('./ConfigWorker'),
    StatusWorker: require('./StatusWorker'),
    PoolWorker: require('./PoolWorker'),
    DeployWorker: require('./DeployWorker'),
    TestClassifierWorker: require('./TestClassifierWorker'),
    TestBackendWorker: require('./TestBackendWorker'),
    configProcessor: require('./configProcessor'),
    statsProcessor: require('./statsProcessor')
};
