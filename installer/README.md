# AI Traffic Orchestrator Offline Installer V1

This directory builds a self-contained offline installer bundle for BIG-IP.
The customer-facing install flow is on-box:

```bash
tar xzf aito-<version>.tgz
cd aito-<version>
sudo ./preflight.sh
sudo ./install.sh
sudo ./verify.sh
```

V1 installs the product shell and runtime only. It intentionally does not
create a listener or attach AITO to customer traffic by default. After install,
users configure pools, classifiers, backend targets, routing policies, and
northbound listeners in TMUI, then use `Deploy Changes`.

## Build

From the repository root:

```bash
./installer/build_offline_bundle.sh
```

Output:

```text
dist/aito-<version>.tgz
dist/aito-<version>.tgz.sha256
```

## Bundle Contents

- `payload/iapp/`: full iApps LX UI and worker app.
- `payload/ilx/`: ILX runtime `index.js`, `package.json`, iRule source, seed config, and empty native JSON.
- `payload/config/`: empty deployed-config baseline and UI sample config.
- `scripts/`: BIG-IP on-box `preflight`, `install`, `upgrade`, `rollback`, and `verify` scripts.

## Safety Model

- Existing AITO state is backed up under `/var/tmp/AITrafficOrchestrator-install-backups/<timestamp>`.
- Existing `deployed-config.json` and native runtime JSON are preserved on upgrade.
- The sudo bridge is installed only for the existing DeployWorker apply wrapper.
- Rollback is best-effort and intended for immediate install/upgrade recovery.
- `cleanup.sh` removes AITO-owned install/runtime artifacts for test reset. It does not delete customer-owned BYO pools.
