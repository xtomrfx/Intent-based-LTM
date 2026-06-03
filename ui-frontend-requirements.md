# AI Gateway Unified Config UI Spec

## 1. Document Purpose

This document is the **UI product spec for an AI design agent**.

Its purpose is not to explain BIG-IP internals in detail. Its purpose is to give a design agent enough structured context to produce:

1. information architecture
2. screen layouts
3. interaction flows
4. component hierarchy
5. state and error handling

The target experience is a **single configuration workbench** for AI Gateway, not a raw form over iRule or ILX files.

## 2. Output Expected From The Design Agent

The design agent should output:

1. one primary desktop workbench screen
2. one endpoint/model editor flow
3. one tags and decision mapping flow
4. one prompt profile editor flow
5. one validate, simulate, publish flow
6. empty, loading, error, validation-failure, publish-success states

The design agent should not spend time inventing backend behavior. It should use the domain model and API contracts in this document as the source of truth.

## 3. Product Context

The product is an **AI Gateway control surface** for configuring how northbound requests are accepted, classified, transformed, routed, locally responded to, validated, and published.

The user should be able to configure these concerns from one place:

- listener and northbound protocol settings
- classifier model settings
- backend model settings
- tags
- prompt profiles
- decision mapping
- local responses
- service chain order
- validation, simulation, publish, rollback

The UI must hide low-level implementation details by default. It should not require the user to manually edit:

- iRules
- ILX JavaScript
- raw runtime JSON
- pool members or TLS profiles directly

Those may be shown as generated diagnostics in an advanced drawer, but they are not the primary editing experience.

## 4. Current Runtime Reality vs Product Design Scope

The design agent needs to understand which objects already exist in runtime and which are product-level abstractions.

### 4.1 Runtime-backed objects today

These objects already exist in the current runtime/config model:

- `mode`
- `timeoutMs`
- `rulesFirst`
- `candidateTags`
- `targetModels`
- `promptProfiles`
- `decisions`

### 4.2 Product-level objects that should still exist in UI

These may not all be first-class runtime objects yet, but they should still be represented in UI because they are product requirements:

- listener config
- northbound schema enablement
- local response templates
- service chain stage configuration
- secrets management
- versions and audit views

### 4.3 Important design rule

The design must distinguish:

- **MVP-backed objects**
  - can be persisted directly now
- **future-managed objects**
  - can appear in UI with a clear label such as `Coming next`, `Advanced`, or `Control-plane managed`

The design must not imply that every screen is already fully live if the backend object does not yet exist.

## 5. Canonical Domain Model

This section defines the nouns that the UI must use consistently.

### 5.1 Top-level config object

```json
{
  "mode": "openai_compatible_chat",
  "timeoutMs": 3000,
  "rulesFirst": true,
  "candidateTags": ["chat", "f5", "bad", "unknown"],
  "targetModels": {
    "ClassifierModels": {},
    "BackendModels": {}
  },
  "promptProfiles": {},
  "decisions": {
    "default": {},
    "tags": {}
  }
}
```

### 5.2 `targetModels`

`targetModels` defines which model integrations the gateway uses.

#### `ClassifierModels`

This is the model used to classify a request into a tag.

It supports:

- `targetModel_type = classifier_llm`
- `targetModel_type = classifier_nli`

#### `BackendModels`

This is the model used when the gateway decides to route traffic to a backend model.

It currently uses:

- `targetModel_type = backend_llm`

### 5.3 `promptProfiles`

`promptProfiles` are reusable prompt/config objects referenced by models and decisions.

There are two profile families:

#### LLM prompt profile

Used by:

- `classifier_llm`
- `backend_llm`

Main fields:

- `type`
- `system_prompt.mode`
- `system_prompt.value`
- `temperature`
- `max_tokens`

#### NLI classification profile

Used by:

- `classifier_nli`

Main fields:

- `type`
- `labels`
- `hypothesis_template`
- `multi_label`
- `decision_policy`

### 5.4 `decisions`

