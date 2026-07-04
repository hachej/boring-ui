# Ownership boundaries

## When to use

Use this when deciding where new logic belongs.

## Default recommendation

Choose ownership deliberately instead of dropping code into the nearest file.

## Decision table

| Concern | Usually belongs in |
|---|---|
| reusable shell/auth/workspace foundations | core composition |
| app identity, branding, app-specific routes | app shell |
| workspace extension surfaces (panels, tabs, commands, tools) | plugin |
| app-specific business logic and external API integration | app/server or domain module |

## Traps to avoid

- don't move app-specific logic into core by default
- don't use plugins for domain/backend code that should live in server modules
- don't put trusted backend behavior in runtime-generated plugins

## Deeper docs

- `../manuals/architecture/OWNERSHIP_RULES.md`
- `plugin-paths.md`
