# PR 08 — Extend plugin self-test to backend health

## Goal

Extend PR #159 self-test so runtime backend handlers are verified alongside frontend loading/rendering.

## Scope

`boring-ui test-plugin` backend health support.

## Manifest health declaration

```jsonc
{
  "boring": {
    "runtimeServer": "server/index.ts",
    "health": { "path": "/health" }
  }
}
```

This is plugin-owned `/health` under the gateway:

```txt
/api/v1/plugins/:pluginId/health
```

Host metadata health remains:

```txt
/api/v1/agent-plugins/:pluginId/health
```

## Tasks

1. Parse optional backend health declaration.
2. `test-plugin` calls gateway health path when present.
3. Include backend status in JSON/text output.
4. Record last self-test result in health aggregator if available.

## Non-goals

- No generic endpoint crawler.
- No deep backend interaction testing.
- No remote sandbox support.

## Tests

- Healthy backend appears as backend ok.
- Backend failure appears separately from front failure.
- Missing backend health declaration does not fail self-test.
- Host health path and plugin health path are not confused.

## Acceptance

- `boring-ui test-plugin <id>` reports front and backend separately.
