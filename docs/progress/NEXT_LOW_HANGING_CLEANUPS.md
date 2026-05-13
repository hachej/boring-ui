# Next Low-Hanging Cleanup Tracker

Branch: `cleanup/low-hanging`

Process: implement one task at a time, run focused checks, get subagent review with a `ship` verdict, then commit that step before moving on.

## Risk order

| ID | Status | Scope | Review | Commit |
| --- | --- | --- | --- | --- |
| NLH-01 | done | Document `check-generated-artifacts` usage/policy. | reviewer: ship | `40eacdc0` |
| NLH-02 | done | Extract `CommandPalette` recent/select handlers into a focused helper/hook. | reviewer: ship | `88bb454e` |
| NLH-03 | done | Move `convertBlobUrlToDataUrl` into a browser file utility while preserving prompt-input re-export. | reviewer: ship | `d6626992` |
| NLH-04 | done | Split `prompt-input.tsx` constants/context only, with no JSX movement. | reviewer: ship after one revise round | pending |
| NLH-05 | pending | Extract ChatPanel composer history hook. | pending | pending |
| NLH-06 | pending | Extract ChatPanel slash/mention handlers. | pending | pending |

## Notes

- Prefer behavior-preserving extraction.
- Preserve public import paths unless explicitly noted.
- Ask reviewer/oracle before each commit.
