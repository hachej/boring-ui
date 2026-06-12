# PLUGINS

Plugin and extension notes for `@hachej/boring-agent`.

## Two extension paths

There are two ways to extend the agent, depending on host integration:

1. **Pi-native resources** (`package.json#pi`: `extensions`, `skills`,
   `prompts`, `systemPrompt`) — discovered by the Pi harness in `direct`/`local`
   mode and reloadable through `/reload`. This is the right place for portable,
   hot-reloadable tools and skills. See [tools.md](./tools.md).
2. **Trusted server plugins** (`@hachej/boring-workspace` `defineServerPlugin`)
   — static/boot-time `agentTools`, routes, and provisioning declared by trusted
   server code. See [tools.md](./tools.md) and
   [runtime-provisioning.md](./runtime-provisioning.md).

Both paths converge on the same `AgentTool` contract
(`src/shared/tool.ts`). The standalone `createAgentApp` ships no UI tools;
`exec_ui`/`get_ui_state` and UI routes are owned by `@hachej/boring-workspace`.

## Tool contract

Each tool provides:

- Stable `name`
- Clear `description`
- JSON-schema `parameters`
- Async `execute(params, ctx)` implementation

`ctx` is expected to carry:

- `abortSignal`
- `toolCallId`
- Optional progress callbacks (`onUpdate`)

Optional fields:

- `readinessRequirements?: ToolReadinessRequirement[]` — gates the tool on
  runtime readiness. `mergeTools` assigns `['workspace-fs']` to plugin tools
  that omit it (built-in/`extraTools` tools keep whatever they declare).
- `promptSnippet?` — extra guidance injected into the system prompt when the
  tool is registered.

## Trust & runtime modes

Plugin tools' `execute()` run in the **host Node process** and bypass the
sandbox by design — treat plugin code as trusted local/workspace code. Plugin
auto-discovery is local-mode-only (see the `vercel-sandbox` caveat below). For
the full internal-vs-external plugin trust model, see
`packages/workspace/docs/PLUGIN_SYSTEM.md` §1.1.

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

### Plugin vs Plugin collisions

If two plugins register the same tool name:

- the later plugin registration wins
- a warning is logged for the override
- startup does **not** fail; no hard error is thrown

The rule is implemented in `mergeTools` and is applied uniformly whether the
previous tool came from built-ins, `extraTools`, or another plugin.

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

- Adding tools: [tools.md](./tools.md)
- Chat `/slash` commands as a plugin surface:
  `packages/workspace/docs/PLUGIN_SYSTEM.md` §4.7
- Minimal integration sketch: `examples/with-custom-tool/README.md`
- Historical design notes: `docs/plans/archive/` (archival; not current truth)
