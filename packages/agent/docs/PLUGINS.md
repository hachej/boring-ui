# PLUGINS

Plugin and extension notes for `@boring/agent`.

## Current Status

The full plugin runtime is not shipped yet in this scaffold.

Today:

- Tool contracts are defined in `src/shared/tool.ts`.
- Runtime catalog/harness integration is still under active implementation.

## Planned Integration Model

The intended extension seam is "register additional tools into the catalog"
without modifying core runtime internals.

Each tool should provide:

- Stable `name`
- Clear `description`
- JSON-schema `parameters`
- Async `execute(params, ctx)` implementation

`ctx` is expected to carry:

- `abortSignal`
- `toolCallId`
- Optional progress callbacks (`onUpdate`)

## Safety + Compatibility Rules

- Validate all plugin input against schema before execution.
- Return deterministic, serializable output structures for reliable rendering.
- Keep plugin-side filesystem and process behavior behind the selected runtime
  mode adapter (do not bypass the agent runtime boundary).
- Avoid `node:*` imports in shared/frontend code paths.

## Tool Name Collisions

Collision precedence is explicit: last-registered wins.

- Built-in catalog tools are registered first.
- App `extraTools` are registered next.
- Plugin tools are registered last.

If a plugin reuses an existing tool name (for example `bash`), the plugin tool
replaces the earlier one and a warning is logged:

`[catalog] Tool "bash" overridden by plugin <name>`

## Local-Only Caveat (Current Phase)

Until remote runtime adapters and package-level plugin APIs are complete, treat
plugin wiring as local development integration. Do not assume multi-tenant or
untrusted plugin isolation guarantees in the current scaffold.

## References

- Canonical design: `docs/plans/agent-package-spec.md`
- Minimal integration sketch: `examples/with-custom-tool/README.md`
