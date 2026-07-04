# TODO-S2 — Spreadsheet embed contract + reference (pi-excel and any host)

Handoff: self-contained work order for one autonomous coding agent (pi or gpt-5.5-xhigh). Cite plan files by relative path. No prior conversation assumed.

## Context (read first)

- Plan: `docs/issues/391/runtime-refactor/INDEX.md` § "Phase S2" (deliverables + exit criteria; "after S1 learnings"; keep lighter — contract + example, not a product).
- Plan: `docs/issues/391/runtime-refactor/architecture/08-pluggable-agent-surfaces.md` § "The headless façade: `createAgent()`", the reference-adapters table (Spreadsheet/pi-excel row: "Agent tools are spreadsheet tools supplied by the host as `tools`; boring-bash not installed"), § "Two handles", § "Human-in-the-loop".
- Dependencies: **S1** (surface-adapter conformance suite + two-handles pattern, from [`../S1-slack-channel/TODO.md`](../S1-slack-channel/TODO.md)) and **P1** (`createAgent()` façade). As with S1, `createAgent()` does not exist in the repo yet — `packages/agent/src/server/` exports `createAgentApp`/`registerAgentRoutes` only (`createAgentApp.ts`, `registerAgentRoutes.ts`, barrel `index.ts`). The embed consumes the **published client contract** of `@hachej/boring-agent`, not server internals.
- The public runtime API the embed relies on (`08` § façade): `agent.start(input)` (or the `agent.send(input)` convenience = `start` + `stream`), `agent.resolveInput(sessionId, requestId, response)`, `agent.stream(sessionId, { startIndex })`, `agent.sessions` — all **single-argument** and `sessionId`-keyed (two-handles; never `send(input, ctx)` — any tenancy `ctx` rides inside `AgentSendInput`). Tools are supplied as `tools` (extra `AgentTool[]`); `runtime: 'none'` — the reference embed is host-supplied domain tools ONLY, with **no filesystem bindings**.
- **Descope (binding):** governed-context-in-embeds (injecting a readonly `company_context` binding into the embed) is **out of S2 scope** — it becomes a named **post-E2 follow-up filed at P8** (`TODO-P8` BBP8-004). The reference embed is `runtime: 'none'` + host-supplied domain tools only; it injects no readonly binding.
- Repo app layout (verified): `apps/` contains `agent-playground`, `full-app`, `workspace-playground` (package names identical to dir names, unscoped). There is **no `examples/` dir**; `pnpm-workspace.yaml` globs `apps/*`, `packages/*`, `plugins/*`. Recommendation: put the reference embed under **`apps/spreadsheet-embed-playground`** (matches the existing `*-playground` convention and the `apps/*` glob — no workspace-config change needed). Do not create a new top-level `examples/` tree.
- `AgentTool` shape & approvals: `AgentTool` gains `needsApproval?: boolean | (params, ctx) => boolean | Promise<boolean>` (`08` HITL). The host declares approval policy on its own tools; the embed renders the approval request in a host dialog and answers via `resolveInput`.

## Goal / exit criteria

