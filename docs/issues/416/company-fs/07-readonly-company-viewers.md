# PR 7 — Readonly company viewers

## Objective

Make files opened from readonly `company_context` bindings readonly by construction.

This PR is viewer/editor behavior only.

## Depends on

- PR 5 UI bridge filesystem identity.
- PR 6 Company file tree root.

## Ownership

Viewer/editor pieces belong to future `@hachej/boring-bash/plugin`; workspace hosts the plugin.

## Scope

### In scope

- Readonly viewer mode for readonly filesystem bindings.
- Capability-based mutation affordance gating.
- Readonly badge/breadcrumb/tab affordance.
- Ensure mutation shortcuts and LSP/code actions cannot mutate readonly company files.

### Out of scope

- File tree roots.
- Backend provider implementation.
- Save As / export / copy-to-workspace.
- Binary/download/preview.
- Major editor redesign beyond necessary extraction.

## Behavior

Readonly binding:

- no save/edit/rename/delete/upload/replace;
- no Save As / Export-to-workspace in V0;
- no drag/drop write;
- no autosave/writeback;
- no dirty state;
- no optimistic write flow;
- mutation shortcuts no-op or show readonly feedback;
- LSP/code actions/rename-symbol cannot mutate.

Use capabilities, not hardcoded role checks:

```txt
binding.access === 'readonly' | 'readwrite'
```

## Tests

- Readonly company file opens in readonly viewer.
- No save/edit/rename/delete/upload/drag-write/LSP mutation path for readonly company files.
- User file editor behavior unchanged.
- Readonly company viewer never calls write/edit/delete/move/upload routes.
- No `Buffer` in shared/front payload types.

## Review checklist

Block if:

- readonly viewer has reachable mutation paths;
- UI code hardcodes roles instead of binding capabilities;
- implementation creates giant branchy file panels instead of capability-based components;
- current file panel is already above ~700 lines and no extraction/split lands before adding readonly behavior.
