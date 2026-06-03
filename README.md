# F5 LTM Semantic Routing Demo

This repository now tracks the current `8080` path only.

The active runtime is:

```text
vs_llm_semantic_demo_8080
  -> iRule llm_semantic_route_phase2
  -> ILX plugin llm_semantic_plugin / llm_semantic_ext
  -> TMM local respond or southbound route
```

The older `8081` / `llm_ai_gw_*` ILX-managed path has been removed from this repo and should no longer be treated as current.

## Active Runtime Components

- Virtual server: `vs_llm_semantic_demo_8080`
- Active iRule: `llm_semantic_route_phase2`
- Rollback iRule still present: `llm_semantic_route`
- ILX plugin: `llm_semantic_plugin`
- ILX extension entrypoint in this repo: `index.js`
- ILX config example: `classifier-config.json.example`
- Demo client/backend helpers: `semantic_client.py`, `semantic_backend.py`

## Current Behavior

- BIG-IP accepts OpenAI-like northbound requests on `8080`
- ILX extracts prompt text and returns a lightweight decision
- TMM performs local `respond` behavior for policy-driven replies
- TMM rewrites and forwards routed requests to the selected backend pool
- Linux only hosts demo helpers and the demo chatbot
- Runtime config still supports `targetModels + promptProfiles + decisions`, but the preferred local authoring model is now `listeners + classifiers + backendTargets + routingPolicies`, with the older shape treated as compatibility input
- The ILX runtime now loads `classifier-config.json` as the base config, then overlays `native/ifile_ai_gateway_{classifiers,backend_targets,routing_policies}.json` when those published files exist
- Listener-level northbound path families are now configuration-driven through `dg_ai_gateway_listener_settings`, including:
  - `root_paths`
  - `model_paths`
  - `chat_paths`
  - `responses_paths`
- Listener-level capability status is also configuration-driven through `dg_ai_gateway_listener_settings`, including:
  - `northbound_api_mode`
  - `chat_completions_support`
  - `responses_support`
- `GET /` now returns the listener's configured northbound capability summary instead of a fully hardcoded status body
- Gateway-mode hardening now includes canonical config validation before render/publish, plus richer ILX `health` diagnostics for active refs, registry counts, and native overlay file state
- The publisher now treats device backups as best-effort and uses per-SSH timeouts plus post-publish object verification, so UDF SSH noise does not change runtime behavior
- The publish toolchain now also emits:
  - `publish-backups/latest/publish-diff.json`
  - `publish-backups/latest/publish-manifest.json`
  - `publish-backups/latest/rollback-plan.json`
- `publish-manifest.json` now records input file checksums, desired state summary, remote state summary, and verification status

## Config Layers

- Human-readable source of intent: [gateway-config.canonical.json](/Users/k.ji/Library/CloudStorage/OneDrive-F5,Inc/books/demo test/ltm-semantic-routing/gateway-config.canonical.json)
- Rendered publish bundle for F5 native objects: `gateway-native-artifacts.json`
- Published record for operators and device-side inspection: `gateway-config.snapshot.json`
- Runtime truth: BIG-IP native objects, especially `Virtual Server`, `Data Group`, `iFile`, and the active iRule

The snapshot JSON is meant for review, diff, and debugging. It does not replace BIG-IP native objects as the runtime source of truth.
The native artifacts JSON is meant for renderer review and publisher input. It shows exactly what will become `Data Group` records and `iFile` payloads on BIG-IP.

The current supported northbound request families are documented in:

- [customer-config-guide.md](/Users/k.ji/Library/CloudStorage/OneDrive-F5,Inc/books/demo test/ltm-semantic-routing/customer-config-guide.md)
- [northbound-southbound-support-profile.md](/Users/k.ji/Library/CloudStorage/OneDrive-F5,Inc/books/demo test/ltm-semantic-routing/northbound-southbound-support-profile.md)
- [f5-ai-gateway-openapi.yaml](/Users/k.ji/Library/CloudStorage/OneDrive-F5,Inc/books/demo test/ltm-semantic-routing/f5-ai-gateway-openapi.yaml)
- [f5-native-config-refactor-plan.md](/Users/k.ji/Library/CloudStorage/OneDrive-F5,Inc/books/demo test/ltm-semantic-routing/f5-native-config-refactor-plan.md)

## Key Files

