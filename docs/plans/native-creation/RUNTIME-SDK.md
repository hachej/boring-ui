# The agent runtime SDK and the package split (2026-09-09)

> Owner direction, 2026-09-09: `packages/agent` should be **the runtime** — an
> agent SDK, in the shape of the OpenAI Agents SDK but with our extras (multi
> filesystem, sandbox modes, prompts/skills as packages, Views as tool output)
> — with chat UI and the View contract in their own packages. **The key
> reason: an agent must be able to spawn agents with this SDK inside the same
> workspace.** That is what makes a product a team instead of a chatbot.
> Nothing here is ratified; §"Proposed ruling" carries the text for the owner.

The later [OpenComputer interface review](OPENCOMPUTER-INTERFACE-REFERENCE.md)
provides a concrete reference for keeping this SDK small: immutable agent
behavior revisions, pinned durable Sessions, ordered events, scoped browser
steering, admitted sources, limits and credential-free repository effects. It
is inspiration for the interface and conformance behavior, not a choice of
hosted provider or a reason to replace the existing gateway, records,
filesystems, sandbox providers or metering mechanisms.

## Why the runtime is the product

An installed product is not one bot. The tutor needs a grader; the builder
needs a reviewer; a room has several named agents. Today spawning happens
only above the runtime: the Factory's host plugin creates child sessions
through the gateway, and the MCP delegate server exposes an agent to another
process. Both re-implement composition the runtime already owns. If the SDK
exposes spawn as a first-class primitive — under the same authority funnel —
then any product can staff its own jobs and every consumer stops rebuilding
the same delegation glue.

## Today (facts, 2026-09-09)

`packages/agent` is ~114k lines in one package:

| Area | LOC | Note |
|---|---|---|
| Runtime | ~41k | harness wrapper over pi, sessions, definitions/digests, tools, filesystems, sandbox modes, credentials, metering, MCP, events |
| Host composition | ~18k | agent host, gateway, request ledger, fleet compiler, HTTP routes, standalone app |
| Chat UI (React) | ~33k | PiChatPanel, primitives, composer, session hooks, tool + reasoning renderers |
| Shared types | ~9k | harness, tool, workspace, sandbox, gateway, chat DTOs, credentials |
| Eval | ~2k | suite runner, matchers |

Consumption: of 277 cross-package import sites, **142 are `/shared`, 90 are
`/server`, 33 are `/front`**. Every runtime consumer — including the DB-free
sandbox and bash packages and core's server — pulls agent's UI dependency set
(Radix, streamdown, react-query, motion, cmdk, shiki) through one package.json.
The pi seam is real only where the invariant checks it: the 9k-line
`server/harness/pi-coding-agent/` wrapper is imported from the host, models,
HTTP routes and the public `server` index, and one front file imports
`@earendil-works/pi-tui` directly. No View contract exists in code at all —
`ViewDescriptor` appears only in plans; workspace has ~943 lines of panel and
surface registry, and `plugins/generated-pane` is a rendering vocabulary.

## Target packages

| Package | Owns | Depends on | React |
|---|---|---|---|
| `@hachej/boring-agent` (**runtime SDK**) | Agent (definition, compile, digest, skills, knowledge, prompt assembly) · Runner (host, gateway, request ledger, events) · Tools (catalog, merge, `AgentTool`) · Filesystems (multi-binding, readonly policy) · Sandbox modes · Sessions + harness backend seam · **Spawn/Delegation** · Credential broker · Approvals contract · Metering · MCP · Eval | sandbox, bash (type-only today) | **no** |
| `@hachej/boring-chat` (new) | The chat surface: transcript, composer, session list, tool/reasoning renderers, slash commands, upload; transcript-purity rules (posts, ephemeral progress, cards; traces behind a drawer) | agent `/shared` + gateway client, ui-kit, views | yes |
| `@hachej/boring-views` (new) | `ViewDescriptor` · `ViewResolver` · `ViewHost` · `ViewContext` · `ViewRef` as a set, built-in renderers (record, table, chart, dashboard) on the ui-kit, store interface | ui-kit | yes |
| `@hachej/boring-workspace` | Workbench, plugins, bridge; hosts Views in Dockview | views, ui-kit; agent only at the app seam | yes |
| core · ui · sandbox · bash · cli | unchanged in role | | |

This is the ratified layering, not a new one: L1 agent, L4 views, L6 surfaces
with "chat is one shell option", and the port handbook's own sketch of
`kernel · agent · runtime · workspace · data · views · ui`.

