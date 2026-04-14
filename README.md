# F5 LTM Native AI Gateway Demo

This workspace now models BIG-IP LTM as the AI gateway core, not just a tag router.

## Target Architecture

- Client sends OpenAI or OpenAI-like requests to BIG-IP.
- BIG-IP parses the northbound schema and extracts prompt text.
- BIG-IP calls a configurable classifier endpoint.
- BIG-IP applies semantic policy on-box.
- BIG-IP calls a configurable model endpoint and performs schema transformation on-box.
- Linux is only used as a test client for the demo.

## Demo Objects on BIG-IP

- Workspace: `llm_ai_gw_ws`
- Extension: `gateway`
- Plugin: `llm_ai_gw_plugin`
- ILX profile: `llm_ai_gw_profile`
- Virtual: `vs_llm_ai_gateway_8081`

## Client-facing APIs

Northbound request paths accepted by the ILX HTTP server:

- `POST /v1/chat/completions`
- `POST /chat/completions`
- `POST /v1/responses`
- `POST /responses`
- `GET /health`
- `GET /admin/config/schema`
- `GET /admin/config/status`
- `GET /admin/config/versions`
- `GET /admin/policy/list`
- `POST /admin/evaluate`
- `POST /admin/config/validate`
- `POST /admin/config/activate`
- `POST /admin/config/rollback`

Supported response modes:

- non-streaming JSON
- streaming SSE

## Southbound Capability in This Demo

BIG-IP calls the configured model endpoint directly from ILX and converts responses back into the client-facing schema.

Supported southbound pattern in the current code:

- downstream chat-completions style endpoint
- `provider_type: openai`
- `provider_type: openai_like`

The demo validates both provider shapes with DeepSeek because it accepts:

- `/chat/completions`
- `/v1/chat/completions`

## Configuration Model

The main configuration file on BIG-IP is:

- `/var/ilx/workspaces/Common/llm_ai_gw_ws/extensions/gateway/gateway-config.json`

The formal config schema in this workspace is:

- [gateway-config.schema.json](/Users/k.ji/Library/CloudStorage/OneDrive-F5,Inc/books/demo%20test/ltm-semantic-routing/gateway-config.schema.json)

It contains four product-facing objects that map cleanly to a future UI:

- `resources.classifiers`
- `model_endpoints`
- `pipeline`
- `runtime`

See:

- [gateway-config.json.example](/Users/k.ji/Library/CloudStorage/OneDrive-F5,Inc/books/demo%20test/ltm-semantic-routing/gateway-config.json.example)
- [gateway-pipeline-config.json.example](/Users/k.ji/Library/CloudStorage/OneDrive-F5,Inc/books/demo%20test/ltm-semantic-routing/gateway-pipeline-config.json.example)
- [customer-config-guide.md](/Users/k.ji/Library/CloudStorage/OneDrive-F5,Inc/books/demo%20test/ltm-semantic-routing/customer-config-guide.md)
- [northbound-southbound-support-profile.md](/Users/k.ji/Library/CloudStorage/OneDrive-F5,Inc/books/demo%20test/ltm-semantic-routing/northbound-southbound-support-profile.md)
- [f5-ai-gateway-openapi.yaml](/Users/k.ji/Library/CloudStorage/OneDrive-F5,Inc/books/demo%20test/ltm-semantic-routing/f5-ai-gateway-openapi.yaml)

## Files

- [ai_gateway_plugin.js](/Users/k.ji/Library/CloudStorage/OneDrive-F5,Inc/books/demo%20test/ltm-semantic-routing/ai_gateway_plugin.js)
- [gateway-config.json.example](/Users/k.ji/Library/CloudStorage/OneDrive-F5,Inc/books/demo%20test/ltm-semantic-routing/gateway-config.json.example)
- [gateway-pipeline-config.json.example](/Users/k.ji/Library/CloudStorage/OneDrive-F5,Inc/books/demo%20test/ltm-semantic-routing/gateway-pipeline-config.json.example)
- [ltm-gateway-notes.md](/Users/k.ji/Library/CloudStorage/OneDrive-F5,Inc/books/demo%20test/ltm-semantic-routing/ltm-gateway-notes.md)

## Verified Demo Behavior

- `chat` can respond directly from BIG-IP
- `f5` can route to the engineering endpoint
- `bad` can respond directly from BIG-IP without exposing backend models
- tag list is derived from `pipeline.classify.tags` and `pipeline.policy.rules`, not duplicated in code
- invalid config no longer silently replaces the active config
- classifier resources are referenced by name from `pipeline[].classifier`
- policy matching supports `tag`, `confidence_gte`, `northbound_type`, `client_model`, `path`, `tenant`, `headers`, and `prompt_regex`
- `/admin/evaluate` can show classifier result, matched policy, endpoint, and downstream model without sending business traffic
- `/admin/config/validate`, `/admin/config/activate`, `/admin/config/rollback`, and `/admin/config/versions` provide an API-driven config lifecycle
- explicit `pipeline` mode supports multi-operation rules such as `set_system_prompt -> route`
- `/v1/chat/completions` returns OpenAI chat-completions schema
- `/chat/completions` works as OpenAI-like northbound alias
- `/v1/responses` returns Responses API schema
- chat streaming is proxied as chat-completion SSE
- responses streaming is transformed into Responses SSE events

## Notes

- The plugin is written conservatively for BIG-IP Node.js 6.9.1.
- `startHttpServer()` is used, so the demo virtual should not have an HTTP profile attached.
- The current demo focuses on on-box classification, semantic routing, model endpoint selection, schema transformation, and config-driven policy dispatch.
- Future pipeline stages such as semantic cache should be modeled as additional configurable service steps, not hard-coded branches.
