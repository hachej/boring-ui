# Issue 590 — implementation TODO

Canonical plan: [`plan.md`](./plan.md)

## Current state

- [x] Create issue #590.
- [x] Close superseded issue #197.
- [x] Complete thermo plan review loop to GREEN.
- [x] Reconcile PR #592 with the green Slice 1 plan.

## Slice 1 — required before PR #592 can merge

### Local store contract

- [x] Make `FileAutomationStore` single-workspace by construction.
- [x] Remove `AutomationStoreCtx` and per-call `workspaceId` parameters.
- [x] Remove `workspaceId` from local `Automation` and `AutomationRun` records.
- [x] Keep the thin plugin-local store interface only where it earns dependency injection/testability.
- [x] Replace shared cross-store conformance claims with concrete file-store behavior tests; design cross-store conformance only when a real second store exists.

### Run ownership

- [x] Remove public HTTP run-create route.
- [x] Remove public HTTP run-patch route.
- [x] Keep public run history read-only.
- [x] Reserve run creation/transitions for the future executor seam.
- [x] Keep only `promptSnapshot` and `modelSnapshot` on runs.
- [x] Remove `cronSnapshot` and `timezoneSnapshot`; retain `scheduledFor`.

### Storage-neutral model

- [x] Use explicit `null` for persisted nullable run fields.
- [x] Remove absent-key/null-clearing semantics that cannot map cleanly to SQL.
- [x] Keep store errors domain-only; map them to HTTP status in routes.

### Canonical editable Markdown

- [x] Keep `.pi/automation/prompts/<automation-id>.md` canonical in CLI mode.
- [x] Write prompt first and `store.json` last as the commit point.
- [x] Test orphan prompt recovery/cleanup eligibility.
- [x] Test missing prompt behavior: load empty body and repair by saving again.

### Remove speculative scaffolding

- [x] Remove empty `src/server/schedule.ts`.
- [x] Do not add scheduler/session-launch/Postgres files before their slice.

### Slice 1 proof and review loop

- [x] Run `pnpm --filter @hachej/boring-automation typecheck`.
- [x] Run `pnpm --filter @hachej/boring-automation test`.
- [x] Run `pnpm --filter @hachej/boring-automation build`.
- [x] Run GPT-5.5 implementation/spec review.
- [x] Run Claude Code review.
- [x] Run Opus 4.8 thermo review.
- [x] Fix accepted findings and re-review until GREEN.
- [x] Update PR #592 proof/handoff.

## Slice 0 — seam confirmation before execution/hosted work

- [ ] Confirm supported headless session-launch path.
- [ ] Choose trigger model: external host/CLI trigger or justified generic lifecycle seam.
- [ ] Confirm hosted topology and sandbox boundaries.
- [ ] Confirm hosted migration ownership.
- [ ] Confirm verified workspace/user identity seam for hosted plugin routes.
- [ ] Confirm token usage attribution/query path.
- [ ] Record decisions in `docs/issues/590/seam-spike.md`.
- [ ] Re-plan execution and hosted slices from those findings.

## Slice 2 — front UI

- [ ] Automation list/cards.
- [ ] Prompt editor for canonical Markdown.
- [ ] Cron/timezone/model/enabled controls.
- [ ] Expanded read-only run history.
- [ ] Open run session through `openDetachedChat(sessionId)`.
- [ ] Loading, empty, validation, and error states.
- [ ] Screenshot and component/integration proof.

## Deferred until Slice 0

- [ ] Executor-owned manual run.
- [ ] Due-run schedule evaluation and trigger integration.
- [ ] Hosted persistence/composition/duplicate-run protection.
- [ ] Token accounting.
- [ ] Final UI polish.
