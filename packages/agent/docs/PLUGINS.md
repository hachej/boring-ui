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

## Discovery Sources (direct/local)

In `direct` and `local` mode, plugin discovery can load tools from:

- `~/.pi/agent/extensions/*.js|*.mjs` (global)
- `<workspace>/.pi/extensions/*.js|*.mjs` (local)
- `<workspace>/node_modules/pi-plugin-*` packages
- `<workspace>/.pi/extensions.json` `npm` entries (if installed in `node_modules`)

## `vercel-sandbox` Mode Caveat

`createAgentApp` disables automatic plugin loading when runtime mode is
`vercel-sandbox`. This is intentional: plugin files are discovered via host
Node filesystem access, while sandbox workspace/exec are remote.

Practical effect:

- Plugin auto-discovery is enabled in `direct` and `local`.
- Plugin auto-discovery is disabled in `vercel-sandbox`.

## Manual Packaging Pattern For `vercel-sandbox`

If you still need extension-like behavior in `vercel-sandbox`, package files
manually into the workspace image/template used to create the sandbox:

- include `.pi/extensions/*` in your source template
- ensure files exist at `/vercel/sandbox/.pi/extensions/` in the remote workspace
- load/register tools through your app-shell bootstrap (not package auto-discovery)

Use the same template-seeding concept as local provisioning (for example
`templatePath`/`BORING_AGENT_TEMPLATE_PATH` workflows), but apply it when you
build the sandbox source/snapshot consumed by Vercel.

## Environment Differences

When porting plugins from host modes to `vercel-sandbox`, expect differences:

- available binaries and OS tools can differ from host machine
- root/path assumptions differ (`/vercel/sandbox` workspace root)
- process/network policy can differ from local development

## References

- Canonical design: `docs/plans/agent-package-spec.md`
- Minimal integration sketch: `examples/with-custom-tool/README.md`
