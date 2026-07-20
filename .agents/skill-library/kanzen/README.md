# Kanzen Skill Archive

This folder is an archive of the previous Kanzen skill workflow. Do not copy these skills back into `.agents/skills/` wholesale.

Boring v2 lives in `../boring-v2/` and should be the default source for new active skills.

## Status

- `v1/` — historical Kanzen workflow skills.
- Useful ideas from v1 should be copied into Boring v2 deliberately, not preserved as a parallel workflow.

## Migration map

| Kanzen v1 skill | Boring v2 home | Keep? | Notes |
| --- | --- | --- | --- |
| `boring-feedback` | `boring-v2/skills/feedback` | Partially | Keep redaction, safe GitHub issue creation, and “create issue then stop”. Drop Kanzen labels/phases. |
| `boring-triage` | `boring-v2/skills/triage` | Partially | Keep first-blocker thinking and next-action comments. Use simple Matt-style labels. |
| `boring-loop-plan` | `boring-v2/skills/plan` | Partially | Keep flag/abstraction, proof, review budget, plan files. Use `to-spec` first and `to-tickets` only when needed. |
| `boring-loop-implement` | `boring-v2/skills/implement` | Mostly | Keep PR/proof/review/handoff safety. Simplify labels and routing. |
| `boring-loop-grill` | `feedback`, `triage`, `plan` | Mostly drop | Keep only the “grill now / defer / skip” decision and specific `needs-info` questions. |
| `boring-orchestration` | future, maybe not needed | Drop for now | Too heavy for the first v2 pass. Reintroduce only after the simple workflow proves itself. |
| `loop-grill` | none | Drop | Compatibility shim only. |
| `loop-plan` | none | Drop | Compatibility shim only. `plan` is the loop. |
| `loop-implement` | none | Drop | Compatibility shim only. `implement` is the loop. |

## Concepts worth carrying forward

These are useful as inspiration, not as canonical Kanzen machinery:

- Safe feedback redaction: no secrets, cookies, auth headers, private transcripts, or host-local paths.
- Feedback creates the issue and stops.
- First blocker / first unmet gate thinking.
- Human-vs-agent routing, but as `ready-for-human` / `ready-for-agent`.
- Proof path is required: exact command, screenshot/demo, manual steps, or explicit waiver.
- Flag / abstraction / rollback thinking for risky changes.
- Review budget for slices.
- PR handoff card with issue, proof, review, risks, next action.
- Fast-track safety cautions for auth, billing, permissions, secrets, migrations, public API, releases, deletion-heavy work, and broad refactors.

## Concepts to drop from v2 surface area

- `state:*`, `phase:*`, and `track:*` labels.
- Separate `gate:*` label concepts.
- Many command names for the same flow.
- Heavy orchestration before the five-skill workflow is proven.
- Compatibility aliases unless a human explicitly asks for them.

## If we delete later

Once Boring v2 is accepted, this archive can be reduced further. Suggested deletion candidates:

1. `v1/loop-grill`
2. `v1/loop-plan`
3. `v1/loop-implement`
4. `v1/boring-orchestration`
5. `v1/boring-loop-grill`

Do not delete them until the owner explicitly asks for deletion.
