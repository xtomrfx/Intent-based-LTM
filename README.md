# AI Traffic Orchestrator

AI Traffic Orchestrator is a native BIG-IP AI Gateway control plane. It installs on a single BIG-IP device, exposes a TMUI-hosted iApps LX user interface, and applies gateway configuration to BIG-IP native objects plus an iRules LX runtime.

The current product scope is `Gateway` mode:

```text
Client
  -> BIG-IP Virtual Server
  -> iRule / TMM request handling
  -> iRules LX decision worker
  -> Local Response or Routed Model Backend
```

`Transparent Mode` is reserved and is not part of the current installation or configuration scope.

## Product Features

- Native BIG-IP UI under `iApps > Application Services > Applications LX`.
- OpenAI-compatible northbound traffic, primarily `POST /v1/chat/completions`.
- Classifier-driven semantic tags such as `f5`, `general`, `blocked`, and `unknown`.
- Routing policies that return a local response or route to a model backend.
- Northbound Virtual Keys for application or tenant authentication and policy matching.
- Southbound Model Credential pools for model API key priority failover.
- BYO BIG-IP LTM pools. AITO references pools but does not own pool members, monitors, or load-balancing method.
- Offline installation and cleanup with on-box scripts. No external control-plane service is required.

## Offline Install On A Clean BIG-IP

### Requirements

- BIG-IP with iApps LX and iRules LX available.
- Shell access as `root`, or a user that can run the installer scripts with `sudo`.
- On-box commands available: `bash`, `tar`, `curl`, `tmsh`, `restcurl`, and `bigstart`.
- Existing customer-owned LTM pools for model backend and classifier egress paths.
- Working BIG-IP data-plane DNS, routing, and server-side TLS/SNI behavior for the selected model providers.

### Build The Offline Bundle

From the repository root:

```bash
./installer/build_offline_bundle.sh
```

The build creates:

```text
dist/aito-0.2.1.tgz
dist/aito-0.2.1.tar
dist/aito-0.2.1.tgz.sha256
dist/aito-0.2.1.tar.sha256
```

`dist/` is generated output and is not committed to Git.

### Upload And Install

Copy the archive to BIG-IP:

```bash
scp dist/aito-0.2.1.tgz root@<bigip-management-ip>:/var/tmp/
```

Install on BIG-IP:

```bash
ssh root@<bigip-management-ip>
cd /var/tmp
tar xzf aito-0.2.1.tgz
cd aito-0.2.1
sudo ./oneclick_install.sh
```

If you are already logged in as `root`, omit `sudo`.

`oneclick_install.sh` runs:

```text
preflight.sh -> install.sh -> verify.sh
```

The installer creates or updates:

- iApps LX UI and worker files under `/var/config/rest/iapps/AITrafficOrchestrator`.
- iRules LX workspace, extension, plugin, and runtime `index.js`.
- Managed iRule `/Common/llm_semantic_route_phase2`.
- Empty deployed-config and native runtime JSON baselines.
- Worker loader-path registration for `/mgmt/iapps/AITrafficOrchestrator`.
- A narrow sudo bridge used by the Deploy worker apply wrapper.

The installer does not create a traffic listener by default. After installation, open the UI, configure the gateway objects, and click `Deploy Changes`.

### Verify The Install

The one-click installer runs verification automatically. You can rerun verification manually:

```bash
sudo ./verify.sh
```

Expected result:

```text
Summary: <n> passed, 0 failed, <n> skipped
```

The authenticated worker check is skipped unless `AITO_REST_USER` and `AITO_REST_PASSWORD` are set.

### Open The UI

Recommended TMUI path:

```text
iApps > Application Services > Applications LX > AITrafficOrchestrator
```

Direct worker entry:

```text
https://<bigip-management-ip>/mgmt/iapps/AITrafficOrchestrator
```

Static fallback after TMUI login:

```text
https://<bigip-management-ip>/iapps/AITrafficOrchestrator/presentation/index.html
```

### One-Click Uninstall

From the extracted bundle directory:

```bash
sudo ./oneclick_uninstall.sh
```

Cleanup removes AITO-owned files and objects:

