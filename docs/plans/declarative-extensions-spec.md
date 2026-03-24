# Declarative Extensions for boring-ui Child Apps

## Status: DRAFT — seeking usability feedback

## Problem

boring-ui child apps can extend the platform with custom panes, backend routes, and agent tools,
but every extension point requires manual multi-file wiring:

| Extension | Files Touched | Discovery |
|---|---|---|
| Custom pane | Write `kurt/panels/X/Panel.jsx` | Convention-based scan by `WorkspacePluginManager` |
| Custom route | Write Python router + add to `[backend].routers` list | Config-driven import |
| Frontend agent tool | Write JS tool object + call `addPiAgentTools()` in app init | Imperative registration |
| Backend agent tool | Modify `WORKSPACE_TOOLS` list + `tool_executor.py` | Hardcoded |
| UI-action tool | Write JS tool with `window.dispatchEvent()` | Imperative registration |

Problems with this:

1. **No single source of truth.** A tool's schema lives in JS, its handler in Python, its route
   in TOML — nothing validates they agree.
2. **No `bui doctor` validation.** Typo in a handler path? Missing panel file? Silent failure
   at runtime.
3. **No capabilities advertisement for tools.** The agent doesn't know child app tools exist
   unless they're hardcoded into the PI service or frontend.
4. **No scaffolding support.** `bui init` creates a route stub but no pane or tool stubs.
5. **Pane metadata is invisible.** Placement, constraints, and capability requirements are
   hardcoded in JS, not in config.

## Goal

A unified, declarative extension system where child apps declare panes, tools, and route
metadata in `boring.app.toml`. The framework handles discovery, validation, capability
advertisement, and (where possible) auto-generated execution wrappers.

## Design Principles

1. **TOML is the source of truth.** If it's in `boring.app.toml`, the framework owns discovery
   and validation. No imperative registration needed for declared extensions.
2. **Convention over configuration, but configuration wins.** The existing `kurt/panels/` scan
   continues to work for undeclared panes. But declared panes get metadata, validation, and
   scaffolding support.
3. **Tools are typed.** Every tool has a JSON Schema for parameters, a declared execution
   context (backend/frontend/route-proxy/ui-action), and a handler reference the framework
   can resolve and validate.
4. **`bui doctor` validates everything.** Handler files exist, schemas parse, required features
   are spelled correctly, route prefixes don't collide.
5. **Capabilities endpoint is the single discovery surface.** Panes, tools, and route metadata
   all flow into `/api/capabilities` automatically.
6. **Additive, not breaking.** Existing child apps with manual wiring continue to work. The
   declarative system is opt-in per extension.

---

## 1. Declarative Tool Registration: `[tools.*]`

### 1.1 Tool Execution Contexts

boring-ui has three agent execution contexts, each with different capabilities:

| Context | Runtime | Has UI Access | Has Filesystem | Has DB/Services | Used By |
|---|---|---|---|---|---|
| **Frontend PI** | Browser JS | Yes (DOM, events, panels) | LightningFS (IndexedDB) | Via HTTP to backend | `agents.mode = "frontend"` |
| **Backend PI** | Node.js (proxied) | Limited (HTTP UI API) | Workspace root (disk) | Via HTTP to backend | `agents.mode = "backend"` |
| **Messaging** | Python (server) | None | Workspace root (disk) | Direct Python calls | Telegram/Slack gateway |

Tools must declare which context they target so the framework can generate the right executor.

### 1.2 TOML Schema

All tools live under `[tools.*]` with a `kind` field that determines execution context.
New kinds can be added later as enum values without restructuring the TOML.

