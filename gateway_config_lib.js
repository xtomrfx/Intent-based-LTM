'use strict';

var url = require('url');

var CONFIG_SCHEMA_VERSION = 1;

var DEFAULT_CONFIG = {
  schema_version: CONFIG_SCHEMA_VERSION,
  northbound: {
    allow_chat_completions: true,
    allow_responses: true
  },
  resources: {
    classifiers: {}
  },
  model_endpoints: {},
  pipeline: [],
  runtime: {
    fallback_tag: 'unknown',
    config_reload_interval_ms: 1000,
    request_limits: {
      data_plane_bytes: 524288,
      admin_plane_bytes: 262144,
      classifier_prompt_chars: 16384
    }
  }
};

var SUPPORTED_PROVIDER_TYPES = {
  openai: true,
  openai_like: true
};

var SUPPORTED_POLICY_ACTIONS = {
  drop: true,
  respond: true,
  route: true
};

var SUPPORTED_OPERATION_ACTIONS = {
  drop: true,
  respond: true,
  route: true,
  set_system_prompt: true
};

var SUPPORTED_STAGE_NAMES = {
  normalize: true,
  classify: true,
  policy: true,
  invoke_model: true,
  egress_transform: true
};

function mergeObjects(base, override) {
  var result = {};
  var key;
  base = base || {};
  override = override || {};

  for (key in base) {
    if (Object.prototype.hasOwnProperty.call(base, key)) {
      if (base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])) {
        result[key] = mergeObjects(base[key], {});
      } else if (Array.isArray(base[key])) {
        result[key] = base[key].slice();
      } else {
        result[key] = base[key];
      }
    }
  }

  for (key in override) {
    if (Object.prototype.hasOwnProperty.call(override, key)) {
      if (override[key] && typeof override[key] === 'object' && !Array.isArray(override[key]) &&
          result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])) {
        result[key] = mergeObjects(result[key], override[key]);
      } else if (Array.isArray(override[key])) {
        result[key] = override[key].slice();
      } else {
        result[key] = override[key];
      }
    }
  }

  return result;
}

