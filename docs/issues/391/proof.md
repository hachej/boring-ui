# #391 plan-reset proof

Date: 2026-07-17

Branch: `issue-391-plan-realignment`

Base: `origin/main` at `e7fe0f79a` (v0.1.89) after normal merge-forward

## Scope

Planning and tracker reconciliation only. No runtime source, package manifest, migration, release, or deployment behavior changed.

## Authority and archive proof

- Active plan: `docs/issues/391/plan.md`.
- Durable ruling: `docs/DECISIONS.md` Decision 25.
- Six active top-level summary/review files point to the canonical plan.
- Historical **pre-move audit**: the original 127-file pack was classified as `8` retired AgentHost/D1/D2 work orders, `29` historical snapshots/evidence/redirects, and `84` retained architecture, roadmap, or independently tracked work-package files.
- **Post-move state**: `127` Markdown files remain under `docs/issues/391/runtime-refactor/`, classified exactly as `8` retired work orders, `28` historical snapshots/evidence files, `11` retained shared documents, `74` redirect stubs, and `6` active #391 summaries.
- The `74` canonical destinations are distributed as `33` documents to #805, `13` to #806, `7` to #807, `6` to #808, and `15` to #809.
- `docs/issues/391/OWNERSHIP.md` maps programmes to child issues #805–#809 and records the completed physical redistribution.
- `plan-navigator.html` renders a visible historical warning and canonical-plan link.
- `74` canonical Markdown documents moved: `33` to #805, `13` to #806, `7` to #807, `6` to #808, and `15` to #809. Every former path is a minimal direct redirect stub; #391 retains S1 PLAN/HANDOFF/TODO and all S2 relocation snapshots.
- `golden-path.json` retains main's v0.1.89 benchmark schema and records the static multi-agent package tracer plus Seneca proof as pending; detailed P0→N1 ordering lives in the canonical plan/INDEX.

Commands:

```bash
/usr/bin/git diff --check
jq empty docs/issues/391/runtime-refactor/golden-path.json
find docs/issues/391/runtime-refactor -type f -name '*.md' | wc -l
grep -RIl '^> \*\*Status: superseded AgentHost-era work order\.\*\*' \
  docs/issues/391/runtime-refactor --include='*.md' | wc -l
grep -RIl '^> \*\*Status: historical snapshot/evidence;' \
  docs/issues/391/runtime-refactor --include='*.md' | wc -l
grep -RIl '^> \*\*\(Scope status\|Work-package status\|Roadmap status\)' \
  docs/issues/391/runtime-refactor --include='*.md' | wc -l
find docs/issues/391/runtime-refactor -type f -name '*.md' \
  -exec grep -l '^# Moved$' {} + | wc -l
for summary in README.md INDEX.md VISION.md OWNER-REVIEW.md PR-PLAN.md FORWARD-PLAN.md; do
  test -f "docs/issues/391/runtime-refactor/$summary" && printf '%s\n' "$summary"
done | wc -l
for issue in 805 806 807 808 809; do
  find "docs/issues/$issue/runtime-refactor" -type f -name '*.md' ! -name README.md | wc -l
done
```

Result: PASS; no whitespace errors and valid JSON. The post-move commands output `127`, then exactly `8 / 28 / 11 / 74 / 6`; the destination loop outputs `33 / 13 / 7 / 6 / 15`. The pre-move `8 / 29 / 84` audit remains historical evidence, not a claim about the post-move tree.

## Tracker proof

New epic: `wt-391-forward-o0b`.

Ordered implementation graph:

```text
o0b.1 P0
-> o0b.2 S1
-> o0b.3 S2
-> o0b.4 S3
-> o0b.5 S4
-> o0b.6 S5
-> o0b.7 R1
-> o0b.8 N1

N1 -> o0b.9 deferred custom-tool planning trigger
N1 -> o0b.10 deferred native delegation/A2A planning trigger
```

Nine obsolete D1/AgentHost continuation beads were closed with the same explicit Decision-25/#794 supersession reason. Existing unrelated landed/deferred tracker records were not rewritten.

Commands:

```bash
br dep cycles
bv --robot-insights | jq '{cycle_count:(.Cycles|length),status:.status.Cycles}'
```

Result:

```text
✓ No dependency cycles detected.
cycle_count: 0
status: computed
```

## Independent plan review

Fresh read-only Sol (`openai-codex/gpt-5.6-sol`, xhigh requested) review rounds:

1. Architecture ruling: selected static package-first composition; rejected controller/CAS restoration; identified durable-decision and tracker reset requirements.
2. Full-diff review: found Decision 25 status-process conflict and stale Decision 21 topology; both corrected.
3. Unknown-unknown review: found route aggregation, physical runtime ownership, session mismatch, catalog exposure, deployment provenance, and pre-publish consumer qualification gaps; all integrated into the plan and Beads.
4. Final convergence review: **CLEAN** on the static architecture.
5. Ownership audit after owner challenge: found the blanket 121-file historical marker incorrect; replaced it with exact `8 retired / 29 evidence / 84 retained` classes and child issue ownership #805–#809.

The physical moves are complete, not future work. Decision 25 and the no-code scope remain unchanged.

The runtime invariant suite is waived for this docs-only move because this
isolated worktree has no installed `node_modules`/`tsup`. GitHub CI remains the
runtime invariant authority; all documentation, JSON, tracker-cycle, and diff
checks listed here run locally.

Final review output is stored in the session's subagent artifacts and was produced against this worktree after the corrections above.

## Handoff gates

- Plan-reset PR: https://github.com/hachej/boring-ui/pull/803.
- GitHub issue #391 body points to the canonical plan and PR #803.
- P0 is `in_review` until PR #803 merges.
- S1 remains dependency-blocked and must not start before P0 merge.
