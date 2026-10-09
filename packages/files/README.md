# @hachej/boring-files

Versioned resources over a workspace's files: the contracts, and the workspace provider over Pi's own FileSystem (no Boring file system). Reader, publisher and lookup capabilities are independently injectable; the aggregate ResourceProvider advertises actual support/grants/availability/qualified guarantees. ResourceClient carries browser intent, not trusted host ResourceAccess.

Publication requires nonempty changes and explicit atomicity. The trusted boundary computes the canonical digest and checks approval; those are not client-authored authority fields. Receipts identify valid create/replace/delete transitions; partial outcomes retain operation, input index and full target/view. Reconciliation is optional and required explicitly where claimed; not-found is not proof of no effect.

Opaque resource view IDs are provider-scoped and bound to the actual backing/incarnation by the provider. Import contracts with `import type`.

`@hachej/boring-files/workspace` exports `createWorkspaceProvider({ identity, fs, journal })`: the one provider of a workspace's files ([One place for files](../../docs/architecture/FILES-GIT-EXEC.md#one-place-for-files)). It takes a Pi `FileSystem` (a disk environment, the virtual workspace or the SQLite backend below), the host's workspace identity and a journal (`createWorkspaceJournal(connection)` from `@hachej/boring-files/journal`, receipts, intents and the last 20 versions of each file in SQLite). Revisions are Git blob ids of the bytes. A conditional write checks every expected revision and precondition inside the workspace's queue, records its intent first and its receipt last; an intent without a completion looks up as `unknown` and is never replayed. Its owner closes the connection; the provider borrows it. Node currently marks `node:sqlite` experimental.

