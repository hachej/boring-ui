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
- [x] Add `.agents/personas/{concierge,triage,steward,worker,reviewer}` authored
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

- [x] Add exact bounded `BoringTaskDetail`, metadata, and relation DTOs plus
  generic optional card priority/issueType/assignee fields.
- [x] Enforce documented string/section/count/total-byte bounds and exact
  dependency/dependent/parent/child relation mapping.
- [x] Add optional detail capability/get contract to front/server adapters.
- [x] Add stable unknown-source/unsupported-detail/not-found service behavior.
- [x] Add Tasks get-detail route and HTTP adapter preserving code/retryability.
- [x] Replace board-wide failure with per-source all-settled loading.
- [x] Preserve successful cached source data as visibly stale on refresh failure.
- [x] Add per-source retry and all-source refresh.
- [x] Avoid duplicate config/list reads where practical.
- [x] Test bounds, ordering/dedup, typed errors, source isolation, retry, and stale
  behavior.
- [x] Pass Tasks test/typecheck gate.

## D — Workspace-authorized read-only Beads provider

Blocked by C.

- [x] Define injected `BeadsOperations` with no caller-selectable cwd/path.
- [x] Add local/playground adapter bound to one admitted Workspace root; remote
  without matching operations returns runtime-unavailable.
- [x] Pin/check `br 0.2.16`; use fixed sandboxed argv, read-only copies of
  Workspace-admitted Beads files, and bounded timeout/output.
- [x] Validate IDs with ASCII/NFC/length grammar and mandatory `--` terminator.
- [x] Test leading option, DB/config option, traversal, whitespace/control,
  overlength, and Unicode inputs before execution.
- [x] Parse list object/show array defensively; ignore unknown fields and reject
  malformed required shapes/duplicates.
- [x] Map explicit statuses including unknown → `other`.
- [x] Map ID/title/preview/status/labels/priority/type/assignee/parent/epic.
- [x] Map full description/acceptance/notes/metadata and ordered relations.
- [x] Strip source_repo_path/path-shaped unknowns and redact command errors.
- [x] Implement/export the complete generic + `TASK_BEADS_*`
  code/status/retryability table, including unsupported version.
- [x] Return typed per-source partial-list errors without hiding healthy sources.
- [x] Strictly validate provider config and reject duplicate Beads providers.
- [x] Add playground GitHub + Beads config.
- [x] Prove the admitted `issues.jsonl`/metadata/config snapshot and untouched
  DB/WAL/SHM files all keep byte-level fingerprints; separately prove canonical
  public output is unchanged and report transient locks.
- [x] Run Tasks tests/typecheck/build and security/path review gate.

## E — Accessible Bead detail dialog

Blocked by C; may develop against mock detail adapter while D completes.

- [x] Add dedicated detail-open control to cards in list and Kanban.
- [x] Preserve drag and nested chat/external/menu behavior.
- [x] Add responsive plain-text dialog with accessible name, focus containment,
  Escape close, focus return, and close/back.
- [x] Render identity/status/metadata, description, acceptance, notes, and
  relations with loading/error/retry states.
- [x] Test keyboard, focus, Escape, loading, failure/retry, nested actions, and
  drag regression.
- [x] Run automated browser assertions and desktop/mobile visual proof.
- [x] Complete high-taste UI review gate.

## F — Convergence and owner handoff

Blocked by all lane gates.

- [x] Keep A/B and C/D/E in independently reviewable commits.
- [x] Run every command and browser proof from the canonical plan.
- [x] Run `pnpm audit:imports`, `pnpm lint:invariants`, and `git diff --check`.
- [x] Run tier-2 cross-lane standards/spec/thermo review.
- [x] Integrate accepted findings; re-prove/re-review non-trivial fixes.
- [x] If one focused loop does not clear blockers/majors, split PRs.
- [x] Otherwise push the issue branch and open one PR linked to #1072.
- [x] Post current-head proof and owner-review handoff. Never merge.
