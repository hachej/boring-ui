# TODO-S2 — Spreadsheet embed contract + reference (pi-excel and any host)

Handoff: self-contained work order for one autonomous coding agent (pi or gpt-5.5-xhigh). Cite plan files by relative path. No prior conversation assumed.

## Context (read first)

- Plan: `docs/issues/391/runtime-refactor/06-migration-phases.md` § "Phase S2" (deliverables + exit criteria; "after S1 learnings"; keep lighter — contract + example, not a product).
- Plan: `docs/issues/391/runtime-refactor/08-pluggable-agent-surfaces.md` § "The headless façade: `createAgent()`", the reference-adapters table (Spreadsheet/pi-excel row: "Agent tools are spreadsheet tools supplied by the host as `tools`; boring-bash not installed"), § "Two handles", § "Human-in-the-loop".
- Dependencies: **S1** (surface-adapter conformance suite + two-handles pattern, from `TODO-S1-slack-channel.md`) and **P1** (`createAgent()` façade). As with S1, `createAgent()` does not exist in the repo yet — `packages/agent/src/server/` exports `createAgentApp`/`registerAgentRoutes` only (`createAgentApp.ts`, `registerAgentRoutes.ts`, barrel `index.ts`). The embed consumes the **published client contract** of `@hachej/boring-agent`, not server internals.
- The public runtime API the embed relies on (`08` § façade): `agent.send(input, ctx)`, `agent.resolveInput(sessionId, requestId, response)`, `agent.replay(sessionId, { startIndex })`, `agent.sessions`. Tools are supplied as `tools` (extra `AgentTool[]`); `runtime: 'none'`; optional readonly bindings.
- Repo app layout (verified): `apps/` contains `agent-playground`, `full-app`, `workspace-playground` (package names identical to dir names, unscoped). There is **no `examples/` dir**; `pnpm-workspace.yaml` globs `apps/*`, `packages/*`, `plugins/*`. Recommendation: put the reference embed under **`apps/spreadsheet-embed-playground`** (matches the existing `*-playground` convention and the `apps/*` glob — no workspace-config change needed). Do not create a new top-level `examples/` tree.
- `AgentTool` shape & approvals: `AgentTool` gains `needsApproval?: boolean | (params, ctx) => boolean | Promise<boolean>` (`08` HITL). The host declares approval policy on its own tools; the embed renders the approval request in a host dialog and answers via `resolveInput`.

## Goal / exit criteria

