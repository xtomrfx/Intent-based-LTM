# F5 Native UI Implementation Plan

## Conclusion

This UI can be implemented natively on a BIG-IP device without requiring an external web server or a separately deployed control-plane service.

The recommended implementation path is:

1. `iApps LX` as the native on-box UI container
2. `Custom iApps LX GUI` for the multi-page user experience
3. `iApps LX Config Processor` as the on-box controller that writes runtime configuration
4. `Data Group + iFile + native LTM objects` as the runtime-backed storage and execution contract

This keeps the customer-facing deliverable inside a single F5 device:

- BIG-IP TMUI hosts the UI
- BIG-IP REST/iApps LX processors perform writes
- BIG-IP native objects remain the runtime truth

The local renderer/publisher scripts remain development tools only and are not required by the customer deliverable.

## Why This Is The Right F5-Native Choice

### Recommended: iApps LX

`iApps LX` is the best fit for this project because it supports:

- installation as an on-box RPM package
- launch from the BIG-IP GUI
- a default GUI or a fully custom GUI
- a JSON block model for saved application instances
- configuration processors to translate UI data into BIG-IP configuration
- optional stats/audit processors for health and diagnostics

Relevant F5 documentation:

- iApps LX supports a default GUI or a custom GUI presentation.【https://clouddocs.f5.com/products/iapp/iapp-lx/tmos-14_0/iapplx_concepts/gui.html】
- iApps LX can be used to create a wizard for BIG-IP configuration, including a routing decision table, and supports a custom UI with strong authentication.【https://clouddocs.f5.com/products/iapp/iapp-lx/tmos-14_0/iapplx_concepts/overview.html】
- iApps LX custom GUI assets can be HTML/JavaScript and are served from `/var/config/rest/iapps/<app>/presentation` under the BIG-IP web server path `/iapps/<app>`.【https://clouddocs.f5.com/products/iapp/iapp-lx/tmos-14_0/iapplx_programming_tutorials/gui-programming.html】
- BIG-IP installs these packages through `iApps > Package Management LX`.【https://clouddocs.f5.com/products/extensions/f5-appsvcs-templates/latest/userguide/install-uninstall.html】

### Not Recommended As The Primary UI

#### Traditional iApp template

This is too limited for:

- object lists
- multi-panel editors
- custom navigation
- classifier test workflows
- future orchestrator views

It is acceptable for a very small wizard, but not for this product-style UI.

#### FAST template UI

`FAST` is useful for declarative templated deployments, but it is not the best primary UX for:

- managing reusable `listeners / classifiers / backendTargets / routingPolicies`
- editing multiple object collections in one product shell
- running custom actions like `Test Classifier`
- showing custom diagnostics and policy-state views

FAST can still be useful later for templated deployment patterns, but not as the main UX for this orchestrator.

## Target UX Model

The UI should behave like a product workspace inside TMUI, not like a single wizard page.

Recommended structure:

1. `Operating Mode`
2. `Northbound Listener`
3. `Classifier Setting`
4. `Backend Target Setting`
5. `Routing Policy Setting`
6. `Diagnostics`
7. `Audit Logs`

### Visual Direction

Use the provided mockups as the visual reference, but adapt them to BIG-IP-native constraints:

- keep the product shell and left navigation
- keep the object-list + detail-pane pattern
- keep the clean enterprise styling
- keep the `Gateway / Transparent` mode toggle in the top bar
- keep the right-side status cards where useful

### Required Changes To The Supplied HTML/CSS

The supplied prototype code cannot be used as-is inside BIG-IP.

It must be adapted in these ways:

1. Remove external CDNs
   - no Tailwind CDN
   - no Google Fonts
   - no external Material Symbols fetch

2. Bundle all assets into the iApps LX package
   - CSS
   - JS
   - icons
   - local fonts if absolutely necessary

3. Prefer a prebuilt static bundle
   - compiled CSS
   - compiled JS
   - no runtime dependency on internet access

4. Keep the interaction model aligned with the saved JSON block model
   - object list on the left
   - object editor on the right
   - explicit save/deploy/test actions

## Runtime And Storage Contract

The UI must not write arbitrary runtime files directly.

It should write into an on-box object model, and the processor should translate that into runtime truth.

### Authoring Layer

The iApps LX block instance should store a product-level object model equivalent to:

- `operatingMode`
- `listeners`
- `classifiers`
- `backendTargets`
- `routingPolicies`

This is conceptually aligned with the current canonical JSON.

### Runtime Truth Layer

The config processor should translate saved UI state into:

- `Virtual Server`
- `Pool`
- `Monitor`
- `Server SSL Profile`
- `Data Group`
- `iFile`

The runtime should continue to read from:

- `dg_ai_gateway_listener_refs`
- `dg_ai_gateway_listener_settings`
- native `iFile` JSON documents
- active `iRule`
- active `ILX`

This keeps the customer solution self-contained on the device.

## Recommended On-Box Component Design

### 1. iApps LX Package

Package contents:

- `presentation/`
  - custom GUI static assets
- `nodejs/`
  - config processor
  - optional stats processor
  - optional audit processor
- template/block definition

Install path:

- imported via `iApps > Package Management LX`

Use path:

- launched from `iApps > Application Services > Applications LX`
- custom presentation served from BIG-IP under `/iapps/<app>`

### 2. Config Processor

The config processor is the key controller.

Responsibilities:

- validate the saved UI block data
- render listener settings into `Data Group`
- render classifiers/backend targets/routing policies into `iFile`
- create or update `Virtual Server`, pools, monitors, and references where appropriate
- keep runtime objects aligned with the saved block

