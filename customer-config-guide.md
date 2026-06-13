# AI Traffic Orchestrator Configuration Guide

This guide explains how to configure AI Traffic Orchestrator after the offline installer has been installed on BIG-IP.

The current supported product mode is `Gateway`. `Transparent Mode` is reserved and should not be enabled for customer deployments.

## 1. Configuration Model

AI Traffic Orchestrator is configured through the native BIG-IP iApps LX UI. The UI stores deployed configuration and renders BIG-IP native runtime artifacts.

Main configuration objects:

| Object | Purpose |
| --- | --- |
| `Classifier` | Calls a model or classifier endpoint and returns a routing tag. |
| `Backend Target` | Defines a routed southbound model endpoint, model id, prompt policy, and referenced BIG-IP pool. |
| `Model Credential` | Groups southbound provider API keys for priority failover. |
| `Routing Policy` | Maps classifier tags and Virtual Key rules to route or local response actions. |
| `Virtual Key` | Provides northbound application or tenant authentication and policy matching. |
| `Northbound Listener` | Creates the BIG-IP virtual service that accepts client traffic and attaches a routing policy. |

BIG-IP Local Traffic remains the owner of pool members, monitors, and load-balancing method. AITO references existing pools by name, such as `/Common/deepseek`.

## 2. Recommended Setup Order

Use this order on a clean install:

1. Create backend and classifier LTM pools in BIG-IP `Local Traffic > Pools`.
2. Configure `Classifier Setting`.
3. Configure `Model Credential` if backend targets should use shared provider keys.
4. Configure `Backend Target Setting`.
5. Configure `Virtual Key` pools and keys if listener authentication is required.
6. Configure `Routing Policy Setting`.
7. Configure `Northbound Listener`.
8. Click `Deploy Changes`.
9. Check `Status` and send a test request through the listener.

The UI uses staged editors:

- `Commit` writes the current editor values into the browser draft.
- `Deploy Changes` applies the committed draft to BIG-IP.
- `Reset Draft` discards local browser draft changes and reloads the deployed device baseline.

## 3. BIG-IP Pool Preparation

Before configuring AITO, create the LTM pools that represent model provider egress paths.

Typical pool examples:

| Pool | Use |
| --- | --- |
| `/Common/deepseek` | Backend model route to a DeepSeek-compatible endpoint. |
| `/Common/glm` | Backend model route to a GLM-compatible endpoint. |
| `/Common/classifier_deepseek` | Classifier egress path. |

Pool configuration is customer-owned. AITO does not create, edit, or delete pool members, monitors, or load-balancing methods.

For HTTPS providers:

- Pool members must be reachable from BIG-IP.
- BIG-IP must have working DNS and data-plane routing.
- AITO derives backend TLS behavior from the Backend Target `Endpoint URL`.
- Deploy attaches the managed server SSL profile only to listeners whose active policy can route to an HTTPS Backend Target.

## 4. Classifier Setting

A classifier determines the routing tag for a request.

Common fields:

| Field | Meaning |
| --- | --- |
| `Classifier Name` | User-facing name. |
| `Classifier Type` | LLM classifier or NLI classifier. |
| `Endpoint URL` | Provider endpoint for the classifier request. |
| `API Key` | Classifier provider key. Env refs and secret refs are intentionally blocked. |
| `Model ID` | Classifier model name. |
| `Referenced BIG-IP Pool` | Existing LTM pool used for classifier egress. |
| `Classifier Prompt` | Prompt that defines valid tags and classification behavior. |
| `Fallback Tag` | Tag used when classification is uncertain or no tag matches. |
| `Bypass` | Skips classification and uses the policy default rule after deploy. |

LLM classifier candidate tags are derived from `{{tag}}` placeholders in `Classifier Prompt`. `Fallback Tag` must be selected from the current candidate tags.

Example classifier prompt:

```text
Classify the user request into exactly one tag:
- {{f5}} for F5 BIG-IP, LTM, iRules, pool, virtual server, monitor, ASM, APM, DNS, GTM, or WAF questions.
- {{general}} for general assistant questions.
- {{blocked}} for harmful, abusive, or disallowed requests.
Return only JSON: {"tag":"f5","confidence":0.92}
```

Use `Test Classifier` before deployment to validate draft prompt, tags, endpoint, and API key. This validates draft form values; runtime classifier egress objects are created or updated by `Deploy Changes`.

## 5. Model Credential

Model Credential pools manage southbound provider keys used by Backend Targets.

Pool fields:

