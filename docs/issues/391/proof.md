# #391 plan-reset proof

Date: 2026-07-17  
Branch: `issue-391-plan-realignment`  
Base: `origin/main` at `cf0c8b2e776f1437f6090849af8e73b64aea511a`

## Scope

Planning and tracker reconciliation only. No runtime source, package manifest, migration, release, or deployment behavior changed.

## Authority and archive proof

- Active plan: `docs/issues/391/plan.md`.
- Durable ruling: `docs/DECISIONS.md` Decision 25.
- Six active top-level summary/review files point to the canonical plan.
- `127` Markdown files exist under `docs/issues/391/runtime-refactor/`:
  - `6` current top-level reference/summary files;
  - `121` retained historical files with the standard first-line
    `historical reference / non-dispatchable` marker.
- `plan-navigator.html` renders a visible historical warning and canonical-plan link.
- `golden-path.json` parses and records #794 complete plus P0→N1 ordered pending work.

Commands:

```bash
git diff --check
jq empty docs/issues/391/runtime-refactor/golden-path.json
find docs/issues/391/runtime-refactor -type f -name '*.md' | wc -l
grep -RIl '^> \*\*#391 status (2026-07-17): historical reference / non-dispatchable\.\*\*' \
  docs/issues/391/runtime-refactor --include='*.md' | wc -l
```

Result: PASS; no whitespace errors, valid JSON, `127` total Markdown files and `121` marked historical files.

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

Ten obsolete D1/AgentHost continuation beads were closed with the same explicit Decision-25/#794 supersession reason. Existing unrelated landed/deferred tracker records were not rewritten.

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
4. Final convergence review: **CLEAN** — no blocker, high, or medium findings; no hidden implementation scope or AgentHost/controller/CAS restoration.

Final review output is stored in the session's subagent artifacts and was produced against this worktree after the corrections above.

## Residual gates

- GitHub issue #391 body and labels are updated after the plan PR exists so the body can cite the exact review URL.
- P0 remains planning/in-review until the PR merges.
- S1 remains dependency-blocked and must not start before P0 merge.
