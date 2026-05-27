# Acceptance

## When to use

Use this before calling a child app done.

## Default recommendation

Verify by layer, not just by typecheck.

## Verification table

| Layer | Check |
|---|---|
| config/env | required env vars resolved and documented |
| auth | sign-in, verify-email, reset-password, magic-link flows behave correctly |
| plugins | expected plugin path loads the expected surfaces |
| routes/UI | shell, public pages, and app-specific pages mount correctly |
| persistence | migrations run and app-owned tables behave correctly |
| deploy | smoke checks pass on the target platform |

## Traps to avoid

- don't stop at local build/typecheck when deploy/runtime behavior changed
- don't skip auth and email smoke checks on serious apps
- don't call provider-owned blockers “done” without saying so clearly

## Deeper docs

- `../manuals/verification/ACCEPTANCE_MATRIX.md`
- `../playbooks/CHECKLISTS.md`
- `../playbooks/PROGRESS_DISCLOSURE.md`
