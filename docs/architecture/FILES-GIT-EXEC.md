# Working environments, resources and execution

Decision: keep agent execution independent of files, and compose working files/shell coherently when present. Reuse native Pi filesystem/environment contracts; Boring adds resource revision/publication meaning and provider integration, not a second generic filesystem or command API. [SPEC.md](SPEC.md) owns architecture; [BORING-PI-5..6](../../INVARIANTS.md) own the laws; [PI-COMPLEMENT.md](PI-COMPLEMENT.md) applies them to remote coding, embedded background work and an assistant beside an app.

## Two contracts, one deliberate composition

The pinned [Pi environment export](https://github.com/earendil-works/pi/blob/0495646a8322ff99ce40ac2f9e15f1f49f56bb11/packages/durable/src/env/index.ts) provides FileSystem, Shell and ExecutionEnv combining both. It already covers namespace/cwd/path semantics, text/binary operations, metadata, command output/context and cleanup. Preserve its result/error semantics and supported options in adapters instead of inventing equivalent Boring methods.

| Contract | Purpose | Does not imply |
| --- | --- | --- |
| Native FileSystem/Shell/ExecutionEnv | Working files, tools, installs, builds/tests and command execution against an assigned namespace | Approved document mutation, exact historical reads or atomic resource receipts |
| Boring resource/publication provider | Stable resource identity, selected revision, conditional authoritative writes and qualified evidence | POSIX completeness, a shell, a mounted workspace or another agent runtime |

A simple editor may write directly through a conditional resource provider. A coding task may derive a workspace, modify it, then publish a reviewed change. The contracts share physical storage: a document and its working file are one path in one workspace (see [One place for files](#one-place-for-files)); do not force a second authoritative store, a mirror or a duplicate checkout. A resource read is not implemented by shelling out to `cat`.

File-only agent tools close over their selected provider and use native registration; no dummy shell is needed. The Pi environment hook expects its native ExecutionEnv when used, not an arbitrary incomplete object. Stock native coding tools can operate on qualified working/staging environments. For authoritative resources, use explicit admitted conditional operations; a blind write adapter cannot honestly promise revision-checked publication.

## One place for files

### Frontend file browsing

The frontend binds one `revisionProvider` for listing, filename search, uploads,
history and viewer reads and writes. The host authenticates the request and selects
the permitted workspace; the library handles the file operations. The binding
names the provider, workspace instance, incarnation and view. A request for an old
binding must not operate on a newly selected workspace.

The catalog uses the same native filesystem and journal as conditional publication.
Listing and mention search share a default filter for Git-ignored files, dependency
and build folders, and internal metadata. Hosts may override presentation filtering;
filtering grants no access. Authentication and workspace selection protect catalog
and history requests as well as content reads and publications.

Every frontend mutation, including binary upload, uses the publication contract.
A duplicate upload name is a conflict. An unconfirmed upload keeps its operation
identity for reconciliation and must not be retried under a different name.
Historical viewing reads an exact retained revision without replacing a dirty
editor buffer. Closing a file tree does not close its borrowed provider.

### Workspace ownership

Scope: one person and their agent per workspace now (one harness may serve many such workspaces, see [Workspace per call](#workspace-per-call)); several people and agents on one file later (a separate design). Access control is at the workspace boundary (the host); there are no per-file permissions inside a workspace. The migration to this model is done: there is no other resource store. Still pending: the AWS reference deployment (files PR 7: ECS + EFS + AgentCore, proven by a journey against a disposable deployment; see [HOST-RECIPE-AWS.md](HOST-RECIPE-AWS.md)).

Every file lives in a workspace: a Pi `FileSystem`, plus exec when there is a shell. Every access (agent tools, file tree, editor saves, delivery, outside any agent turn) goes through that workspace's single provider instance. The one safe way to write is the workspace provider's conditional write (expected revision, operation id, lookup, history); "published" is a mode of writing, not a location. Hosts differ only in where bytes live: disk/EFS, a remote sandbox, or SQLite. A remote sandbox's `bash` writes to its own disk, so only the workspace's own `FileSystem` sees every write without a sync adapter. Guarantees belong to the contract (`ResourceProvider`, `PublicationRequest`, `ProviderGuarantees`), not to a store, so viewers, the text buffer and the transport do not change.

`@hachej/boring-files/workspace` exports `createWorkspaceProvider({ identity, fs, journal })`: a `ResourceProvider` with `publication` and `reconciliation` over a Pi `FileSystem`, plus the workspace mutation queue. There is no Boring FileSystem facade. The provider refuses an environment without a host-supplied identity.

- **Identity.** Pi's environment `id` is a namespace (every local Node environment reports `node:local`), not an incarnation. Keys use the host's `WorkspaceIdentity` (provider, instance, incarnation, view) plus the canonical path. The incarnation belongs to persistent storage (the EFS directory, the SQLite database), not to a replaceable exec session; a recreated directory gets a new one and older receipts then read as `unknown`.
- **Revision** is the Git blob id of the bytes, computed without Git. Reads and polling hash the bytes they return; saves rehash inside the queue. No mtime/size cache unless measurement shows hashing is too slow, and then never on whole-second mtimes. A save that changes nothing keeps its revision, so `before` equal to `after` is valid in the shared publication parser, delivery reconciliation and the text buffer. Operation id and digest checks stay. The ABA case (X to Y to X) loses no content and is accepted.
- **One mutation queue per workspace**, ours on public APIs (an upstream Pi conditional-write API would be welcome but is not required), serializes provider writes and whole native `read`/`write`/`edit` calls. Shell commands are not queued. Accepted residual risk: a shell write landing between a conditional write's check and its rename can be lost.
- **Conditional write.** Record the intent in the journal. Inside the queue, check every target's expected revision and every publication precondition; any mismatch refuses with `conflict` and nothing is written. Then write each target to a temp file, `renameFile` it into place, record history and mark the operation complete.
- **Atomicity.** A single-file `all-or-nothing` request is accepted when the backend replaces atomically (temp file + rename). Multi-file batches are accepted only by the SQLite backend; anything else is rejected before any effect. There is no in-place `writeFile` fallback claiming atomicity.
- **Change events.** Provider writes emit change events; shell writes are found by polling revisions of watched paths.
- **Scopes.** A host that keeps several scopes in one database (the redaction and current-hub fixtures) opens one SQLite-backed workspace per scope (`openSqliteFileSystem` with the scope as workspace name, `createWorkspaceProvider` with the scope as instance), with the journal in the same database keyed by each workspace's identity. Its access policy is checked at that workspace boundary before the provider is called ([`examples/shared/sqlite-workspaces.mjs`](../../examples/shared/sqlite-workspaces.mjs)): a refused write whose operation committed, and a lookup the policy no longer permits, read `unknown`.
- **Journal and history.** The journal holds receipts of conditional writes only, in host-owned storage outside the workspace (the agent's `bash` could forge receipts inside it). An intent without a completion stays `unknown`: never reported committed, never replayed automatically. The editor offers an explicit "abandon reconciliation and refresh, keeping my draft" action. Nothing is inferred from file contents. Without Git history, the last 20 versions per file are kept (configurable); unretained revisions read as `unavailable`, never substituted. Receipts are kept.

| Backend | Atomic single file | Multi-file batch | Bytes + receipt together |
| --- | --- | --- | --- |
| Disk / EFS | Yes (rename) | Rejected | No: a crash between rename and completion reads `unknown` |
| Remote sandbox | Only if its `renameFile` is atomic; otherwise rejected | Rejected | No; sandbox expiry reads `unknown` |
| SQLite (new work) | Yes | Yes | Yes: one transaction |

Agent tools keep only Pi's native `read`, `write`, `edit` and `bash`, with the first three wrapped in the agent package by Pi's public `wrapTool` (`@earendil-works/pi-durable`): an existing file must have been read before it is overwritten or edited and its current revision must equal the last-read revision, otherwise the tool gets a native `FileError`; creating is allowed only while the file is absent. The baseline per conversation and path lives in Pi conversation state keyed by workspace identity. Agent writes are working writes and are observed, never receipted (owner ruling, 2026-10-10): a Pi `write`/`edit` produces a history entry with source `'agent'` plus a change event; `bash` produces a change event only (invalidation, no history), found by polling revisions of watched paths or by a watcher, as in "shell writes are found by polling" under Change events above. Agent writes never enter the publication journal and never mint receipts; change events are invalidation hints, while bytes and the journal stay authoritative. Artifacts are files: one native `present(path)` tool, versions are the file's history. Cloudflare runs the virtual just-bash workspace over the SQLite backend, never a FileSystem-only environment or a dummy shell; AWS uses EFS with one writer task per workspace and the journal outside the mount.

### Workspace per call

The workspace is resolved per call, like Pi's environment ([`HarnessOptions.env(target, context)`](https://github.com/earendil-works/pi/blob/0495646a8322ff99ce40ac2f9e15f1f49f56bb11/packages/durable/test/examples/29-sandbox-per-conversation.ts): same inputs, same timing, same lifecycle), so one harness serves several people. `@hachej/boring-agent/workspaces` owns the shape:

- **One host function.** The workspace comes with the env: the host's `HarnessOptions.env` returns an env with its binding attached (`withWorkspace(env, binding)`, done by every `createWorkspaceCache` entry), and a tool created without a `workspace` option (the guard, `present`, the canvas tools, `working_git`; the standard agent's `workspace: 'env'`) uses the binding of the env Pi handed its call (`workspaceOfEnv(api.env)`). A host never wires a second lookup; a fixed workspace is still one constant (`constantWorkspace`, or `withWorkspace` on the one env). The binding carries what belongs to the workspace: its provider, root, agent access, and optionally its git `repository`.

- **Resolver.** A `WorkspaceResolver` has the shape of `env`: `(target, context)` returns the binding `{ id, files, root, env?, access? }` of that call, or `undefined` (no workspace). The file guard, `present` and the canvas tools take it instead of a provider; a single-workspace host passes the binding itself (wrapped as `constantWorkspace`). The target is what Pi passes to `env` (conversation, agent `cwd`, committed reads); which owner a conversation belongs to is host data, typically read from durable conversation state, and a subagent's child uses the workspace of the conversation that owns it (`rootConversation`).
- **Coherence.** The env Pi hands a call and the provider a tool resolves must be one workspace instance. `createWorkspaceCache({ key, open, idleMs, busy })` keeps both in one entry per key: `cache.env` goes to the harness, `cache.workspace` to the tools, and a binding names its env, so a tool refuses (never writes through) a call whose `api.env` is another instance.
- **Lifecycle.** The cache owns what `open` returns: one provider instance per key, opened on first use and closed after `idleMs` with no lease and nothing `busy` (Pi does not report when a call stops using its env, so a host answers `busy` for long calls). Viewer and HTTP routes borrow by key after authentication (`acquire`, `release`); releasing never closes, so closing a viewer never disposes a provider a call or another viewer uses.
- **Baselines** are keyed by workspace identity and path in the conversation document; a conversation's workspace is fixed by its owner.
- **Credentials.** A `CredentialResolver` `(target, context, { tool, server? })` returns the secret of the person behind a call at execute time; tools keep it in memory only (never conversation state, results or logs). The MCP recipe connects lazily per credential with a cache and idle close.
- **Self-evolution and git per workspace.** `.agent/` is read through the call's env, and a self-evolving agent defined without a fixed workspace gives each workspace its own extension (`agent.inWorkspace(name)`, `self-evolving:<name>`, installed in the one registry when the workspace opens); a conversation created in a workspace selects only that extension, so one workspace's agent-written tools are never offered to another's. `working_git` uses the binding's repository (`createEnvGitFs` runs isomorphic-git over the workspace's own Pi `FileSystem`, so Git is confined like every file tool).
- **Viewer and HTTP routes** (file tree, file viewer, resources, uploads, mentions, `/reload`, the Git tab) borrow the authenticated person's workspace by key (`acquire`) and use the same binding.
- **One harness per owner** (`@hachej/boring-agent/harness-pool`) is the alternative when each owner needs its own storage file (single-writer SQLite, an AgentCore session per key) or crash isolation: owners never share a harness, a lease or a streaming response keeps one open, and an idle one with no live work closes. Choose one harness with per-call resolution otherwise (one storage, one scheduler, one recovery pass).

## Internal capability boundaries

These compose; the rows are not runtime modes or independent copies.

| Capability | Depends on | Does not require |
| --- | --- | --- |
| Custom domain tools | Host's native tool registration and authorized domain services | Files, Bash, sandbox or Boring workflow |
| Published resource read/edit | Qualified resource provider and current host policy | Native exec, a chat or a working checkout |
| Working file tools | Appropriate native FileSystem/provider binding | A new Boring filesystem engine |
| Virtual Git | isomorphic-git-compatible facade over the selected working view | Native git binary or OS process |
| Virtual Bash | just-bash plus the same selected view/custom commands | Native Linux execution |
| Viewer controls/page commands | Injected resource access and bound presentation instance | Kernel imports, shell or mandatory workbench |
| Optional code mode | Upstream pi-codemode and native tool registration | Files, exec or a new interpreter |
| Remote commands | Qualified provider's native Shell/ExecutionEnv binding | Replacing all other tool/resource contracts |

## Filesystem capabilities and server directories

Files and agents coexist or work independently. Multiple logical mounts may use different providers. Distinguish support, grants, availability and guarantees; do not compress them into one `write` or `exec` flag.

| Declaration | Meaning | Owner |
| --- | --- | --- |
| Support | Implemented resource operations: read/list/search/create/write/delete/move/mkdir/upload/history/diff, optional watch/binary access | Provider implementation |
| Effective access | What this authenticated actor/task may do to this target now | Host policy plus provider enforcement |
| Availability | Whether the selected provider instance/view can currently serve it | Provider observation, with freshness |
| Guarantees | Qualified pinned history, conditional commit, atomic batches/receipts, duplicate lookup, confinement and revocation fencing | Provider conformance |
| Execution binding | Separately granted commands and their workspace, mounts, egress, credentials and limits | Host and execution provider |

Expose a trusted authenticated catalog of logical identity, label/root, support, effective operations, availability and guarantee metadata. Tools/controls reflect support intersected with grants and availability. Discovery is not a grant token: recheck every call and required commit-time conditions, including narrower path policies. Missing catalog data cannot invent a writable primary workspace. Historical inspection cannot become a live write by changing a label. Provider substitution must preserve required guarantees or explicitly refuse that composition; a method name is not proof.

Adapt v2's operation-derived catalog and source-to-port details in [LEGACY-UI.md](../compatibility/LEGACY-UI.md). Do not add another permission engine. A resource provider may support useful reads/working writes while remaining unqualified for strong publication; disclose that limitation without disabling unrelated access or making false guarantees.

Ship a scoped Node server-directory resource adapter, with read-only references and writable documents and no native exec. The host selects real roots; public resource IDs use logical mounts. Reuse applicable native I/O or reviewed confinement/watcher code, but enforce actual root/symlink policy, binary fidelity, external-change behavior and claimed conditional writes/receipts. Trusted adapter I/O does not grant ambient Node or shell to the model. Retain v2's shared-watcher/disposal and combined content/metadata performance lessons; a combined method is only a consistent snapshot when its implementation proves that. Legacy mtime or advisory `fsCapability` labels are not transaction evidence.

When a shell is installed, enforce mount restrictions at the OS/container/provider too. A readonly RPC wrapper cannot constrain an unrestricted shell or writable alias. File tools and commands must address the same namespace/path mapping; do not pair a server directory with an unrelated remote sandbox. Git mutation restrictions also cover raw `.git` writes through any exposed interface. This qualification concerns the complete exposure, not just the visible tool list.

### Independent acquisition and resource capabilities

WorkspaceProvider accepts host-chosen typed input rather than requiring every Git commit, image or local directory to be a Boring ResourceRef. RecoverableWorkspaceProvider separately requires reattachment; ephemeral acquisitions need no dummy method. EnvironmentFactory aliases the full native HarnessOptions.env signature. Read environment.id for native namespace identity; an independently assignable duplicate namespaceId is not proof of pairing. Provider-scoped opaque resource view IDs resolve through the provider to the actual backing/incarnation and must not be reused for different views.

ResourcePublisher and PublicationLookup are separate capabilities. All-or-nothing publication cannot silently degrade, and a missing lookup record cannot prove that a timed-out write had no effect. Authority and canonical digest computation happen after trusted capture/validation, outside the caller payload. These type distinctions do not qualify a provider by themselves.

## Workspace identity, views and lifecycle

Acquire the provider once and expose narrow filesystem/shell/observation interfaces over that acquisition. A remote lifecycle adapter adds only what native FileSystem/Shell does not express: provisioning, durable instance/reattachment, expiry/disposal and optional port exposure. It does not duplicate exec's native argument/result vocabulary. Provider-specific useful options remain available through explicit host configuration/public provider access; a convenience recipe cannot silently erase them.

Preserve native FileSystem.id meaning: equal namespaces see the same files at the same paths, irrespective of cwd. That ID is not a security grant or a substitute for resource revision and view selection. Associate existing references with provider/resource identity, selected published revision or working view, provider incarnation where needed, and access scope. A reopened machine at the same `/workspace` path is not necessarily the previous instance. Viewers/caches must not key solely by path.

An expert can read published R while two tasks use private overlays A and B. Interfaces within A agree; A does not expose unfinished B writes. A native working filesystem need not be permanently snapshotted, but workflows claiming reproducible inputs must use a real snapshot. Refresh keeps the old attempt/dependencies/proposal and starts a new attempt. Copy-on-write over a changing lower layer does not prove immutable input; an in-memory overlay does not prove crash durability.

Ownership is explicit for Harness, workspace, watchers and presentation subscriptions. Borrowing a view must not transfer disposal authority. On partial acquisition failure, release only newly acquired handles. Closing one consumer releases its own reference; a background task keeps its workspace for its declared lifetime. Durable native task/doc binding supports restart; a process-local map is merely a cache. Reattach to the recorded instance or report missing/expired state; never silently recreate lost work or fall back to the host.

Observations use native Pi views for execution and provider-specific invalidations/watchers for files. Coalesce where useful and resnapshot on gaps. Do not build a second durable event engine or execute writes while rendering an update. Preserve binary/streaming/batched I/O where available instead of requiring one costly remote roundtrip per byte/metadata operation.

### Native capability subsets and concurrent access

A provider may grant native Shell without a filesystem RPC interface. WorkspaceLease and recovery preserve that subset; native ExecutionEnv is required only where the native hook or coding tool contract actually needs both. No dummy filesystem and no new exec contract are introduced.

FileSystem.cwd is mutable. Per-call native facades can share the same acquired backing namespace while retaining their own cwd. Do not implement env(target) by mutating one shared environment object and returning it to concurrent calls; namespace identity does not imply shared current-directory state. Keep resource/provider disposal outside per-call borrowed cleanup.

ResourcePublisher represents its bound commit authority, not a generic distributed transaction coordinator. Atomic publication spanning authorities requires a real supported common transaction or rejection before effects. Otherwise the host composes individual requests and delivery evidence; files does not silently invent a cross-provider commit service. No additional transaction API is required by this clarification.

## Working writes and publication

Isolation is the host's choice of environment (owner ruling, 2026-10-10): a shared-process host uses an isolated worker env (`aws-code-interpreter`, or a remote-shell/remote-files sandbox); local single-user mode may use Pi's `NodeExecutionEnv` with local bash. No "confined Node env" is built, and the file guard still fails closed on its own refusal paths.

Installs, caches, builds and test output use ordinary working-file operations within granted isolation. Record command/tool admission and required logs/evidence, not a domain revision/receipt for every scratch write. A local Git commit describes working repository history, not permission to change an application's authoritative resource or deploy.

Publication is an explicit admitted operation with original input/target versions, stable operation ID, canonical change digest, current authority and the provider's real outcome. Required approval concerns that exact candidate/change. Multi-file atomicity, lost-response lookup and revocation fencing are separate guarantees; preserve partial/unknown outcomes for weaker providers. Native working mutation cannot bypass protected authoritative mounts. A direct human save can use the same resource boundary without manufacturing an agent execution.

A staged publication validates relevant read dependencies as well as targets when the workflow requires them. Include content, directory/search predicates and observed absence at declared invalidation granularity. Rejected changes remain inspectable proposals. Hub M1 additionally requires safe disjoint unchanged-input publication, not coarse whole-repository conflict on every unrelated edit. See [HUB-M1.md](../compatibility/HUB-M1.md#snapshot-dependency-and-refresh-contract-h02).

## Reference publication and recovery

Start the strong document fixture with an existing transactional host provider, or an optional SQLite-backed reference provider storing document bytes, revision and operation outcome together. A hard kill inside the transaction must reveal no committed half; a kill after commit/before acknowledgement must reconcile the original outcome. Do not call an externally visible commit-before-receipt interval atomic. Directory/sandbox access remains useful working access unless separately qualified; it does not inherit these transaction guarantees.

Initially accept one commit authority, nonempty independent changes and explicit expected revision/absence. Reject duplicate/overlapping targets, unsupported cross-authority atomicity and ambiguous per-change dependencies before effects. Capture mutable bytes before digest/admission; validate paths, authority and versioned canonical payload at the boundary. Known incompatible guarantee requirements can fail at construction, but that check cannot substitute for current call/commit authorization. Declarations are claims until backed by named provider/configuration/version evidence. Reuse existing conformance fixtures and fault hooks; do not invent a new test or guarantee-certification service.

A Git publication implementation must prove its actual compare-and-update protocol before claiming equivalent properties. The selected authority must condition the ref update on the head against which dependencies and targets were validated. An API accepting only force:false is not automatically an expected-head CAS. On a competing update, fetch, first reconcile the operation key, revalidate input/target dependencies, then rebuild and retry under a bounded policy. Unrelated disjoint publication requires its own tests; Git working-tool success does not establish it.

A commit trailer alone is untrusted text, not a publication receipt. Operation identity, canonical intent digest, actor/scope and target binding need trusted validation and retained lookup evidence. Lost-response lookup must distinguish a matching operation from a forged/mismatched marker. No marker after one fetch does not prove the original update cannot still complete; use a qualified idempotency/conditional-update protocol or report unknown. History rewriting, visibility, retention and revocation limitations are explicit. Do not add generic distributed transactions to solve a provider limitation.

Git-backed private refs may checkpoint work only when their backing object/ref storage and checkpoint publication are durable and access-controlled. Their name does not provide confidentiality or persistence. A native document records an acknowledged checkpoint only after provider persistence. Restore that exact checkpoint or report its absence; preserve refused proposals under a declared retention policy. Avoid a mandatory full-tree commit after every tool call. Measure checkpoint cost and the loss window; scratch builds need no per-file domain journal.

Record an operation key and recoverable input before external provisioning or command start. Reattach by known workspace identity is insufficient when the successful acquisition reply was lost. Use actual provider idempotency/tagged lookup/reconciliation, or expose unknown/manual action rather than create or run again. Stops and timeouts cannot roll back prior effects.

Retain outcomes/tombstones and input snapshots for the accepted replay/recovery window. Receipt GC cannot turn a duplicate into a fresh effect; expire/reject old request namespaces when necessary. Backups restore data and operation identity coherently. Pending tasks and inspectable proposals keep required inputs. Suspension and idle cleanup use only the selected provider's demonstrated lifecycle and must not delete active or unacknowledged work. Performance and retention measurements qualify the provider, not Pi's scheduler.

## Pi code mode

Included but opt-in: use upstream `@earendil-works/pi-codemode` with ordinary public native tool registration. [UPSTREAM-EXAMPLES.md](UPSTREAM-EXAMPLES.md#code-mode-reuse) identifies the reviewed seam. Pi Durable 1.0.0 does not automatically install that tool. No Boring interpreter, engine service, VM store or new workspace type.

The QuickJS/WASM engine runs bounded JavaScript with injected callbacks, not ambient Node/filesystem/network. For managed resource/domain operations, callbacks reuse the admitted dispatcher and preserve actual tool returns/receipt references. A schema declaration is not validation and script output is not evidence. Working-file callbacks obey their working-view grants and are not falsely labelled published mutations. Host-selected deadlines, memory/output/concurrency limits and cancellation cannot be widened by script options.

Pi persists the outer tool/task, not JavaScript stack/program counter. Cancellation/failure cannot undo prior effects. Interrupted mutating scripts are not automatically replayed: reconcile provider evidence and expose partial/unknown outcomes. Restart-spanning human waits use native tasks, not a promised resumed JavaScript await. Qualify A14/A22 for enabled configurations; code mode is no prerequisite for files, Git, chat or remote coding.

## Virtual filesystem and Bash

Use existing storage implementations and thin compatibility facades, not another filesystem engine or shell interpreter. just-bash, typed file access and optional Git see the same scoped working view. Native filesystem, Bash IFileSystem and Node-style fs.promises are different public contracts; map their methods, errors, bytes and supported link/mode semantics deliberately, without maintaining independent writable copies or permission systems.

Offer seeded ephemeral work for disposable tasks and genuinely durable provider/overlay binding where promised. Virtual Bash initially operates on authorized read/scratch resources; publishing is a separate conditional operation. Declare supported commands, cwd, environment/network policy, budgets and state lifetime. Unsupported commands return explicit unavailable/unsupported results; they never execute natively behind the user's back.

## isomorphic-git

Provide optional `@hachej/boring-files/git`: a Git-compatible fs.promises facade and scoped repository operations without importing execution or starting an agent. Typed native tools and the just-bash `git` custom command call the same service. No native git fallback or complete native-Git parity promise. Status/history/diff can be available while commit/push/ref mutation remain withheld; raw metadata writes obey the same effective restriction.

[Upstream filesystem documentation](https://isomorphic-git.org/docs/en/fs) describes its injected contract. The initial subset remains init/status/status matrix/add/remove/commit/log/branches/checkout and declared tree/index/worktree diff. Exact dependency pin and policy approval precede implementation; research version is 1.42.6. Working-tree and repository metadata belong to the selected view. Serialize conflicting index/ref writers where necessary. For promised durable repository state, qualify interrupted metadata recovery; Git's multi-file steps are not automatically a resource-provider transaction. Disposable scratch can honestly remain disposable instead of acquiring a new journaling service.

[HTTP](https://isomorphic-git.org/docs/en/http) and [auth](https://isomorphic-git.org/docs/en/onAuth) are separately injected for fetch/clone/push. Allowlist destinations/redirects, supply credentials at the trusted request boundary and enforce network/output/size/deadline budgets. No secrets in model output/browser content or implicit public CORS proxy. Unsupported protocols/features, including unimplemented SSH/LFS/native extensions, are explicit. Remote tests use disposable controlled endpoints; local Git needs no network.

## Cloud coding with a remote sandbox

The host chooses a vendor and acquires one workspace, not a mandatory Boring service. Adapt its working file/shell semantics to native Pi public contracts and add only missing lifecycle/identity/port capabilities. Preserve command/cwd/environment/output/cancellation/deadline behavior; bounded streaming/spill evidence must match the published adapter guarantee. Native registration and host publication bindings are separate from a pure provider entry point.

Provision/reattach/status/expiry/dispose have stable identity and recovery semantics. Missing or expired working state cannot be silently replaced. Provider process cancellation is best-effort; distinguish requested stop, acknowledgement and actual termination. Disconnection is not success and cannot roll back already admitted network effects. Suspend/snapshot/resume across human waits is provider-specific and must be qualified before promised.

Builders run installs/tests and publish a reviewed conditional change through host authority. Verifiers additionally require source/test/command/config protection throughout execution, separate writable outputs and no publication capability; before/after hashes alone cannot detect edit-and-restore. Evidence binds the actual candidate/environment/template, not just an asserted commit label. See [Hub H04](../compatibility/HUB-M1.md#verifier-integrity-h04). Native file RPC and shell paths must both preserve those guarantees.

## Feasibility evidence

The recorded standalone probe over just-bash 3.6.0 InMemoryFs and isomorphic-git 1.42.6 passed local repository operations, binary bytes, shared Bash/Git content and in-memory reconstruction with zero native-process calls. [BASELINE.md](../stress-tests/BASELINE.md) and `scripts/probe-vfs-git.mjs` describe its scope. This is not durable storage, adapter authorization, atomic receipt or live remote qualification.

## Proof obligations

Extend existing A21–A24/A35/A36/A40–A47 and native boundary proof slots; no parallel test framework. File/domain/viewer/code-mode workflows with exec absent must work. Same-view direct/Bash/Git/native-shell operations agree where installed; unsupported commands never fall back and `.git` cannot bypass grants. Published content and two private overlays stay distinct. Test stale content/listing/absence, disjoint publication, conflict and interrupted metadata/publication honestly.

Server-directory/catalog tests cover readonly references plus writable documents without exec, missing discovery, scoped caching, path denial/revocation, pinned-history refusal, binary I/O, external writers and watcher cleanup. Provider swaps either preserve required semantics or reject them explicitly; no silent downgrade. Remote tests cover failed/partial acquisition, borrowed/owned cleanup, reattachment versus reincarnation/expiry, uncertain cancellation, independent file/exec grants, real build/test, protected verification inputs, egress and conditional publication. Native parity and the three composed reference applications are distinct from source checks and isolated package demos.

## Current disposable virtual adapter

`@hachej/boring-execution/virtual` now composes a single upstream just-bash 3.6.0 `InMemoryFs` with native file access and independent cwd leases. `@hachej/boring-execution/virtual-git` adapts that selected view to isomorphic-git 1.42.6 and installs a local custom command. These optional entry points do not import an agent implementation. [The package guide](../../packages/execution/README.md) owns the concrete supported operations, lifecycle and explicit refusals.

Public-output tests execute actual native read/write/edit tasks, shared Bash/Git operations, binary and alias paths, independent cleanup and negative fallback controls. The installed tarball consumer repeats them with strict public declarations and enforced dependency resolution. This establishes a disposable working slice. The shared `@hachej/boring-files/git` service now serializes calls through one host-bound repository instance. Native `@hachej/boring-agent/git` ToolTasks and the virtual Bash command use that same instance and whole-repository authorization. Reads disable index refresh; late mutation errors retain possible prior effects. Raw filesystem writers and separate repository instances remain outside this queue. This does not discharge complete exposure authorization, atomic path mutation, durable overlays, native live combined output/spill or remote provider qualification. Those requirements remain unchanged.

## Current borrowed remote Shell adapter

`@hachej/boring-execution/remote-shell` adapts an already acquired native `Shell` through paired Fetch handler/client functions. It uses existing `WorkspaceLease<Shell>` identity and borrowed ownership. It does not provision, replace or reacquire the workspace. [The package guide](../../packages/execution/README.md#borrowed-remote-shell) owns concrete transport limits, host authentication/revocation duties, native option handling and explicit qualifications.

Public tests run actual native commands and a shell-only native ToolTask through Request/Response streams. They exercise identity refusal before effects, current authorization, live combined output, timeout/spill, concurrent cwd capture, uncertain disconnection after a real write, malformed acknowledgements and independent borrowed cleanup. The installed consumer excludes optional virtual/Git and Boring files/UI/agent peers. A frame request ID is correlation only; durable admission, idempotency, vendor lifecycle, full remote coding and protected verifier guarantees remain open. Local socket qualification is unavailable in the current sandbox and is not inferred from Fetch loopback.

## Current borrowed remote FileSystem adapter

`@hachej/boring-execution/remote-files` transports the public native `FileSystem` through paired authenticated Fetch functions. Each request binds a host-provided cwd facade over an already acquired workspace and validates its actual namespace, selected view and incarnation. Native line readers use one stream. The host closes each reader before releasing its facade. [The package guide](../../packages/execution/README.md#borrowed-remote-filesystem) owns concrete methods, limits, cancellation and host duties.

Public-output tests use actual native files and a native ToolTask. They exercise binary and path behavior, concurrent cwd capture, same-namespace Shell agreement, uncertain append acknowledgement, authorization, stale bindings, streamed line fidelity and independent cleanup. The isolated consumer checks strict declarations and excludes Boring files/UI/agent and virtual/Git peers. This is a working-file transport over an existing acquisition. Provider acquisition/reattachment, durable admission/recovery, atomic authorization, full exposure restrictions, socket deployment and protected verification remain required qualifications.
