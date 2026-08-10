---
github: https://github.com/hachej/boring-ui/issues/1177
issue: 1177
state: needs-owner-approval
updated: 2026-08-09
flag: not-needed
track: owner
---

# gh-1177 — visual project documentation

This is the owner-gate plan. It records how to add a visual orientation layer;
the package docs and accepted decisions remain normative. Slice 1 may proceed
before this gate because the owner explicitly classified it as low-risk.

## Problem

The repository explains its architecture in accurate but mostly prose-led
package and contract docs. A reader cannot yet scan the package boundaries,
runtime seams, or common request flows at a glance, and older plans can be
mistaken for current code.

## Today / Delta

**Today (`origin/main` at `27d54226a`, verified 2026-08-09):**

- `docs/README.md` is the global index and already links the normative package
  docs, decisions, direction, apps, and plugins.
- `pnpm-workspace.yaml` declares packages, plugins, apps, and tools. Internal
  package dependencies are declared by the package manifests and confirmed by
  live imports.
- Decisions 28 and 29 define the deployment-static fleet, Workspace-owned
  orchestration, the AgentGateway construction funnel, and the
  Agent → boring-bash → boring-sandbox runtime layering. Decision 30 is a
  presentation boundary, not a runtime authority edge.
- The invariants in `docs/procedures/coding-invariants.md` lock the paired
  runtime adapter, `UiBridge.postCommand`, import boundaries, stable errors,
  and Pi factory + Operations adapter seams.
- No `docs/visual/` index exists.

**Delta:** add a `docs/visual/` layer linked from `docs/README.md`: one small
GitHub-native Mermaid diagram per concept, a caption of at most three
sentences, and an explicit list of the current source files each diagram
depicts.

## Solution

Create `docs/visual/README.md` as the visual-docs hub. Each concept gets its
own Markdown page so links remain stable and reviewers can compare one diagram
with one set of source files. Existing docs stay in place and remain the source
of detailed contracts.

### Diagram inventory

