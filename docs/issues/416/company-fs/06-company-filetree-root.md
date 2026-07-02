# PR 6 — Company file tree root

## Objective

Show `company_context` as a separate Company root/tab/section in the file tree.

This PR is tree UX only; readonly viewer mutation hardening comes later.

## Depends on

- PR 2 readonly company binding.
- PR 5 UI bridge filesystem identity.

## Ownership

This UI belongs to future `@hachej/boring-bash/plugin`. Workspace hosts the plugin and surface registry.

## Scope

### In scope

- File tree capability/binding discovery.
- Separate Workspace and Company roots/tabs/sections.
- Company tree lists only readable folders/files for readonly bindings.
- Company file tree opens include `filesystem: 'company_context'`.
- Tree-level actions reflect binding access: readonly has no mutation actions.

### Out of scope

- Readonly viewer/editor internals.
- Readwrite management UI polish.
- Global search redesign.
- Save/copy/export.

## UX rule

Do not show company context as a subfolder of the user workspace.

Good:

```txt
Files
  [Workspace] [Company]
```

or:

```txt
Workspace
  src/

Company
  hr/
```

## Tests

- Single-fs app unchanged.
- Workspace and Company render as separate roots/tabs/sections.
- Company root hidden when no binding exists.
- Company tree hides denied files/counts for readonly actors.
- Company tree click opens with `filesystem: 'company_context'`.
- Tree mutation actions are absent/disabled for readonly Company root.

## Review checklist

Block if:

- company files appear under user workspace tree;
- tree opens company files path-only;
- denied files/counts leak in tree/search;
- tree actions can mutate readonly company_context;
- UI code hardcodes product roles instead of binding capabilities.
