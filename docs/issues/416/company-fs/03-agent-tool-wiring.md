# PR 3 — Agent tool wiring for filesystem bindings

## Objective

Expose filesystem bindings to agents through existing Pi-style file tools with `filesystem?: FilesystemId`, while preserving current user workspace behavior.

## Depends on

- PR 1 foundation binding model.
- PR 2 readonly company binding / fixture routes.

## Scope

### In scope

- Add optional `filesystem?: FilesystemId` to existing `read`, `ls`, `find`, `grep` tool schemas.
- Default omitted `filesystem` to `user`.
- Route explicit `company_context` calls to the prepared readonly binding from PR 2.
- Reject mutation tools (`write`, `edit`, etc.) against readonly bindings.
- Add concise tool/prompt guidance when company_context is advertised.
- Preserve Pi factory + Operations adapter path.

### Out of scope

- Projection/provider lifecycle.
- UI bridge/tree/viewer work.
- Readwrite management binding.
- New company-specific duplicate tools.

## Tool behavior

```ts
read({ path: 'README.md' }) // user default
read({ filesystem: 'company_context', path: '/company/hr/policy.md' })
ls({ filesystem: 'company_context', path: '/' })
find({ filesystem: 'company_context', pattern: '*.md', path: '/' })
grep({ filesystem: 'company_context', pattern: 'vacation', path: '/' })
```

Path prefix does not choose filesystem. `company_context:/x` inside `path` is invalid.

## Tests

- Existing tools without `filesystem` still hit `user` and existing tests pass.
- Explicit `filesystem: 'user'` behaves same as omission.
- Explicit `filesystem: 'company_context'` read/list/find/grep uses company binding.
- Mutation tools reject readonly company binding.
- Path spoofing does not switch filesystem.
- Prompt/tool descriptions mention company_context only when capability is advertised and include root `/` guidance.
- Pi factory/Operations adapter parity tests cover user behavior.

## Review checklist

Block if:

- separate basic company tools are introduced;
- omission of `filesystem` can mean company_context;
- Pi factory/Operations adapter path is bypassed without parity tests;
- mutation tools can write readonly company bindings.