| Field | Meaning |
| --- | --- |
| `Pool Name` | User-facing name. |
| `Pool ID` | Stable internal reference used by Backend Targets. |
| `Vendor` | Provider label, such as `openai`, `deepseek`, or `zhipu`. |
| `Selection Mode` | V1 supports `Priority Failover`. |
| `Cooldown Seconds` | Default cooldown for failed credentials. |
| `Enabled` | Enables or disables the pool. |

Credential fields:

| Field | Meaning |
| --- | --- |
| `Display Name` | Operator-facing label. |
| `Credential ID` | Stable per-credential id. |
| `Priority` | Lower number is selected first. |
| `API Key` | Southbound provider API key. |
| `Enabled` | Enables or disables the credential. |

Runtime failover behavior:

- `401`, `403`, and `429` can mark a credential unavailable and open cooldown.
- Later requests can select the next available credential.
- `LB_FAILED` is treated as a network or backend-path failure and does not cool down credentials.
- V1 does not perform same-request HTTP retry to reduce duplicate-billing risk.

Runtime credential status is operational state. It is shown in `/status` and the UI, but it is not written into deployed configuration.

## 6. Backend Target Setting

A Backend Target defines where routed model requests go.

Required fields:

| Field | Meaning |
| --- | --- |
| `Backend Name` | User-facing backend target name. |
| `Schema Family` | Product-controlled dropdown. Current value: `openai_chat_compatible`. |
| `Endpoint URL` | Full provider URL, such as `https://api.deepseek.com/v1/chat/completions`. |
| `Model ID` | Southbound model id sent to the provider. |
| `Referenced BIG-IP Pool` | Existing LTM pool for this backend route. |
| `Credential Source` | `Inline API Key` or `Model Key Pool`. |

Optional field:

| Field | Meaning |
| --- | --- |
| `Backend Prompt` | Prompt appended to the original northbound chat request before routing. |

Credential source rules:

- `Inline API Key` stores one backend key directly on the Backend Target.
- `Model Key Pool` references a `Model Credential` pool by id.
- A Backend Target cannot set both inline `api_key` and `credential_pool_ref`.
- If a credential pool is used, legacy secret/env key fields are rejected.

The backend model probe beside `Endpoint URL` uses the current draft form values and sends a fixed OpenAI-compatible chat request. It validates provider reachability and credentials, but it does not replace BIG-IP pool monitor health.

## 7. Virtual Key

Virtual Keys provide northbound authentication and policy matching.

Virtual Key Pool fields:

| Field | Meaning |
| --- | --- |
| `Pool Name` | User-facing pool name. |
| `Pool ID` | Stable pool reference. |
| `Description` | Operator notes. |
| `Enabled` | Enables or disables all keys in the pool. |

Virtual Key fields:

| Field | Meaning |
| --- | --- |
| `kid` | Key id used for display and matching. |
| `Secret` | Generated or pasted northbound secret. |
| `Key Tag` | Optional tag used by Routing Policy key rules. |
| `Pool` | Parent Virtual Key Pool. |
| `Enabled` | Enables or disables the key. |

Virtual Key `Last Used` is date-level runtime status. It records successful Virtual Key-authenticated requests and does not mutate deployed config.

## 8. Routing Policy Setting

A Routing Policy decides what happens after authentication and classification.

Routing modes:

| Mode | Behavior |
| --- | --- |
| `classifier_only` | No Virtual Key routing. Classifier tag rules and default rule decide behavior. |
| `key_only` | Virtual Key rules decide behavior. Classifier is not used. |
| `key_then_classifier` | Virtual Key rules are evaluated first. Unmatched traffic can fall through to classifier and tag rules. |

Required policy fields:

| Field | Meaning |
| --- | --- |
| `Policy Type` | Gateway policy type. |
| `Policy Name` | User-facing policy name. |
| `Classifier` | Required unless routing mode is `key_only`. |
| `Default Rule` | Exactly one default action: route to Backend Target or return Local Response. |

Tag rule fields:

| Field | Meaning |
| --- | --- |
| `Source Tag` | Classifier tag to match. |
| `Action` | `Route` or `Local Response`. |
| `Backend Target` | Required for route action. |
| `Local Response` | Required for local-response action. |
| `Enabled` | Disabled rules are ignored and do not block deploy. |

Key rule `Source` values:

| Source | Meaning |
| --- | --- |
| `Pool` | Match any enabled key in a Virtual Key Pool. |
| `Key` | Match one concrete Virtual Key. |
| `Key Tag` | Match keys with the selected tag. |

