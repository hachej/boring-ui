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
- Preserve legacy `results: string[]` for the primary workspace and add
  browser-safe `resources: { filesystem, path }[]` for unified consumers.
  Request-scoped binding resolution remains the authorization boundary, and
  opening a result continues through the normal freshly authorized file route.
- Give Files catalog rows filesystem-qualified IDs and show the root identity.
- Retain the Files-pane control only as a clearly labeled `Filter current tree`
  control; the shell catalog remains the global search entry point.
- Do not change issue #996 selection behavior beyond carrying filesystem
  identity when opening a selected result.

## Implementation

1. Extend the search route options with request-visible bindings, aggregate
   primary and binding results, and return structured resources.
2. Wire binding resolution through both agent route composition paths.
3. Preserve `FetchClient.search(): Promise<string[]>` and add the structured
   `searchResources()` API. Update catalog/fallback consumers to prefer structured
   resources with legacy bare-path fallback, preserve duplicate paths across
   roots, and open with filesystem. Preserve non-user identity through the
   public `WorkspaceProvider.onOpenFile` callback's optional resource argument.
4. Clarify the local Files-pane filter wording.
5. Make the multi-filesystem playground binding request-scoped and searchable,
   align readonly projection glob matching with the case-insensitive catalog
   query format, and add focused route, front, unit, and Playwright coverage.

## Proof

- Route tests prove primary + virtual binding aggregation, duplicate-path
  identity, request filtering, and operation-based binding search.
- Front tests prove structured parsing, qualified row IDs/root labels, and
  filesystem-aware open commands.
- File-tree tests prove the local control is explicitly scoped.
- Playground Playwright coverage searches and opens the same relative path from
  both `user` and `company_context` roots.

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