function pushError(errors, pathText, message) {
  errors.push(pathText + ': ' + message);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isPositiveInteger(value) {
  return typeof value === 'number' && isFinite(value) && Math.floor(value) === value && value > 0;
}

function validateUrlString(value) {
  var parsed;
  if (!isNonEmptyString(value)) {
    return false;
  }
  parsed = url.parse(value);
  return !!(parsed && parsed.protocol && parsed.hostname && (parsed.protocol === 'http:' || parsed.protocol === 'https:'));
}

function rawConfigHasNonEmptySemanticPolicy(rawConfig) {
  return !!(rawConfig &&
    rawConfig.semantic_policy &&
    typeof rawConfig.semantic_policy === 'object' &&
    !Array.isArray(rawConfig.semantic_policy) &&
    Object.keys(rawConfig.semantic_policy).length);
}

function deriveCandidateTags(config) {
  var tags = [];
  var i;
  var policyStage;
  var classifyStage;
  var rules;
  var rule;

  if (!config || !Array.isArray(config.pipeline)) {
    return [];
  }

  for (i = 0; i < config.pipeline.length; i += 1) {
    if (!classifyStage && config.pipeline[i] && config.pipeline[i].name === 'classify') {
      classifyStage = config.pipeline[i];
    }
    if (config.pipeline[i] && config.pipeline[i].name === 'policy') {
      policyStage = config.pipeline[i];
    }
  }

  if (classifyStage && Array.isArray(classifyStage.tags)) {
    for (i = 0; i < classifyStage.tags.length; i += 1) {
      if (isNonEmptyString(classifyStage.tags[i]) && tags.indexOf(classifyStage.tags[i]) === -1) {
        tags.push(classifyStage.tags[i]);
      }
    }
  }

  rules = (policyStage && policyStage.rules) || [];
  for (i = 0; i < rules.length; i += 1) {
    rule = rules[i];
    if (rule && rule.when && isNonEmptyString(rule.when.tag) && tags.indexOf(rule.when.tag) === -1) {
      tags.push(rule.when.tag);
    }
  }

  return tags;
}

function summarizeConfig(config) {
  var actions = {};
  var policySummary = buildSemanticPolicyFromPipeline(config.pipeline || []);
  var key;
  for (key in policySummary) {
    if (Object.prototype.hasOwnProperty.call(policySummary, key)) {
      actions[key] = policySummary[key].action;
    }
  }

  return {
    schema_version: config.schema_version,
    fallback_tag: config.runtime.fallback_tag,
    tags: ((config._derived || {}).candidate_tags || []).slice(),
    classifiers: Object.keys(((config.resources || {}).classifiers) || {}),
    endpoints: Object.keys(config.model_endpoints || {}),
    pipeline: (config.pipeline || []).map(function(stage) { return stage.name; }),
    actions: actions
  };
}

function ensureArray(value) {
  if (Array.isArray(value)) {
    return value.slice();
  }
  if (value === undefined || value === null) {
    return [];
  }
  return [value];
}

function buildSemanticPolicyFromPipeline(pipeline) {
  var result = {};
  var i;
  var j;
  var stage;
  var rules;
  var rule;
  var operations;
  var op;
  var k;

  for (i = 0; i < (pipeline || []).length; i += 1) {
    stage = pipeline[i];
    if (stage && stage.name === 'policy') {
      rules = stage.rules || [];
      for (j = 0; j < rules.length; j += 1) {
        rule = rules[j];
        operations = ensureArray(rule && rule.then);
        op = null;
        for (k = 0; k < operations.length; k += 1) {
          if (operations[k] && SUPPORTED_POLICY_ACTIONS[operations[k].action]) {
            op = operations[k];
            break;
          }
        }
        if (rule && rule.when && isNonEmptyString(rule.when.tag) && op && SUPPORTED_POLICY_ACTIONS[op.action]) {
          result[rule.when.tag] = { action: op.action };
          if (op.endpoint) {
            result[rule.when.tag].endpoint = op.endpoint;
          }
          if (op.message) {
            result[rule.when.tag].message = op.message;
          }
        }
      }
      break;
    }
  }

  return result;
}

function renderClassificationPrompt(template, tags) {
  var tagList = tags.join(', ');
  var baseTemplate = isNonEmptyString(template) ? template :
    'You are a routing classifier inside an AI gateway. Classify the user input into exactly one tag from: {{tags}}. Return only compact JSON like {"tag":"unknown","confidence":0.5}.';

  return baseTemplate
    .replace(/\{\{\s*tags\s*\}\}/g, tagList)
    .replace(/\{\{\s*tag_list\s*\}\}/g, tagList);
}

function validateClassifier(errors, pathText, classifier) {
  validateEndpoint(errors, pathText, classifier, true);
  if (!isNonEmptyString(classifier && classifier.classification_prompt_template)) {
    pushError(errors, pathText + '.classification_prompt_template', 'must be a non-empty string');
  }
}

function validateEndpoint(errors, pathText, endpoint, allowEmptyApiKey) {
  if (!endpoint || typeof endpoint !== 'object' || Array.isArray(endpoint)) {
    pushError(errors, pathText, 'must be an object');
    return;
  }

  if (!SUPPORTED_PROVIDER_TYPES[endpoint.provider_type]) {
    pushError(errors, pathText + '.provider_type', 'must be one of: openai, openai_like');
  }

  if (!validateUrlString(endpoint.base_url)) {
    pushError(errors, pathText + '.base_url', 'must be a valid http/https URL');
  }

  if (endpoint.path !== undefined && endpoint.path !== null && endpoint.path !== '' &&
      (typeof endpoint.path !== 'string' || endpoint.path.charAt(0) !== '/')) {
    pushError(errors, pathText + '.path', 'must start with "/"');
  }

  if (!allowEmptyApiKey && endpoint.api_key !== undefined && endpoint.api_key !== null &&
      typeof endpoint.api_key !== 'string') {
    pushError(errors, pathText + '.api_key', 'must be a string');
  }

  if (!isNonEmptyString(endpoint.model)) {
    pushError(errors, pathText + '.model', 'must be a non-empty string');
  }

  if (endpoint.timeout_ms !== undefined &&
      (!(typeof endpoint.timeout_ms === 'number') || endpoint.timeout_ms <= 0)) {
    pushError(errors, pathText + '.timeout_ms', 'must be a positive number');
  }

  if (endpoint.accept_client_model !== undefined && typeof endpoint.accept_client_model !== 'boolean') {
    pushError(errors, pathText + '.accept_client_model', 'must be a boolean');
  }

  if (endpoint.client_model_aliases !== undefined &&
      (!endpoint.client_model_aliases || typeof endpoint.client_model_aliases !== 'object' || Array.isArray(endpoint.client_model_aliases))) {
    pushError(errors, pathText + '.client_model_aliases', 'must be an object');
  }
}

function validateOperation(errors, pathText, operation, config) {
  if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
    pushError(errors, pathText, 'must be an object');
    return;
  }

  if (!SUPPORTED_OPERATION_ACTIONS[operation.action]) {
    pushError(errors, pathText + '.action', 'must be one of: drop, respond, route, set_system_prompt');
    return;
  }

  if (operation.action === 'respond' && !isNonEmptyString(operation.message)) {
    pushError(errors, pathText + '.message', 'is required when action=respond');
  }

  if (operation.action === 'route') {
    if (!isNonEmptyString(operation.endpoint)) {
      pushError(errors, pathText + '.endpoint', 'is required when action=route');
    } else if (!config.model_endpoints[operation.endpoint]) {
      pushError(errors, pathText + '.endpoint', 'references undefined model endpoint "' + operation.endpoint + '"');
    }
  }

  if (operation.action === 'set_system_prompt' && !isNonEmptyString(operation.value)) {
    pushError(errors, pathText + '.value', 'is required when action=set_system_prompt');
  }
}