Key rules support `Route`, `Local Response`, and, in `key_then_classifier`, `Classify`. `key_only` policies reject key rules with `Classify`.

Fallback Backend Target:

- This is separate from the Default Rule.
- Default Rule handles no matching tag or no matching key rule.
- Fallback Backend handles a matched route whose primary BIG-IP pool has zero active members.

Deploy applies strict validation to policies referenced by a listener. Unused stale policies can remain present while operators switch active listeners away from them.

## 9. Northbound Listener

A Northbound Listener creates the customer-facing BIG-IP virtual service for gateway traffic.

Required fields:

| Field | Meaning |
| --- | --- |
| `Virtual Service` | Managed BIG-IP virtual server name. |
| `VIP` | Listener destination address. |
| `Port` | Listener service port. |
| `Assigned Policy` | Routing Policy attached to this listener. Must be selected explicitly. |

Authentication modes:

| Mode | Meaning |
| --- | --- |
| `None` | No northbound Virtual Key check. |
| `Virtual Key` | Requires a valid Virtual Key and can restrict allowed key pools. |

Deploy validates listener destinations before applying changes. If another virtual server already owns the same destination address, service port, protocol, source, and VLAN scope, deploy returns a clear user-facing conflict instead of a raw `tmsh` error.

## 10. Data-Plane API Behavior

Primary supported request:

```http
POST /v1/chat/completions
Content-Type: application/json
Authorization: Bearer <virtual-key-or-client-token>
```

Example request:

```bash
curl -sk "http://<listener-vip>:<port>/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <virtual-key-secret>" \
  -d '{
    "model": "client-visible-model",
    "messages": [
      {"role": "user", "content": "How do I configure an F5 LTM pool monitor?"}
    ]
  }'
```

Protocol hardening:

- Non-POST methods on chat/responses endpoints return OpenAI-style JSON `405 method_not_allowed`.
- Malformed JSON returns JSON `400 invalid_json`.
- Unsupported paths return JSON `404 not_found`.
- Local Response streaming emits strict OpenAI-compatible SSE lines.

`/v1/models` returns an OpenAI-style model list for supported methods.

## 11. Status And Troubleshooting

Configuration status and runtime health are separate:

| Status Type | Meaning |
| --- | --- |
| Config status | Whether local committed draft differs from deployed config. |
| Runtime health | BIG-IP runtime object and pool health. |

Runtime status includes:

- Listener health.
- Classifier and Backend Target pool member health.
- Virtual Key last-used date.
- Model Credential runtime state, failure reason, cooldown, and fallback counters.

Common issues:

| Symptom | Likely Cause | Action |
| --- | --- | --- |
| Deploy says referenced pool is missing | Backend or classifier pool name is not present on BIG-IP | Create the pool in Local Traffic or select a valid existing pool. |
| Deploy destination conflict | Another virtual server already uses the same VIP/port scope | Change the listener VIP/port or remove/change the conflicting virtual server. |
| Provider request returns `route_connect_failed` | BIG-IP cannot connect to selected backend pool member | Check routing, DNS, pool members, TLS, and provider reachability. |
| Classifier returns `unknown` unexpectedly | Prompt tags, model response, or max token behavior are not aligned | Use `Test Classifier` and verify that the provider returns one of the configured tags. |
| UI shows a stale draft | Browser local draft differs from the deployed baseline | Use `Reset Draft` to reload deployed config. |

## 12. Install, Upgrade, And Cleanup Commands

Build bundle:

```bash
./installer/build_offline_bundle.sh
```

Install on BIG-IP:

```bash
tar xzf aito-0.2.1.tgz
cd aito-0.2.1
sudo ./oneclick_install.sh
```

Verify:

```bash
sudo ./verify.sh
```

Upgrade:

```bash
sudo ./upgrade.sh
sudo ./verify.sh
```

Immediate install or upgrade rollback:

```bash
sudo ./rollback.sh
```

Uninstall from a lab or clean test device:

```bash
sudo ./oneclick_uninstall.sh
```

Cleanup removes only AITO-owned objects and files. It does not delete customer-owned BYO pools.

## 13. Current Limitations

- Current implementation scope is Gateway mode.
- Northbound schema customization is not exposed in the UI.
- Backend Target schema family is currently `openai_chat_compatible`.
- Model Credential Pool V1 applies to Backend Targets, not Classifier Targets.
- Credential failover is next-request failover, not same-request retry.
- Runtime status files are local operational state, not HA-shared durable billing records.
- Billing-grade token accounting, quota, and per-key rate limiting are future roadmap items.
