# Breaking migration to the native Pi library

This candidate replaces the implementation in `hachej/boring-ui` with the v4
library. Its proposed npm version is `1.0.0`, the next major after `0.1.111`.
The architecture name "v4" is independent of the npm version. Packages remain
private until release qualification and publication authorization are complete.

## Package identities

| Development identity | Release candidate identity |
| --- | --- |
| `@boring/agent` | `@hachej/boring-agent` |
| `@boring/ui` | `@hachej/boring-ui-kit` |
| `@boring/files` | `@hachej/boring-files` |
| `@boring/execution` | `@hachej/boring-execution` |
| `@boring/browser` | `@hachej/boring-browser` |
| `@boring/feedback` | `@hachej/boring-feedback` |
| `@boring/testing` | `@hachej/boring-testing` |

Neither the old agent API nor the UI kit API is compatible with this candidate.
The old private `@hachej/boring-browser` plugin also has a different API from the
new optional native agent worker. Do not upgrade applications by changing only
their dependency versions.

The old core, workspace, CLI, plugin CLI, Pi skills/reference package, Bash, sandbox and plugin
packages have no package-level compatibility replacement in this tree. Existing
published versions remain untouched. Host applications retain identity, storage,
policy and deployment responsibilities. Native Pi supplies execution; optional
workspace adapters and copied shadcn recipes replace selected capabilities, not
the old imports or persisted data formats.

## Application migration

1. Keep the existing application and its dependency lock until its own migration
   branch passes its acceptance tests. This repository change migrates no app.
2. Choose the optional entries documented in the [library guide](README.md).
   Borrow a host-owned native Harness and keep its direct APIs. Do not pass old
   AgentHost or workspace objects as though they were compatible native objects.
3. Implement host authorization and resource publication against the new
   [contracts](docs/contracts/CONTRACTS.md). Review working files separately from
   conditional authoritative writes, and preserve expected revisions and receipts.
4. Port UI composition using the [UI guide](packages/ui/README.md) and
   [registry guide](registry/README.md). Install the new recipe sources explicitly;
   existing copied recipes do not update when an npm dependency changes.
5. Qualify existing data and task history separately. No automatic conversion of
   old sessions, databases, grants or plugins is supplied. Preserve backups and
   old application builds before any separately approved cutover.

## Source and ownership

The target base is `62eaa783257c7126dcdfe798cd09b83cf9633de8` in
`hachej/boring-ui`. Git history retains the previous implementation and its owner
documents. The user explicitly requested the replacement and breaking release.
The v4 owner documents now govern this implementation; previous frozen
AgentHost, plugin and pnpm architecture instructions describe the old generation.

The imported candidate combines v4 PR54 at
`5c2cc6be92cc91f692599ad86461896384449954` with v4 main through
`af55e2a87cd5d1183eb7807acb26db6f5a29f56e`. Local integration source is
`59defc4c55a5488956a34eff659898c57ddc2d72`. Main's AWS/Cloudflare workspace,
question-card streaming and ignored-file checks are included. Uncommitted chat
continuity work is excluded. Evidence for predecessor commits does not qualify
this renamed and combined candidate.

The previous automatic pnpm publishing workflow is removed. The replacement
uses npm workspaces and [release preflight](docs/implementation/NPM-RELEASE.md).
It includes synchronized version preparation and a maintainer-dispatched npm
workflow that publishes the exact qualified tarballs through trusted publishing.
Merges and tags do not trigger publication. Packages remain private in this PR.
No GitHub release, npm publication, deployment or consumer modification is part
of this PR. The [partial checkpoint](docs/implementation/PARTIAL.md) and all
eleven global proof deferrals remain. A major version does not discharge them.