```toml
# ── Backend tool: Python handler, runs server-side ────────────
[tools.compute_stats]
kind = "backend"
description = "Compute descriptive statistics for a dataset"
handler = "my_app.tools.stats:compute"
parameters.dataset_id = { type = "string", required = true, description = "Dataset identifier" }
parameters.metric = { type = "string", required = false, enum = ["mean", "median", "p95", "all"] }

# ── Backend tool with complex params via external schema ──────
[tools.ingest_feed]
kind = "backend"
description = "Fetch and store data from an external feed"
handler = "my_app.tools.ingest:fetch_feed"
schema_file = "schemas/ingest_feed.json"         # JSON Schema file (replaces inline parameters)
requires_auth = true

# ── Route-proxy tool: auto-generated wrapper over backend route
[tools.search_catalog]
kind = "route"
description = "Search the data catalog by keyword"
route = "/api/v1/macro/catalog/search"
method = "GET"
parameters.q = { type = "string", required = true, description = "Search query" }
parameters.page_size = { type = "integer", required = false, default = 20 }

# ── Route-proxy tool with complex body via schema file ────────
[tools.persist_series]
kind = "route"
description = "Save a derived series with lineage tracking"
route = "/api/v1/macro/transform/persist"
method = "POST"
schema_file = "schemas/persist_series.json"

# ── UI-action tool: dispatches frontend CustomEvent ───────────
[tools.open_chart]
kind = "ui"
description = "Open a chart panel for the given series"
event = "BM_OPEN_SERIES"
parameters.series_id = { type = "string", required = true }

[tools.open_deck]
kind = "ui"
description = "Open a markdown deck in the deck panel"
event = "BM_OPEN_DECK"
parameters.path = { type = "string", required = true, description = "Path relative to workspace" }

# ── Tool-level configuration ─────────────────────────────────
[tools._config]
system_prompt_file = "prompts/agent.md"
```

**Parameter declaration**: Two mutually exclusive options per tool:
- `parameters.*` — inline TOML, best for 1-3 simple params
- `schema_file` — path to a JSON Schema file, for complex/nested params

If both are present, `bui doctor` errors. This ensures one source of truth per tool
while keeping simple tools concise and complex tools properly structured.

**`kind` values** (v1):
- `backend` — Python handler, server-side. Needs `handler`.
- `route` — Auto-generated HTTP wrapper. Needs `route` + `method`.
- `ui` — Frontend event dispatch. Needs `event`. Frontend-only.

Future kinds (additive, no TOML restructuring needed):
- `frontend` — Custom JS handler in browser context. Would need `handler = "tools/foo.js:fn"`.
- `messaging` — Messaging-gateway-specific tool (if ever needed).

### 1.3 Handler Contract

**`kind = "backend"`** — Python handler, server-side:

```python
# src/my_app/tools/stats.py

async def compute(dataset_id: str, metric: str = "all") -> dict:
    """Handler receives kwargs matching declared parameters.
    Returns a dict that the framework JSON-serializes as the tool result."""
    results = await run_query(dataset_id, metric)
    return {"dataset_id": dataset_id, "metric": metric, "values": results}
```

Handler signature rules:
- Parameter names must match the declared schema (inline `parameters.*` or `schema_file`).
- Return type must be `dict`, `str`, or `list`. Framework wraps it as tool result content.
- For workspace access, accept an optional `ctx: WorkspaceContext` parameter (injected by
  framework if present in signature).
- Async handlers preferred; sync handlers are run in a thread pool.
- Exceptions become tool error results with the exception message (no traceback to agent).

**`kind = "route"`** — auto-generated HTTP wrapper:
- No handler code needed. Framework auto-generates:
  - **Frontend PI**: JS `fetch()` call to the declared route with parameter mapping
  - **Backend PI**: Python `httpx` call to the backend route
  - **Messaging**: Python `httpx` call (same as backend PI)
- Path parameters: Use `{param}` in route, e.g., `/api/v1/series/{id}/data` — framework
  extracts `id` from tool parameters and substitutes.
- Query parameters (GET) / body parameters (POST) are inferred from `method`.

**`kind = "ui"`** — frontend event dispatch:
- No handler code needed. Framework auto-generates:
  - `window.dispatchEvent(new CustomEvent(event, { detail: { ...params } }))`
- Frontend PI mode only. In backend PI or messaging mode, these tools are excluded from
  the tool catalog (not an error — just not applicable).

### 1.4 Framework Integration

**Config loading** (`app_config_loader.py`):
- Parse `[tools.*]` sections (skip `[tools._config]`)
- Read `kind` field to determine tool type and required fields
- Resolve parameters from inline `parameters.*` or load + validate `schema_file`
- Build typed `ToolDefinition` objects: `name`, `kind`, `description`,
  `input_schema` (JSON Schema), `handler`/`route`/`event`, `requires_auth`
- Validate handler import paths resolve (backend tools)
- Validate route paths match declared routers (route-proxy tools)