The provider accepts all-or-nothing create and replace. It refuses working views, per-change requests and deletes (files are removed with the workspace's own tools) before any effect. Logical paths are relative to the workspace root; a path whose real location leaves the root is denied. A single file is replaced atomically by every backend; a multi-file batch only by the SQLite backend, together with its receipt when the journal shares the database. Access control is the host's, at the workspace boundary: there are no per-file permissions inside a workspace, and external revocation fencing is not implemented.

Receipts are scoped by workspace identity, principal, scope and initiator. Identical committed retries return the original receipt; changed arguments conflict. Refused operations do not reserve an ID. A receipt from an earlier incarnation of the workspace reads `unknown`. A not-found lookup is not permission to replay an uncertain operation.

`@hachej/boring-files/publication` is browser-safe. It captures request bytes, computes a versioned canonical SHA-256 digest with WebCrypto, and parses result shapes. Digests carry `boring-publication-v1:sha256:` and bind that format identifier in the hashed payload. Consumers must also check operation, target, scope and index association against their own request. This module confers no authorization. The SQLite connection (`openNodeConnection` from `@hachej/boring-files/sqlite`) is a separate server entry point.

`@hachej/boring-files/sqlite` exports `openNodeConnection(filename, settings?)` (a `node:sqlite` file as a `SqliteConnection`) and `openNodeDatabase(filename, settings?)` (the configured `DatabaseSync`, for Pi's public adapter: `SqliteStorage.open(new NodeSqliteDatabase(openNodeDatabase(file, settings)))`). `settings` is `SqliteSettings` `{ journalMode?: 'wal' | 'delete' | 'truncate' | 'persist', lockingMode?: 'normal' | 'exclusive', busyTimeoutMs?, synchronous?: 'off' | 'normal' | 'full' | 'extra', tempStore?: 'default' | 'file' | 'memory' }`; missing fields come from `sqliteSettings.localDisk` (WAL, normal locking, 5 s busy timeout, full sync: the behaviour before settings existed). `sqliteSettings.networkFilesystem` is for one process owning a file on NFS such as EFS: rollback journal, `exclusive` locking with the lock taken at open, 10 s busy timeout, full sync, temporary tables in memory; another connection to that file fails with `SqliteLockedError` (`code: 'sqlite-locked'`) after its busy timeout. Names and values are allow-listed (`TypeError` otherwise, before the file is opened); there is no free-form pragma. The settings live in `@hachej/boring-files/sqlite-settings` (pure, browser-safe; `sqlitePragmas(settings)` is what the browser's SQLite Wasm uses), and `npm run check` refuses `PRAGMA journal_mode`/`locking_mode` assignments anywhere else. The journal, the metering ledger and the SQLite file system borrow a connection and never set pragmas.

`@hachej/boring-files/sqlite-filesystem` exports `openSqliteFileSystem({ connection, workspace, cwd })`: a Pi `FileSystem` whose regular files and directories are rows of one workspace in a `SqliteConnection` (`openNodeConnection`, `durableObjectSqliteConnection`, or `openBrowserSqliteConnection` from `@hachej/boring-browser/sqlite`), with the `incarnation` of those rows. Like Pi's `NodeExecutionEnv` (which Pi's `write` tool relies on), `writeFile` creates missing parent directories; a parent that is a file still fails. Given to `createWorkspaceProvider` it is the SQLite workspace backend ([One place for files](../../docs/architecture/FILES-GIT-EXEC.md#one-place-for-files)): multi-file conditional batches commit in one transaction, together with the receipt when the journal uses the same connection. It implements Pi 1.1's full `FileSystem` (positional readers whose `scanLines` is Pi's own `LineScanner`, paged directory readers, and a polling `watch`) and answers with Pi's own `FileError`s, so this entry loads `@earendil-works/pi-durable/env` (Pi's portable contracts, no engine): install `@earendil-works/pi-durable` with it. The other entries of this package do not need Pi.

See [scaffold guide](../../docs/contracts/SCAFFOLD.md) and [resource design](../../docs/architecture/FILES-GIT-EXEC.md).

## Node hosts

`@hachej/boring-files/node-http` bridges `node:http` to the Fetch handlers of these packages: `webRequest(incoming, url, { signal, maxBytes })` reads the body first under a byte cap (never `Readable.toWeb` on a live request, whose cancellation kills the process) and `sendWebResponse(response, outgoing, { signal })` flushes the headers at once, keeps each `set-cookie`, waits for `drain` when the socket is full and cancels the web body when the client disconnects. The example servers use it; `npm run check` refuses hand-written response copies under `examples/`.

## Optional authenticated resource transport

`@hachej/boring-files/remote` exports `createResourceClient` and `createResourceHandler`. Both are Fetch adapters over the existing resource contracts. They import no Pi runtime, filesystem or database. The client implements `ResourceClient`; `publication: true` and `reconciliation: true` independently select its optional methods. The handler borrows a reader, optional publisher and optional lookup. It never closes them.

```ts
const handler = createResourceHandler({
  authenticate: request => host.authenticateResourceRequest(request),
  reader: provider,
  publisher: provider.publication,
  lookup: provider.reconciliation,
});
const client = createResourceClient({
  identity: { principalId, scopeId, initiatorId },
  endpoint: 'https://example.invalid/resources',
  fetch: authenticatedFetch,
  publication: true,
  reconciliation: true,
});
```

`publication: true` requires `reconciliation: true` (types and constructor): a save whose acknowledgement is lost is `unknown`, and only a lookup can resolve it. A read-only client sets neither.

Authentication returns trusted `ResourceAccess` or null. Its optional signal represents host revocation; the handler combines it with request cancellation. Client identity is expected response metadata, never authority. The host owns credentials, origin/CSRF/CORS policy, endpoint routing and provider confinement. The injected Fetch must honor `redirect: 'error'`, preserve cancellation and never retry effects. Bind a handler to the host's selected provider capabilities. Browser JSON cannot grant access or supply a trusted digest or approval.

The private versioned JSON envelope captures publication bytes before any asynchronous work. Protocol version 2 carries bytes as canonical base64 text (version 1 integer arrays are refused). Default limits are 4 MiB per serialized request and 8 MiB per serialized response, configurable up to 64 MiB. Incoming bodies use a bounded growing buffer. These are accepted-message limits, not limits on Fetch allocation, provider output, local request capture, JSON expansion or digest memory. Hosts must bound their trusted inputs and provider production separately.

All-or-nothing receipts must match the captured operation, canonical digest, actor and complete target transitions. Receipt order is preserved but does not determine association. Per-change requests are refused before dispatch; partial acknowledgements are unqualified and become unknown. A real partial provider must establish its receipt convention before that transport guarantee is added.

Transport errors, mismatched or oversized acknowledgements and aborted observation produce unknown publication/lookup outcomes. They never manufacture a known-no-commit denial or provider not-found, and never trigger replay. Read transport failures produce unavailable. Lookup checks operation and actor association; the caller still checks the digest and transitions against its captured original attempt. An operation ID alone cannot establish those arguments. Not-found does not authorize replay.

Revocation suppresses disclosure until the handler constructs its response; already delivered bytes cannot be retracted. Aborting observation does not prove provider termination, rollback or an atomic revocation fence. Provider exceptions and response serialization failures may follow a commit, so the client retains uncertainty. The workspace provider's declared guarantees remain unchanged.

Run `node examples/resource-transport.mjs` for a fictional exact-save and lookup journey through real Request/Response objects. Public-output tests also compose a native ToolTask and lost-acknowledgement Markdown reconciliation. The isolated document consumer exercises this adapter with strict types and a browser bundle without Pi, agent or React installed. These checks do not qualify deployed HTTP, browser identity policy or remote provider lifecycle.

`@hachej/boring-files/text` supplies the shared pure `applyTextEdits` transform and input parser. Edits run in order, require unique nonempty exact matches and preserve untouched whitespace. A failed edit refuses the whole transformation. It performs no I/O and grants no permission.

## Optional working Git

`@hachej/boring-files/git` requires pinned `isomorphic-git@1.42.6`. `createGitRepository` borrows its public `PromiseFsClient`, an absolute normalized directory, a host author and a current `authorize(operation)` callback. The callback grants the bound caller access to the entire selected repository, including worktree and metadata. Only exact `true` grants access. It runs after queue acquisition and again before returning results. Share one repository instance across callers. Its queue serializes those calls only; other instances, raw filesystem writers and aliases require underlying host policy. Relative argument validation does not confine an unrestricted filesystem or symlink targets.

`createEnvGitFs(fileSystem, context)` is the `PromiseFsClient` over a Pi `FileSystem` (an `ExecutionEnv`'s files): every Git read and write goes through that environment, so its confinement applies to Git too. Files read as mode `0o100644` (Pi's file contract has no modes) and symbolic links are refused (`ENOSYS`), never followed.

Methods are `init`, matrix `status`, `add`, index-only `remove`, `commit`, twenty-entry `log`, `branches`, `branch`, `checkout` and `diff`. Diff compares exact tree refs/object IDs, index and worktree. It returns changed blob paths, modes, object IDs and byte arrays, including untracked worktree files. It excludes `.git`, rejects unsupported entry types and reports limit errors without truncated success. Default returned-content limits are 100 files and 1 MiB. Traversal is serial, but upstream can allocate an entire blob before the byte limit is checked. These limits do not bound peak memory or repository traversal cost. Status and worktree diff disable native index refresh.

The host owns filesystem confinement, credentials and disposal. No network transport is installed. Cancellation is checked around native operations and during diff traversal; it cannot roll back Git mutations. `GitOperationError.effects` distinguishes pre-execution refusal from possible prior mutation. Git operations have no durable operation receipts, conditional publication or crash recovery guarantee.


### Local publication preparation failures

`PublicationNotDispatchedError` from `@hachej/boring-files/publication` identifies a valid publication request that the remote client could not dispatch. Its `operationId` identifies that invocation. Local byte-limit, unsupported atomicity, digest, request-construction and pre-dispatch cancellation failures use this error. The error does not establish the outcome of earlier attempts with the same operation ID. Retain and reconcile any earlier uncertain attempt.

Once the fetch callback is called, transport exceptions, HTTP errors and invalid acknowledgements remain `unknown`, including a callback that throws the same error class after committing. A lookup `not-found` still does not prove that an interrupted request had no effect. The text controllers use the typed error only for their freshly generated operation, releasing that attempt so the user can save a corrected draft.

SQLite reads and receipt lookups of the SQLite workspace backend use deferred read transactions; a conditional write keeps its `BEGIN IMMEDIATE` transaction for its files and receipt. Tests hold an independent WAL writer transaction and read the previous committed file and receipt through the provider. This qualifies that WAL contention case; opening the database and arbitrary SQLite locking modes can still require write access or wait.

## Migrating from the removed resource store

The SQLite resource store of `@hachej/boring-files/sqlite` (`openSqliteResources`, `SqliteResourceProvider` and its option types) is
removed. Its documents become files of a workspace; `SqliteConnection` and `openNodeConnection` stay in `@hachej/boring-files/sqlite`.
A host that kept one store with rows per scope (the redaction and current-hub fixtures here) opens one SQLite-backed workspace per
scope in the same database:

| Old call | New call |
| --- | --- |
| `openSqliteResources({ filename, providerId, authorize })` | `connection = openNodeConnection(filename)`, `journal = createWorkspaceJournal(connection)`, then per scope `fs = openSqliteFileSystem({ connection, workspace: scopeId, cwd: '/workspace' })` and `createWorkspaceProvider({ identity: { providerId, instanceId: scopeId, incarnation: fs.incarnation, viewId: 'published' }, fs, journal })` |
| `openSqliteResources({ connection, ... })` (a Durable Object) | the same calls with `durableObjectSqliteConnection(ctx.storage)` from `@hachej/boring-files/sqlite-durable-object` |
| `authorize(action, target, access)` inside the store | the host checks its policy before calling the workspace's provider; [`examples/shared/sqlite-workspaces.mjs`](../../examples/shared/sqlite-workspaces.mjs) shows one way (a refused write whose operation committed and a refused lookup read `unknown`) |
| `provider.close()` | `connection.close()` by the connection's owner |
| a `delete` change | the workspace's own file tools (`fs.remove`, Pi's `bash`); publication refuses deletes |
| revisions were random ids; saving the same bytes made a new revision | revisions are Git blob ids: the same bytes keep their revision, and `before` equal to `after` is a valid committed change |
| every revision retained | the last 20 versions per file (`createWorkspaceJournal(connection, { historyLimit })`); older ones read `unavailable` |

Existing store databases are not migrated: their `boring_documents` rows are not read by the workspace backend. Copy each current
document into its workspace with a create, or start from the files.

## Frontend revision provider

`@hachej/boring-files/revision-handler` serves an existing workspace provider. The
host resolves its OAuth session and selected workspace on every request:

```ts
const handleFiles = createRevisionHandler({
  resolve: async request => {
    const session = await authenticate(request);
    if (!session) return null;
    return {
      provider: workspaces.workspace(session.workspaceId),
      access: {
        principalId: session.userId,
        scopeId: session.workspaceId,
        initiatorId: session.userId,
      },
    };
  },
});
```

`authenticate` and `workspaces` are host objects. Import `createRevisionHandler`
from `@hachej/boring-files/revision-handler`. If acquisition returns a lease,
include `release`; the handler retains it until underlying operations settle,
including after request cancellation.

In the browser, import `connectRevisionProvider` from
`@hachej/boring-files/revision` and connect once per selected workspace:

```ts
const revisionProvider = await connectRevisionProvider({
  endpoint: new URL('/api/workspace', location.origin),
  fetch: request => fetch(request),
});
```

The binding discovers identity and workspace incarnation from the authenticated
server. Reconnect when the selected workspace changes. It exposes `list`,
filename `search`, retained `history`, `locate`, `read`, `publish` and `lookup`.
All writes use conditional publication; uploading a new file requires absence,
and replacing one requires its exact resource revision. An unknown result must
be reconciled by operation ID before another upload to that path.

Catalog defaults hide Git-ignored files, dependency/build folders and internal
metadata. Configure `createWorkspaceProvider({ ..., catalog: { defaults: false,
filter: entry => ... } })` to override them. Filters govern presentation, not
access control. The host authorizes the whole selected workspace. Listings do
not follow symlinks. Pagination is a live, lexical view, not a frozen snapshot;
refresh after concurrent changes. Traversal over the configured `maxEntries`
(default 100,000) fails explicitly. History contains revisions retained by the
workspace journal, not Git commits or an imported filesystem's prior history.

The existing resource transport limits still apply: requests default to 4 MiB
and responses to 8 MiB, including their serialized envelope. This API does not
provide streaming uploads.
