# tldraw Canvas plugin

Native `.tldraw` editing for the regular Boring agent.

## Architecture

- The standard Boring agent uses its configured model and authentication, including Codex subscription authentication.
- `edit_tldraw_canvas` supports `create`, `read`, and batched `edit` operations.
- `.tldraw` and `.tldr` files resolve to one workspace tab per path.
- An open tab owns one live tldraw SDK `Editor`. Manual edits and agent action batches mutate that same editor.
- Agent batches are delivered to the owning tab, applied as remote tldraw SDK changes, serialized with `serializeTldrawJson`, and submitted as one stable commit request through the Workspace adapter. An unknown transport/write outcome may replay that same request idempotently.
- Manual document changes autosave with an optimistic `{ size, mtimeMs, sha256 }` revision. Plugin-originated writes are serialized per file; stale content is rejected before writing and the result is read back to detect an immediately overlapping external write.
- The playground enables the plugin only in local mode, where the plugin and agent runtime share the same policy-aware Workspace instance. Remote-worker mode stays disabled until it exposes the same capability.
- Native file creation uses the tldraw store schema; files contain `tldrawFileFormatVersion`, serialized schema, and native records.

## Agent workflow

```text
create/read native file
→ open corresponding workspace tab
→ load into the live tldraw Editor
→ apply one validated action batch
→ serialize one resulting snapshot
→ submit one stable optimistic commit (idempotently replayed only after an unknown outcome)
```

Supported batch actions: create, update, delete, clear, align, and distribute.

## Concurrency boundary

The local filesystem does not provide compare-and-swap replacement against arbitrary processes. This plugin therefore does **not** claim cross-process atomic CAS. It detects changes visible before its guarded write and verifies content immediately afterward, but a raw filesystem writer can still race inside or after that interval. On a detected conflict the panel reloads the durable file; users should avoid editing an open `.tldraw` file through unrelated raw filesystem tools.

## Run

```bash
BORING_WORKSPACE_PLAYGROUND_NATIVE_AGENT=1 pnpm --filter workspace-playground dev
```

Then ask the regular agent:

> Create `architecture.tldraw`, open it, and draw the request flow using one action batch.

`tldraw` production licensing must be reviewed before shipping; the watermark remains enabled.