**Tool registry** (new `src/back/boring_ui/api/tool_registry.py`):
- Holds the resolved tool catalog
- `list_tools(context: str) -> list[ToolDefinition]` — filters by execution context
- `get_tool(name) -> ToolDefinition`
- `execute_backend_tool(name, params, workspace_ctx) -> dict` — resolves handler, calls it
- Registered in app state, accessible from capabilities endpoint and agent harnesses

**Capabilities endpoint** (`/api/capabilities`):
```json
{
  "tools": [
    {
      "name": "compute_stats",
      "kind": "backend",
      "description": "Compute descriptive statistics for a dataset",
      "input_schema": {
        "type": "object",
        "properties": {
          "dataset_id": {"type": "string", "description": "Dataset identifier"},
          "metric": {"type": "string", "enum": ["mean", "median", "p95", "all"], "default": "all"}
        },
        "required": ["dataset_id"]
      }
    },
    {
      "name": "search_catalog",
      "kind": "route",
      "description": "Search the data catalog by keyword",
      "input_schema": { ... }
    },
    {
      "name": "open_chart",
      "kind": "ui",
      "description": "Open a chart panel for the given series",
      "input_schema": { ... }
    }
  ]
}
```

**PI service integration** (`tools.mjs`):
- On session creation, fetch tool catalog from `/api/capabilities`
- For each tool, generate an executor:
  - `backend` → HTTP POST to `/api/v1/tools/{name}/execute` (new framework route)
  - `route` → HTTP to declared route with parameter mapping
  - `ui` → HTTP POST to `/api/v1/ui/commands` with event dispatch payload
- Merge with built-in workspace tools (built-ins take precedence on name collision)

**Messaging integration** (`tool_executor.py`):
- `execute_tool()` checks tool registry before falling back to built-in `WORKSPACE_TOOLS`
- Backend tools: calls handler directly (in-process, no HTTP)
- Route-proxy tools: calls route via internal HTTP
- UI tools: skipped (not applicable in messaging context)

**New framework route** (for PI service to call backend tools):
```
POST /api/v1/tools/{tool_name}/execute
Content-Type: application/json
Authorization: Bearer <internal_token>

{"dataset_id": "gdp_us", "metric": "mean"}

→ 200 {"result": {"dataset_id": "gdp_us", "metric": "mean", "values": [...]}}
```

### 1.5 `bui doctor` Validation

| Check | Severity | What |
|---|---|---|
| `tools.kind_valid` | ERROR | `kind` is one of the recognized values |
| `tools.handler_resolves` | ERROR | Backend tool handler module + function exists and is importable |
| `tools.handler_signature` | WARN | Handler parameters match declared schema |
| `tools.route_exists` | ERROR | Route-proxy tool's route prefix matches a declared router |
| `tools.schema_valid` | ERROR | Parameter schemas (inline or `schema_file`) are valid JSON Schema |
| `tools.schema_file_exists` | ERROR | `schema_file` path exists and parses as valid JSON Schema |
| `tools.schema_exclusive` | ERROR | Tool does not declare both `parameters.*` and `schema_file` |
| `tools.no_name_collision` | ERROR | No two tools share the same name |
| `tools.system_prompt_exists` | WARN | `system_prompt_file` path exists if declared |
| `tools.enum_values_valid` | WARN | Enum values are non-empty strings |

### 1.6 `bui init` Scaffolding

```bash
bui init my-app --with-tool stats --tool-kind backend    # backend tool stub
bui init my-app --with-tool search --tool-kind route     # route-proxy tool stub
bui init my-app --with-tool open-panel --tool-kind ui    # ui-action tool stub
```

Each generates:
- `[tools.<name>]` declaration in `boring.app.toml` with `kind` field
- Handler file (backend tools only) with example implementation
- `schemas/<name>.json` stub (backend tools with complex params)
- Prompt file stub if `system_prompt_file` not already declared

---

## 2. Declarative Panel Registration: `[frontend.panels.*]`

### 2.1 Current State

Panes are discovered two ways:
1. **Built-in**: Hardcoded in `src/front/registry/panes.jsx` (`createDefaultRegistry()`)
2. **Workspace plugins**: Convention scan of `kurt/panels/*/Panel.jsx` by `WorkspacePluginManager`

Both lack declarative metadata. Built-ins hardcode placement/constraints in JS. Workspace
plugins get `placement: "center"` and no constraints/requirements.

