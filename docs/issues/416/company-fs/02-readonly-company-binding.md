# PR 2 — Readonly policy-filtered company binding

## Objective

Implement readonly `company_context` for normal users/agents using a policy-filtered projection.

Done when backend operations can browse/search/read allowed company files, denied files are absent, and no tool/UI behavior has changed yet.

## Depends on

- PR 1 foundation binding model.
- #391 dependency inversion or approved boring-bash staging seam.

## Scope

### In scope

- Fixture/local company provider projection.
- Policy-filtered readonly company binding.
- Read/list/find/grep/search operation support for readonly binding.
- Readonly company routes or route params needed by tools/UI later.
- Sentinel denied-content tests.
- Transcript/tool-event metadata as V0 access trail.
- Reusable readonly-projection conformance tests for providers.

### Out of scope

- Existing Pi-style tool schema/wiring changes; PR 3 owns `filesystem?` tool wiring.
- Readwrite management binding.
- UI tree/viewers.
- Real company provider.
- MCP integration.
- Binary/download/preview.
- Copy/export.
- Transcript redaction/retention.

## Binding behavior

Normal user policy can grant:

```ts
{
  filesystem: 'company_context',
  access: 'readonly',
  mountPath: '/company_context',
  projection: 'policy-filtered',
}
```

V0 implementation is bounded to a provider-prepared readonly projection for the fixture/local provider. The projection must contain only files/folders allowed for this context. Readonly mount/projection is not safe if denied files are present.

Production policy lookup is DB-backed through the host-provided binding resolver. File-based policy is only acceptable for CLI/dev/test fixtures.

The prepared readonly binding must be injected into the runtime-mode adapter for the session that receives it. File tools, shell, routes, and UI capability discovery must all refer to the same prepared binding to avoid split-brain.

If a future provider cannot produce a safe projection, it must expose no shell mount for company_context and must use backend adapter reads/searches instead. That fallback is a follow-up provider mode, not part of this PR.

## Operation behavior

Allowed for readonly company binding:

```txt
read
ls/list
find
grep
stat/search if present
```

Rejected:

```txt
write
edit
delete/rename/mkdir/upload/watch
```

PR 3 wires these operations into existing Pi-style tools.

## Path and filesystem identity

Path prefix does not choose filesystem.

Reject:

```txt
company_context:/company/hr/policy.md as a path string
/company_context/company/hr/policy.md as a path-switch attempt
```

Accept operation descriptors with explicit filesystem:

```ts
{ filesystem: 'company_context', path: '/company/hr/policy.md' }
```

## Projection/filtering requirements

Policy-filtered projection must ensure:

- denied files physically absent from mounted/projected view;
- denied directory names absent;
- no hidden placeholders/counts;
- symlink escapes blocked;
- path traversal blocked by adapter/provider;
- stale projections invalidated or rebuilt when policy changes.

Search/list/find/grep must not leak denied names/snippets/total counts. Pagination/limits must be safe: do not return fewer visible items merely because denied items were dropped without continuing/overfetching where appropriate.

Any provider exposing mounted readonly company bindings must pass readonly-projection conformance tests:

```txt
denied files absent
symlink escapes blocked
stale policy invalidation works
writes fail
no denied names/snippets/counts leak
```

## Fixture and sentinel

Fixture:

```txt
/company/hr/policy.md
/company/hr/onboarding.md
/company/finance/budget.md  // contains FORBIDDEN_FINANCE_SECRET_123
/company/legal/contract.md
```

A user denied finance must never observe `FORBIDDEN_FINANCE_SECRET_123` through any V0 access path.

## Tests

- Direct read/list/find/grep operation tests against readonly company binding pass.
- Write/edit/mutation operations reject `company_context` readonly binding.
- Path spoofing does not switch filesystem.
- Readonly projection contains only allowed fixture files.
- `list('/company')` with finance denied returns only allowed folders.
- Search/find/grep return only readable paths/snippets and no denied counts.
- Sentinel never appears in list/search/grep/read errors/operation output/shell output/transcript metadata for denied actor.
- Fixture/local readonly projection, when mounted, contains only readonly allowed files and cannot write.
- Providers without safe projection support expose no shell access to company_context; backend-adapter fallback is a follow-up provider mode, not part of this PR.
- Missing identity/policy/binding fails closed.
- Transcript/tool-event metadata includes filesystem/path/operation where available.
- Readonly-projection provider conformance suite fails an intentionally unsafe projection that includes denied files.

## Review checklist

Block if:

- denied files are present in readonly projection;
- readonly projection is just full company store mounted `ro`;
- path prefix decides filesystem;
- write/edit can target readonly company binding;
- provider exposes mounted readonly company binding without passing conformance tests;
- result filtering/pagination leaks denied data;
- company content is silently copied into user workspace/cache.