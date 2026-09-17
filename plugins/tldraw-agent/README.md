# tldraw Canvas plugin

Native `.tldraw` editing for the regular Boring agent.

## Architecture

- The standard Boring agent uses its configured model and authentication, including Codex subscription authentication.
- `edit_tldraw_canvas` supports `create`, `read`, and batched `edit` operations.
- `.tldraw` and `.tldr` files resolve to one workspace tab per path.
- An open tab owns one live tldraw SDK `Editor`. Manual edits and agent action batches mutate that same editor.
- Agent batches are delivered to the owning tab, applied through tldraw SDK APIs, serialized with `serializeTldrawJson`, and atomically saved once.
- Manual document changes autosave the same native file with optimistic `mtime` conflict detection.
- Native file creation uses the tldraw store schema; files contain `tldrawFileFormatVersion`, serialized schema, and native records.

## Agent workflow

```text
create/read native file
→ open corresponding workspace tab
→ load into the live tldraw Editor
→ apply one validated action batch
→ serialize once
→ atomically save once
```

Supported batch actions: create, update, delete, clear, align, and distribute.

## Run

```bash
BORING_WORKSPACE_PLAYGROUND_NATIVE_AGENT=1 pnpm --filter workspace-playground dev
```

Then ask the regular agent:

> Create `architecture.tldraw`, open it, and draw the request flow using one action batch.

`tldraw` production licensing must be reviewed before shipping; the watermark remains enabled.