### 2.2 TOML Schema

```toml
[frontend.panels.data-catalog]
title = "Data Catalog"
component = "kurt/panels/data-catalog/Panel.jsx"   # relative to workspace root
placement = "left"                                   # left | center | right | bottom
icon = "database"                                    # lucide icon name (optional)
essential = true                                     # must exist in layout (default: false)
locked = false                                       # prevent close (default: false)
hide_header = false                                  # hide tab header (default: false)

[frontend.panels.data-catalog.constraints]
min_width = 240
min_height = 150
collapsed_width = 48

[frontend.panels.data-catalog.requires]
features = ["files"]                                 # ALL must be enabled
any_features = []                                    # at least ONE (optional)
routers = []                                         # ALL must be enabled

[frontend.panels.chart-canvas]
title = "Chart"
component = "kurt/panels/chart-canvas/Panel.jsx"
placement = "center"

[frontend.panels.eval-status]
title = "Eval Status"
component = "kurt/panels/eval-status/Panel.jsx"
placement = "center"
requires.features = ["files"]
```

### 2.3 Framework Integration

**Config loading**: Parse `[frontend.panels.*]` into typed `PanelDefinition` objects.

**Capabilities endpoint** (`/api/capabilities`):
```json
{
  "workspace_panes": [
    {
      "id": "ws-data-catalog",
      "name": "data-catalog",
      "title": "Data Catalog",
      "path": "data-catalog/Panel.jsx",
      "placement": "left",
      "icon": "database",
      "essential": true,
      "constraints": {"min_width": 240, "min_height": 150, "collapsed_width": 48},
      "requires": {"features": ["files"], "any_features": [], "routers": []}
    }
  ]
}
```

**Frontend loading** (`App.jsx`):
- `loadWorkspacePanes()` receives enriched metadata from capabilities
- `registerPane()` called with full config (placement, constraints, requirements) instead
  of defaults
- Capability gating applied automatically from declared requirements

**Backward compatibility**:
- Undeclared `kurt/panels/*/Panel.jsx` files still discovered by convention scan
- Convention-discovered panes get default metadata (center, no constraints, no requirements)
- If a pane is both convention-discovered and TOML-declared, TOML wins

### 2.4 `bui doctor` Validation

| Check | Severity | What |
|---|---|---|
| `panels.component_exists` | ERROR | Declared component file exists |
| `panels.default_export` | WARN | Component file has a default export (static check) |
| `panels.placement_valid` | ERROR | Placement is one of left/center/right/bottom |
| `panels.icon_known` | WARN | Icon name is in the lucide icon set |
| `panels.features_spelled` | WARN | Required feature names match known feature set |
| `panels.no_id_collision` | ERROR | No two panels produce the same `ws-{name}` id |

### 2.5 `bui init` Scaffolding

```bash
bui init my-app --with-panel dashboard
```

Generates:
- `kurt/panels/dashboard/Panel.jsx` with example component
- TOML declaration in `boring.app.toml` `[frontend.panels.dashboard]`

---

## 3. Route Metadata: `[backend.routes.*]`

### 3.1 Current State

`[backend].routers` is a flat list of Python import paths. There's no metadata — no
descriptions, tags, auth requirements, or prefix declarations. The capabilities endpoint
reports routers but only by name.

### 3.2 TOML Schema

```toml
[backend]
routers = [
    "my_app.routers.status:router",
    "my_app.routers.data:router",
]

[backend.routes.status]
module = "my_app.routers.status:router"          # must match an entry in routers list
prefix = "/api/x/status"                          # explicit mount prefix (optional)
description = "App health and status endpoints"
tags = ["public", "monitoring"]
requires_auth = false

[backend.routes.data]
module = "my_app.routers.data:router"
prefix = "/api/v1/macro"
description = "Data catalog and series operations"
tags = ["data", "authenticated"]
requires_auth = true
```

### 3.3 Framework Integration

**Config loading**: Route metadata is optional. Routers without metadata continue to work
exactly as they do today (auto-mounted at `/api/x/<module_name>`).

**Capabilities endpoint**: Enriched router entries include description, tags, auth requirement.

**`bui doctor`**: Validates `module` references match entries in `[backend].routers`, prefixes
don't collide with framework routes (`/api/v1/agent/*`, `/api/capabilities`, etc.).