### 3. Stats Processor

Recommended for:

- backend pool health summaries
- listener status indicators
- deployment status badges
- simple diagnostic counters

This is especially useful for:

- health icons next to backend pool members
- status cards on the right side of the UI

### 4. Audit Processor

Optional at first, but a good product path for:

- change tracking
- policy deployment audit
- drift detection

## UI Scope Recommendation

Build the UI in two layers:

### MVP Scope

Implement first:

1. `Operating Mode`
2. `Northbound Listener`
3. `Classifier Setting`
4. `Backend Target Setting`
5. `Routing Policy Setting`

This is already supported by the current runtime object model direction.

### Deferred Scope

Do not block MVP on:

- full `Transparent Mode`
- true `Orchestrator` execution logic
- advanced diagnostic charts
- audit drilldown views
- install/upgrade workflow inside the UI

For now:

- `Transparent Mode` can stay visible but limited
- `Orchestrator` can remain a reserved option in the UI

## Mapping The UI To Current Runtime

### Northbound Listener

Current runtime already supports listener-driven configuration for:

- `default_public_model`
- `max_payload_bytes`
- `decision_timeout_ms`
- `root_paths`
- `model_paths`
- `chat_paths`
- `responses_paths`
- `northbound_api_mode`
- `chat_completions_support`
- `responses_support`

This means the `Northbound Listener` page is viable now.

### Classifier Setting

Current object model already supports:

- `classifier_llm`
- `classifier_nli`
- `schema_family`
- `endpoint_url`
- `api_key_env / secret_ref`
- `model_id`
- `candidate_tags`
- `fallback_tag`
- `use_built_in_rules_first`
- `timeout_ms`

This page is viable now.

### Backend Target Setting

Current object model already supports:

- `backend target`
- `endpoint_url`
- `model_id`
- `pool_name`
- `backend_prompt`
- `backend_prompt_mode`
- `advanced.server_ssl_profile`
- `advanced.sni_server_name`
- `advanced.monitor`

This page is viable now.

### Routing Policy Setting

Current object model already supports:

- ordered `rules[]`
- `default_rule`
- `route`
- `respond`
- `backend_target_ref`
- `response_message`

This page is viable now.

## Remaining Runtime Gaps That UI Must Respect

The following are still not fully productized and should not be over-promised in MVP:

1. `Local Response` protocol templates
   - message is configurable
   - full JSON/SSE envelope template is not yet UI-configurable

2. routed `responses` unsupported fallback message
   - still a fixed runtime message today

3. some tag normalization aliases
   - still runtime logic, not a customer-facing editable policy set

So for MVP UI:

- expose `Response Message`
- do not expose raw protocol template editing
- do not expose arbitrary northbound/southbound path editing

## Implementation Plan

### Phase UI-1: Freeze The Product Contract

Goal:

- align the UI field model with the current runtime object model

Tasks:

- freeze the field names used by the UI
- map UI fields to:
  - `listeners`
  - `classifiers`
  - `backendTargets`
  - `routingPolicies`
- explicitly mark non-editable fields

Deliverable:

- final UI field contract

### Phase UI-2: Build The iApps LX Package Shell

Goal:

- create the on-box package and navigation shell

Tasks:

- create an iApps LX package
- add custom `presentation/` assets
- create placeholder pages for the 4 main screens
- wire the left navigation and top bar

Deliverable:

- installable RPM that opens a native BIG-IP product shell

### Phase UI-3: Read-Only Data Integration

Goal:

- make the UI useful before write support is enabled

Tasks:

- show existing listener list
- show backend pools and member health
- show classifier list
- show routing policy list
- show runtime status cards

Deliverable:

- native read-only control plane UI

### Phase UI-4: Saved Block Editing

Goal:

- allow editing the product object model inside the iApps LX block

Tasks:

- implement forms for:
  - listener
  - classifier
  - backend target
  - routing policy
- add create/copy/delete object interactions
- add validation and draft save

Deliverable:

- on-box editable UI state

### Phase UI-5: Config Processor Write Path

Goal:

- make the UI apply real runtime config

Tasks:

- implement config processor translation from block instance to:
  - `Data Group`
  - `iFile`
  - `Virtual Server`
  - LTM object bindings
- ensure config processor respects the current runtime contract

Deliverable:

- saved UI changes become effective runtime configuration

### Phase UI-6: Product Actions

Goal:

- finish the first operational workflow

Tasks:

- add `Deploy Changes`
- add `Test Classifier`
- add diagnostics status panels
- add deployment result feedback

Deliverable:

- native UI with operational workflow

## Recommended Build Strategy

### Front-End

Use a custom GUI, but ship it as static assets inside the iApps LX package.

Recommended approach:

- prebuilt static HTML/CSS/JS
- no internet dependencies
- no external asset fetches

### Backend

Use on-box processors only:

- config processor
- optional stats processor

Do not require:

- separate web servers
- external API gateways
- developer-side publish tools

## Final Recommendation

Yes, this UI is feasible as a native BIG-IP UI.

The best on-box implementation is:

- `iApps LX` package
- `custom GUI presentation`
- `config processor` writing to `Data Group + iFile + native LTM objects`

Do not use:

- traditional iApp template as the main UX
- FAST as the main UX
- external web hosting

The next practical step is:

1. freeze the MVP field contract
2. scaffold the iApps LX package shell
3. convert the supplied mockup style into an on-box static custom GUI
4. wire it first in read-only mode
5. then add config-processor writes
