# AI Traffic Orchestrator MVP Field Contract

This file freezes the first UI field contract for the native BIG-IP GUI.

## Contract Rules

1. UI edits the product object model, not raw iRules or ILX files.
2. Runtime truth remains `Data Group + iFile + native LTM objects`.
3. `Northbound API Type` and supported API paths are shown as product contract, not customer-editable free text.
4. `Local Response` is editable at message level only.
5. `Orchestrator` is visible as reserved product scope, not executable MVP logic.

## Object Model

```json
{
  "operatingMode": "gateway",
  "listeners": {},
  "classifiers": {},
  "backendTargets": {},
  "routingPolicies": {}
}
```

## 1. Operating Mode

| Field | Type | Editable | Canonical Mapping | Notes |
| --- | --- | --- | --- | --- |
| Operating Mode | enum(`gateway`, `transparent`) | yes | `operatingMode` | `transparent` remains limited in MVP |

## 2. Northbound Listener

| Field | Type | Editable | Canonical Mapping | Notes |
| --- | --- | --- | --- | --- |
| Virtual Service | select | yes | `listeners.<id>.virtual_service` | choose existing VS |
| Create Virtual Service | action | yes | processor action | creates VS later via config processor |
| VIP | string | yes | `listeners.<id>.vip` | |
| Port | number | yes | `listeners.<id>.port` | |
| Default Public Model | string | yes | `listeners.<id>.default_public_model` | |
| Streaming | boolean | yes | `listeners.<id>.streaming` | |
| Client Authentication | enum | yes | `listeners.<id>.client_auth_type` | `none`, `api_key`, `bearer_token`, reserved `mtls`, `oidc/jwt` |
| Max Payload Bytes | number | yes | `listeners.<id>.advanced.max_payload_bytes` | advanced |
| Decision Timeout (ms) | number | yes | `listeners.<id>.advanced.decision_timeout_ms` | advanced |
| Request ID Mode | enum | yes | `listeners.<id>.advanced.request_id_mode` | advanced |
| Northbound API Mode | string | no | `listeners.<id>.status.northbound_api_mode` | read-only |
| Supported Paths | string[] | no | `listeners.<id>.status.supported_paths` | read-only |
| Chat Completions Support | string | no | `listeners.<id>.status.chat_completions_support` | read-only |
| Responses Support | string | no | `listeners.<id>.status.responses_support` | read-only |
| Assigned iRule | string | no | `listeners.<id>.status.assigned_irule` | read-only |
| Status | string | no | `listeners.<id>.status.status` | read-only |

## 3. Classifier Setting

### Common Fields

| Field | Type | Editable | Canonical Mapping | Notes |
| --- | --- | --- | --- | --- |
| Classifier Name | string | yes | `classifiers.<id>.classifier_name` | |
| Classifier Type | enum | yes | `classifiers.<id>.classifier_type` | `classifier_llm`, `classifier_nli` |
| Schema Family | enum/string | yes | `classifiers.<id>.schema_family` | product-controlled choices |
| Endpoint URL | string | yes | `classifiers.<id>.endpoint_url` | |
| API Key / Secret Ref | string | yes | `classifiers.<id>.api_key_env` or `secret_ref` | UI label stays human-friendly |
| Candidate Tags | string[] | yes | `classifiers.<id>.candidate_tags` | |
| Fallback Tag | string | yes | `classifiers.<id>.fallback_tag` | |
| Use Built-in Rules First | boolean | yes | `classifiers.<id>.use_built_in_rules_first` | |
| Timeout (ms) | number | yes | `classifiers.<id>.timeout_ms` | |
| Test Classifier | action | yes | processor/stats action | operational action |

### LLM Variant Fields

| Field | Type | Editable | Canonical Mapping |
| --- | --- | --- | --- |
| Model ID | string | yes | `classifiers.<id>.model_id` |
| Temperature | number | yes | `classifiers.<id>.temperature` |
| Max Tokens | number | yes | `classifiers.<id>.max_tokens` |
| Classifier Prompt | text | yes | `classifiers.<id>.classifier_prompt` |

### NLI Variant Fields

| Field | Type | Editable | Canonical Mapping |
| --- | --- | --- | --- |
| Min Confidence | number | yes | `classifiers.<id>.min_confidence` |
| Multi Label | boolean | yes | `classifiers.<id>.multi_label` |
| Hypothesis Template | text | yes | `classifiers.<id>.hypothesis_template` |
| Min Margin | number | yes | `classifiers.<id>.min_margin` |

## 4. Backend Target Setting

| Field | Type | Editable | Canonical Mapping | Notes |
| --- | --- | --- | --- | --- |
| Backend Target Name | string | yes | `backendTargets.<id>.backend_target_name` | |
| Schema Family | enum/string | yes | `backendTargets.<id>.schema_family` | product-controlled choices |
| Endpoint URL | string | yes | `backendTargets.<id>.endpoint_url` | |
| API Key / Secret Ref | string | yes | `backendTargets.<id>.api_key_env` or `secret_ref` | |
| Model ID | string | yes | `backendTargets.<id>.model_id` | |
| Pool Name | string | yes | `backendTargets.<id>.pool_name` | selected from native pool objects |
| Backend Prompt | text | yes | `backendTargets.<id>.backend_prompt` | |
| Backend Prompt Mode | enum | yes | `backendTargets.<id>.backend_prompt_mode` | `append`, `rewrite` |
| Server SSL Profile | string | yes | `backendTargets.<id>.advanced.server_ssl_profile` | advanced |
| SNI Server Name | string | yes | `backendTargets.<id>.advanced.sni_server_name` | advanced |
| Monitor | string | yes | `backendTargets.<id>.advanced.monitor` | advanced |
| Pool Members | collection | no | stats/native lookup | read-only health summary in MVP |

## 5. Routing Policy Setting

### Policy Object

| Field | Type | Editable | Canonical Mapping | Notes |
| --- | --- | --- | --- | --- |
| Policy Type | enum | yes | `routingPolicies.<id>.policy_type` | `routing`, reserved `orchestrator` |
| Policy Name | string | yes | `routingPolicies.<id>.policy_name` | |
| New / Copy / Delete Policy | action | yes | block editor action | |

### Rules

| Field | Type | Editable | Canonical Mapping | Notes |
| --- | --- | --- | --- | --- |
| Rule Name | string | yes | `routingPolicies.<id>.rules[n].rule_name` | |
| Source Tag | string | yes | `routingPolicies.<id>.rules[n].source_tag` | |
| Action | enum | yes | `routingPolicies.<id>.rules[n].action` | `route`, `respond` |
| Backend Target | string | yes | `routingPolicies.<id>.rules[n].backend_target_ref` | only when `route` |
| Response Message | text | yes | `routingPolicies.<id>.rules[n].response_message` | only when `respond` |
| Enabled | boolean | yes | `routingPolicies.<id>.rules[n].enabled` | |

### Default Rule

| Field | Type | Editable | Canonical Mapping |
| --- | --- | --- | --- |
| Default Backend Target | string | yes | `routingPolicies.<id>.default_rule.backend_target_ref` |
| Default Local Response | text | yes | `routingPolicies.<id>.default_rule.response_message` |
| Default Action | enum | yes | `routingPolicies.<id>.default_rule.action` |

## MVP Limits The UI Must Preserve

Do not expose as customer-editable in MVP:

- arbitrary northbound path editing
- arbitrary southbound path editing
- Local Response JSON/SSE template envelopes
- tag normalization alias tables
- routed `responses` fallback template internals