| Slice | Page / concept | What the diagram must show | Files it depicts |
| --- | --- | --- | --- |
| S1 | `package-map.md` — package map | Apps and plugins over core, workspace, agent, CLI, UI kit, Pi knowledge, plugin CLI, boring-bash, and boring-sandbox; distinguish runtime imports from Markdown-only knowledge | `pnpm-workspace.yaml`; root `package.json`; `packages/{core,agent,workspace,cli,ui,pi,plugin-cli,boring-bash,boring-sandbox}/package.json`; `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts`; `packages/cli/src/server/modeApps.ts`; `packages/cli/src/front/App.tsx`; `apps/full-app/src/server/main.ts`; `plugins/ask-user/src/server/index.ts` |
| S1 | `runtime-stack.md` — three-stack runtime layering | Agent owns harness/session/tool composition; boring-bash owns coherent environment operations and Pi tool adapters; boring-sandbox owns provider isolation; Workspace/Sandbox are created as one runtime pair | `docs/DECISIONS.md` (D28/D29); `packages/agent/src/server/runtime/mode.ts`; `packages/agent/src/server/runtime/modes/providerAdapter.ts`; `packages/boring-bash/src/agent/tools/operations/`; `packages/boring-sandbox/src/shared/providerV1.ts` |
| S2 | `agent-gateway.md` — AgentGateway session flow | Authorized scope → seven addressed session operations → embedded gateway/composition → Pi session service, with `createAgentHost()` as the only construction funnel | `packages/agent/docs/AGENT_GATEWAY_V0.md`; `packages/agent/src/shared/gateway/types.ts`; `packages/agent/src/server/agent-host/createAgentHost.ts`; `packages/agent/src/server/agent-host/embeddedGateway.ts`; `packages/agent/src/server/agent-host/httpProjection.ts` |
| S2 | `ui-bridge.md` — UiBridge dispatch | All producers converge on `UiBridge.postCommand`; bridge transport reaches the front command bus/dispatcher; chat `data-ui-command` parts are display-only | `packages/workspace/src/shared/ui-bridge.ts`; `packages/workspace/src/server/bridge/createInMemoryBridge.ts`; `packages/workspace/src/front/bridge/uiCommandStream.ts`; `packages/workspace/src/front/bridge/uiCommandBus.ts`; `packages/workspace/src/front/bridge/uiCommandDispatcher.ts` |
| S2 | `chat-turn.md` — chat-turn sequence | Browser prompt → addressed HTTP projection → AgentGateway → Pi chat service/harness → durable/live events → browser reducer | `packages/agent/src/server/agent-host/httpProjection.ts`; `packages/agent/src/server/agent-host/embeddedGateway.ts`; `packages/agent/src/core/piChatSessionService.ts`; `packages/agent/src/server/pi-chat/harnessPiChatService.ts`; `packages/agent/src/front/chat/pi/piChatStream.ts` |
| S2 | `agent-initiated-pane.md` — agent-initiated pane | Agent tool emits a typed UI command through the server bridge and front dispatcher to Dockview; no second dispatch path | `packages/workspace/src/server/ui-control/tools/uiTools.ts`; `packages/workspace/src/shared/ui-bridge.ts`; `packages/workspace/src/front/bridge/uiCommandDispatcher.ts`; `packages/workspace/src/front/provider/WorkspaceProvider.tsx` |
| S3 | `plugin-contracts.md` — server/front plugin contracts | Manifest discovery and bootstrap split into trusted server contributions and browser front factories; shared manifest is data-only | `packages/workspace/docs/PLUGIN_SYSTEM.md`; `packages/workspace/src/shared/plugins/manifest.ts`; `packages/workspace/src/shared/plugins/frontFactory.ts`; `packages/workspace/src/server/plugins/defineServerPlugin.ts`; `packages/workspace/src/server/plugins/bootstrapServer.ts`; `packages/workspace/src/plugin.ts` |
| S3 | `plugin-panel-open.md` — plugin-panel-open sequence | Front plugin registers a panel/surface/command, an open request resolves it, and Dockview creates or focuses the panel | `packages/workspace/src/shared/plugins/bootstrap.ts`; `packages/workspace/src/shared/plugins/SurfaceResolverRegistry.ts`; `packages/workspace/src/front/bridge/uiCommandDispatcher.ts`; `packages/workspace/src/front/provider/WorkspaceProvider.tsx` |
| S3 | `pi-tools-operations.md` — Pi factories + Operations adapters | Pi tool factories receive bound boring-bash Operations adapters instead of rebuilding shell/file tools or receiving raw paths | `docs/procedures/coding-invariants.md`; `packages/agent/src/server/harness/pi-coding-agent/createHarness.ts`; `packages/boring-bash/src/agent/tools/harness/`; `packages/boring-bash/src/agent/tools/operations/`; `packages/agent/src/server/runtime/mode.ts` |
| S3 | `tool-call.md` — tool-call sequence | Model tool request → Pi tool factory product → bound filesystem or sandbox Operations adapter → runtime pair → tool result back to the harness | `packages/agent/src/server/agent-host/buildAgentComposition.ts`; `packages/agent/src/server/harness/pi-coding-agent/createHarness.ts`; `packages/boring-bash/src/agent/tools/harness/index.ts`; `packages/boring-bash/src/agent/tools/filesystem/index.ts`; `packages/boring-bash/src/agent/tools/operations/bound.ts`; `packages/agent/src/server/runtime/mode.ts` |
| S4 | `credentials.md` — credential resolution chain | Authorized workspace scope → authority verification → binding/registry → host resolver → short-lived lease/use → vault backend or approved delivery; plaintext never enters general UI or logs | `packages/agent/src/shared/credentials/authority.ts`; `packages/agent/src/shared/credentials/lease.ts`; `packages/agent/src/shared/credentials/registry.ts`; `packages/agent/src/server/credentials/hostResolver.ts`; `packages/agent/src/server/credentials/withResolvedCredential.ts`; `packages/agent/src/server/credentials/vault/` |
| S4 | `durable-streams.md` — durable stream path | Pi event publish appends to SQLite before live fan-out; reconnect reads by composite stream path/offset; flag-off fallback remains bounded replay | `packages/agent/src/server/events/eventStreamStore.ts`; `packages/agent/src/server/agent-host/buildAgentComposition.ts`; `packages/agent/src/server/pi-chat/harnessPiChatService.ts`; `packages/agent/src/server/pi-chat/piChatReplayBuffer.ts`; `packages/agent/src/core/piChatSessionService.ts` |

File lists are part of every page, not only this plan. Slice authors must
re-check names and paths against their slice's fresh `origin/main`; the paths
above are the r1 inventory, not a license to copy stale structure.

## Visual conventions

1. Use fenced `mermaid` rendered natively by GitHub. SVG is allowed only when
   Mermaid cannot express the concept clearly, and its editable source must be
   committed beside it.
2. One diagram per page and one concept per diagram. Prefer 5–9 named nodes;
   group detail into subgraphs instead of reproducing entire modules.