Match `INDEX.md` Phase S2 exit criteria:
1. The embed has **no `boring-bash` dependency**.
2. Tool outputs project into the sheet (domain tools are the host's spreadsheet read/write-range tools).
3. The surface-adapter conformance suite (from S1) passes for the embed.

## Non-negotiables

- Embed depends only on the **published `@hachej/boring-agent` client contract** — no server internals, no `boring-bash`, no provider packages.
- Domain tools (`read_range`, `write_range`, etc.) are supplied by the host as `tools`; the agent has `runtime: 'none'` and **no filesystem** — the reference embed injects **no** readonly binding (governed-context-in-embeds is the deferred post-E2 follow-up, above).
- Approvals go through the same on-stream path as every other surface (`resolveInput`), rendered as a host/task-pane dialog — no embed-specific approval channel.
- Two-handles rule: the embed owns its addressing (`workbookId + sheetId` → `sessionId` map); agent APIs receive `sessionId` only.
- **Trust boundary — `createAgent()` runs host-side, never in the browser add-in.** The reference embed runs `createAgent()` in a **TRUSTED host/server (Node) process**; the task-pane / browser add-in UI consumes the **`ChatTransport` contract only** (message-in, event-stream-out, approvals, session state). **Model credentials and the agent loop NEVER run in the browser add-in process** — the add-in talks to the host over the transport, exactly as the workspace UI does. A minimal reference MAY co-locate both in one Node process for demonstration, but the contract boundary (UI ↔ `ChatTransport` ↔ host-side `createAgent`) must stay explicit and the loop + credentials stay host-side.
- S2 is lighter than S1: a **contract doc + one reference embed**, reusing S1's shared surface pieces (`@hachej/boring-channel-core` wrapper is not needed for an in-process/task-pane embed; reuse the S1 conformance suite only).

## Do NOT

- Do NOT add `@hachej/boring-bash` (or any provider) to the embed's dependencies.
- Do NOT build a real Office/Excel add-in or ship a product; a minimal spreadsheet-ish reference (in-memory grid + task-pane-style approval) is the deliverable.
- Do NOT fork the surface-adapter conformance suite; import `runSurfaceAdapterConformance` from the neutral home `@hachej/boring-agent/testing` (where S1 BBS1-006 authors it) — **not** from the Slack package — and provide a spreadsheet subject.
- Do NOT invent server APIs; if a needed façade method is missing, block on P1 rather than reaching into the harness.
- Do NOT touch `/home/ubuntu/projects/boring-ui-v2`. Work on a dedicated branch/worktree per the PR-PLAN branch naming; never commit to main directly; every bead lands as a PR per INDEX.

## Beads

### BBS2-001 — Embedding client contract doc (S)
- Description: The publishable "agent as a library inside another product" contract.
- Files: create `packages/agent/docs/embedding.md` (co-located with the agent package's docs so it ships as the stable public API reference, per `08` Phase 8 note).
- Notes: Document exactly what a host imports and supplies:
  - construct `createAgent({ runtime: 'none', tools: hostDomainTools, sessions, systemPrompt, ... })` **in the trusted host/server (Node) process — never in the browser add-in**; the task-pane UI consumes only the `ChatTransport` contract, and model credentials + the loop stay host-side;
  - the four-part surface contract (message-in, event-stream-out, approvals, session state) restated for an in-process embed;
  - how the host supplies domain tools as `tools: AgentTool[]` and marks side-effecting ones `needsApproval`;
  - approval rendering: subscribe to approval events, show a host dialog, call `resolveInput`;
  - the two-handles rule for spreadsheet addressing (`workbookId+sheetId → sessionId`).
- Tests: none (doc); ensure doc-link CI passes; every symbol named must exist in the published contract post-P1 (add a TODO note if P1 not yet merged).
- Acceptance: a host engineer can wire an embed from this doc alone; zero boring-bash references.

### BBS2-002 — Reference embed under `apps/spreadsheet-embed-playground` (M)
- Description: Minimal spreadsheet-ish embed demonstrating domain tools + task-pane approval.
- Files: create `apps/spreadsheet-embed-playground/` (`package.json` name `spreadsheet-embed-playground`, unscoped, matching sibling apps; `tsconfig.json`; `src/`). Depend only on `@hachej/boring-agent` (client contract).
- Notes: Provide an in-memory grid model (`Cell[][]`) and two domain `AgentTool`s: `read_range({ a1 })` and `write_range({ a1, values })` — `write_range` is `needsApproval: true`. Wire `createAgent({ runtime: 'none', tools: [readRange, writeRange] })` **in the trusted Node host process** (never instantiating the loop or model credentials in the browser add-in). Render a tiny task-pane-style UI (or headless driver script if a UI framework is overkill) that drives the host via the `ChatTransport` contract: sends a user turn, streams events, projects `write_range` tool outputs into the grid, and on an approval event shows a task-pane dialog resolving via `resolveInput`. Keep it minimal — the point is the contract (UI ↔ transport ↔ host-side `createAgent`), not fidelity.
- Tests: `apps/spreadsheet-embed-playground/src/__tests__/embed.test.ts` — a turn that calls `write_range` parks on approval; approving projects the values into the grid; denying leaves the grid unchanged; `read_range` returns current cells.
- Acceptance: tool outputs land in the sheet model; approval dialog round-trips; no boring-bash import.

### BBS2-003 — Surface-adapter conformance for the embed (S)
- Description: Run S1's conformance suite with a spreadsheet subject.
- Files: `apps/spreadsheet-embed-playground/src/__tests__/embedConformance.test.ts`.
- Notes: Import `runSurfaceAdapterConformance` from `@hachej/boring-agent/testing` (the neutral home S1 BBS1-006 authors — not the Slack package). Provide a subject whose `deliverInbound` sends a user turn, `collectOutbound` reads the event stream, `answerApproval` calls `resolveInput`, `addressingKeyOf` returns the `workbookId+sheetId` key. Assert message-in→events-out, approval round-trip, and addressing isolation (a second workbook cannot resolve the first's session).
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
- Trust boundary explicit: `createAgent()` + model credentials + the agent loop run **host-side (trusted Node)**, never in the browser add-in; the task-pane UI consumes the `ChatTransport` contract only.
