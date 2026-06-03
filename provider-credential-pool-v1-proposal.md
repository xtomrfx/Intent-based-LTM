# Provider Credential Pool V1 Proposal

## Purpose

This document defines V1 southbound model-vendor key management for `AI Traffic Orchestrator`.

The user-facing concept may be labeled `Model Keys`, but the internal product object should use
`providerCredentialPools` to keep it distinct from northbound `Virtual Keys`.

## Problem

Current backend and classifier objects store a single southbound `api_key` inline.

That is sufficient for a single-provider demo, but it breaks down when:

- one vendor account has multiple keys
- a key is rate-limited or revoked
- an operator wants operational cutover without touching routing policy
- multiple backend targets should share the same credential set

## V1 Goals

- add a first-class southbound credential pool abstraction
- let a `Backend Target` reference a pool instead of storing one inline key
- support multiple vendor keys in one pool
- support automatic failover away from an unhealthy key
- keep the northbound contract unchanged
- keep BIG-IP deploy impact in the `runtime_artifacts_only` class when only credential pool data changes

## V1 Non-Goals

- no northbound auth changes
- no Virtual Key behavior changes
- no shared health state across HA peers or across separate ILX worker processes
- no weighted load-balancing across keys
- no cost-aware or quota-aware optimization
- no secret manager integration in V1
- no classifier migration in the first delivery; classifier support can reuse the same abstraction in V2

## Recommended Scope

V1 should be implemented for `Backend Targets` first.

Reason:

- this solves the main routed southbound key-management problem
- it avoids mixing new key-pool logic into classifier egress rollout on day one
- it preserves a smaller validation surface for the first release

The runtime abstraction should still be generic so `Classifiers` can adopt it later without a redesign.

## Naming

Use these names consistently:

- UI page label: `Model Keys`
- internal object: `providerCredentialPools`
- backend reference field: `credential_pool_ref`
- pool entry object: `credential`

Avoid naming the internal object `modelKeys`, because one vendor key may serve multiple models and multiple backend targets.

## Object Model

### Top-Level Authoring Object

Add one new top-level section:

```json
{
  "operatingMode": "gateway",
  "listeners": {},
  "classifiers": {},
  "backendTargets": {},
  "routingPolicies": {},
  "providerCredentialPools": {}
}
```

### Provider Credential Pool

```json
{
  "providerCredentialPools": {
    "openai_prod": {
      "pool_name": "OpenAI Production Keys",
      "vendor": "openai",
      "auth_scheme": "bearer",
      "selection_mode": "priority_failover",
      "cooldown_seconds": 30,
      "entries": [
        {
          "credential_id": "openai_prod_a",
          "display_name": "OpenAI Prod A",
          "enabled": true,
          "priority": 100,
          "api_key": "sk-xxxx",
          "status": {
            "state": "healthy"
          }
        },
        {
          "credential_id": "openai_prod_b",
          "display_name": "OpenAI Prod B",
          "enabled": true,
          "priority": 200,
          "api_key": "sk-yyyy",
          "status": {
            "state": "healthy"
          }
        }
      ]
    }
  }
}
```

### Backend Target Reference

```json
{
  "backendTargets": {
    "deepseek_primary": {
      "backend_target_name": "DeepSeek Primary",
      "schema_family": "openai_chat_compatible",
      "endpoint_url": "https://api.deepseek.com/v1/chat/completions",
      "model_id": "deepseek-chat",
      "pool_name": "/Common/deepseek",
      "credential_pool_ref": "openai_prod"
    }
  }
}
```

## Validation Rules

V1 validation should enforce:

- `providerCredentialPools.<id>` must have at least one enabled entry
- `selection_mode` supports only `priority_failover` in V1
- each `credential_id` must be unique within its pool
- each enabled entry must have `api_key`
- `priority` must be an integer; lower number wins
- a `Backend Target` may use either `credential_pool_ref` or inline `api_key`, but not both
- `credential_pool_ref` must reference an existing pool
- if `credential_pool_ref` is set, `api_key`, `apiKey`, `api_key_env`, `apiKeyEnv`, `secret_ref`, and `secretRef` must be rejected

## Runtime Selection Model

V1 selection mode is `priority_failover`.

Selection algorithm:

1. sort enabled entries by ascending `priority`
2. skip entries currently in cooldown
3. pick the first available entry
4. if all entries are cooling down, pick the lowest-priority entry whose cooldown expires first

This is failover, not balancing. V1 should produce stable routing and predictable operator behavior.

## Failure Classification

The runtime must separate request failure classification from long-lived credential health.

### Immediate Credential-Invalid Failures

Treat these as hard failures for the current credential:

- HTTP `401`
- HTTP `403`
- vendor response codes that clearly mean invalid key, revoked key, or forbidden account

Action:

- mark credential `unhealthy`
- open cooldown
- move future requests to the next credential

### Rate-Limit Failures

Treat these as temporary credential failures:

- HTTP `429`
- vendor-specific rate-limit codes

Action:

- mark credential `rate_limited`
- set cooldown from `Retry-After` when present
- otherwise use pool `cooldown_seconds`
- move future requests to the next credential

### Pre-Response Transport Failures

Treat these as temporary upstream transport failures:

- DNS failure
- TCP connect failure
- TLS handshake failure
- connection refused
- request timeout before any upstream response headers

