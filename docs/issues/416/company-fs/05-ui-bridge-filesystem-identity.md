# PR 5 — UI bridge filesystem identity

## Objective

Make file-open UI plumbing filesystem-aware so later Company tree/viewer work cannot lose `company_context` identity.

This PR is identity plumbing only.

## Depends on

- PR 1 foundation binding model.
- PR 2 readonly company binding for test fixtures/capabilities.

## Ownership

This belongs to the future `@hachej/boring-bash/plugin` surface contracts where possible. `@hachej/boring-workspace` owns `UiBridge.postCommand`, surface registry, and plugin hosting; it should not own company-specific file UI logic long-term.

## Scope

### In scope

- Add `filesystem?: FilesystemId` to UI bridge/surface file-open payloads.
- Bind legacy path-only opens to `filesystem: 'user'`.
- Include filesystem in panel params, tab ids, cache keys, dirty-state keys, stale-write keys, and persisted/deep-link state where file opens are encoded.
- Chat file mentions / `@` mentions / transcript file-reference UI preserve filesystem identity where they reference files.

### Out of scope

- Company file tree root.
- Readonly viewer mutation behavior.
- Backend provider implementation.
- Global search redesign.

## Compatibility rule

```txt
legacy open path with no filesystem => user
company open => { filesystem: 'company_context', path: '/company/hr/policy.md' }
```

Do not infer company context from path text.

## Tests

- Path-only open binds to `user`.
- Company open requires filesystem field.
- `user:/x` and `company_context:/x` open distinct tabs/panels.
- Persisted company tab denied after policy change shows disclosure-safe not found/denied.
- Chat mentions/file refs preserve filesystem identity.
- `UiBridge.postCommand` remains the single UI dispatch source.
- No `Buffer` in shared/front payload types.

## Review checklist

Block if:

- UI opens company files path-only;
- tab/cache/dirty keys omit filesystem;
- path strings like `/company_context/x` or `company_context:/x` switch filesystem;
- workspace base front/shared code imports agent values.
