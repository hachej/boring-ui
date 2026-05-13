# Harness tool UI capabilities plan

## Problem

Harnesses and plugins can contribute agent tools, but the frontend must not assume every runtime has the same tools or the same rich UI affordances. Pi-specific tools such as a subagent tool should be additive harness/plugin contributions, not core shared assumptions.

This plan splits tool activation and tool UI from the follow-up/history capability work. It follows the same runtime capability principle: active runtime/session metadata and catalogs drive what is available.

Related plan: [`harness-followup-capabilities.md`](./harness-followup-capabilities.md).

## Current tool flow

- `AgentTool` is the shared server-side tool contract.
- `registerAgentRoutes()` builds core tools from the runtime bundle:
  - harness/shell tools (`bash`, `execute_isolated_code` when available),
  - filesystem tools (`read`, `write`, `edit`, `find`, `grep`, `ls`),
  - upload tools.
- Hosts can add tools with `extraTools` / `getExtraTools`.
- Plugins can add tools through the pi plugin loader.
- `mergeTools()` combines standard, host, scoped, and plugin tools; later registrations can override by name.
- The active harness receives the final tool list. The pi harness currently adapts that list into pi `customTools`.
- The frontend catalog endpoint exposes active tool names/descriptions/schemas.
- `ChatPanel` renders tool parts generically, with optional custom renderers via `toolRenderers`.

## Harness-specific tools

A harness may activate additional harness-specific tools without making them core.

Examples:

```txt
pi runtime only:
  pi.subagent / subagent

deepagent runtime only:
  deepagent.handoff / memory / etc.
```

Guidelines:

1. Core tools should be the portable workspace/tooling baseline.
2. Harness-specific tools should be contributed by the harness/runtime binding, not assumed by the shared frontend.
3. Tool names should be stable and collision-aware. Prefer namespacing for harness-only semantics if the tool is not portable (`pi.subagent`, `deepagent.handoff`) unless compatibility with an existing tool name is intentional.
4. Prompt snippets/system prompt entries must be derived from the active tool list only.
5. The catalog must reflect the current runtime/session tool list; the UI must not assume every harness has every tool.

## Plugin-owned tool UI

- Today, plugins can bring server-side agent tools.
- Today, the host/app shell can provide matching frontend renderers through `ChatPanel.toolRenderers`.
- There is not yet a formal automatic plugin contract for bundling `server tool + frontend tool renderer` as one unit.

Future plugin shape could be explicit app-shell composition, for example:

```ts
// server side
export const tools = [myTool]

// frontend side, bundled by the host app
export const toolRenderers = {
  my_tool: MyToolRenderer,
}
```

Do not dynamically load arbitrary plugin frontend code from the server at runtime. Frontend renderers should be explicit imports/registrations in the host/app shell so bundling, trust, and versioning remain clear.

## Pi subagent overlay example

A pi subagent tool should reuse the original pi subagent package/tool for execution. Boring should not fork or reimplement subagent orchestration just to get UI.

Preferred shape:

```txt
original pi subagent package
  = execution behavior, prompts, tool semantics

boring pi-subagent overlay plugin
  = wraps/adapts the original tool
  = adds Boring-specific structured UI details/events
  = exports/registers a frontend tool renderer through app-shell composition
```

Server overlay responsibilities:

- import or construct the original pi subagent tool;
- expose it as an `AgentTool` under a stable tool name, e.g. `pi.subagent` or the upstream-compatible `subagent` if intentional;
- preserve upstream behavior and prompt semantics;
- enrich tool output with structured UI metadata when available.

Example result shape:

```ts
return {
  content: [{ type: 'text', text: finalSummary }],
  details: {
    uiKind: 'pi-subagent',
    task,
    agent,
    status: 'done',
    transcript,
    steps,
  },
}
```

Frontend overlay responsibilities:

```ts
export const toolRenderers = {
  'pi.subagent': PiSubagentToolRenderer,
  subagent: PiSubagentToolRenderer, // optional upstream-compatible alias
}
```

The renderer should consume structured `input`, `output`, and UI details/events from the tool part. If the upstream tool only returns plain text, the renderer can fall back to a basic summary UI. Rich display requires the overlay to surface structured details or streaming updates.

## Tool UI metadata path

Open implementation note: today tool parts reliably expose `input`/`output`; verify whether `ToolResult.details` is preserved into frontend tool parts. If not, add an explicit, typed tool UI metadata path before relying on rich renderers.

Do not encode rich UI state only as untyped human text.

Possible future shape:

```ts
interface ToolUiMetadata {
  rendererId?: string
  displayGroup?: string
  icon?: string
  details?: unknown
}
```

This can be surfaced either through tool result details if the stream adapter preserves them, or through a dedicated typed data part keyed by `toolCallId`.

## Open questions

1. Should tool capability metadata include renderer hints (`rendererId`, display group, icon), or should renderers remain keyed only by tool name for now?
2. Should plugin-owned renderer registration live in `@boring/agent/front`, the app shell, or a future plugin manifest format?
3. Should pi subagent use the upstream-compatible `subagent` name, the namespaced `pi.subagent` name, or expose both?

## Recommendation

Keep harness/plugin-specific tools and renderers additive and capability/catalog-driven. Do not hardcode harness-only tools into shared chat assumptions. For pi subagent, reuse the original subagent package for execution and add only a Boring overlay for structured UI metadata plus a frontend renderer.
