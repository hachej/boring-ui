# Route composition

## When to use

Use this when the app needs pages or endpoints outside the stock workspace/auth flow.

## Default recommendation

Decide whether each page is:

- authenticated and inside the app shell
- public and outside the auth gate
- app-specific but still workspace-aware

## Decision table

| Route type | Composition bias |
|---|---|
| workspace/app-auth page | keep inside existing shell/provider stack |
| public page | lower-level composition, outside auth gate |
| mixed app-specific page | verify provider ordering and auth assumptions first |

## Traps to avoid

- don't assume dropping to `CoreFront` alone solves public-route composition
- don't add public routes without checking auth/provider ordering
- don't let workspace-aware providers mount in the wrong place

## Deeper docs

- `../manuals/architecture/ROUTE_COMPOSITION.md`
- `../manuals/architecture/OWNERSHIP_RULES.md`