function validatePipeline(errors, config) {
  var stages = config.pipeline;
  var policyStageCount = 0;
  var i;
  var j;
  var stage;
  var rules;
  var operations;

  if (!Array.isArray(stages) || !stages.length) {
    pushError(errors, 'pipeline', 'must be a non-empty array');
    return;
  }

  for (i = 0; i < stages.length; i += 1) {
    stage = stages[i];
    if (!stage || typeof stage !== 'object' || Array.isArray(stage)) {
      pushError(errors, 'pipeline[' + i + ']', 'must be an object');
      continue;
    }
    if (!SUPPORTED_STAGE_NAMES[stage.name]) {
      pushError(errors, 'pipeline[' + i + '].name', 'must be one of: normalize, classify, policy, invoke_model, egress_transform');
      continue;
    }
    if (stage.name === 'classify') {
      if (!isNonEmptyString(stage.classifier)) {
        pushError(errors, 'pipeline[' + i + '].classifier', 'is required for classify stage');
      } else if (!config.resources || !config.resources.classifiers || !config.resources.classifiers[stage.classifier]) {
        pushError(errors, 'pipeline[' + i + '].classifier', 'references undefined classifier "' + stage.classifier + '"');
      }
      if (stage.tags !== undefined && !Array.isArray(stage.tags)) {
        pushError(errors, 'pipeline[' + i + '].tags', 'must be an array of strings');
      }
    }
    if (stage.name === 'policy') {
      policyStageCount += 1;
      rules = stage.rules || [];
      if (!Array.isArray(rules) || !rules.length) {
        pushError(errors, 'pipeline[' + i + '].rules', 'must be a non-empty array');
      } else {
        for (j = 0; j < rules.length; j += 1) {
          if (!rules[j] || typeof rules[j] !== 'object' || Array.isArray(rules[j])) {
            pushError(errors, 'pipeline[' + i + '].rules[' + j + ']', 'must be an object');
            continue;
          }
          if (!rules[j].when || typeof rules[j].when !== 'object' || Array.isArray(rules[j].when)) {
            pushError(errors, 'pipeline[' + i + '].rules[' + j + '].when', 'must be an object');
          } else {
            if (rules[j].when.client_model !== undefined && !isNonEmptyString(rules[j].when.client_model)) {
              pushError(errors, 'pipeline[' + i + '].rules[' + j + '].when.client_model', 'must be a non-empty string');
            }
            if (rules[j].when.path !== undefined && !isNonEmptyString(rules[j].when.path)) {
              pushError(errors, 'pipeline[' + i + '].rules[' + j + '].when.path', 'must be a non-empty string');
            }
            if (rules[j].when.tenant !== undefined && !isNonEmptyString(rules[j].when.tenant)) {
              pushError(errors, 'pipeline[' + i + '].rules[' + j + '].when.tenant', 'must be a non-empty string');
            }
            if (rules[j].when.headers !== undefined &&
                (!rules[j].when.headers || typeof rules[j].when.headers !== 'object' || Array.isArray(rules[j].when.headers))) {
              pushError(errors, 'pipeline[' + i + '].rules[' + j + '].when.headers', 'must be an object');
            }
            if (rules[j].when.prompt_regex !== undefined) {
              if (!isNonEmptyString(rules[j].when.prompt_regex)) {
                pushError(errors, 'pipeline[' + i + '].rules[' + j + '].when.prompt_regex', 'must be a non-empty string');
              } else {
                try {
                  new RegExp(rules[j].when.prompt_regex);
                } catch (regexErr) {
                  pushError(errors, 'pipeline[' + i + '].rules[' + j + '].when.prompt_regex', 'must be a valid regular expression');
                }
              }
            }
          }
          operations = ensureArray(rules[j].then);
          if (!operations.length) {
            pushError(errors, 'pipeline[' + i + '].rules[' + j + '].then', 'must contain at least one operation');
          } else {
            operations.forEach(function(op, idx) {
              validateOperation(errors, 'pipeline[' + i + '].rules[' + j + '].then[' + idx + ']', op, config);
            });
          }
        }
      }
      if (stage.default !== undefined && stage.default !== null) {
        operations = ensureArray(stage.default);
        if (!operations.length) {
          pushError(errors, 'pipeline[' + i + '].default', 'must contain at least one operation');
        } else {
          operations.forEach(function(op, idx2) {
            validateOperation(errors, 'pipeline[' + i + '].default[' + idx2 + ']', op, config);
          });
        }
      }
    }
  }

  if (!policyStageCount) {
    pushError(errors, 'pipeline', 'must contain a policy stage');
  }
}

