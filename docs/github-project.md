# GitHub Project Roadmap

The canonical GitHub-only roadmap is:

- Project: [Boring Roadmap](https://github.com/users/hachej/projects/7)
- Repository: [hachej/boring-ui](https://github.com/hachej/boring-ui)
- Scope: product backlog, active issue work, review loop state, and shipped work.

Do not mirror this roadmap into a file backlog. Use the GitHub Project for the
roadmap overview and GitHub issues for concrete work.

## Mental Model

The project has three useful dimensions:

| Field | Purpose | Values |
| --- | --- | --- |
| `Status` | Global project flow | `Backlog`, `Doing`, `Done` |
| `Loop Status` | Agent/maintainer execution loop | `Needs Triage`, `Needs Grill`, `Needs Plan`, `Needs Review`, `Ready`, `Executing`, `Blocked` |
| `Type` | Primary work kind visible in the project view | `Bug`, `Feature`, `Refactor`, `Architecture`, `Dependencies`, `Documentation`, `Chore`, `Story` |

Keep these dimensions separate. `Status` answers "where is this globally?",
`Loop Status` answers "what does the work need next?", and `Type` answers
"what kind of work is this?"

## Color Conventions

GitHub Project single-select options should stay color-coded for scanning:

| Field | Value | Color |
| --- | --- | --- |
| `Status` | `Backlog` | Gray |
| `Status` | `Doing` | Blue |
| `Status` | `Done` | Green |
| `Loop Status` | `Needs Triage` | Gray |
| `Loop Status` | `Needs Grill` | Purple |
| `Loop Status` | `Needs Plan` | Yellow |
| `Loop Status` | `Needs Review` | Orange |
| `Loop Status` | `Ready` | Blue |
| `Loop Status` | `Executing` | Green |
| `Loop Status` | `Blocked` | Red |
| `Type` | `Bug` | Red |
| `Type` | `Feature` | Green |
| `Type` | `Refactor` | Purple |
| `Type` | `Architecture` | Blue |
| `Type` | `Dependencies` | Orange |
| `Type` | `Documentation` | Yellow |
| `Type` | `Chore` | Gray |
| `Type` | `Story` | Pink |

## Status

Use `Status` for the coarse roadmap lane only.

| Status | Meaning |
| --- | --- |
| `Backlog` | Queued, not actively being worked. This includes ideas, planned work, and bugs that are not currently executing. |
| `Doing` | Active work. An issue should usually be `Doing` when it has an open linked PR, an assigned active owner, or a current implementation thread. |
| `Done` | Shipped, closed, or explicitly finished. |

Avoid making `Status` carry review/planning nuance. That belongs in
`Loop Status`.

## Loop Status

Use `Loop Status` for the execution loop.

| Loop Status | Meaning |
| --- | --- |
| `Needs Triage` | The item exists but has not been classified well enough to trust. |
| `Needs Grill` | The direction needs pressure-testing before planning or implementation. Use this for major architecture/product bets. |
| `Needs Plan` | The direction is accepted, but the implementation plan is not ready. |
| `Needs Review` | A plan, branch, draft PR, or implementation exists and needs human/agent review. |
| `Ready` | Ready to implement, but not currently executing. |
| `Executing` | Currently being worked. Issues with open linked PRs should be here. |
| `Blocked` | Cannot progress without an external decision, dependency, credential, or upstream fix. |

Default mapping from issue labels:

| Issue signal | Project value |
| --- | --- |
| Open linked PR | `Status: Doing`, `Loop Status: Executing` |
| `status:to-review`, `status:to-plan-review`, `status:to-code-review`, `need-review` | `Needs Review` |
| `status:to-code`, `status:to-implement`, `status:to-merge` | `Ready` |
| `story` or broad `architecture` + planning labels | `Needs Grill` |
| `status:to-plan` or `needs-plan` | `Needs Plan` |
| Unlabeled or unclear | `Needs Triage` |

## Type

Use `Type` for the primary kind of work visible in the project. Keep detailed
package/plugin routing in issue labels.

| Type | Meaning |
| --- | --- |
| `Bug` | Broken behavior or user-visible regression. |
| `Feature` | New user-facing or platform capability. |
| `Refactor` | Internal restructuring without intended behavior change. |
| `Architecture` | System design, package boundary, runtime strategy, or major technical decision. |
| `Dependencies` | Dependency upgrade or migration work. |
| `Documentation` | Docs-only work. |
| `Chore` | Maintenance that is not user-facing and is not dependency-specific. |
| `Story` | Umbrella issue spanning multiple child issues. |

When an issue has multiple type labels, choose one primary `Type` for project
scanning. Suggested priority is:

1. `Bug`
2. `Dependencies`
3. `Story`
4. `Feature`
5. `Refactor`
6. `Architecture`
7. `Documentation`
8. `Chore`

The issue can still keep all relevant labels.

## Issue Labels

Use issue labels for details that do not need their own project field:

- Type labels: `bug`, `feature`, `refactor`, `architecture`, `dependencies`,
  `documentation`, `chore`, `story`.
- Package labels: `package:core`, `package:agent`, `package:workspace`,
  `package:ui`, `package:cli`, `package:pi`.
- Plugin labels: `plugin:*`.
- Legacy/detail status labels may exist while old issues are being cleaned up,
  but the project fields are the roadmap source of truth.

Prefer `feature` over GitHub's default `enhancement` label.

## Project View Setup

GitHub currently allows agents to edit project fields and item values, but not
the visual view layout. Configure the view once in the GitHub UI:

1. Open [Boring Roadmap](https://github.com/users/hachej/projects/7).
2. Show these fields:
   - `Status`
   - `Loop Status`
   - `Type`
   - `Linked pull requests`
3. Hide noisy fields unless needed:
   - `Assignees`
   - `Sub-issues progress`
   - `Labels`
   - `Milestone`
4. Group by `Status`.
5. Sort by `Loop Status`, then `Type`, if the view needs more structure.

This gives a compact overview:

```text
Backlog
  Needs Grill     Architecture / Story
  Needs Plan      Feature / Refactor / Bug
  Needs Review    Plans or draft work awaiting review
  Ready           Implementable work waiting for an owner

Doing
  Executing       Open linked PRs or active implementation

Done
  Finished work
```

## Maintenance Rules

- Raw ideas can start as project draft items.
- Bugs should become GitHub issues immediately.
- Create or keep a GitHub issue when work is real, current, user-facing, or a bug.
- Move issues with open linked PRs to `Status: Doing` and `Loop Status: Executing`.
- Move closed/shipped work to `Status: Done`.
- Keep the project fields synced when issue labels change.
- Do not create a parallel file-based backlog in this repository.
