# Shared child-app platform plan

Status: Draft plan
GitHub issue: [#376](https://github.com/hachej/boring-ui/issues/376)
Branch: `plan/shared-child-app-platform`
Created: 2026-06-24

## Summary

Make Boring UI faster to turn into custom agents by separating **child app** from
**deployment**. A child app should be a product definition mounted into one shared
production platform, not a new Fly app, Postgres database, auth stack, billing
stack, and runtime stack.

Target model:

```txt
one deployed platform
  ├─ one Fastify/core/workspace/agent runtime
  ├─ one auth system
  ├─ one Postgres database
  ├─ one global credits/billing service
  ├─ one sandbox/runtime fleet
  └─ many child apps
       ├─ hostnames
       ├─ workspace kind/default workspace policy
       ├─ trusted plugins/routes/tools
       ├─ prompts/skills/provisioning
       ├─ frontend shell/branding
       └─ Stripe product/prices registered in global billing
```

MacroAnalyst is the first proving migration:

```txt
app.senecaapp.ai       -> childAppId=seneca, workspaceKind=generic
macro.senecaapp.ai     -> childAppId=macro,  workspaceKind=macro
same deployment/runtime/auth/DB/billing service
```

Billing remains global. The platform does not create one billing implementation
per child app. Each child app contributes Stripe product/price configuration,
and the global billing service records ledger/checkout activity with child app
context.

## Goals

1. **Accelerate custom-agent creation.** A new serious custom agent should be
   created by adding a child app definition and app/internal plugin, not by
   cloning full-app deployment infrastructure.
2. **Share expensive platform concerns.** Reuse auth, Postgres, migrations,
   credits, runtime mode, sandbox handles, deployment smoke, and operational
   runbooks across child apps.
3. **Keep child-app behavior isolated.** Macro tools, system prompt,
   provisioning, and UI must not leak into the generic Seneca workspace.
4. **Preserve current plugin trust boundaries.** Child apps use trusted
   app/internal plugins for routes/tools/domain APIs; generated runtime plugins
   stay route-free.
5. **Keep global billing, product-scoped checkout.** One billing subsystem owns
   checkout/webhooks/ledger; child apps register Stripe products/prices under
   the same Stripe organization/account.
6. **Make host-driven UX possible.** A user visiting `macro.senecaapp.ai` gets
   MacroAnalyst branding, public shell, default workspace kind, starter panels,
   prompts, and billing packs.
7. **Support app-first and workspace-first navigation.** Existing
   `/workspace/:id` remains valid, while default workspace resolution becomes
   child-app aware.

## Non-goals

- Do not introduce separate deployments, separate databases, or separate auth
  stacks per child app.
- Do not implement hosted/untrusted marketplace plugins. This plan is for
  trusted first-party child apps and app/internal plugins.
- Do not hot-register Fastify routes or static tools from generated plugins.
  Core still consumes trusted server contributions at boot.
- Do not move user workspace content into deployment snapshots. Child-app
  workspace files remain provisioning contributions.
- Do not replace Macro's legitimate trusted domain routes with generic RPC for
  purity. Macro-style `/api/macro/*` routes remain valid trusted app/internal
  plugin APIs.
- Do not solve every future product platform feature in v1: admin consoles,
  per-product analytics dashboards, self-serve DNS onboarding, and marketplace
  publishing are later work.

## Current architecture findings

### Full-app composition

`apps/full-app` is the production reference app. It calls
`createCoreWorkspaceAgentServer` from `@hachej/boring-core/app/server`, which
layers:

- core auth/workspaces/settings/invites on Postgres;
- workspace UI/plugin composition;
- agent routes and runtime mode;
- Fly/Docker deployment shape.

Current `full-app` has one global `CoreConfig` (`appId`, `appName`, auth URL,
CORS, feature flags) and one global plugin collection for the process.

### Core plugin integration today

Per `packages/core/docs/PLUGIN_INTEGRATION.md`:

- Core consumes workspace plugins statically.
- Server plugins are passed through `createCoreWorkspaceAgentServer({ plugins })`.
- Front plugins are passed through the front shell props.
- Core disables hot reload for multi-workspace production composition.
- Static server plugin factories resolve at boot before a request workspace is
  known, so generic plugin bridge context is limited.

This means simple global plugin installation is not enough: if Macro is mounted
as a global plugin without scoping, Macro routes/tools/provisioning/prompt become
visible to all workspaces.

### Workspace plugin model today

Per `packages/workspace/docs/PLUGIN_SYSTEM.md`:

- App/internal plugins are trusted boot-time packages.
- They may define front panels/commands/catalogs/surface resolvers and server
  routes/tools/system prompt/provisioning.
- Runtime/generated plugins live under `.pi/extensions` and are route-free.
- `boring.server` routes/tools are boot-time only.

This matches child apps well. A child app can be "hostname + workspace kind +
trusted plugin bundle + prompt/provisioning + branding".

### Workspace records today

Core workspaces currently model:

```txt
workspaces(id, app_id, name, created_by, created_at, deleted_at, is_default)
```

The unique default workspace invariant is per `(created_by, app_id)` for
`is_default=true`. There is no durable workspace kind/product dimension yet.

For a shared child-app platform, default workspace behavior must become
child-app/workspace-kind aware, otherwise a user who signs into Macro may reuse
or create the wrong default workspace.

### Provisioning today

Plugin provisioning is collected during app/server composition and executed by
agent runtime provisioning before the workspace agent starts. The deployment
workflow docs draw the right ownership boundary:

```txt
plugin declares provisioning
  -> workspace normalizes declarations
  -> agent executes provisioning
```

For the shared platform, provisioning must be scoped to the active child app or
workspace kind. Macro Python SDK and template files must materialize only in
Macro workspaces.

### MacroAnalyst current shape

The current Macro app is already close to the target plugin shape:

- package metadata declares `boring.front`, `boring.server`, and
  `defaultPluginPackages`;
- Macro front plugin contributes charts/deck/data-catalog surfaces;
- Macro server plugin contributes routes, macro tools, system prompt, and
  provisioning;
- Macro provisioning includes a workspace template and Python SDK/CLI support;
- Macro currently runs as its own deployment with its own Fly/Docker/env wiring.

The migration should promote Macro from "separate deployed app" to "first
child-app definition in full-app/shared platform" without weakening the plugin
contract.

## Target conceptual model

### Definitions

```ts
type ChildAppId = string // examples: "seneca", "macro"
type WorkspaceKind = string // examples: "generic", "macro"

type ChildAppDefinition = {
  id: ChildAppId
  label: string
  hosts: string[]
  canonicalUrl: string
  workspaceKind: WorkspaceKind
  defaultWorkspaceName: string
  branding: ChildAppBranding
  frontend: ChildAppFrontendDefinition
  server: ChildAppServerDefinition
  agent: ChildAppAgentDefinition
  billing?: ChildAppBillingDefinition
  rollout?: ChildAppRolloutPolicy
}
```

The child app definition is app-owned platform configuration, not a package-level
runtime plugin API. It can live initially in `apps/full-app/src/child-apps/` and
later graduate into a public `@hachej/boring-core/app` helper if the shape
stabilizes.

### Child-app registry

A registry lists all product surfaces served by the deployment:

```ts
export const childApps = defineChildApps([
  senecaChildApp,
  macroChildApp,
])
```

The registry is consumed by both server and frontend:

- server: host resolution, workspace kind resolution, route/plugin/provisioning
  scoping, billing checkout config, CORS/origin validation, smoke metadata;
- frontend: branding, public shell, chat suggestions, initial panels, front
  plugins, default route behavior, buy-credit pack display.

### Host/product resolution

Every request should resolve a child app early:

```txt
Host header / forwarded host
  -> normalized public host
  -> childAppId
  -> childAppDefinition
```

Rules:

- Exact host match first.
- Dev hosts may map through explicit env/config overrides, not heuristics.
- Unknown production host fails closed or maps to a configured default only if
  explicitly allowed.
- Resolution must respect reverse proxy headers only from trusted deployment
  environments.
- The resolved child app id should be available to request handlers, workspace
  route helpers, billing routes, telemetry, and agent route context.

Required core seam before implementation:

```ts
resolveChildAppContext(request) -> {
  childAppId,
  workspaceKind,
  defaultWorkspaceName,
  allowedKinds,
  billing,
}
```

This child-app context must be the single request-scoped source of truth shared
by workspace routes, agent routes, billing routes, `/api/v1/workspace/meta`,
telemetry, and frontend runtime metadata. Route handlers may accept explicit
workspace ids, but they must not infer child app or workspace kind from request
body fields when the resolved child-app context disagrees.

Proposed helper names:

```ts
resolveChildAppFromRequest(request, registry)
resolveChildAppContext(request)
getChildAppContext(request)
```

### Workspace kind and default workspace behavior

Add durable workspace kind. Minimal schema direction:

```txt
workspaces.kind text not null default 'generic'
```

Default workspace uniqueness should become:

```txt
unique default per (created_by, app_id, kind)
```

Core workspace APIs should support child-app-aware default list/create without
breaking existing clients:

- `GET /api/v1/workspaces` returns workspaces visible for the current child app
  by default, or accepts an explicit kind filter for privileged/internal uses.
- `POST /api/v1/workspaces` creates the current child app's workspace kind by
  default unless a validated kind is explicitly supplied.
- Authenticated shell default resolution uses `(user, appId, workspaceKind)`.
- `/workspace/:id` validates membership as today, then verifies that the
  workspace kind is allowed for the current child app; cross-kind access either
  redirects to the right host or returns a stable error.

Migration/backward compatibility details:

- Existing rows migrate to `kind='generic'` in a backfill-safe migration.
- The default workspace unique index changes from `(created_by, app_id)` to
  `(created_by, app_id, kind)` only for `is_default=true`; the migration must
  preserve the existing partial-index/soft-delete behavior and avoid creating
  duplicate active defaults.
- Soft-deleted workspaces remain excluded exactly as they are today; adding
  `kind` must not resurrect or reclassify deleted rows.
- Existing APIs remain valid for single-kind deployments.
- Existing app code that does not configure child apps behaves as one default
  generic child app.
- Cross-kind access, unknown child app, and forbidden child app context failures
  must use stable error codes (for example `CHILD_APP_NOT_FOUND`,
  `CHILD_APP_FORBIDDEN`, `WORKSPACE_KIND_FORBIDDEN`) rather than ad hoc strings.

### Plugin scoping

Do not make trusted plugin packages dynamic/untrusted. Instead, collect all
trusted child-app server plugins at boot, but tag their contributions with
`childAppId` / `workspaceKind` and filter at request/runtime use.

Target behavior:

| Contribution | Scoping rule |
| --- | --- |
| Fastify domain routes | Registered globally, but trusted domain route handlers must fail closed unless they are explicitly public or the resolved child app/workspace kind is authorized. Route paths should be child-app namespaced (`/api/macro/*`) to avoid collisions. |
| Agent tools | Only included for agent sessions whose workspace kind matches the child app. |
| System prompt | Only appended for matching workspace kind. |
| Pi skills/packages | Only loaded for matching workspace kind/session root. |
| Provisioning | Only executed for matching workspace kind. |
| Front plugins | Only passed to the shell for the resolved child app. |
| Surface resolvers/catalogs | Only registered in the active frontend shell/plugin registry. |
| Preserved UI state keys | Scoped by child app/workspace kind where needed. |

Implementation direction:

```ts
type ScopedPluginContribution = {
  childAppId: string
  workspaceKind: string
  plugin: WorkspaceServerPlugin
}
```

`createCoreWorkspaceAgentServer` can build a static collection, then route
`getPi`, `getExtraTools`, `systemPromptAppend`, and `provisionRuntime` through a
workspace-aware filter.

### Provisioning scoping

Provisioning must be keyed by workspace kind and plugin contribution fingerprint:

```txt
workspace id + child app/workspace kind + provisioning contribution ids
  -> provisioning fingerprint
```

Macro workspaces receive:

- Macro workspace template;
- Macro Pi skills;
- Macro Python SDK/CLI;
- Macro bridge environment.

Generic workspaces do not receive Macro files or Python SDK dependencies.

Readiness UI should keep current three-level readiness behavior:

1. chat ready;
2. workspace/files ready;
3. runtime dependencies ready.

Child-app runtime dependencies can customize labels (for example, "Macro runtime
installing…") without turning Level 3 into a global blocker.

### Frontend shell selection

The deployed SPA resolves child app from runtime config and/or host:

```txt
browser host
  -> runtime config child app metadata
  -> frontend child app definition
  -> CoreWorkspaceAgentFront props
```

The front shell selects:

- product title/branding/theme defaults;
- public marketing shell and public routes;
- chat-first public shell copy/models/suggestions;
- front plugins;
- initial panels;
- top-bar additions;
- user settings/billing section labels;
- session/local-storage keys.

Frontend state isolation requirements:

- workspace query/cache keys include child app id and workspace kind where the
  data depends on host/default workspace selection;
- default workspace selection caches include child app id/workspace kind;
- local/session storage keys for sessions, layout, surface state, onboarding, and
  public draft handoff include child app id or workspace kind when values should
  not cross product surfaces;
- authenticated `/workspace/:id` navigation revalidates workspace kind instead
  of trusting cached frontend state.

Macro example:

```txt
macro.senecaapp.ai
  -> MacroAnalyst public shell
  -> macro front plugin
  -> macro demo panels
  -> Macro-specific suggestions
  -> Macro billing packs from global billing config
```

Generic example:

```txt
app.senecaapp.ai
  -> Seneca AI public shell
  -> generic workspace plugins
  -> generic suggestions
  -> generic billing packs
```

### Global billing with per-child Stripe products/prices

Billing remains a global platform subsystem. Child apps contribute product/price
metadata:

```ts
type ChildAppBillingDefinition = {
  stripeProductId: string
  prices: Array<{
    packId: string
    priceId: string
    creditsMicros: number
    label: string
  }>
  defaultPackId: string
  redirectUrl: string
}
```

Checkout flow:

```txt
request host -> child app -> billing definition
  -> parse configured packs/prices for that child app
  -> create Stripe Checkout Session for that child app's price
  -> attach signed/server-derived metadata: childAppId, workspaceKind, userId, workspaceId, packId, priceId
  -> webhook fetches/uses Stripe line item price/product data
  -> webhook validates actual line item price/product against server registry
  -> global ledger records credit purchase with childAppId context
```

Implementation requirements:

- Add a child-app-aware billing config/env parser, e.g. a structured JSON config
  or namespaced env entries that map `childAppId -> stripeProductId -> packs`.
- Metadata is for correlation and audit only; the webhook must not trust
  `packId`, `priceId`, or `childAppId` metadata unless the actual Stripe line
  item price/product matches the server registry for that child app.
- Checkout creation, purchase records, ledger rows, balance/store APIs, and
  usage/debit APIs include child app context.
- Backfill/default semantics: legacy rows without child app context are treated
  as the default `seneca`/`generic` child app until explicitly migrated.
- Tests must cover the same `packId` used by two child apps with different
  `priceId` values.

Ledger direction:

- Keep a single ledger/table/service.
- Add child-app/product context to purchase and usage rows where not already
  represented.
- Usage debit resolves active child app from workspace kind/session context.
- Global billing routes can remain under `/api/credits/*`, but they must resolve
  product/prices from request child app.
- One webhook endpoint can use metadata for correlation, but dispatch/crediting must be validated against actual Stripe line item price/product ids and the server registry.

Important distinction:

```txt
same Stripe organization/account
  -> multiple Stripe Products/Prices
  -> one platform billing service
```

Open product decision: whether credit balances are globally fungible across
child apps or displayed/limited per child app. The initial recommendation is to
record `childAppId` on ledger rows and expose per-child app balances in UX, while
leaving a platform-level aggregation possible for admins.

### Auth, cookies, origins, and proxy trust

The shared platform must support multiple hostnames under the same app. Host
resolution is a security boundary and requires an early Phase 0 gate before
multi-host rollout.

Design requirements:

- Define trusted proxy behavior before reading forwarded host headers; direct
  requests with spoofed `X-Forwarded-Host` must be rejected or ignored in tests.
- Add all child app origins to CORS/trusted origins.
- Confirm better-auth supports the desired subdomain cookie behavior.
- Prefer cookie domain `.senecaapp.ai` if sign-in should seamlessly carry across
  `app.senecaapp.ai` and `macro.senecaapp.ai`.
- If cross-subdomain session sharing is not reliable, fall back to same auth DB
  with per-host sign-in redirects, but keep user identity shared.
- Runtime config should expose only safe public child app metadata.
- Auth redirects (`BETTER_AUTH_URL`, callback URLs, reset links) must produce the
  correct host for the request/child app or use a canonical auth host with safe
  return URLs.
- CSRF/origin checks must accept only registered child app origins.
- Better Auth base URL, callback URL, password reset return URL, checkout return
  URL, and cookie domain behavior must be decided and tested before enabling a
  second production host. The cookie-domain choice remains a Phase 0 decision,
  not an implicit implementation detail.

Security notes:

- Do not trust arbitrary `Host`/`X-Forwarded-Host` outside known trusted proxy setup; include negative spoofing tests.
- Never let request body choose `childAppId` for billing or workspace creation
  without checking against resolved host and authenticated workspace context.
- Stripe webhook metadata is advisory; validate product/price ids against server
  registry.

## Proposed phased implementation

### Phase 0 — lock the product/security contract

Deliverables:

- Finalize whether balances are per-child display/budget or globally fungible.
- Finalize whether Macro domain is `macro.senecaapp.ai`, `getmacroanalyst.com`,
  or both.
- Finalize cookie/session sharing policy across subdomains.
- Finalize trusted proxy/forwarded-host policy, CORS/trusted origins, Better
  Auth base/callback/return URL behavior, and cookie domain strategy.
- Replace the current unconditional Fastify `trustProxy: true` posture with a
  configured trusted-proxy allowlist/function before forwarded-host child-app
  resolution ships.
- Decide first registry location: app-local only vs exported core helper.

Acceptance:

- Written decision notes in this plan or a follow-up decision doc.
- No implementation begins until product/security decisions are accepted,
  especially proxy trust and auth/cookie behavior for multiple hosts.

### Phase 1 — app-local child app registry and host resolution

Implement in `apps/full-app` first to minimize public API commitment.

Tasks:

1. Add `apps/full-app/src/child-apps/` definitions for `seneca` and a
   metadata/test-fixture-only `macro` entry. Do not import the real Macro plugin
   until Phase 7.
2. Add host normalization/resolution helper with dev override support.
3. Add request decoration/context for resolved child app via
   `resolveChildAppContext(request)`.
4. Expose safe runtime child app metadata to frontend.
5. Add tests for host matching, unknown hosts, dev host mapping, and metadata
   redaction.

Acceptance:

- `app.senecaapp.ai` resolves to `seneca`.
- `macro.senecaapp.ai` resolves to `macro`.
- Unknown production host fails closed or resolves only to explicit default.
- No secrets appear in runtime config.
- Direct spoofed `X-Forwarded-Host` requests cannot impersonate another child
  app outside trusted proxy configuration.

### Phase 2 — workspace kind schema and default workspace behavior

Tasks:

1. Add `workspaces.kind` with default `generic`.
2. Add migration for existing rows.
3. Update workspace shared type/API schema.
4. Update default workspace uniqueness to `(created_by, app_id, kind)`.
5. Update list/create/default resolution to use current child app workspace kind.
   Include `workspaceKind` in default-workspace in-flight dedupe keys and race
   fallback list queries; current code dedupes by `appId:userId` only.
6. Add membership + kind checks for `/workspace/:id` under a child app host.
7. Add tests for two defaults for one user: generic and macro.

Acceptance:

- Existing full-app users keep their generic workspace.
- Same user can have a default generic workspace and default macro workspace.
- Macro host does not auto-open the generic workspace.
- Generic host does not auto-open the macro workspace unless explicitly allowed.

### Phase 3 — scoped server plugin and agent contribution filtering

Tasks:

1. Represent child-app server plugins with `(childAppId, workspaceKind)` scope.
2. Register trusted routes once at boot with collision checks/namespaced paths.
3. Filter extra tools by workspace kind in `getExtraTools`.
4. Filter Pi options/system prompt by workspace kind in `getPi` and a
   workspace-aware system-prompt seam.
5. Do not pass scoped child-app `extraTools`, `systemPromptAppend`, or `pi`
   through static top-level agent options globally; resolve them via
   workspace-aware filters (`getExtraTools`, `getPi`, workspace-aware system
   prompt, and `provisionRuntime` as applicable).
6. Filter preserved UI state keys if needed.
7. Add focused tests that Macro tools/prompt are absent from generic sessions and
   present in macro sessions.

Acceptance:

- Early tests use fixture scoped plugins unless the real Macro plugin has moved
  in Phase 7; this avoids making Macro import/migration a hidden prerequisite
  for core scoping work.
- Generic workspace tool catalog has no Macro tools.
- Macro workspace tool catalog includes Macro tools.
- Macro system prompt/skills apply only in Macro sessions.
- Route registration remains boot-time and trusted-only.

### Phase 4 — scoped provisioning and readiness labels

Tasks:

1. Filter runtime provisioning contributions by workspace kind.
2. Include child app/workspace kind in provisioning fingerprint inputs.
3. Add child-app-specific runtime dependency readiness label/copy, using fixture
   provisioning until the real Macro plugin moves in Phase 7.
4. Test generic provisioning does not install fixture child-app SDK/template.
5. Test scoped fixture provisioning installs only for the matching workspace kind.

Acceptance:

- Generic workspace remains lean.
- Scoped fixture child-app workspace provisions child-app-specific files/dependencies.
- Runtime dependency readiness is visible but does not block chat.
- Real Macro SDK/template/`bm` assertions wait for Phase 7 Macro migration.

### Phase 5 — frontend child app shell selection

Tasks:

1. Move current full-app/Seneca shell props into `seneca` child app definition.
2. Add fixture Macro-like shell metadata for `macro`; port the real Macro front
   shell props/plugin/public routes only in Phase 7.
3. Select `CoreWorkspaceAgentFront` props from resolved child app metadata.
4. Scope local storage keys, session keys, query/cache keys, and default
   workspace selection caches by child app/workspace kind where relevant.
5. Add tests for public shell and authenticated shell selection.

Acceptance:

- `app.senecaapp.ai` renders Seneca AI shell.
- `macro.senecaapp.ai` renders MacroAnalyst shell.
- Public routes and initial panels are child-app correct.
- Front plugins do not leak across child app shells.

### Phase 6 — global billing product registry

Tasks:

1. Extend global billing config to support multiple child app product entries
   with a concrete parser/env shape.
2. Resolve checkout packs from current child app context.
3. Add child app/workspace kind/workspace id/pack id/price id metadata to
   Checkout Sessions, derived server-side from the registry and authenticated
   context.
4. If metadata is signed, bind `childAppId`, `workspaceKind`, `workspaceId`, `packId`, and `priceId`; actual Stripe line item/product registry validation remains authoritative.
5. Add a Stripe line-item/product retrieval seam plus test double for webhook
   validation tests.
6. Validate webhook actual Stripe line item price/product ids against the server
   registry, not metadata alone.
7. Record child app context on ledger rows or equivalent metadata, with legacy
   backfill/default behavior.
8. Update credit balance/store/purchase APIs and UX to display current child
   app's relevant packs/balance.
9. Add tests for checkout on Seneca vs Macro hosts, including same `packId` with
   different `priceId` values.

Acceptance:

- Same billing service handles both products.
- Seneca checkout uses Seneca Stripe price ids.
- Macro checkout uses Macro Stripe price ids.
- Webhook rejects mismatched product/price metadata and line item price/product
  mismatches.
- No Stripe secrets are exposed to frontend/logs.

### Phase 7 — Macro migration

Tasks:

1. Import or vendor Macro plugin code into the shared platform using the trusted
   app/internal plugin path.
2. Configure Macro child app definition.
3. Configure Macro Stripe product/prices in global billing.
4. Configure Macro host/origins/auth redirects.
5. Remove assumptions that Macro has its own deployment root/database.
6. Keep existing Macro domain routes under `/api/macro/*`.
7. Run Macro smoke against shared deployment.

Acceptance:

- MacroAnalyst works at its target host on the shared deployment.
- Existing Macro app can remain as fallback until smoke passes.
- Macro workspace is distinct from generic workspace for the same user.
- Macro data catalog/tools/deck/chart flows work.

### Phase 8 — child app authoring workflow

Tasks:

1. Document "new child app" checklist.
2. Add template definition file for a child app.
3. Optionally add CLI/scaffold command later:

   ```sh
   boring-ui child create macro \
     --host macro.senecaapp.ai \
     --workspace-kind macro \
     --plugin macro \
     --stripe-product prod_xxx
   ```

4. Add smoke template for child app onboarding.

Acceptance:

- New child agent creation has a documented path requiring no new DB/deploy/auth
  stack.
- The remaining manual steps are DNS, Stripe product/prices, and plugin/domain
  implementation.

## Tests and validation plan

### Unit tests

- Host resolver:
  - exact host match;
  - trusted proxy forwarded host handling;
  - direct spoofed `X-Forwarded-Host` negative cases;
  - unknown host fail-closed;
  - dev override;
  - no secrets in runtime metadata.
- Workspace kind:
  - migration default;
  - default uniqueness per kind;
  - list/create uses current child app kind;
  - cross-kind workspace access behavior.
- Plugin scoping:
  - generic session excludes Macro tools/prompt/Pi;
  - macro session includes Macro tools/prompt/Pi;
  - trusted domain route handlers fail closed for unauthorized child app/workspace kind contexts unless explicitly public;
  - route collision detection.
- Provisioning:
  - generic provisioning excludes Macro contributions;
  - macro provisioning includes Macro contributions;
  - fingerprint changes when child app provisioning changes.
- Billing:
  - checkout uses child app prices;
  - same packId across child apps can map to different priceId values;
  - webhook validates actual Stripe line item price/product against child app registry;
  - ledger/store/purchase APIs record child app context and handle legacy defaults;
  - frontend receives only public billing pack metadata.

### Integration tests

- Sign in once, visit both child app hosts, verify distinct default workspaces.
- Start chat on generic host while Macro runtime dependencies are irrelevant.
- Start chat on Macro host while Macro runtime dependencies prepare in the
  background.
- Open Macro data catalog/chart/deck flows from Macro host.
- Ensure generic host command palette/catalog does not show Macro entries.

### E2E/smoke checks

For each registered child app:

1. `GET /health` returns ok.
2. Public shell loads on host.
3. Sign-up/sign-in works.
4. Default workspace resolves to expected kind.
5. `/api/v1/workspace/meta` reports expected project/child app context and rejects cross-kind workspaces with a stable error code.
6. Agent capabilities endpoint works.
7. Tool catalog is scoped correctly.
8. Billing balance endpoint shows child app's packs.
9. Checkout creation uses expected Stripe price id in test mode.
10. Runtime smoke for child-app-specific provisioning passes.
11. Multi-host post-deploy smoke runs the same suite for each configured host
    with host headers/URLs that match production proxy behavior.
12. Negative Host/`X-Forwarded-Host` spoofing smoke confirms requests cannot
    select an unauthorized child app.

Macro-specific smoke:

- Macro catalog status route works or reports warming with stable code.
- `macro_search` works when ClickHouse is configured.
- Macro chart opens via surface resolver.
- `bm list` works after runtime dependencies are ready.
- Macro deck route/presentation works.

## Rollout strategy

1. Ship schema/registry infrastructure with only the existing generic child app
   enabled.
2. Enable Macro in staging/preview host with test Stripe prices.
3. Run dual-write or metadata-only billing ledger context if needed before UX
   depends on it.
4. Deploy shared platform while old Macro deployment remains live.
5. Cut DNS for Macro host after smoke passes.
6. Keep rollback path: point Macro DNS back to old deployment and disable Macro
   child app registry entry.
7. After stable period, retire old Macro app/deployment resources.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Macro tools/prompt leak into generic workspace | Workspace-kind scoped tool/Pi/prompt tests; fail closed if child app context missing. |
| Wrong default workspace opened on child host | Add workspace kind to default uniqueness; test same user with two defaults; scope frontend query/cache/storage keys by child app/kind. |
| Auth redirect/cookie issues across subdomains | Decide cookie domain/canonical auth host early; add multi-origin auth smoke before rollout. |
| Host spoofing through proxy headers | Define trusted proxy policy; reject/ignore spoofed `X-Forwarded-Host` outside trusted proxies; add negative tests. |
| Stripe metadata tampering | Validate actual Stripe line item price/product ids against server registry; derive child app from session/host where possible. |
| Route collisions between child apps | Require child-app namespaced API paths and boot-time collision checks. |
| Provisioning bloat in generic workspaces | Filter provisioning by workspace kind; assert file/dependency absence in tests. |
| Operational rollback complexity | Keep old Macro deployment until shared smoke is proven; DNS rollback documented. |
| Premature public API lock-in | Start registry app-local in full-app; graduate only after Macro migration proves shape. |

## Open decisions

1. **Credit balance semantics:** Are credits fungible across child apps or shown
   as per-child balances? Recommended v1: record child app context and show
   current child app balance; keep admin/global aggregation possible.
2. **Auth host/cookie strategy:** Shared `.senecaapp.ai` cookie vs canonical auth
   host with per-domain redirects.
3. **Macro domain plan:** `macro.senecaapp.ai`, `getmacroanalyst.com`, or both.
4. **Registry location:** app-local first vs core exported helper immediately.
   Recommended: app-local first.
5. **Cross-kind workspace navigation:** Redirect to owning host vs stable 403.
   Recommended: redirect when the registry knows the owning host, otherwise 403.
6. **Billing route path:** Keep `/api/credits/*` global vs introduce
   `/api/child-apps/:id/credits/*`. Recommended: keep global route and resolve
   child app from request host.

## Definition of done for the platform milestone

- One deployment serves Seneca and Macro hosts.
- One Postgres database stores both generic and Macro workspaces.
- One auth system signs users into both surfaces.
- One global billing service handles both Seneca and Macro Stripe products.
- Same user gets distinct default workspaces per workspace kind.
- Macro plugins/provisioning/tools/prompts are scoped to Macro workspaces.
- Generic workspace remains free of Macro-specific tools and runtime setup.
- Post-deploy smoke covers every registered child app.
- New child-agent creation is documented as: define child app, add trusted
  plugin, add billing product/prices, point DNS, deploy shared platform.