`decisions` maps a classification result to a gateway action.

Current action types:

- `respond`
- `route`

Each tag can have its own decision rule.

Example:

```json
{
  "f5": {
    "action": "route",
    "pool": "pool_semantic_demo_big_direct",
    "prompt_profile": "f5_expert"
  }
}
```

## 6. Config Logic The UI Must Make Obvious

This is the most important section for the design agent.

The UI must visually teach the user the logic chain below.

### 6.1 Request handling logic

```text
Northbound request
-> listener accepts request
-> classifier model maps request to a tag
-> decision rule uses tag to choose action
-> action is either local respond or route
-> if route, backend model + prompt profile are applied
-> response is returned northbound
```

### 6.2 Object dependency graph

```text
Listener / Northbound
  -> affects which requests enter the gateway

ClassifierModels
  -> uses candidateTags
  -> references one prompt profile if classifier_llm
  -> references one NLI profile if classifier_nli

candidateTags
  -> constrain allowed decision keys
  -> constrain fallback tag choices

decisions.tags
  -> each tag must map to one action
  -> if action=route, must reference a valid pool and optional prompt profile
  -> if action=respond, must reference a valid message or local response template

BackendModels
  -> used only when decision.action=route
  -> may append or rewrite system prompt through promptProfiles
```

### 6.3 Key mental model

The design must help users answer these questions quickly:

1. Which requests are accepted?
2. How are requests classified?
3. Which tags exist?
4. What happens for each tag?
5. Which backend model will be used?
6. Which prompt profile will be applied?
7. What happens if the gateway answers locally?
8. What changes when I publish?

## 7. Supported Model Types And Schema Families

This is required for the model selection UI.

### 7.1 `classifier_llm`

Use this for chat-style classification models.

Typical schema families:

- `openai_chat_compatible`
- `ollama_openai_compatible`

Behavior:

- requires `prompt_profile`
- supports `append` or `rewrite` on system prompt
- expects compact structured classification output

### 7.2 `classifier_nli`

Use this for NLI or zero-shot classification models.

Typical schema families:

- `hf_zero_shot_classification`
- `nli_pairs_json`
- `custom_label_scores`
- `legacy_classifier_http`

Behavior:

- does not use system prompt
- uses `labels`, `hypothesis_template`, `multi_label`, `decision_policy`
- parse result becomes evidence
- final tag is decided by `finalize_classification`

### 7.3 `backend_llm`

Use this for routed backend generation models.

Typical schema families:

- `openai_chat_compatible`
- `ollama_openai_compatible`

Behavior:

- uses reusable prompt profiles
- default behavior is `append` with empty value
- can preserve user system prompt or rewrite it

## 8. Prompt Profile Semantics

This must be shown clearly in UI because it is easy to misunderstand.

### 8.1 `append`

Meaning:

- keep the user original system prompt
- append gateway profile prompt to it

If `value = ""`:

- treat as no-op
- do not modify the user system prompt

### 8.2 `rewrite`

Meaning:

- ignore the user original system prompt
- use only the configured prompt profile text

### 8.3 Default product behavior

- `ClassifierModels`
  - default is `append` classification prompt
- `BackendModels`
  - default is `append` empty value

The UI should explain this with plain-language helper text, not just raw enum labels.

## 9. Recommended Screen Architecture

Use a **single-page workbench** with persistent navigation.

### 9.1 Layout

#### Left navigation

- Overview
- Listener & Northbound
- Models
- Prompt Profiles
- Tags & Decisions
- Local Responses
- Service Chain
- Validate & Publish
- Versions & Audit

#### Main content area

This is where the active section is edited.

#### Right summary rail

Always visible summary:

- instance name
- draft status
- current published version
- northbound schemas enabled
- classifier type
- backend model
- tag count
- last validation result
- last publish status

#### Top action bar

Always visible actions:

- Save Draft
- Validate
- Simulate
- Preview Diff
- Publish
- Rollback

## 10. Screen-by-Screen Specification

