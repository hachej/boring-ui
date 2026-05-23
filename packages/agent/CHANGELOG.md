# @boring/agent Changelog

## [Unreleased] - Pi tools migration (epic uhwx)

### Changed

- Tool names now follow pi conventions: `find_files` -> `find`, `grep_files` -> `grep`.
- Tool schemas now come from pi factory definitions. Notable breaking changes: `read` uses `offset`/`limit`; `edit` takes an `edits[]` array; `write` always creates parent directories; `bash` accepts optional `timeout`; `grep` supports `ignoreCase`, `literal`, and `context`.
- File operations are registered through `buildFilesystemAgentTools(bundle)` instead of the legacy catalog path. Standalone agent apps get default file tools unless `disableDefaultFileTools` is set; workspace/plugin hosts can compose the same factory into their own app shell.

### Added

- Streaming bash output via `Sandbox.exec({ onStdout, onStderr })` callbacks.
- Generic `Sandbox` metadata for future remote backends: `SandboxResources`, `vendorHints`, and `placement: "remote"`.
- Vercel-specific grep execution that preserves pi's grep name, description, and schema while running `rg` inside the sandbox.
- **`/api/v1/agent/reload` response body** carries `restart_warnings` (per-plugin restart-needed notices) and `diagnostics` (non-fatal plugin reload errors). Both are optional and only present when relevant.
- **`ReloadHookResult` shape** for the `beforeReload` option on `createAgentApp` / `reloadRoutes` — closures can return `{ restart_warnings, diagnostics }` and the route surfaces them verbatim on the response.
- **`PluginRestartWarning` type** declared once in `@hachej/boring-agent/shared/agentPluginEvents` and consumed by both the server route and the chat UI banner. The agent layer does not depend on workspace; the shape mirrors `@hachej/boring-workspace`'s `PluginRestartWarning` by convention.
- **Chat UI `PluginUpdateStatus` banner** renders an amber "Restart needed for N plugin(s)" sub-block + a separate diagnostics sub-block inside the green success banner when `/reload` returns either field. Banner copy is unified across all three surfaces ("Stop and restart the workspace process (Ctrl-C, then re-run your dev command)"). Success heading flips to "Plugins partially updated." when warnings present.

### Removed

- Hand-rolled tool implementations for `bash`, `read`, `write`, `edit`, `find`, and `grep`.
- Per-tool guideline bullets in the pi harness; pi prompt snippets now pass through verbatim.
- Decorated prompt-snippet formatting that could leak extra dash/backtick wrappers into the system prompt.