Match `06-migration-phases.md` Phase S2 exit criteria:
1. The embed has **no `boring-bash` dependency**.
2. Tool outputs project into the sheet (domain tools are the host's spreadsheet read/write-range tools).
3. The surface-adapter conformance suite (from S1) passes for the embed.

## Non-negotiables

- Embed depends only on the **published `@hachej/boring-agent` client contract** — no server internals, no `boring-bash`, no provider packages.
- Domain tools (`read_range`, `write_range`, etc.) are supplied by the host as `tools`; the agent has `runtime: 'none'` and no filesystem unless the host injects a readonly binding.
- Approvals go through the same on-stream path as every other surface (`resolveInput`), rendered as a host/task-pane dialog — no embed-specific approval channel.
- Two-handles rule: the embed owns its addressing (`workbookId + sheetId` → `sessionId` map); agent APIs receive `sessionId` only.
- S2 is lighter than S1: a **contract doc + one reference embed**, reusing S1's shared surface pieces (`@hachej/boring-channel-core` wrapper is not needed for an in-process/task-pane embed; reuse the S1 conformance suite only).

## Do NOT

- Do NOT add `@hachej/boring-bash` (or any provider) to the embed's dependencies.
- Do NOT build a real Office/Excel add-in or ship a product; a minimal spreadsheet-ish reference (in-memory grid + task-pane-style approval) is the deliverable.
- Do NOT fork the surface-adapter conformance suite; import S1's `surfaceAdapterConformance` from `@hachej/boring-channel-core` (or wherever S1 placed it) and provide a spreadsheet subject.
- Do NOT invent server APIs; if a needed façade method is missing, block on P1 rather than reaching into the harness.
- Do NOT touch `/home/ubuntu/projects/boring-ui-v2`. Do NOT commit.

## Beads

### BBS2-001 — Embedding client contract doc (S)
- Description: The publishable "agent as a library inside another product" contract.
- Files: create `packages/agent/docs/embedding.md` (co-located with the agent package's docs so it ships as the stable public API reference, per `08` Phase 8 note).
- Notes: Document exactly what a host imports and supplies:
  - construct `createAgent({ runtime: 'none', tools: hostDomainTools, sessions, systemPrompt, ... })`;
  - the four-part surface contract (message-in, event-stream-out, approvals, session state) restated for an in-process embed;
  - how the host supplies domain tools as `tools: AgentTool[]` and marks side-effecting ones `needsApproval`;
  - optional readonly bindings (readonly `company_context` only — reference how a host injects a binding without importing boring-bash: the binding operations arrive as an injected object, not a package import);
  - approval rendering: subscribe to approval events, show a host dialog, call `resolveInput`;
  - the two-handles rule for spreadsheet addressing (`workbookId+sheetId → sessionId`).
- Tests: none (doc); ensure doc-link CI passes; every symbol named must exist in the published contract post-P1 (add a TODO note if P1 not yet merged).
- Acceptance: a host engineer can wire an embed from this doc alone; zero boring-bash references.

### BBS2-002 — Reference embed under `apps/spreadsheet-embed-playground` (M)
- Description: Minimal spreadsheet-ish embed demonstrating domain tools + task-pane approval.
- Files: create `apps/spreadsheet-embed-playground/` (`package.json` name `spreadsheet-embed-playground`, unscoped, matching sibling apps; `tsconfig.json`; `src/`). Depend only on `@hachej/boring-agent` (client contract).
- Notes: Provide an in-memory grid model (`Cell[][]`) and two domain `AgentTool`s: `read_range({ a1 })` and `write_range({ a1, values })` — `write_range` is `needsApproval: true`. Wire `createAgent({ runtime: 'none', tools: [readRange, writeRange] })`. Render a tiny task-pane-style UI (or headless driver script if a UI framework is overkill) that: sends a user turn, streams events, projects `write_range` tool outputs into the grid, and on an approval event shows a task-pane dialog resolving via `resolveInput`. Keep it minimal — the point is the contract, not fidelity.
- Tests: `apps/spreadsheet-embed-playground/src/__tests__/embed.test.ts` — a turn that calls `write_range` parks on approval; approving projects the values into the grid; denying leaves the grid unchanged; `read_range` returns current cells.
- Acceptance: tool outputs land in the sheet model; approval dialog round-trips; no boring-bash import.

### BBS2-003 — Surface-adapter conformance for the embed (S)
- Description: Run S1's conformance suite with a spreadsheet subject.
- Files: `apps/spreadsheet-embed-playground/src/__tests__/embedConformance.test.ts`.
- Notes: Import `surfaceAdapterConformance` from `@hachej/boring-channel-core` (S1 BBS1-006). Provide a subject whose `deliverInbound` sends a user turn, `collectOutbound` drains the event stream, `answerApproval` calls `resolveInput`, `addressingKeyOf` returns the `workbookId+sheetId` key. Assert message-in→events-out, approval round-trip, and addressing isolation (a second workbook cannot resolve the first's session).
- Tests: the file.
- Acceptance: `passed: true`; isolation holds across two workbooks.

### BBS2-004 — No-boring-bash dependency guard (S)
- Description: Lock exit criterion 1 mechanically.
- Files: extend `scripts/audit-imports.ts` (or add a package-local check) to fail if `apps/spreadsheet-embed-playground` imports `@hachej/boring-bash`, any `@hachej/boring-bash/*` subpath, or a provider-internal module.
- Notes: Reuse the existing import-audit machinery rather than a bespoke script. Assert the embed's `package.json` deps exclude boring-bash.
- Tests: covered by `pnpm audit:imports`; add a focused case if the audit supports per-package rules.
- Acceptance: adding a boring-bash import to the embed fails the audit.

## Verification — exact commands verified against package.json scripts

```bash
pnpm install
pnpm --filter spreadsheet-embed-playground run typecheck
pnpm --filter spreadsheet-embed-playground run test
pnpm audit:imports        # must fail on any boring-bash import from the embed
pnpm run build:packages
pnpm run test
```
(New app `package.json` scripts mirror sibling apps + boring-bash: `typecheck: tsc --noEmit`, `test: vitest run --passWithNoTests`; add `build` only if the embed has a bundled UI.)

## Review gates

- Embed `package.json` deps: `@hachej/boring-agent` only (+ dev/test tooling); no `@hachej/boring-bash`, no provider packages.
- Domain tools supplied via `tools`; `runtime: 'none'`; side-effecting tool marked `needsApproval`.
- Approvals use `resolveInput` on the shared stream — no embed-local approval channel.
- Conformance suite is imported from S1, not re-implemented.
- Embedding doc lives in `packages/agent/docs/` and names only published-contract symbols.
