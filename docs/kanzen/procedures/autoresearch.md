# Autoresearch

Autoresearch is a bounded controller around one regular plan and one regular
exec. It turns combined review evidence into a small convergence loop; it does
not grant extra edit, baseline, model, or merge authority.

## Inputs

Require one tracked issue, target/allowed paths, measurable goal, exact
functional commands, optional exact registered UI spec, and a writer-iteration
cap from 1 through 5. Use the Model Card unless the owner explicitly overrides
reviewers for the run. Resolve intent and risky scope before iteration 0.

One dedicated worktree has one writer. Tests, host contracts, registered review
specs, hard gates, and reviewers remain independent judges.

## Topology

```text
plan once
→ iteration 0: immutable functional/UI/performance baseline
→ exec once: [select ≤3 → fix → prove → blind review] × cap
→ one owner handoff
```

Iteration 0 does not spend a writer round. Starting a fix selection does. UI
`improve` packets and recursive skill invocation are outside this controller.

## Combined review

Deterministic proof comes first:

- target typecheck, tests, build, and declared contract/E2E checks;
- every required hard gate from the exact registered UI spec;
- baseline/final performance measurement with a declared threshold; and
- repository invariants required by the changed paths.

A red proof closes the iteration without live visual criticism or model-review
spend. Retry a command at most once on the same revision and record both
attempts. Reproducible product failures become findings; repeated infrastructure
failure ends `blocked-owner`.

After green proof, start each required reviewer in a fresh isolated read-only
session. Give them the same commit/tree-bound packet and no other reviewer's
verdict. Record role, target commit/tree, resolved model, effort, transport,
verdict, and findings or artifact link. Reviewer findings are advisory inputs;
the exec review ladder and thermo requirement still apply.

## Finding queue

Normalize every finding as `<source>:<check>:<subject>`, deduplicate exact IDs,
carry unresolved IDs forward, and sort by:

1. deterministic-gate failures;
2. agreement between independent reviewers;
3. severity; then
4. normalized ID.

Select at most three material fixes per iteration. Progress requires one carried
finding to resolve or drop severity without a new deterministic failure of equal
or higher severity. The same normalized set after two consecutive writer rounds
ends `stalled`.

## Visual changes

Keep iteration 0 revision- and digest-bound as comparison evidence. A red report
is comparison-only and is never supplied as a paired `--baseline-dir`, because
that would carry its failures into every candidate.

An intended visual delta may update a registered baseline only when all
non-visual gates pass, every changed image is inspected, before evidence is
preserved, and the spec's registered update command is used. Then run a fresh
unpaired review. Reviewers judge the final tree and before/after evidence. A
rejected delta becomes a finding for the next iteration. If an update is first
needed after the final writer round, stop `cap-exhausted`.

Workers may improve product code and its tests within the declared paths. They
consume host contracts and review specs as judges. Changes to contracts, gates,
budgets, baselines, or exemptions require an explicit planned rationale and the
normal independent review; they are never a shortcut to green.

## Iteration record

For iteration 0 and every writer round, record:

- issue/run ID, iteration, target, goal, and terminal state;
- base and candidate commit/tree;
- evidence paths and SHA-256 digests;
- commands, exit status, and retry disposition;
- normalized queue, selected fixes, and dispositions;
- baseline/final performance values and threshold; and
- complete independent reviewer records or the deterministic reason they were
  skipped.

## Stop conditions

- `success`: all acceptance gates pass and required reviewers are clean on one
  commit/tree.
- `stalled`: the progress rule fails for two consecutive writer rounds.
- `blocked-owner`: unresolved intent, authority, reviewer availability, repeated
  infrastructure failure, or declared scope/performance boundary.
- `cap-exhausted`: the final writer iteration ends without success.

There is no extra writer round, self-certification, automatic merge, or silent
model substitution. Exec completes its normal proof, PR, owner artifact, and
human decision handoff for every terminal state.
