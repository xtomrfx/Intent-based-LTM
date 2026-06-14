# AI Traffic Orchestrator Native UI

This subtree owns the on-box UI work for the BIG-IP native product experience.

Scope:

- iApps LX package scaffold
- static `presentation/` assets with no internet dependency
- worker code that maps UI state to BIG-IP native objects and runtime artifacts

Non-goals in this subtree:

- changing live gateway runtime behavior
- introducing an external web server
- depending on local developer publish tools at runtime

Current status:

1. A local static custom-GUI shell exists under the iApps LX scaffold.
2. On-box workers exist for:
   - `GET /mgmt/iapps/AITrafficOrchestrator`
   - `GET /mgmt/iapps/AITrafficOrchestrator/config`
   - `POST /mgmt/iapps/AITrafficOrchestrator/deploy`
3. `Deploy Changes` applies the current UI state to BIG-IP native objects using a local tmsh/bash bridge.

## Local Preview

Run:

```bash
cd native-ui
./preview-native-ui.sh
```

Then open:

```text
http://127.0.0.1:8765/
```

The preview supports:

- page navigation
- local draft save to browser storage
- reset to sample config
- JSON import
- JSON export
- listener configuration hidden by default until select/create
- create-listener flow with draft-only status view

## Lab Deploy To BIG-IP iApps

Run:

```bash
cd native-ui
./deploy_native_ui_to_f5.sh
```

This stages the current local UI into:

```text
/var/config/rest/iapps/AITrafficOrchestrator
```

on the target BIG-IP, and also creates or updates a `BOUND` Applications LX block named
`AITrafficOrchestrator` so it appears in:

```text
iApps > Application Services > Applications LX
```

It also prints the direct `/iapps/.../presentation/index.html` URL for fallback access after logging in to TMUI.

The bound block uses a lightweight on-box worker entry at:

```text
/mgmt/iapps/AITrafficOrchestrator
```

which returns the local HTML shell and points static assets back to `/iapps/AITrafficOrchestrator/presentation/`.

## Current Deploy Model

- source of truth remains the UI state / on-box deployed config JSON
- runtime truth remains BIG-IP native objects:
  - `ltm virtual`
  - `ltm data-group`
  - `sys file ifile`
- apply path is:
  - UI `Deploy Changes`
  - local `DeployWorker`
  - generated tmsh/bash apply script
  - privileged root wrapper
  - `tmsh` updates + `save sys config`

Current MVP boundary:

- listeners are managed from the UI and rendered to BIG-IP native objects
- classifiers / backend targets / routing policies are rendered to iFiles + data-groups
- backend `pool_name` is validated and referenced, but pool/member creation is not owned by the UI yet
- this privileged bridge is currently installed by the lab deploy script and should later be formalized in the install/upgrade path
