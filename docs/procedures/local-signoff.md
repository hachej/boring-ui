# Local Signoff

Optional compatibility procedure. Remote CI owns release/deploy proof; local
signoff records developer proof on an exact commit SHA.

| Command | Use |
| --- | --- |
| `pnpm signoff:local` | lint + changed typecheck/tests (full fallback) + `signoff/local` |
| `pnpm signoff:full` | `pnpm ci` + local/full signoffs |

Install `basecamp/gh-signoff` only when needed. Never run `gh signoff install`
blindly; it may rewrite branch-protection checks.

A later commit makes prior signoff stale. Check with `gh signoff status`, rerun the
relevant command, then link it from the canonical proof/owner-review card.

For branch protection, prefer stable summary checks (for example `PR Fast
Summary`) plus `signoff/local`; do not require path-filtered jobs that legitimately
skip or every branch to be rebased merely because `main` advanced. Keep production
deploy gates separate.
