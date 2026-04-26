# Workspace Playground

A minimal reference app that wires `@boring/workspace` end-to-end.

## Features

- File tree with fixture files
- Code editor (CodeMirror 6) for `.ts`, `.json`, `.py`, `.sql`, `.yaml`
- Markdown editor (TipTap) for `.md` files
- Theme toggle (light / dark)
- In-memory file system — edits are not persisted across reloads

## Running

```bash
pnpm --filter workspace-playground dev
```
