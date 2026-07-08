# @hachej/boring-tasks

Lean Kanban task-board plugin for boring-ui.

`boring-tasks` owns only the generic board UI:

- standard task cards: number, title, description;
- adapter selector;
- flexible adapter-supplied columns;
- drag/drop status moves;
- optimistic update and revert.

Source-specific behavior belongs in adapters. A GitHub, Linear, Kata, or custom DB adapter maps native status/actions to the normalized board model; the Kanban UI does not know those systems.

The server plugin reads its own plugin config and creates task sources from it. In CLI workspaces mode, the host stores this config under the workspace's opaque `plugins.tasks` section:

```yaml
plugins:
  tasks:
    providers:
      - provider: github
        repo: auto
      - provider: github
        repo: hachej/boring-ui
```

`repo: auto` detects the repository with `gh repo view --json nameWithOwner` from the workspace root, so each local CLI workspace can map to its own associated GitHub repo. The GitHub source requires `gh auth login` and repository access. If no Tasks config is present, the backend exposes no task sources. If backend routes are unavailable, the front end still falls back to demo adapters for review/playground usage.