## 10.1 Overview

### Goal

Give users a one-screen understanding of current gateway behavior.

### Primary data shown

- instance name
- environment
- published version
- draft version
- listener summary
- classifier summary
- backend summary
- tag-to-action summary
- recent validation result
- recent publish result

### Must-have visual blocks

- gateway status card
- northbound support card
- model summary card
- tags and actions matrix
- publish history summary

### Primary CTA

- `Continue editing`
- `Validate current draft`

## 10.2 Listener & Northbound

### Goal

Configure which requests the gateway accepts.

### Primary data object

```json
{
  "vip": "10.1.10.12",
  "vport": 8080,
  "northbound": {
    "enable_chat_completions": true,
    "enable_responses": true,
    "enable_streaming": true,
    "allowed_paths": ["/v1/chat/completions", "/v1/responses"],
    "max_payload_bytes": 65535,
    "request_timeout_ms": 3200,
    "default_public_model": "gateway-demo"
  }
}
```

### Fields

- `vip`
- `vport`
- `snat_mode`
- `enable_chat_completions`
- `enable_responses`
- `enable_streaming`
- `allowed_paths`
- `max_payload_bytes`
- `request_timeout_ms`
- `client_auth_type`
- `default_public_model`

### Important UX rule

Do not show raw BIG-IP object names first. Show user intent first. Advanced mapping to VS, profiles, or iRule can live in a collapsible diagnostics section.

## 10.3 Models

### Goal

Configure classifier model and backend model in one conceptual place.

### Screen structure

Two cards or two tabs:

- `ClassifierModels`
- `BackendModels`

### `ClassifierModels` fields

- `schema_family`
- `targetModel_type`
- `provider_config.protocol`
- `provider_config.hostname`
- `provider_config.port`
- `provider_config.path`
- `provider_config.method`
- `provider_config.model`
- `provider_config.apiKey` or `apiKeyEnv`
- `provider_config.headers`
- `prompt_profile`

### `BackendModels` fields

- `schema_family`
- `targetModel_type`
- `provider_config.protocol`
- `provider_config.hostname`
- `provider_config.port`
- `provider_config.path`
- `provider_config.method`
- `provider_config.model`
- `provider_config.apiKey` or `apiKeyEnv`
- `provider_config.acceptClientModel`
- `provider_config.headers`
- `prompt_profile`

### UX requirements

- model type picker must change the visible form fields
- `classifier_llm` and `classifier_nli` must not look identical
- secret fields must not echo plaintext after save
- include `Test connection` action

## 10.4 Prompt Profiles

### Goal

Manage reusable prompt profiles without mixing them into decisions or model connection settings.

### Screen structure

List on left, editor on right.

### LLM profile editor fields

- `profile_name`
- `type`
- `system_prompt.mode`
- `system_prompt.value`
- `temperature`
- `max_tokens`

### NLI profile editor fields

- `profile_name`
- `type`
- `labels`
- `hypothesis_template`
- `multi_label`
- `decision_policy.fallback_label`
- `decision_policy.min_confidence`
- `decision_policy.min_margin`

### UX requirements

- if `type = classifier_nli`, hide system prompt controls
- if `type = backend_llm` or `classifier_llm`, hide NLI-only controls
- show inline helper explaining `append` vs `rewrite`
- show referenced-by list:
  - models that use this profile
  - decisions that use this profile

## 10.5 Tags & Decisions

### Goal

Make tag logic understandable at a glance.

### Primary data object

```json
{
  "candidateTags": ["chat", "f5", "bad", "unknown"],
  "decisions": {
    "default": {
      "action": "route",
      "pool": "pool_semantic_demo_default_direct",
      "prompt_profile": "general_assistant"
    },
    "tags": {
      "chat": {
        "action": "respond",
        "message": "工作时间请不要闲聊"
      },
      "f5": {
        "action": "route",
        "pool": "pool_semantic_demo_big_direct",
        "prompt_profile": "f5_expert"
      }
    }
  }
}
```

