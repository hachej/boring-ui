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
- [x] Update and merge dedicated PR #600.

## Slice 0 — seam confirmation before execution/hosted work

- [x] Confirm canonical headless path: host-injected existing workspace `Agent.send()` dispatcher.
- [x] Choose trigger model: externally invoked idempotent due operation; no hidden plugin timer.
- [x] Confirm hosted topology and sandbox/remote-worker/session-volume boundaries.
- [x] Confirm current migration ownership gap and recommended app-owned registration path.
- [x] Confirm verified actor resolver requirement for hosted plugin routes.
- [x] Confirm first-pass token attribution from live Pi usage events.
- [x] Record decisions in `docs/issues/590/seam-spike.md`.
- [x] Re-plan execution and hosted slices from those findings.
- [ ] Owner decision: app-owned explicit plugin migration registration vs generic trusted-plugin migrations.
- [ ] Owner decision: scheduled usage billing owner vs future workspace billing account.
- [ ] Owner decision: hosted automation role policy and reassignment permissions.

## Slice 2 — front UI

- [ ] Automation list/cards.
- [ ] Prompt editor for canonical Markdown.
- [ ] Cron/timezone/model/enabled controls.
- [ ] Expanded read-only run history.
- [ ] Open run session through `openDetachedChat(sessionId)`.
- [ ] Loading, empty, validation, and error states.
- [ ] Screenshot and component/integration proof.

## Next execution/hosted slices

- [ ] Slice 3A: generic trusted workspace agent dispatcher.
- [ ] Slice 3B: executor-owned manual run with live usage aggregation.
- [ ] Slice 4: pure due policy and external trigger adapter.
- [ ] Slice 5: hosted persistence, verified actor composition, and duplicate-run lease after owner decisions.
- [ ] Slice 6: authenticated hosted platform trigger.
- [ ] Final UI polish.
