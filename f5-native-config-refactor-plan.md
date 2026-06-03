# F5 Native-Backed Refactor Plan

## Goal

Use the custom UI as a single entry point, but keep the deployed configuration aligned with F5 native capabilities:

- `Virtual Server / Pool / Monitor / Server SSL Profile` stay as native LTM objects
- `Data Group` stores small lookup-oriented values and object references
- `iFile` stores structured JSON documents such as classifiers, backend targets, routing policies, and future orchestrator definitions
- `iRule` becomes a stable executor instead of a frequently edited config carrier
- `ILX` becomes the decision engine that reads objectized config and returns a compact routing decision

## Authoring And Runtime Layers

The refactor keeps three explicit layers instead of one ambiguous config file:

1. `gateway-config.canonical.json`
   - source of intent
   - optimized for humans, UI, review, and diffs
2. `gateway-config.snapshot.json`
   - published record
   - optimized for device-side inspection and rollback context
3. BIG-IP native objects
   - runtime truth
   - includes `Virtual Server`, `Data Group`, `iFile`, and the active iRule

Rule:

- canonical JSON may be edited
- snapshot JSON is generated, not hand-edited
- BIG-IP native objects remain the only effective runtime source of truth

## Current Local Refactor

This local refactor implements the first stable step:

1. `index.js` can now normalize a preferred object model:
   - `listeners`
   - `classifiers`
   - `backendTargets`
   - `routingPolicies`
   - `runtime.listener_ref`
   - `localRules`
2. The same runtime still accepts the older compatibility model:
   - `targetModels`
   - `promptProfiles`
   - `decisions`
3. Routing policy can now be expressed as an ordered rule list plus `default_rule`, instead of only `tag -> object map`.
4. Backend selection can now resolve by `backend_target_ref`, which is closer to the future UI and F5 native publishing flow.
5. Local rules are no longer hardcoded only in JavaScript; they can be configured through `localRules`.

## Target Object Model

### 1. `listeners`

Represents the UI-level northbound listener object.

Recommended publisher targets:

- `Virtual Server`
- `Data Group` entries for per-listener references and simple settings

Typical fields:

- `virtual_service`
- `vip`
- `port`
- `streaming`
- `client_auth_type`
- `classifier_ref`
- `policy_ref`
- `advanced.max_payload_bytes`
- `advanced.decision_timeout_ms`
- `advanced.request_id_mode`

### 2. `classifiers`

Represents reusable classifier resources.

Recommended publisher targets:

- classifier JSON inside `iFile`
- secret references resolved during publish

Typical fields:

- `classifier_type`
- `schema_family`
- `endpoint_url`
- `api_key_env` / `secret_ref`
- `model_id`
- `classifier_prompt`
- `candidate_tags`
- `fallback_tag`
- `use_built_in_rules_first`
- `timeout_ms`

### 3. `backendTargets`

Represents reusable route destinations with unified behavior.

Recommended publisher targets:

- backend target JSON inside `iFile`
- native `pool`
- native `server ssl profile`
- native `monitor`

Typical fields:

- `endpoint_url`
- `api_key_env` / `secret_ref`
- `model_id`
- `pool_name`
- `backend_prompt`
- `backend_prompt_mode`
- `advanced.server_ssl_profile`
- `advanced.sni_server_name`
- `advanced.monitor`

### 4. `routingPolicies`

Represents ordered rule lists similar to ACL-style evaluation.

Recommended publisher targets:

- policy JSON inside `iFile`
- `Data Group` may optionally store only the active policy reference

Typical fields:

- `policy_type`
- `rules[]`
- `default_rule`

Each rule:

- `source_tag`
- `action`
- `backend_target_ref`
- `response_message`
- `enabled`

## Phase Plan

### Phase 1: Native-Backed Config Model

Deliverables:

- `index.js` supports the object model above
- `classifier-config.json.example` uses the new structure
- routing policy supports ordered rules and `default_rule`
- local rules support config-driven regex rules

Risk:

- low to medium
- local-only behavior change
- deployed environment unaffected until published

### Phase 2: iRule De-hardcode

Deliverables:

- replace `RULE_INIT` hardcoded defaults with lookups from `Data Group`
- keep current northbound protocol rendering in `iRule`
- keep current `Local Response` rendering in `iRule`
- reduce direct dependence on hardcoded backend host/auth/model values