### Recommended layout

Top:

- tag chips or table
- fallback tag selector
- `rulesFirst` switch

Main:

- one row per tag
- columns:
  - tag
  - description
  - action
  - target pool
  - prompt profile
  - local response
  - warning state

### UX requirements

- editing a tag name must warn about downstream references
- action type change must reconfigure visible columns
- default decision must be visually distinct from tag-specific decisions
- one matrix view is better than many disconnected forms

## 10.6 Local Responses

### Goal

Design a UI for gateway-owned replies.

### Important product note

This is a product-level feature area. It may be partly runtime-backed today and partly future-managed. The UI may still represent it as a first-class object.

### Fields

- `template_name`
- `northbound_schema`
- `streaming_mode`
- `message`
- `language`
- `variables`
- `header_overrides`

### Preview needs

The user must see:

- JSON response preview
- SSE response preview
- rendered text preview

## 10.7 Service Chain

### Goal

Let the user understand request processing order without reading code.

### Stage list

- `normalize`
- `authenticate`
- `classify`
- `guardrail`
- `policy`
- `set_prompt`
- `route`
- `local_respond`
- `egress_transform`
- `audit`

### UX rules

- default view should be a linear pipeline, not a free-form canvas
- drag-and-drop can exist, but must be constrained by rule validation
- show which stages are runtime-backed today vs future-managed
- show one-line purpose text for every stage

### Validation rules

- `normalize` must be first
- `audit` must exist
- `route` and `local_respond` must not both be terminal for the same branch without an explicit policy explanation

## 10.8 Validate & Publish

### Goal

Reduce publish fear.

### Tabs or panels

- Validation
- Simulation
- Diff
- Publish summary

### What validation must show

- schema validation
- reference validation
- missing profile references
- invalid tag references
- secret or auth issues
- northbound config issues
- publish risk warnings

### What simulation must show

Input:

- path
- request body
- optional headers

Output:

- normalized request summary
- predicted tag
- matched decision
- target backend or local respond
- selected prompt profile

## 10.9 Versions & Audit

### Goal

Show traceability and rollback clearly.

### Data shown

- version id
- created at
- created by
- change summary
- validation result
- publish result
- rollback entry point
- recent audit samples

## 11. API Contract For UI Design

These API contracts are recommended for UI design. They define the shape of data the frontend should expect, even if final endpoint naming changes later.

The design agent should assume a control-plane API with the following resources.

## 11.1 Get current config

`GET /api/gateway-instances/{instanceId}`

### Response

```json
{
  "instanceId": "gw-demo-01",
  "environment": "udf-lab",
  "publishedVersion": "v12",
  "draftVersion": "draft-2026-04-18-01",
  "config": {
    "mode": "openai_compatible_chat",
    "timeoutMs": 3000,
    "rulesFirst": true,
    "candidateTags": ["chat", "f5", "bad", "unknown"],
    "targetModels": {},
    "promptProfiles": {},
    "decisions": {}
  },
  "capabilities": {
    "supportsClassifierNli": true,
    "supportsServiceChainDesigner": false,
    "supportsLocalResponseTemplates": true
  }
}
```

## 11.2 Save draft

`PUT /api/gateway-instances/{instanceId}/draft`

### Request

```json
{
  "config": {}
}
```

### Response

```json
{
  "draftVersion": "draft-2026-04-18-02",
  "savedAt": "2026-04-18T10:20:00Z",
  "warnings": []
}
```

## 11.3 Validate draft

`POST /api/gateway-instances/{instanceId}/validate`

### Request

```json
{
  "config": {}
}
```

### Response

```json
{
  "status": "failed",
  "errors": [
    {
      "code": "INVALID_PROMPT_PROFILE_REF",
      "path": "decisions.tags.f5.prompt_profile",
      "message": "Prompt profile f5_expert does not exist."
    }
  ],
  "warnings": [
    {
      "code": "EMPTY_BACKEND_APPEND",
      "path": "promptProfiles.backend_default.system_prompt.value",
      "message": "Backend default profile will preserve the client system prompt."
    }
  ]
}
```

