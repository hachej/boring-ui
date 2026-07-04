# Transport decisions

## When to use

Use this when deciding how the frontend and backend should communicate.

## Default recommendation

Pick the narrowest transport that fits the job.

## Decision table

| Need | Prefer |
|---|---|
| open UI surfaces or send workspace UI actions | UI bridge command/event flow |
| normal authenticated data or mutations | authenticated route |
| public marketing or webhook-style endpoint | public route |
| workspace filesystem interaction | workspace/file abstraction |

## Traps to avoid

- don't add routes when a bridge command is enough
- don't force bridge transport for ordinary CRUD or webhook work
- don't pass raw paths where the workspace abstraction should be used

## Deeper docs

- `../manuals/architecture/TRANSPORT_DECISION_MATRIX.md`
- `../manuals/architecture/ROUTE_COMPOSITION.md`
