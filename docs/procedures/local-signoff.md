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

Local signoff does not replace required GitHub checks, independent abstraction
review or [current-main integration proof](boring-loop.md#mandatory-verification-and-review-gates).
Use a merge queue or equivalent controlled candidate validation; if main moves,
validate the new combination even when the feature patch is unchanged. Stable
summary checks may account for jobs skipped by explicit path rules, never for
missing required proof. Keep deployment gates separate. This supersedes the
older advice that a moved main needs no further integration check.