### 3.4 Interaction with Route-Proxy Tools

When a `kind = "route"` tool declares `route = "/api/v1/macro/catalog/search"`, `bui doctor`
can cross-reference against `[backend.routes.*]` to verify:
- A router with a matching prefix is declared
- The route is reachable (prefix + path exists in the router's URL space)
- Auth requirements are consistent (tool doesn't skip auth that the route requires)

---

## 4. Capability Advertisement Summary

After this spec, `/api/capabilities` returns a complete extension manifest:

```json
{
  "features": { "files": true, "git": true, "pty": true, ... },
  "agents": { "mode": "frontend", "default": "pi", "available": ["pi"] },
  "workspace_panes": [ ... ],
  "workspace_routes": [ ... ],
  "tools": [ ... ]
}
```

All three extension types (panes, routes, tools) are discoverable from one endpoint. The PI
service, frontend, and external tooling can introspect what the child app provides without
reading TOML or scanning directories.

---

## 5. Migration Path

### Phase 1: Config schema + doctor validation (no runtime changes)
- Add TOML parsing for `[tools.*]`, `[frontend.panels.*]`, `[backend.routes.*]`
- `bui doctor` validates declarations against filesystem
- No runtime behavior changes — existing manual wiring continues to work

### Phase 2: Capabilities advertisement
- Capabilities endpoint returns declared tools, enriched pane metadata, route metadata
- Frontend reads pane metadata from capabilities (placement, constraints, requirements)
- PI service reads tool catalog from capabilities

### Phase 3: Auto-generated executors
- Route-proxy tools: framework generates fetch wrappers (frontend) and httpx calls (backend)
- UI-action tools: framework generates event dispatch wrappers
- Backend tools: framework generates `/api/v1/tools/{name}/execute` route
- `addPiAgentTools()` still works for tools that need hand-written JS

### Phase 4: Scaffolding
- `bui init --with-tool <name> --tool-kind <kind>`, `--with-panel <name>`
- `bui add tool <name> --kind <kind>`, `bui add panel <name>` for existing projects

---

## 6. Full boring-macro Migration Example

What boring-macro's `boring.app.toml` would look like after adopting this spec:

```toml
[app]
name = "Boring Macro"
id = "boring-macro"
logo = "M"

[framework]
repo = "github.com/hachej/boring-ui"
commit = "a2a1920"

[backend]
type = "python"
entry = "backend.runtime:app"
port = 8000
pythonpath = "src/web"
routers = [
    "backend.modules.data.router:router",
]
dependencies = ["clickhouse-connect>=0.8.0"]

[backend.routes.data]
module = "backend.modules.data.router:router"
prefix = "/api/v1/macro"
description = "ClickHouse data catalog, series, SQL, and transform operations"
tags = ["data"]
requires_auth = false

# ── Tools ─────────────────────────────────────────────────────

[tools.execute_sql]
kind = "route"
description = "Run a read-only SQL query against the ClickHouse warehouse"
route = "/api/v1/macro/sql"
method = "POST"
parameters.query = { type = "string", required = true, description = "SQL query (must use FINAL keyword)" }

[tools.macro_search]
kind = "route"
description = "Search the FRED series catalog by keyword"
route = "/api/v1/macro/catalog/search"
method = "GET"
parameters.q = { type = "string", required = true }
parameters.page_size = { type = "integer", required = false, default = 20 }

[tools.get_series_data]
kind = "route"
description = "Fetch time-series observations for a series"
route = "/api/v1/macro/series/{series_id}/data"
method = "GET"
parameters.series_id = { type = "string", required = true }
parameters.start = { type = "string", required = false, description = "ISO start date" }
parameters.end = { type = "string", required = false, description = "ISO end date" }

[tools.persist_derived_series]
kind = "route"
description = "Save a derived series with lineage tracking"
route = "/api/v1/macro/transform/persist"
method = "POST"
schema_file = "schemas/persist_series.json"      # complex nested params → JSON Schema

[tools.open_series]
kind = "ui"
description = "Open a chart panel for the given series"
event = "BM_OPEN_SERIES"
parameters.series_id = { type = "string", required = true }

[tools.open_deck]
kind = "ui"
description = "Open a markdown deck in the deck viewer"
event = "BM_OPEN_DECK"
parameters.path = { type = "string", required = true, description = "Deck path relative to workspace" }

[tools._config]
system_prompt_file = "prompts/agent.md"

# ── Panels ────────────────────────────────────────────────────

[frontend]
root = "src/web"
port = 5173

[frontend.branding]
name = "Boring Macro"

[frontend.features]
agentRailMode = "companion"

[frontend.panels.data-catalog]
title = "Data Catalog"
component = "kurt/panels/data-catalog/Panel.jsx"
placement = "left"
icon = "database"
essential = true
constraints = { min_width = 240, collapsed_width = 48 }

[frontend.panels.chart-canvas]
title = "Chart"
component = "kurt/panels/chart-canvas/Panel.jsx"
placement = "center"
icon = "line-chart"

[frontend.panels.deck]
title = "Deck"
component = "kurt/panels/deck/Panel.jsx"
placement = "center"
icon = "presentation"

[frontend.panels.filetree]
title = "Files"
component = "kurt/panels/filetree/Panel.jsx"
placement = "left"
requires.features = ["files"]

[frontend.panels.companion]
title = "Agent"
component = "kurt/panels/companion/Panel.jsx"
placement = "right"
constraints = { min_width = 400 }

# ── Auth & Deploy (unchanged) ────────────────────────────────

[auth]
provider = "neon"
session_cookie = "boring_session"
session_ttl = 86400

[deploy]
platform = "modal"
env = "prod"

[deploy.secrets]
CLICKHOUSE_HOST = { vault = "secret/agent/clickhouse", field = "host" }
# ... etc
```

### What This Eliminates

| Before (manual) | After (declarative) |
|---|---|
| `macroTools.js` — 200 lines of hand-written tool definitions | `[tools.*]` with `kind` — 40 lines of TOML |
| `registry.js` — imperative `registerPane()` calls with hardcoded metadata | `[frontend.panels.*]` — declarative with full metadata |
| `addPiAgentTools(createMacroTools(config))` in `main.jsx` | Automatic — framework reads TOML, generates tools |
| System prompt embedded in JS string literal | `prompts/agent.md` file referenced by TOML |
| No validation — silent runtime failures | `bui doctor` catches errors before `bui dev` |

### What boring-macro Still Needs Hand-Written Code For

- `Panel.jsx` components (the React UI itself — TOML declares metadata, not UI)
- `router.py` backend routes (the HTTP handlers — TOML declares tools, not route logic)
- `prompts/agent.md` (the system prompt content)
- `app.py` custom middleware, companion proxy, startup handlers
- `vite.config.js` custom plugins (ClickHouse query proxy)

This is the right boundary: **TOML declares what exists and how to wire it; code implements behavior.**

---

## 7. Open Questions

1. ~~**Tool parameter types beyond primitives.**~~ **RESOLVED** — `schema_file` support
   handles complex/nested schemas. Inline `parameters.*` remains for simple cases.

2. **Tool versioning.** Should tools have a version field for capability negotiation? Probably
   not in v1 — the `eval_spec_version` model handles this at the eval level.

3. **Tool permissions.** Beyond `requires_auth`, should tools declare fine-grained permissions
   (read-only, write, exec)? Useful for sandbox environments. Additive — can add later as
   a field on `[tools.*]` without restructuring.

4. **Frontend tool handlers.** Some tools need JS logic beyond fetch or event dispatch (e.g.,
   boring-macro's `execute_sql` which does ClickHouse HTTP protocol). This would be
   `kind = "frontend"` with `handler = "tools/macroTools.js:executeSql"`. The flat
   `[tools.*]` + `kind` structure supports this as an additive new kind value — no
   restructuring needed. Ship when there's demand.

5. **Tool testing.** Should `bui test` auto-generate tool contract tests from TOML schemas?
   Now feasible since `schema_file` gives us full JSON Schema to generate against.

6. **Hot-reload.** Panes already hot-reload via workspace plugin watcher. Should tools
   hot-reload too? (Backend tools would need handler reimport; route-proxy tools get it free.)

7. **Router consolidation.** Gemini review suggests eliminating `[backend].routers` list
   in favor of `[backend.routes.*]` as the single source. This is a DRY improvement but
   not required for extensibility — the list still works. Can consolidate in a future pass.
