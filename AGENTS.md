# LTM Semantic Routing Rules

This file applies to work under:

- `/Users/k.ji/Library/CloudStorage/OneDrive-F5,Inc/books/demo test/ltm-semantic-routing`

These rules are more specific than the workspace root `AGENTS.md`.

## Scope

This directory owns:

- BIG-IP gateway runtime logic
- ILX JavaScript plugin code
- iRules and LTM-related configuration artifacts
- active classifier config examples and runtime contracts
- demo client/server helpers used by this project
- product and implementation documentation for this repo

## Do

- Keep the gateway behavior config-driven where possible.
- Prefer changing schema, normalization, and example configs together when the config surface changes.
- Keep ILX plugin code compatible with the conservative BIG-IP Node.js style already used in this repo.
- Treat northbound and southbound schema behavior as explicit product contracts.
- Treat the current 8080/TMM-oriented path as the primary direction unless a task explicitly targets older flows.
- Surface security-sensitive handling clearly and avoid introducing new plaintext secrets.

## Do Not

- Do not hard-code tags, prompts, routing logic, or response behavior when the config model should own them.
- Do not silently change northbound or southbound API behavior.
- Do not mix a new frontend UI implementation directly into runtime files; create or use a dedicated frontend subtree first.
- Do not revert unrelated changes.

## Validation

Run the most relevant checks after changes in this directory:

```bash
cd /Users/k.ji/Library/CloudStorage/OneDrive-F5,Inc/books/demo\ test/ltm-semantic-routing
node --check index.js
python3 -m py_compile semantic_backend.py semantic_client.py
bash -n start-demo.sh stop-demo.sh
```

Add targeted manual review for iRules, ILX, and contract changes when automated checks are insufficient.

## Escalate

Escalate back to the main agent if:

- a change requires a new frontend/UI subtree or build system
- a contract change requires coordinated frontend and backend rollout
- a runtime or configuration change has production compatibility risk that needs broader review