## 11.4 Simulate request

`POST /api/gateway-instances/{instanceId}/simulate`

### Request

```json
{
  "path": "/v1/chat/completions",
  "headers": {
    "Content-Type": "application/json"
  },
  "body": {
    "model": "gpt-4o-mini",
    "messages": [
      {
        "role": "user",
        "content": "What is an F5 BIG-IP pool and node?"
      }
    ]
  }
}
```

### Response

```json
{
  "normalized_input": {
    "text": "What is an F5 BIG-IP pool and node?",
    "public_model": "gpt-4o-mini",
    "request_path": "/v1/chat/completions"
  },
  "classification": {
    "tag": "f5",
    "confidence": 0.96,
    "source": "rules"
  },
  "decision": {
    "action": "route",
    "pool": "pool_semantic_demo_big_direct",
    "prompt_profile": "f5_expert"
  },
  "resolved_backend": {
    "targetModel_type": "backend_llm",
    "schema_family": "openai_chat_compatible",
    "hostname": "api.deepseek.com",
    "path": "/chat/completions"
  }
}
```

## 11.5 Publish draft

`POST /api/gateway-instances/{instanceId}/publish`

### Request

```json
{
  "draftVersion": "draft-2026-04-18-02",
  "changeSummary": "Switch classifier and backend config to unified targetModels structure."
}
```

### Response

```json
{
  "publishedVersion": "v13",
  "publishedAt": "2026-04-18T10:40:00Z",
  "status": "success"
}
```

## 11.6 List versions

`GET /api/gateway-instances/{instanceId}/versions`

### Response

```json
{
  "items": [
    {
      "version": "v13",
      "createdAt": "2026-04-18T10:40:00Z",
      "createdBy": "admin",
      "summary": "Unified targetModels migration"
    }
  ]
}
```

## 11.7 Rollback

`POST /api/gateway-instances/{instanceId}/rollback`

### Request

```json
{
  "targetVersion": "v12"
}
```

### Response

```json
{
  "rolledBackTo": "v12",
  "status": "success"
}
```

## 12. UI State Model

Every major screen should support these states:

- `loading`
- `empty`
- `editing`
- `dirty`
- `valid`
- `invalid`
- `publishing`
- `published`
- `publish_failed`

The design should make draft state visible at all times.

## 13. Validation And Error Messaging Rules

The design should attach errors to specific config paths, not only page-level banners.

Use this pattern:

- top-level summary banner
- section-level error summary
- field-level inline error

For reference errors, show both:

- the broken object
- the object that references it

Example:

- `Decision rule "f5" references prompt profile "f5_expert", but that profile was deleted.`

## 14. AI Design Rules

These are instructions specifically for the design agent.

### 14.1 Do

- treat this as an enterprise control-plane workbench
- prioritize clarity of dependency relationships
- emphasize matrix, inspector, and summary patterns
- keep validation and publish highly visible
- distinguish runtime-backed objects from future-managed objects

### 14.2 Do not

- do not design this like a consumer chatbot UI
- do not center the experience around code editors
- do not scatter related config objects across unrelated screens
- do not hide object references that affect routing behavior

### 14.3 Visual tone

Use a serious operations-console tone:

- high information density
- strong grouping
- clear reference links
- obvious status colors
- conservative use of motion

## 15. Suggested Deliverables

The design agent should produce:

1. information architecture map
2. annotated primary workbench screen
3. models editor screen
4. tags and decisions screen
5. prompt profile editor
6. validate and publish screen
7. component inventory
8. state coverage matrix

## 16. MVP Priority

### Phase 1

- Overview
- Listener & Northbound
- Models
- Prompt Profiles
- Tags & Decisions
- Validate & Publish

### Phase 2

- Local Responses
- Versions & Audit
- richer simulation

### Phase 3

- full Service Chain editor
- more advanced secret governance
- multi-tenant policy views