- iApps LX block and worker loader path.
- AITO iApps files and runtime directory.
- AITO sudoers bridge.
- ILX plugin and workspace.
- AITO iRule and classifier egress helper objects.
- AITO data groups, iFiles, and managed server SSL profile.

It does not delete customer-owned BYO LTM pools.

### Upgrade And Rollback

For an existing AITO installation, extract the new bundle and run:

```bash
sudo ./upgrade.sh
sudo ./verify.sh
```

Install and upgrade create backups under:

```text
/var/tmp/AITrafficOrchestrator-install-backups/<timestamp>
```

Immediate install or upgrade recovery:

```bash
sudo ./rollback.sh
```

Rollback is best-effort and is intended for immediate install or upgrade recovery, not long-term configuration versioning.

## Usage Examples

### Example 1: Route F5 Questions To A Specialist Model

Create a Classifier that emits tags such as `f5`, `general`, `blocked`, and `unknown`. In Routing Policy, map `f5` to a Backend Target with an F5 expert prompt. Other tags can route to a general backend or return local responses.

### Example 2: Block Disallowed Requests Locally

If the Classifier returns `blocked`, configure the matching Routing Policy rule with action `Local Response`. BIG-IP returns the configured response without forwarding the prompt to a backend model.

### Example 3: Assign Virtual Keys Per Application

Create one Virtual Key Pool per application or tenant, then create keys inside each pool. Enable `Virtual Key` authentication on the listener. Routing policies can match by key pool, a specific key, or key tag.

### Example 4: Fail Over Southbound Model API Keys

Create a Model Credential Pool with multiple provider API keys and ascending priorities. A Backend Target can reference that pool. Runtime credential failures such as `401`, `403`, and `429` cool down the current key so later requests can use the next available credential.

## Recommended Configuration Flow

1. Create backend and classifier pools in BIG-IP `Local Traffic > Pools`.
2. Configure `Classifier Setting`.
3. Configure `Model Credential` if southbound API keys should be centrally managed.
4. Configure `Backend Target Setting`.
5. Configure `Virtual Key` if northbound authentication is required.
6. Configure `Routing Policy Setting`.
7. Configure `Northbound Listener`.
8. Click `Deploy Changes`.

Most editors use staged changes. `Commit` writes editor changes into the local draft. `Deploy Changes` applies the committed draft to BIG-IP. `Reset Draft` discards the browser draft and reloads the deployed device baseline.

For field-level configuration details, see [customer-config-guide.md](customer-config-guide.md).

## Important Boundaries

- Northbound behavior is fixed OpenAI-compatible. Northbound schema customization is not exposed in the UI.
- The current primary data-plane path is `/v1/chat/completions`.
- Backend Target schema family is currently `openai_chat_compatible`.
- BIG-IP Local Traffic owns pool members, monitors, and load-balancing method.
- Runtime health, Virtual Key last-used, and Model Credential runtime state are operational data, not deployed configuration.
- Model Credential V1 applies to Backend Targets, not Classifier Targets.
- Southbound credential failover is next-request failover, not same-request HTTP retry.

## Repository Layout

- `installer/`: offline bundle builder and BIG-IP on-box install, verify, rollback, and cleanup scripts.
- `native-ui/iapps-lx/ai-traffic-orchestrator/`: BIG-IP iApps LX UI and worker.
- `index.js`: iRules LX runtime entrypoint.
- `llm_semantic_route.tcl`: gateway iRule source.
- `customer-config-guide.md`: detailed configuration manual.
- `f5-ai-gateway-openapi.yaml`: northbound API description.
- `native/`: native runtime JSON examples.

## Local Validation

Recommended checks before publishing:

```bash
node --check index.js
node --test native-ui/tests/*.js
python3 -m py_compile semantic_backend.py semantic_client.py
bash -n start-demo.sh stop-demo.sh installer/build_offline_bundle.sh installer/scripts/*.sh
./installer/build_offline_bundle.sh
```

The offline installer still needs real BIG-IP validation for full confidence because `tmsh`, `restcurl`, iApps LX, and iRules LX behavior cannot be fully exercised on a Mac.