function buildConfigError(errors) {
  var err = new Error('Gateway config validation failed');
  err.details = errors.slice();
  err.message = 'Gateway config validation failed: ' + errors.join('; ');
  return err;
}

function compileDerivedPolicyArtifacts(config) {
  var stages = config.pipeline || [];
  var i;
  var j;
  var stage;
  var rules;
  var rule;

  for (i = 0; i < stages.length; i += 1) {
    stage = stages[i];
    if (!stage || stage.name !== 'policy' || !Array.isArray(stage.rules)) {
      continue;
    }
    rules = stage.rules;
    for (j = 0; j < rules.length; j += 1) {
      rule = rules[j];
      if (rule && rule.when && isNonEmptyString(rule.when.prompt_regex)) {
        rule.when._compiled_prompt_regex = new RegExp(rule.when.prompt_regex);
      }
    }
  }
}

function validateAndNormalizeConfig(rawConfig) {
  var config = mergeObjects(DEFAULT_CONFIG, rawConfig || {});
  var errors = [];
  var policyTags;
  var classifierNames;
  var endpointNames;
  var i;
  var endpointName;

  if (config.schema_version !== CONFIG_SCHEMA_VERSION) {
    pushError(errors, 'schema_version', 'must equal ' + CONFIG_SCHEMA_VERSION);
  }

  if (!config.northbound || typeof config.northbound !== 'object' || Array.isArray(config.northbound)) {
    pushError(errors, 'northbound', 'must be an object');
  } else {
    if (typeof config.northbound.allow_chat_completions !== 'boolean') {
      pushError(errors, 'northbound.allow_chat_completions', 'must be a boolean');
    }
    if (typeof config.northbound.allow_responses !== 'boolean') {
      pushError(errors, 'northbound.allow_responses', 'must be a boolean');
    }
  }

  if (!config.resources || typeof config.resources !== 'object' || Array.isArray(config.resources)) {
    pushError(errors, 'resources', 'must be an object');
  } else if (!config.resources.classifiers || typeof config.resources.classifiers !== 'object' || Array.isArray(config.resources.classifiers)) {
    pushError(errors, 'resources.classifiers', 'must be an object');
  } else if (!Object.keys(config.resources.classifiers).length) {
    pushError(errors, 'resources.classifiers', 'must define at least one classifier');
  } else {
    classifierNames = Object.keys(config.resources.classifiers);
    for (i = 0; i < classifierNames.length; i += 1) {
      validateClassifier(errors, 'resources.classifiers.' + classifierNames[i], config.resources.classifiers[classifierNames[i]]);
    }
  }

  if (!config.model_endpoints || typeof config.model_endpoints !== 'object' || Array.isArray(config.model_endpoints)) {
    pushError(errors, 'model_endpoints', 'must be an object');
  }

  endpointNames = Object.keys(config.model_endpoints || {});
  for (i = 0; i < endpointNames.length; i += 1) {
    endpointName = endpointNames[i];
    validateEndpoint(errors, 'model_endpoints.' + endpointName, config.model_endpoints[endpointName], true);
  }

  if (rawConfig && Object.prototype.hasOwnProperty.call(rawConfig, 'semantic_policy')) {
    pushError(errors, 'semantic_policy', 'compatibility mode has been removed; define rules under pipeline.policy instead');
  }

  validatePipeline(errors, config);

  if (config.runtime !== undefined && (!config.runtime || typeof config.runtime !== 'object' || Array.isArray(config.runtime))) {
    pushError(errors, 'runtime', 'must be an object');
  }

  if (config.runtime && config.runtime.fallback_tag !== undefined &&
      !isNonEmptyString(config.runtime.fallback_tag)) {
    pushError(errors, 'runtime.fallback_tag', 'must be a non-empty string');
  }

  if (config.runtime && config.runtime.config_reload_interval_ms !== undefined &&
      !isPositiveInteger(config.runtime.config_reload_interval_ms)) {
    pushError(errors, 'runtime.config_reload_interval_ms', 'must be a positive integer');
  }

  if (config.runtime && config.runtime.request_limits !== undefined) {
    if (!config.runtime.request_limits || typeof config.runtime.request_limits !== 'object' || Array.isArray(config.runtime.request_limits)) {
      pushError(errors, 'runtime.request_limits', 'must be an object');
    } else {
      if (!isPositiveInteger(config.runtime.request_limits.data_plane_bytes)) {
        pushError(errors, 'runtime.request_limits.data_plane_bytes', 'must be a positive integer');
      }
      if (!isPositiveInteger(config.runtime.request_limits.admin_plane_bytes)) {
        pushError(errors, 'runtime.request_limits.admin_plane_bytes', 'must be a positive integer');
      }
      if (!isPositiveInteger(config.runtime.request_limits.classifier_prompt_chars)) {
        pushError(errors, 'runtime.request_limits.classifier_prompt_chars', 'must be a positive integer');
      }
    }
  }

  if (errors.length) {
    throw buildConfigError(errors);
  }

  config._derived = config._derived || {};
  config._derived.policy_summary = buildSemanticPolicyFromPipeline(config.pipeline);
  compileDerivedPolicyArtifacts(config);

  policyTags = deriveCandidateTags(config);
  if (!policyTags.length) {
    pushError(errors, 'pipeline', 'must define at least one classify tag or policy rule with when.tag');
    throw buildConfigError(errors);
  }

  if (!config.runtime.fallback_tag || policyTags.indexOf(config.runtime.fallback_tag) === -1) {
    if (config._derived.policy_summary.unknown) {
      config.runtime.fallback_tag = 'unknown';
    } else {
      config.runtime.fallback_tag = policyTags[0];
    }
  }

  config._derived.candidate_tags = policyTags.slice();

  return config;
}

module.exports = {
  CONFIG_SCHEMA_VERSION: CONFIG_SCHEMA_VERSION,
  DEFAULT_CONFIG: DEFAULT_CONFIG,
  SUPPORTED_POLICY_ACTIONS: SUPPORTED_POLICY_ACTIONS,
  SUPPORTED_OPERATION_ACTIONS: SUPPORTED_OPERATION_ACTIONS,
  SUPPORTED_STAGE_NAMES: SUPPORTED_STAGE_NAMES,
  SUPPORTED_PROVIDER_TYPES: SUPPORTED_PROVIDER_TYPES,
  mergeObjects: mergeObjects,
  deriveCandidateTags: deriveCandidateTags,
  summarizeConfig: summarizeConfig,
  ensureArray: ensureArray,
  buildSemanticPolicyFromPipeline: buildSemanticPolicyFromPipeline,
  renderClassificationPrompt: renderClassificationPrompt,
  validateAndNormalizeConfig: validateAndNormalizeConfig,
  buildConfigError: buildConfigError
};
