# Workspace Docs

Current package docs live here. Active ownership plans stay in `docs/plans/`.
Older implementation plans live in `docs/plans/archive/`.

## Current References

- `PLUGIN_SYSTEM.md` - current normative spec for the plugin / agent layer:
  package manifest fields, public API for front + server authoring,
  hot-reload coverage table, prompt-location guidance, and key algorithms.
  Code cites it as `Per PLUGIN_SYSTEM.md §X`.
- `PLUGIN_STRUCTURE.md` - quick layout guide for generated/runtime plugins vs
  app/internal publishable package plugins.
- `INTERFACES.md` - package boundaries and public abstractions.
- `plans/PLUGIN_OUTPUTS_ISOLATION_PLAN.md` - latest plugin ownership plan.
- `plans/UI_BRIDGE_OWNERSHIP_REFACTOR.md` - UI bridge ownership decision.
- `plans/archive/` - superseded implementation plans.

## Rules

- Keep root package markdown to `README.md` and `CHANGELOG.md`.
- Prefer short current-reference docs over long status reports.
- Move old plans into `plans/archive/` instead of keeping them beside active
  ownership plans.