- [index.js](/Users/k.ji/Library/CloudStorage/OneDrive-F5,Inc/books/demo test/ltm-semantic-routing/index.js)
- [gateway-config.canonical.json](/Users/k.ji/Library/CloudStorage/OneDrive-F5,Inc/books/demo test/ltm-semantic-routing/gateway-config.canonical.json)
- [gateway-native-artifacts.json](/Users/k.ji/Library/CloudStorage/OneDrive-F5,Inc/books/demo test/ltm-semantic-routing/gateway-native-artifacts.json)
- [native/ifile_ai_gateway_classifiers.json](/Users/k.ji/Library/CloudStorage/OneDrive-F5,Inc/books/demo test/ltm-semantic-routing/native/ifile_ai_gateway_classifiers.json)
- [native/ifile_ai_gateway_backend_targets.json](/Users/k.ji/Library/CloudStorage/OneDrive-F5,Inc/books/demo test/ltm-semantic-routing/native/ifile_ai_gateway_backend_targets.json)
- [native/ifile_ai_gateway_routing_policies.json](/Users/k.ji/Library/CloudStorage/OneDrive-F5,Inc/books/demo test/ltm-semantic-routing/native/ifile_ai_gateway_routing_policies.json)
- [gateway_native_artifacts_lib.py](/Users/k.ji/Library/CloudStorage/OneDrive-F5,Inc/books/demo test/ltm-semantic-routing/gateway_native_artifacts_lib.py)
- [render_gateway_native_artifacts.py](/Users/k.ji/Library/CloudStorage/OneDrive-F5,Inc/books/demo test/ltm-semantic-routing/render_gateway_native_artifacts.py)
- [publish_gateway_native_artifacts.py](/Users/k.ji/Library/CloudStorage/OneDrive-F5,Inc/books/demo test/ltm-semantic-routing/publish_gateway_native_artifacts.py)
- [rollback_gateway_native_artifacts.py](/Users/k.ji/Library/CloudStorage/OneDrive-F5,Inc/books/demo test/ltm-semantic-routing/rollback_gateway_native_artifacts.py)
- [validate_gateway_canonical.py](/Users/k.ji/Library/CloudStorage/OneDrive-F5,Inc/books/demo test/ltm-semantic-routing/validate_gateway_canonical.py)
- [render_gateway_snapshot.py](/Users/k.ji/Library/CloudStorage/OneDrive-F5,Inc/books/demo test/ltm-semantic-routing/render_gateway_snapshot.py)
- [classifier-config.json.example](/Users/k.ji/Library/CloudStorage/OneDrive-F5,Inc/books/demo test/ltm-semantic-routing/classifier-config.json.example)
- [f5-native-config-refactor-plan.md](/Users/k.ji/Library/CloudStorage/OneDrive-F5,Inc/books/demo test/ltm-semantic-routing/f5-native-config-refactor-plan.md)
- [llm_semantic_route.tcl](/Users/k.ji/Library/CloudStorage/OneDrive-F5,Inc/books/demo test/ltm-semantic-routing/llm_semantic_route.tcl)
- [llm_semantic_rule.conf](/Users/k.ji/Library/CloudStorage/OneDrive-F5,Inc/books/demo test/ltm-semantic-routing/llm_semantic_rule.conf)
- [deploy-demo.tmsh](/Users/k.ji/Library/CloudStorage/OneDrive-F5,Inc/books/demo test/ltm-semantic-routing/deploy-demo.tmsh)
- [semantic_client.py](/Users/k.ji/Library/CloudStorage/OneDrive-F5,Inc/books/demo test/ltm-semantic-routing/semantic_client.py)
- [semantic_backend.py](/Users/k.ji/Library/CloudStorage/OneDrive-F5,Inc/books/demo test/ltm-semantic-routing/semantic_backend.py)

## Validation

Run the practical checks for the current `8080` path:

```bash
cd /Users/k.ji/Library/CloudStorage/OneDrive-F5,Inc/books/demo\ test/ltm-semantic-routing
node --check index.js
python3 -m py_compile semantic_backend.py semantic_client.py
python3 validate_gateway_canonical.py --canonical gateway-config.canonical.json
python3 render_gateway_snapshot.py --canonical gateway-config.canonical.json --output gateway-config.snapshot.json
python3 render_gateway_native_artifacts.py --canonical gateway-config.canonical.json --output gateway-native-artifacts.json
python3 publish_gateway_native_artifacts.py --canonical gateway-config.canonical.json --artifacts-output gateway-native-artifacts.json --snapshot-output gateway-config.snapshot.json --diff --bigip-host <host> --bigip-port <port> --ssh-timeout-seconds 20
python3 publish_gateway_native_artifacts.py --canonical gateway-config.canonical.json --artifacts-output gateway-native-artifacts.json --snapshot-output gateway-config.snapshot.json --ssh-timeout-seconds 20
python3 rollback_gateway_native_artifacts.py --canonical gateway-config.canonical.json --backup-dir publish-backups/latest --show-plan
bash -n start-demo.sh stop-demo.sh
```

For runtime changes, also review:

- `llm_semantic_route.tcl`
- `llm_semantic_rule.conf`
- `classifier-config.json.example`

## Historical Design Material

Some design and planning documents in this repository still discuss future control-plane ideas or previously explored migration approaches. Treat them as design history, not as the current runtime implementation.
