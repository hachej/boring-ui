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

### Removed

- Hand-rolled tool implementations for `bash`, `read`, `write`, `edit`, `find`, and `grep`.
- Per-tool guideline bullets in the pi harness; pi prompt snippets now pass through verbatim.
- Decorated prompt-snippet formatting that could leak extra dash/backtick wrappers into the system prompt.
