# LTM Native AI Gateway Demo

This variant moves both classification and model endpoint proxying into BIG-IP ILX.

## Objects

- Workspace: `llm_ai_gw_ws`
- Extension: `gateway`
- Plugin: `llm_ai_gw_plugin`
- ILX profile: `llm_ai_gw_profile`
- Virtual: `vs_llm_ai_gateway_8081`

## Client-facing endpoints

- `POST /v1/chat/completions`
- `POST /v1/responses`

## Configuration file on BIG-IP

- `/var/ilx/workspaces/Common/llm_ai_gw_ws/extensions/gateway/gateway-config.json`

This single file contains:

- `resources.classifiers`
- `model_endpoints`
- `pipeline`
- `runtime`

It is designed to map cleanly to a future UI.
