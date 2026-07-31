# Issue #995: unified filesystem search

## Problem

The Files catalog searches only the primary `user` filesystem and returns bare
paths. Request-readable runtime filesystem bindings therefore cannot appear in
global search, and identical paths in multiple roots collide. The Files pane
also exposes a second search control without clearly communicating its local
scope.

## Decisions

- Keep the existing `FileSearch` implementation as the primary `user` search.
- At the HTTP route boundary, search the primary root plus every filesystem
  binding resolved for the current request. Binding roots are searched only via
  `RuntimeFilesystemBinding.operations.find`; no host path is exposed or used.
- Return only browser-safe `resources: { filesystem, path }[]` from search.
  Request-scoped binding resolution remains the authorization boundary, and
  opening a result continues through the normal freshly authorized file route.
- Give Files catalog rows filesystem-qualified IDs and show the root identity.
- Remove the Files-pane search input. The shell catalog is the single
  user-facing search entry point; controlled `searchQuery` remains available
  for embedding without rendering a second input.
- Do not change issue #996 selection behavior beyond carrying filesystem
  identity when opening a selected result.

## Implementation

1. Extend the search route options with request-visible bindings, aggregate
   primary and binding results, and return structured resources.
2. Wire binding resolution through both agent route composition paths.
3. Use `searchResources()` throughout the frontend, preserve duplicate paths
   across roots, and open with filesystem. `WorkspaceProvider.onOpenFile`
   receives one required filesystem-qualified resource.
4. Remove the duplicate Files-pane search input while preserving controlled search plumbing.
5. Make the multi-filesystem playground binding request-scoped and searchable,
   align readonly projection glob matching with the case-insensitive catalog
   query format, and add focused route, front, unit, and Playwright coverage.

## Proof

- Route tests prove primary + virtual binding aggregation, duplicate-path
  identity, request filtering, and operation-based binding search.
- Front tests prove structured parsing, qualified row IDs/root labels, and
  filesystem-aware open commands.
- File-tree and UI-review tests prove no duplicate search input renders.
- Playground Playwright coverage searches and opens the same relative path from
  both `user` and `company_context` roots.

## Server-driven filesystem discovery follow-up

- `GET /api/v1/filesystems` projects the authenticated request's effective runtime bindings into a browser-safe catalog. Denied bindings are omitted; provider errors and host paths are never serialized.
- The primary `user` workspace is server-declared. Additional entries derive access and fine-grained capabilities from binding access plus installed operations. Optional binding metadata supplies presentation only and cannot grant authority.
- The canonical Workspace filesystem plugin loads this catalog and falls back to `user` only while loading or on failure. Every file/search/tree/mutation request still resolves and authorizes bindings independently.
- Governance annotates bindings only after server policy authorizes them. No Governance frontend roots factory remains, and no browser code translates `companyContextAccess` or invents `company_context`.
- Hosts using cookie-only authentication change `authScopeKey` after identity transitions; the Files catalog immediately fails closed and reloads under the new identity.
- This is a coordinated breaking cutover: search responses and open callbacks require filesystem-qualified resources.

## Validation completed

- `@hachej/boring-bash`: focused route/projection/parity tests (11 tests) and
  typecheck.
- `@hachej/boring-agent`: focused mention/search/app integration tests (46
  tests) and typecheck.
- `@hachej/boring-workspace`: focused catalog/client/tree/palette/provider tests
  (227 tests) and typecheck.
- Multi-filesystem playground Playwright scenario (1 test) and repository
  invariant lint.

## Rollback

Revert the issue commit. No data migration or persisted schema change is
involved.