Action:

- record transport failure metrics on the backend target or endpoint path
- return a gateway connectivity failure for the current request
- do not cool down or switch credentials only because of transport failure

### Ambiguous Upstream Execution Failures

These failures may happen after the upstream already started processing:

- HTTP `5xx`
- connection reset after request write
- read timeout after request body is sent

V1 must not automatically retry these on another credential in the same request by default, because the first upstream may already have consumed tokens or completed work.

Action:

- record failure metrics
- optionally cool down the credential after repeated consecutive failures
- return the failure to the caller for the current request
- route subsequent requests to the next credential only after the consecutive-failure threshold is crossed

## Request Retry Rules

V1 should support at most one same-request credential failover.

Eligible for same-request failover:

- `401`
- `403`
- `429`
- connect-time failures before upstream response headers

Not eligible for same-request failover:

- upstream `5xx`
- read timeout after request write
- connection reset after request write
- malformed success response bodies

This keeps V1 conservative on duplicate-billing risk.

## Runtime Status Model

Per-credential runtime state should be in-memory and operational, not part of the durable config source of truth.

Suggested states:

- `healthy`
- `rate_limited`
- `degraded`
- `unhealthy`
- `disabled`

Suggested in-memory fields:

- `last_used_at`
- `last_failure_at`
- `last_failure_reason`
- `consecutive_failures`
- `cooldown_until`
- `request_count`
- `success_count`

## UI Behavior

### New Page

Add a new page after `Virtual Key` pages:

- `Model Keys`

The page should follow the compact list + staged editor pattern already used by `Backend Target`, `Routing Policy`, and `Virtual Key`.

### List Columns

Suggested list columns:

- `Pool Name`
- `Vendor`
- `Entries`
- `Active`
- `Status`

### Entry Rows In Editor

Each credential entry should show:

- `Display Name`
- masked key preview such as `****abcd`
- `Enabled`
- `Priority`
- `State`
- `Cooldown Until`
- `Last Failure`

The full key should be editable in the form but never shown in the list or read-only summary.

### Backend Target Form Change

Replace direct backend `API Key` input with:

- `Credential Source`
- `Inline API Key`
- `Credential Pool`

V1 rollout recommendation:

- preserve backward-compatible read support for existing inline `api_key`
- allow new UI to create pool-backed backends
- optionally keep inline key mode during migration behind a small source selector

## Native iFile Contract

Add one new managed iFile:

- `/Common/ifile_ai_gateway_provider_credential_pools`

Suggested content:

```json
{
  "schema": "f5-ai-gateway.provider-credential-pools/v1",
  "generated_at_utc": "2026-05-08T00:00:00Z",
  "providerCredentialPools": {
    "openai_prod": {
      "pool_name": "OpenAI Production Keys",
      "vendor": "openai",
      "auth_scheme": "bearer",
      "selection_mode": "priority_failover",
      "cooldown_seconds": 30,
      "entries": [
        {
          "credential_id": "openai_prod_a",
          "display_name": "OpenAI Prod A",
          "enabled": true,
          "priority": 100,
          "api_key": "sk-xxxx"
        }
      ]
    }
  }
}
```

`Backend Target` iFile content should add `credential_pool_ref` and continue to allow `api_key` only for backward compatibility.

## Runtime Integration

The ILX runtime should introduce one explicit abstraction:

- `resolveSouthboundCredential(providerConfig, poolRegistry, backendTarget)`

Responsibilities:

- choose the active credential entry
- return the actual key to use for this request
- update in-memory health bookkeeping after the response

The existing transport builder should continue to receive one resolved `apiKey` for the active request.

## Deploy Scope

Pure changes in these areas should remain `runtime_artifacts_only`:

- `providerCredentialPools`
- `backendTargets.<id>.credential_pool_ref`
- inline `api_key` to `credential_pool_ref` migration when endpoint/pool/model do not change

No BIG-IP LTM object change should be required only because a credential pool entry or priority changed.

## Migration And Compatibility

V1 should be additive.

Compatibility rules:

- existing deployed configs with inline backend `api_key` remain valid
- new configs may use `credential_pool_ref`
- runtime resolves `credential_pool_ref` first, then falls back to inline `api_key`
- no automatic background migration is required in V1

## Observability

V1 should expose enough status for operators to understand why a key switched.

Minimum status surface:

- active credential per pool
- per-entry state
- cooldown timer
- last failure reason
- last failure time

This can first be exposed through the existing status API and only later polished in the GUI.

## V1 Risks

- health state is local to each ILX worker process
- HA peers will not share credential health in V1
- same-request retry remains intentionally conservative
- storing multiple inline API keys in the managed iFile increases secret footprint until a future secret-ref design replaces it

## Recommended Delivery Sequence

1. extend authoring model and validation with `providerCredentialPools`
2. extend managed iFile publish/read path
3. add runtime credential resolver and in-memory health state
4. add backend target `credential_pool_ref`
5. add minimal status API exposure
6. add `Model Keys` UI page and backend target form switch
7. add classifier adoption in V2 after backend path is stable

## Summary

V1 should introduce a dedicated southbound credential-pool abstraction, use it for backend targets first, keep selection to simple priority failover, and treat key health as runtime operational state rather than durable config truth.
