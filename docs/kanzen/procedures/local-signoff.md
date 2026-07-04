# Local Signoff Workflow

Use local signoff to make handoffs cheap without turning GitHub Actions into the only source of proof.

Remote CI still owns machine-verifiable release/deploy artifacts. Local signoff owns developer proof on the exact commit SHA.

## Model

| Gate | Owner | Purpose |
| --- | --- | --- |
| `PR Fast Summary` | GitHub Actions | Remote routing gate for changed/full checks. |
| `signoff/local` | Developer or agent | Local proof passed on this exact commit. |
| Optional `signoff/*` | Developer, agent, reviewer, owner | Per-PR proof such as `thermo`, `visual`, `self-host`, or `deploy`. |

Only `signoff/local` should be considered for a global branch-protection requirement. Specialized signoffs are per-issue/per-PR proof and should be requested in the PR body, proof comment, or Kanzen gate fields.

Do **not** run `gh signoff install` blindly: it can rewrite branch protection required checks. Update required checks manually or through a reviewed GitHub ruleset change.

## Setup

Install the GitHub CLI extension once:

```bash
gh extension install basecamp/gh-signoff
```

The extension creates GitHub commit statuses named `signoff/<name>` on the current HEAD.

## Normal local proof

Run the repo's changed-workflow checks:

```bash
pnpm signoff:local
```

That script runs:

- `pnpm lint`
- `pnpm typecheck:changed` when available, otherwise `pnpm typecheck`
- `pnpm test:changed` when available, otherwise `pnpm test`
- `gh signoff local`

The signoff attaches to the current commit SHA. If a later commit changes the PR, the previous signoff is stale and must be rerun.

## Full local proof

Use this before release-candidate or broad/high-risk PRs:

```bash
pnpm signoff:full
```

That script runs `pnpm ci` and then signs off `local` and `full`.

## Self-host proof

Use this for self-host deployment changes:

```bash
pnpm signoff:self-host
```

That script runs self-host manifest/action-pin checks and signs off `self-host`.

## Handoff comment

When handing work to another agent or owner, include:

```md
## Handoff

Branch: <branch>
Commit: <sha>
Scope: <what changed>

Proof:
- pnpm signoff:local ✅
- optional: pnpm signoff:self-host ✅
- manual smoke: <url/check> ✅

Signoffs:
- signoff/local ✅ on <sha>
- optional signoff/self-host ✅ on <sha>

Remaining:
- <next action or blocker>
```

The next agent should run:

```bash
gh signoff status
```

If the current commit has changed or required proof is missing, rerun the relevant signoff script before declaring ready.

## Branch protection recommendation

For normal PRs, prefer requiring:

```text
PR Fast Summary
signoff/local
```

Do **not** require every PR branch to be up to date with the latest `main` commit before merge. A PR should be blocked for merge conflicts, stale or missing proof, or failed required checks — not just because `main` advanced after the branch was reviewed. Keep `main` protected by requiring the merge result checks/proof that matter.

Avoid requiring path-filtered jobs directly when they may be skipped by design. Keep production deploy gates separate: protected `prod-*` tags, GHCR image build, manifest verification, attestation verification, and Kamal/deployd deploy.
