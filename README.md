# F5 LTM Semantic Routing Demo

This repository now tracks the current `8080` path only.

The active runtime is:

```text
vs_llm_semantic_demo_8080
  -> iRule llm_semantic_route
  -> ILX plugin llm_semantic_plugin / llm_semantic_ext
  -> TMM local respond or southbound route
```

The older `8081` / `llm_ai_gw_*` ILX-managed path has been removed from this repo and should no longer be treated as current.

## Active Runtime Components

- Virtual server: `vs_llm_semantic_demo_8080`
- iRule: `llm_semantic_route`
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

The current supported northbound request families are documented in:

- [customer-config-guide.md](/Users/k.ji/Library/CloudStorage/OneDrive-F5,Inc/books/demo test/ltm-semantic-routing/customer-config-guide.md)
- [northbound-southbound-support-profile.md](/Users/k.ji/Library/CloudStorage/OneDrive-F5,Inc/books/demo test/ltm-semantic-routing/northbound-southbound-support-profile.md)
- [f5-ai-gateway-openapi.yaml](/Users/k.ji/Library/CloudStorage/OneDrive-F5,Inc/books/demo test/ltm-semantic-routing/f5-ai-gateway-openapi.yaml)

## Key Files

- [index.js](/Users/k.ji/Library/CloudStorage/OneDrive-F5,Inc/books/demo test/ltm-semantic-routing/index.js)
- [classifier-config.json.example](/Users/k.ji/Library/CloudStorage/OneDrive-F5,Inc/books/demo test/ltm-semantic-routing/classifier-config.json.example)
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
bash -n start-demo.sh stop-demo.sh
```

For runtime changes, also review:

- `llm_semantic_route.tcl`
- `llm_semantic_rule.conf`
- `classifier-config.json.example`

## Historical Design Material

Some design and planning documents in this repository still discuss future control-plane ideas or previously explored migration approaches. Treat them as design history, not as the current runtime implementation.
