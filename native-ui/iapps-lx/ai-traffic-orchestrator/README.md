# AI Traffic Orchestrator iApps LX Scaffold

This is the on-box BIG-IP native UI package for AI Traffic Orchestrator.

## Current Layout

- `presentation/`
  - static offline UI shell
  - no CDN
  - no external fonts
  - no runtime internet dependency
- `nodejs/`
  - UI/config/deploy workers
  - config processor that maps UI state to native runtime objects
  - tmsh/bash deploy bridge helpers

## Current Goal

Current behavior:

- UI is served locally from BIG-IP
- `config` and `deploy` are handled by on-box workers
- deploy writes to BIG-IP native objects through a local tmsh/bash bridge
- backend pools are referenced and validated, not created by the UI

## Intended Evolution

1. keep `presentation/` as the product shell and object editors
2. continue tightening the deploy contract and validation rules
3. formalize the privileged deploy bridge in the install/upgrade path
4. keep BIG-IP-native objects as runtime truth