## The SDK surface

Shaped like the OpenAI Agents SDK, with our extras marked:

| Their primitive | Ours | Extra |
|---|---|---|
| Agent | `AgentDefinition` + `compileAgentDirectory` (instructions, skills, `knowledge/`, model policy) → content digest | **packaged and digest-pinned**, installable |
| Runner | `createAgentHost` → `AgentGateway` (seven session methods) | **request-keyed admission ledger**, durable events |
| Function / hosted tools | `AgentTool`, `ToolCatalog`, `mergeTools` | collision policy; **capability effect classes** (nc-x) |
| Computer tool | sandbox modes + browser broker | **product runtime modes** (embedded/local/remote) |
| Handoffs | **Spawn / Delegation** (below) | seat-bound, budgeted, workspace-scoped |
| Guardrails | capabilities ∩ installation ∩ job ∩ policy + approvals | **grant types**, Inbox out-of-band |
| Sessions | Session ↔ Thread binding | **Thread = durable job root** |
| Tracing | events + Activity projection | **audit-grade seat attribution** |
| MCP | delegate server + client | |
| — | **multi filesystem bindings** | not in theirs |
| — | **View references as tool output** | not in theirs |

## Spawn: the primitive that makes it powerful

Proposed contract, in the SDK, above the gateway and under the same funnel:

```ts
spawn({
  agent: AgentRef | { agentTypeId },   // must hold a Seat in this workspace
  task: string | Brief,                 // typed brief preferred
  thread?: ThreadId,                    // default: the caller's job
  resources?: ResourceRef[],            // subset of the caller's working set
  budget: { tokens?, cost?, wallClock? },
  grants?: string[],                    // ⊆ caller's effective grants
  mode?: "child" | "peer"               // child reports back; peer posts in the job
}): Promise<RunHandle>                  // status, result, abort; provenance attached
```

Rules that come from existing rulings, not new ones: the child runs under
actor ∩ installation ∩ job ∩ policy; grants and resources can only narrow,
never widen; the child holds its own Seat and its posts are attributed to it
(multi-author transcript); a `peer` spawn is a participant in the same Thread,
which is why this is not A2A loopback — delivery stays host-mediated; budgets
are enforced by metering; every spawn is an admitted Run with a request key,
so a crash replays to the settled outcome. The Factory's `dispatch_worker`
and the MCP delegate become two consumers of this one primitive.

## Delta

| # | Change | Shape |
|---|---|---|
| 1 | **Permission**: record that chat/views extraction is pulled by the Seneca product slice | proposed ruling below |
| 2 | **Chat out**: move `agent/src/front` → `packages/chat`, deprecated re-exports for one release, move UI deps, replace the `pi-tui` import | `wt-391-forward-nc-sdk-chat-6773` |
| 3 | **Views in**: the first View slice lands in `packages/views`, not inside workspace; workspace gains a Dockview host adapter; chat renders cards through it | rescope of bead `nc-v` |
| 4 | **Runtime hardening**: pi wrapper becomes internal behind `AgentHarnessBackend`; HTTP routes + standalone app move to a `host` subpath; invariant extended; UI deps dropped | `wt-391-forward-nc-sdk-runtime-33l8` |
| 5 | **Spawn**: `spawn()` in the SDK; Factory delegate and MCP delegate retargeted onto it | `wt-391-forward-nc-sdk-spawn-fm8h` |

Ordering: 1 → 2 and 4 in parallel → 5 → 3 with the journey. None of this
blocks the epic's ready beads; chat extraction must not land while a UI-surface
bead is in flight (one UI worker at a time).

## Proposed ruling (owner to ratify)

> **Addendum (2026-09-09) to RECONCILIATION §6 Q2 and VISION §8.** The
> non-goal "big package reorg in the old repo" does not exclude three
> extractions pulled by the Seneca product slice: the chat surface and the
> View contract leave `@hachej/boring-agent`, which becomes the runtime SDK
> with no React dependency. The ratified L1/L4/L6 layering is unchanged; this
> is the physical move that layering already implies, taken under the
> "concrete product slice" trigger, not a speculative reorg. Additionally:
> **spawning an agent is a runtime capability**. The SDK exposes one
> `spawn()` primitive under the D29 funnel — Seat-bound, budgeted,
> narrowing-only in grants and resources, admitted as a request-keyed Run,
> attributed to the child's Seat. Host-mediated delivery is retained; no
> agent-to-agent loopback and no shared runtime room is introduced.