Risk:

- medium
- requires F5 runtime validation

Phase 2 key contract:

- `dg_ai_gateway_listener_refs`
  - key: virtual server name, for example `/Common/vs_llm_semantic_demo_8080`
  - value: listener ref, for example `listener_8080`
- `dg_ai_gateway_listener_settings`
  - key: `<listener_ref>.plugin`
  - key: `<listener_ref>.extension`
  - key: `<listener_ref>.max_payload_bytes`
  - key: `<listener_ref>.decision_timeout_ms`
  - key: `<listener_ref>.service_name`
  - key: `<listener_ref>.root_paths`
  - key: `<listener_ref>.model_paths`
  - key: `<listener_ref>.chat_paths`
  - key: `<listener_ref>.responses_paths`
  - key: `<listener_ref>.northbound_api_mode`
  - key: `<listener_ref>.chat_completions_support`
  - key: `<listener_ref>.responses_support`

Implementation rule:

- if the data group or key does not exist, the iRule must fall back to the previous hardcoded default
- the iRule should stay protocol-stable; only the config source changes in this phase

Current Phase 2 status:

- completed for listener-level northbound routing families and capability status
- `llm_semantic_route_phase2` now reads listener path families and status fields from `dg_ai_gateway_listener_settings`
- verified on UDF with:
  - `GET /`
  - `GET /v1/models`
  - `POST /v1/chat/completions` -> `chat` local response
  - `POST /v1/chat/completions` -> `f5` route
- remaining iRule hardcode cleanup is now mainly:
  - local response templates
  - some northbound status formatting
  - any remaining fixed response text that UI should eventually own

### Phase 3: Publisher / Renderer

Deliverables:

- local renderer:
  - `render_gateway_native_artifacts.py`
  - `gateway-native-artifacts.json`
- publish UI config into:
  - native LTM objects
  - `Data Group`
  - `iFile`
- local publisher:
  - `publish_gateway_native_artifacts.py`
- publish passive objectized payloads first:
  - `/Common/ifile_ai_gateway_classifiers`
  - `/Common/ifile_ai_gateway_backend_targets`
  - `/Common/ifile_ai_gateway_routing_policies`
  - `/Common/ifile_ai_gateway_config_snapshot`
- then let ILX read the published JSON files from a stable local `native/` directory as overlay input, while keeping `classifier-config.json` as the base fallback
- require canonical validation before render / publish:
  - `validate_gateway_canonical.py`
  - reject bad listener/classifier/backend/policy references before generating native objects
- expose richer ILX `health` diagnostics for:
  - active refs
  - object registry counts
  - native overlay file state
- keep UDF-specific SSH instability isolated inside publisher behavior only:
  - per-SSH timeout
  - best-effort backup collection
  - post-publish object verification
- emit publish-side operational artifacts:
  - manifest
  - remote-vs-desired diff
  - rollback plan from latest backups
- validate / dry-run / activate / rollback flow

Risk:

- medium to high
- touches deployment workflow and state management

### Phase 4: Transparent Mode

Deliverables:

- explicit `Operating Mode`
- transparent handling path for endpoint/key pass-through
- minimal prompt append/rewrite and drop/respond behavior

Risk:

- high
- touches gateway contract and southbound auth semantics

## Hardcoded Areas Still To Remove

### `llm_semantic_route.tcl`

Still hardcoded today:

- plugin name / extension
- payload limit
- ILX timeout
- default pool / default profile / default model
- backend host / auth / backend model fallback
- supported northbound paths
- `/models` response payload
- local response templates

### `index.js`

Partially improved locally, but still needs future cleanup:

- default sample prompts and example defaults remain in `DEFAULT_CONFIG`
- `operatingMode` is stored but not fully executed yet
- native F5 object references are metadata today, not yet published automatically

## Recommended Deployment Strategy

When the UDF environment is healthy again:

1. Publish `Data Group` and `iFile` objects first
2. Deploy the updated `index.js`
3. Deploy the updated `classifier-config.json`
4. Update `iRule` to consume the new object references
5. Validate:
   - health endpoint
   - local respond
   - route to backend target
   - policy default rule
   - policy ordered rules
