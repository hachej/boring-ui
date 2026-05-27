# App shape

## When to use

Use this when the user wants a new child app, a branded app shell, or asks how the app should be structured.

## Default recommendation

For a serious shipped app, start from `apps/full-app` and shape the work in five buckets:

- identity/config
- front composition
- server composition
- plugin layer
- domain/backend layer

## Base-app decision table

| Want | Base app |
|---|---|
| real product shell with auth, DB, workspaces, deploy | `apps/full-app` |
| plugin/workbench prototype | `apps/workspace-playground` |
| agent/chat-only app | `apps/agent-playground` |

## Output format

```txt
Child app shape
- Identity/config:
- Front composition:
- Server composition:
- Plugin layer:
- Domain/backend layer:
```

## Traps to avoid

- don't start coding before writing the five-bucket shape
- don't choose `workspace-playground` for a real production shell
- don't decide plugin shape before deciding whether the app is prototype vs shipped

## Deeper docs

- `../manuals/app-shape/APP_ARCHETYPES.md`
- `../manuals/app-shape/IMPLEMENTATION_SHAPE.md`
- `plugin-paths.md`
