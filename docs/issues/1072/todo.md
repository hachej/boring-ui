# gh-1072 implementation TODO

Canonical plan: [`plan.md`](./plan.md)

Bead root: `wt-391-forward-gh-1072-factory-agents-beads-020e`; children `.1`
through `.6` correspond to slices A through F.

The owner requested one final PR. Keep the two lanes as independently green
commits/review units. If either lane retains a blocker/major after one focused fix
loop, stop convergence and split rather than weakening acceptance.

## A — Handoff, identities, trusted skill composition

- [x] Port the independently reviewed handoff skill/procedure and pinned Matt
  Pocock source attribution.
- [x] Add handoff discovery/routing without duplicating canonical policy.
- [x] Add `agents/boring/{concierge,triage,steward,worker,reviewer}` authored
  manifests/instructions using identity-only schema.
- [x] State role restrictions as behavioral policy, not enforced capabilities.
- [x] Add the generic trusted authored-source → configured-AgentHost-spec mapper.
- [x] Add playground role composition that resolves canonical skill files from
  admitted roots, verifies digests, appends exact content, and fails boot on
  missing/mismatched content.
- [x] Prove every role binding resolves only canonical `.agents/skills/**`
  sources—including feedback, fresh-eyes, and handoff—and equals one-shot content/digest.
- [x] Test optional host-supplied `model.preferred` isolation and prove manifests
  cannot select model/plugins/tools/skills.
- [x] Run Agent compiler/materializer/mapper/model tests and build.
- [x] Complete tier-1 and tier-2 review gate.

## B — Fleet selector and addressed sessions

Final integration blocked by A; may develop against configured-agent fixtures.

- [x] Treat existing `WorkspaceAgentFront.agentTypeId` as immutable host default.
- [x] Fetch fleet options and keep separate selected-new-session owner state.
- [x] Persist selection per Workspace storage scope; validate stale values.
- [x] Filter inventory to selected agent in v1.
- [x] Route only future session creation/plugin chat creation through selection.
- [x] Preserve old/in-flight addressed panes and colliding session IDs.
- [x] Preserve single-agent/loading/error/default compatibility and expose
  non-blocking diagnostic when host default is absent from fleet.
- [x] Compose five agents through real workspace-playground AgentHost.
- [x] Test fleet list, selection persistence/fallback, inventory filter, addressed
  create, open-pane preservation, collisions, and model policy.
- [x] Run Agent/Workspace/playground tests, typechecks, builds, and automated
  browser assertions.
- [x] Complete tier-1 and tier-2 review gate.

## C — Generic detail, typed errors, source isolation

Independent of A/B.

- [ ] Add exact bounded `BoringTaskDetail`, metadata, and relation DTOs plus
  generic optional card priority/issueType/assignee fields.
- [ ] Enforce documented string/section/count/total-byte bounds and exact
  dependency/dependent/parent/child relation mapping.
- [ ] Add optional detail capability/get contract to front/server adapters.
- [ ] Add stable unknown-source/unsupported-detail/not-found service behavior.
- [ ] Add Tasks get-detail route and HTTP adapter preserving code/retryability.
- [ ] Replace board-wide failure with per-source all-settled loading.
- [ ] Preserve successful cached source data as visibly stale on refresh failure.
- [ ] Add per-source retry and all-source refresh.
- [ ] Avoid duplicate config/list reads where practical.
- [ ] Test bounds, ordering/dedup, typed errors, source isolation, retry, and stale
  behavior.
- [ ] Pass Tasks test/typecheck gate.

## D — Workspace-authorized read-only Beads provider

Blocked by C.

- [ ] Define injected `BeadsOperations` with no caller-selectable cwd/path.
- [ ] Add local/playground adapter bound to one admitted Workspace root; remote
  without matching operations returns runtime-unavailable.
- [ ] Pin/check `br 0.2.16`; use fixed `execFile` argv and bounded timeout/output.
- [ ] Validate IDs with ASCII/NFC/length grammar and mandatory `--` terminator.
- [ ] Test leading option, DB/config option, traversal, whitespace/control,
  overlength, and Unicode inputs before execution.
- [ ] Parse list object/show array defensively; ignore unknown fields and reject
  malformed required shapes/duplicates.
- [ ] Map explicit statuses including unknown → `other`.
- [ ] Map ID/title/preview/status/labels/priority/type/assignee/parent/epic.
- [ ] Map full description/acceptance/notes/metadata and ordered relations.
- [ ] Strip source_repo_path/path-shaped unknowns and redact command errors.
- [ ] Implement/export the complete generic + `TASK_BEADS_*`
  code/status/retryability table, including unsupported version.
- [ ] Return typed per-source partial-list errors without hiding healthy sources.
- [ ] Strictly validate provider config and reject duplicate Beads providers.
- [ ] Add playground GitHub + Beads config.
- [ ] Prove canonical public-output and byte-level JSONL/DB/WAL/SHM/metadata/config
  fingerprints do not change; report transient locks separately.
- [ ] Run Tasks tests/typecheck/build and security/path review gate.

## E — Accessible Bead detail dialog

Blocked by C; may develop against mock detail adapter while D completes.

- [ ] Add dedicated detail-open control to cards in list and Kanban.
- [ ] Preserve drag and nested chat/external/menu behavior.
- [ ] Add responsive plain-text dialog with accessible name, focus containment,
  Escape close, focus return, and close/back.
- [ ] Render identity/status/metadata, description, acceptance, notes, and
  relations with loading/error/retry states.
- [ ] Test keyboard, focus, Escape, loading, failure/retry, nested actions, and
  drag regression.
- [ ] Run automated browser assertions and desktop/mobile visual proof.
- [ ] Complete high-taste UI review gate.

## F — Convergence and owner handoff

Blocked by all lane gates.

- [ ] Keep A/B and C/D/E in independently reviewable commits.
- [ ] Run every command and browser proof from the canonical plan.
- [ ] Run `pnpm audit:imports`, `pnpm lint:invariants`, and `git diff --check`.
- [ ] Run tier-2 cross-lane standards/spec/thermo review.
- [ ] Integrate accepted findings; re-prove/re-review non-trivial fixes.
- [ ] If one focused loop does not clear blockers/majors, split PRs.
- [ ] Otherwise push the issue branch and open one PR linked to #1072.
- [ ] Post current-head proof and owner-review handoff. Never merge.
