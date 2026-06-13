# AI Traffic Orchestrator Offline Installer

This directory builds a self-contained offline installer bundle for BIG-IP.

## Build

From the repository root:

```bash
./installer/build_offline_bundle.sh
```

Output:

```text
dist/aito-<version>.tgz
dist/aito-<version>.tar
dist/aito-<version>.tgz.sha256
dist/aito-<version>.tar.sha256
```

## One-Click Install

Upload the archive to BIG-IP, extract it, and run:

```bash
tar xzf aito-<version>.tgz
cd aito-<version>
sudo ./oneclick_install.sh
```

The one-click path runs:

```text
preflight.sh -> install.sh -> verify.sh
```

V1 installs the product shell and runtime only. It does not create a listener or attach AITO to customer traffic by default. After install, configure pools, classifiers, backend targets, routing policies, virtual keys, and northbound listeners in TMUI, then use `Deploy Changes`.

## One-Click Uninstall

For lab reset or clean-device removal:

```bash
sudo ./oneclick_uninstall.sh
```

This removes AITO-owned install/runtime artifacts and BIG-IP objects. It does not delete customer-owned BYO pools.

## Bundle Contents

- `payload/iapp/`: full iApps LX UI and worker app.
- `payload/ilx/`: ILX runtime `index.js`, `package.json`, iRule source, seed config, and empty native JSON.
- `payload/config/`: empty deployed-config baseline and UI sample config.
- `scripts/`: BIG-IP on-box `preflight`, `install`, `upgrade`, `rollback`, `verify`, `cleanup`, and one-click wrapper scripts.

## Safety Model

- Existing AITO state is backed up under `/var/tmp/AITrafficOrchestrator-install-backups/<timestamp>`.
- Existing `deployed-config.json` and native runtime JSON are preserved on upgrade.
- The sudo bridge is installed only for the Deploy worker apply wrapper.
- Rollback is best-effort and intended for immediate install/upgrade recovery.
- `cleanup.sh` removes AITO-owned install/runtime artifacts for test reset. It does not delete customer-owned BYO pools.
