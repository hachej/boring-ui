# @hachej/boring-tasks

Lean Kanban task-board plugin for boring-ui.

`boring-tasks` owns only the generic board UI:

- standard task cards: number, title, description;
- adapter selector;
- flexible adapter-supplied columns;
- drag/drop status moves;
- optimistic update and revert.

Source-specific behavior belongs in adapters. A GitHub, Linear, Kata, or custom DB adapter maps native status/actions to the normalized board model; the Kanban UI does not know those systems.

By default, the server plugin exposes a GitHub Issues source for the current workspace repository. It detects the repository with `gh repo view --json nameWithOwner` from the workspace root, so each local CLI workspace maps to its own associated GitHub repo. The GitHub source requires `gh auth login` and repository access. If backend routes are unavailable, the front end still falls back to demo adapters for review/playground usage.
