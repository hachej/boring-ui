---
name: boring-triage
description: "Use this skill to classify boring-ui GitHub issues, PRs, and /feedback reports into workflow states, simplify labels, detect owner-gated work, identify proof paths, and decide whether work should close, wait for owner input, plan, become a stacked PR, enter implementation, enter review, or become merge-ready."
---

# Boring Triage

Triage is the gate between "something exists" and "a worker may act."

Run triage from orchestration on a regular cadence. Do not run it inline inside
`/feedback`; feedback capture should only enrich and queue the issue.

## Read First

For each issue, PR, or feedback report:

1. Read body and comments.
2. Treat owner comments as routing instructions.
3. For PRs, inspect diff, changed files, CI, review, merge state, and head SHA.
4. Search for duplicates or related PRs.
5. Inspect enough code/docs to identify ownership and proof path.

## Queue Mode

When asked to triage a repo instead of a specific item:

1. Count open issues by status label.
2. Prioritize `status:to-triage`.
3. If none exist, inspect items with no status label.
4. Then inspect noncanonical or stale status labels, such as old `status:to-code`
   or plan-review labels.
5. Cap the first pass to the smallest useful set and say what was skipped.
6. Do not mutate labels unless explicitly asked.

Return a short inventory before the cards: open count, `status:to-triage` count,
unrouted count, stale-label count, and any missing canonical labels.

## Decision Algorithm

1. Duplicate, invalid, stale, or unsupported: recommend close/defer.
2. Feedback item waiting on user refinement: `status:needs-grill`.
3. Missing product, security, privacy, access, or proof judgment:
   `status:needs-owner`.
4. Broad, ambiguous, or sequencing-heavy: `status:to-plan`.
5. Complex but decomposable: mark as stack candidate and create a stack plan.
6. Bounded, testable, and authorized: `status:to-implement`.
7. PR exists but proof/review is incomplete: `status:to-review`.
8. Proof, review, and CI are current: `status:to-merge`.

Only `status:to-implement` starts implementation.

## Labels

Use labels for routing only.

Exactly one status label:

- `status:to-triage`
- `status:needs-grill`
- `status:needs-owner`
- `status:to-plan`
- `status:to-implement`
- `status:to-review`
- `status:to-merge`

Optional routing label:

- `source:feedback`

Use normal taxonomy labels when useful: `bug`, `ux`, `docs`, `ci`,
`plugin:*`, `package:*`.

## Structured Fields

Store judgment off-label:

- `type`: bug, feature, dependency, security, docs, internal, ci, ux;
- `risk`: low, medium, high;
- `autonomy`: autonomous, owner-gated, plan-needed, defer, close;
- `decomposition`: single-pr, stack-candidate, stacked, plan-needed;
- `proofRequired`: tests, demo-workspace, provider-live, screenshot, none;
- `proofState`: missing, partial, current, waived;
- `reviewState`: not-run, dirty, clean, stale;
- `mergeMode`: owner, auto-eligible, never-auto;
- `grillState`: not-needed, needed, deferred, complete;
- `blocker`, `nextAction`, `recommendation`.

## Triage Card

Return a URL-first card:

```text
URL:
What:
Type/Risk:
Proof:
Decomposition:
Blocker:
Next:
Recommendation:
```

No card should end with vague "review this." Say what review or proof is
missing.

If the card needs owner input, set `status:needs-owner` and make the card a
decision brief. In manual runs, print it in the Codex session. In product runs,
write it to the Kanzen decision inbox; use a GitHub comment only when the
decision should be public/durable on the issue or PR.

## Autonomous Candidates

Good candidates:

- narrow bug with repro or obvious failing test;
- docs, tests, or internal cleanup with low blast radius;
- low-risk CI/dependency work with clear verification;
- small UI polish with demo/browser proof path;
- contributor PR repair where intended behavior is clear.

Owner-gated:

- product direction;
- security/privacy judgment;
- auth, billing, permissions, identity, data loss;
- public API or package export changes;
- broad refactors;
- unavailable credentials or live proof;
- merge, close, release, publish, or destructive operations without permission.

Stack candidates:

- foundation/API layer plus UI layer;
- multi-package contract/caller work;
- refactor that unblocks a feature;
- migration-style work with separable adapters, callers, cleanup;
- broad bug family with independent proof per slice.

## Feedback Issues

Issues created from `/feedback` start with:

- `source:feedback`
- `status:to-triage`

Backlog items or issues needing user refinement use:

- `source:feedback`
- `status:needs-grill`

Check redaction before public comments. Never publish secrets, cookies, auth
headers, private customer data, full local paths outside the repo, or raw
transcripts.