3. Put a one- to three-sentence caption directly below the diagram. No prose
   wall, legend essay, or duplicated package documentation.
4. Use solid arrows for calls/data movement, dashed arrows for construction or
   dependency, and labeled boundaries for `front`, `server`, `shared`, and
   trusted-authority seams when relevant.
5. Use the code's current nouns and casing (`AgentGateway`, `UiBridge`,
   `Workspace`, `Sandbox`, `Operations`). Do not revive superseded AgentHost
   controller/publication semantics when labeling `createAgentHost()`.
6. End every page with `Depicted files`, listing repository-relative paths.
   A diagram is incomplete if a reviewer cannot follow those paths back to
   current code.

## Decisions

- `docs/visual/` is orientation, not a new normative contract. Each page links
  to the package doc or accepted decision that owns the detailed behavior.
- Mermaid is the default because GitHub renders and diffs the source natively.
- Pages are organized by concept, not package, because the useful visuals are
  the cross-package seams.
- S1 is intentionally dependency/static-composition only. It must not imply
  that every manifest dependency is a runtime value import; type-only, peer,
  tooling, and Markdown-only edges are labeled or omitted.
- No feature flag or schema/API change is needed. Rollback is removal of the
  new index link and visual pages in the owning slice.

## Test seams

- Highest public seam: GitHub-renderable Markdown plus exact source-path links.
- Automated proof: `git diff --check`; a local script extracts every path under
  `Depicted files` and verifies it exists; Mermaid fences are checked for one
  diagram per page and balanced delimiters.
- Review proof: compare diagram nodes/edges with package manifests and the
  cited imports/types at the reviewed SHA.
- Avoid testing: diagram styling pixels or restating implementation tests.

## Acceptance

1. `docs/README.md` links a `docs/visual/README.md` hub.
2. The hub indexes all 12 concepts and clearly says package/contract docs are
   normative.
3. Each page contains exactly one Mermaid diagram, a caption of no more than
   three sentences, and a `Depicted files` list whose paths exist at the
   reviewed SHA.
4. Diagrams agree with accepted D28/D29/D30 boundaries and the nine coding
   invariants; no historical plan is used as current proof.
5. Each slice is independently reviewable and does not edit unrelated verbose
   docs.

## Proof

- Exact commands per slice: `git diff --check`; repository-relative depicted-
  path existence check; focused Mermaid fence/diagram-count check.
- Manual review: open each changed page on the PR's GitHub Files tab and verify
  native rendering, labels, caption length, and source-path traceability.
- Waiver: no screenshot regression suite; these are GitHub Markdown diagrams,
  so the rendered PR diff is the authoritative visual proof.

## Slices

### S1: package map + runtime stack

**Delivers:** `docs/visual/README.md`, package map, three-stack runtime layering,
and the `docs/README.md` link.
**Blocked by:** None. Owner-directed to execute immediately despite the plan
gate.
**Proof:** acceptance 1; S1 pages satisfy acceptance 3–4.
**Review budget:** inside — three small documentation files plus one index link.

### S2: gateway + bridge flows

**Delivers:** AgentGateway session flow, UiBridge dispatch, chat-turn sequence,
and agent-initiated pane sequence.
**Blocked by:** Owner approval of this plan; S1 for the hub links.
**Proof:** S2 pages satisfy acceptance 3–4; gateway diagram is checked against
the seven-method conformance contract and only-construction-funnel invariant.
**Review budget:** inside.

### S3: plugin + Pi seams

**Delivers:** server/front plugin contracts, plugin-panel-open sequence, Pi
factories + Operations adapter seam, and the end-to-end tool-call flow.
**Blocked by:** Owner approval of this plan; S1 for the hub links.
**Proof:** S3 pages satisfy acceptance 3–4; plugin split checked against
`PLUGIN_SYSTEM.md` and current bootstrap code.
**Review budget:** inside.

### S4: credentials + streams

**Delivers:** credential resolution chain and durable stream path.
**Blocked by:** Owner approval of this plan; S1 for the hub links.
**Proof:** S4 pages satisfy acceptance 3–4; trust boundaries and flag-on/off
stream paths receive adversarial review.
**Review budget:** inside.

## Out of scope

- Rewriting or deleting existing docs.
- Changing runtime behavior, public APIs, decisions, flags, or package
  dependencies.
- UI screenshots, marketing art, generated architecture posters, or diagram
  build tooling.
- Future remote Agent/Environment topology, channels, or other unlanded plans.

## Open questions

None for S1. Owner approval of the inventory, page boundaries, and later-slice
ordering is the gate for S2–S4.
