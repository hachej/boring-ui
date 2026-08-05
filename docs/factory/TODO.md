# Factory build order

Each step is usable alone. Today/Delta framing per item. Ordering lives here
only (do not duplicate in VISION).

## 1. Beads claim/handoff conventions

- **Today**: `br` v0.2.16 live; agents can already run it in worktrees; UI has
  read-only Beads provider (#1075).
- **Delta**: encode in /exec + handoff skills: self-claim via `br` lease off
  ready list, handoff notes onto the bead before compaction, `[br-###]`
  commit convention, thread=bead in session titles / intention subjects /
  artifact names.

## 2. Land the inbox edges

- **Today**: two branches nearly done — session↔task binding, artifact
  handover by a session.
- **Delta**: finish + merge both; they are the edges that let intentions carry
  proof (bead→session→PR→intention traceability).

## 3. Seams PR

- **Today**: Beads adapter (`beadsSource.ts`, read-only) exists on PR #1075
  only — main's tasks plugin has just `githubSource`; on the branch it is
  registered via a closed string branch (`sourceConfig.ts`); fleet wired only
  in playground dogfood file; digest = load-time self-consistency only.
- **Delta (first)**: land this PR (#1075) so the Beads adapter merges
  (reconcile the `WorkspaceAgentFront.tsx` overlap with the in-flight
  fix/786 branch).
- **Delta**: `registerTaskSourceProvider` registry; config-driven fleet loader
  with host-pinned digests (tamper evidence); CI check for skill-reference /
  digest drift.

## 4. Beadle automation + policy parser

- **Today**: no dispatcher; task→chat only on human click;
  `plugins/boring-automation` exists as the scheduling host.
- **Delta**: a `boring-automation` scheduled automation on ~10 min tick reading
  `factory/policy.yaml`: spawn workers while ready > active (cap), break
  stale leases (require handoff notes), flag beads closed without proof,
  rebase epic branches past thresholds, file conflict beads.

## 5. Trust ladder + bugfix lane

- **Today**: all merges owner-reviewed ad hoc; no standing fix lane.
- **Delta**: merge gate evaluates class A predicate from policy.yaml
  (allowlist ∧ reviewer-pass ∧ size-cap); stand up `fix/rolling` worktree;
  per-fix intentions; owner flush flow (cherry-pick mixed batches).

## 6. Model card tiering

- **Today**: card has workflow→shape guidance, no concrete tiers; tier table
  added 2026-08-05 (T1 Fable/Sol-xhigh, T2 Opus 4.8/Sol-medium,
  T3 Terra/Sonnet 4.6, T4 Luna/Haiku).
- **Delta**: smoke-test bead for Terra and Luna runtimes (funded key, harness
  support) before Workers/automation default to them; dispatcher reads
  seat→tier from policy.yaml.

## 7. 10-issue manual run → graduation

- **Today**: nothing has run end-to-end.
- **Delta**: run the loop on ~10 real issues against the graduation bar in
  VISION. Then: trusted-plugin tier + factory plugin packaging + Swarm
  Console (in that order).
