'use strict';

function normalizeHealthStatus(member) {
  if (member && member.health_status) {
    return String(member.health_status);
  }
  if (member && member.health === 'ok') {
    return 'healthy';
  }
  if (member && member.health === 'warn') {
    return 'problem';
  }
  return String((member && member.health) || 'unknown');
}

function summarizeBackendHealth(backendTargets) {
  return Object.keys(backendTargets || {}).map(function (targetId) {
    var target = backendTargets[targetId];
    var members = target.members || [];
    var healthy = members.filter(function (member) {
      return normalizeHealthStatus(member) === 'healthy';
    }).length;
    var problems = members.filter(function (member) {
      return normalizeHealthStatus(member) === 'problem';
    }).length;
    var disabled = members.filter(function (member) {
      return normalizeHealthStatus(member) === 'disabled';
    }).length;

    return {
      id: targetId,
      pool_name: target.pool_name,
      member_count: members.length,
      healthy_members: healthy,
      problem_members: problems,
      disabled_members: disabled,
      degraded: problems > 0 || healthy + disabled !== members.length,
      health_status: target.health_status || (target.status && target.status.health_status) || 'unknown'
    };
  });
}

function summarizeRuntime(block) {
  return {
    operatingMode: block.operatingMode || 'gateway',
    listener_count: Object.keys(block.listeners || {}).length,
    classifier_count: Object.keys(block.classifiers || {}).length,
    backend_target_count: Object.keys(block.backendTargets || {}).length,
    routing_policy_count: Object.keys(block.routingPolicies || {}).length,
    backend_health: summarizeBackendHealth(block.backendTargets || {})
  };
}

module.exports = {
  summarizeBackendHealth: summarizeBackendHealth,
  summarizeRuntime: summarizeRuntime
};
