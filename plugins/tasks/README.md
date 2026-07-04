# @hachej/boring-tasks

Lean Kanban task-board plugin for boring-ui.

`boring-tasks` owns only the generic board UI:

- standard task cards: number, title, description;
- adapter selector;
- flexible adapter-supplied columns;
- drag/drop status moves;
- optimistic update and revert.

Source-specific behavior belongs in adapters. A GitHub, Linear, Kata, or custom DB adapter maps native status/actions to the normalized board model; the Kanban UI does not know those systems.

This first implementation ships a client-side mock adapter so the plugin can be loaded and reviewed without adding app/core routes or database migrations.
