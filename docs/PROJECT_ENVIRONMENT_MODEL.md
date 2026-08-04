# Project, Environment, Session, and filesystem authority model

> **Status: proposed architecture vocabulary for issue
> [#1056](https://github.com/hachej/boring-ui/issues/1056).**
> This note does not change runtime behavior, authorize implementation, or
> supersede [`DECISIONS.md`](DECISIONS.md). If accepted, a separate decision
> update must identify the exact text it supersedes. Current package contracts
> remain authoritative.

## Purpose

Boring currently uses `Workspace` for several related but different ideas: a
product membership boundary, a project/content root, a filesystem adapter, and
a runtime authorization scope. That overloading is manageable while one
workspace, one root, and one execution environment are 1:1. It becomes unsafe
when the product adds multi-project navigation, local and cloud execution,
named filesystems, or session-specific worktrees.

This note gives each question one answer:

| Question                                             | Concept                        |
| ---------------------------------------------------- | ------------------------------ |
| Whose work and policy is this?                       | Product Workspace              |
| What durable body of work is this?                   | Project                        |
| Where and how may it execute?                        | Environment Definition         |
| Which running incarnation handles effects?           | Environment Lease / generation |
| Which conversation/history is this?                  | Session                        |
| Which data may this actor access now?                | Filesystem Grant               |
| Which authorized data is physically visible to Bash? | Environment Mount              |

The goal is not to add all of these as tables or public types. Some are product
objects, some are runtime authority, and some are relations or values that
remain implicit until a real consumer requires them.

## Model

```text
Product Workspace
└── Project
    ├── Sessions
    └── Environment Definitions
        └── Environment Leases / generations
            ├── primary Workspace/filesystem
            └── optional explicit Environment mounts
```

The normal cardinality is:

```text
Product Workspace 1 ── N Project
Project           1 ── N Session
Project           1 ── N Environment Definition
Environment       1 ── N Lease/generation over time
Session           N ── 1 Project
Session           N ── 0..1 selected Environment Definition before runtime use
```

Current v1 remains workspace-backed: a runtime-backed Agent run resolves an
approved Environment. Listing Projects or Sessions must not require starting or
leasing that Environment. Whether a planning-only Session may defer Environment
selection is an open product decision, not a new public no-runtime mode.

## Definitions

### Product Workspace: ownership and navigation

A Product Workspace is the durable personal or company boundary presented by a
host product such as Seneca. It owns or governs:

- membership and roles;
- shared policy and credentials;
- the visible Project collection;
- company-wide context and Agent availability;
- product navigation and billing concerns.

Example:

```text
Workspace: My Company
├── Project: Boring UI
├── Project: Seneca
└── Project: Healio
```

This is a product-layer concept. In the initial sole-user product it may be an
implicit singleton rather than a new stored object.

### Project: durable work identity

A Project is the durable thing under which Sessions are organized: a product,
codebase, initiative, or canonical content root. It answers “what are we
working on?” rather than “where is it running?”

A Project identity does not depend on:

- an absolute host path;
- a provider or physical machine;
- a live Sandbox or Environment lease;
- a particular Git worktree;
- a named filesystem grant.

A Session may use its CWD as evidence when selecting a Project, but Project
identity is stored explicitly. It is never continuously derived from CWD: paths
move, worktrees have different roots, and identical paths occur in different
runtime scopes.

A monorepo remains one Project. Sessions distinguish subareas through relative
CWD:

```text
Project: Boring UI
├── Session A · cwd packages/agent
└── Session B · cwd packages/workspace
```

Several Git repositories may also remain one Project when they intentionally
live under one canonical product root:

```text
Project: Seneca
├── web/.git
├── desktop/.git
└── infrastructure/.git
```

Repository count does not define Project count.

### Environment Definition: stable execution authority

An Environment Definition is the stable authorized setup in which one Project
can execute. It answers “where and how may this Project run?” It may select or
constrain:

- a provider and placement target;
- the canonical primary Workspace/filesystem;
- toolchain and provisioning fingerprint;
- isolation and network policy;
- secrets and capability admission;
- explicit resources physically realized in the execution view.

An Environment normally belongs to exactly one Project:

```text
Project: Boring UI
├── Environment: Mac development
├── Environment: OVH development
└── Environment: Cloud preview
```

`OVH` is a placement/provider, not one ambient Environment. One OVH host may
run many separately authorized Environment leases:

```text
OVH host
├── Boring UI Environment
├── Seneca Environment
└── Healio Environment
```

Physical co-location never combines their authority.

The Environment definition may be a stable AgentHost/runtime identity rather
than a product database row. The domain requirement is stable identity and
contract separation, not a prescribed persistence schema.

### Environment Lease and generation: running incarnation

An Environment Lease is the replaceable running incarnation of an Environment
Definition. AgentHost/runtime infrastructure owns preparation, fencing,
invalidation, and disposal.

```text
Environment: OVH development
├── generation 41 · disposed
└── generation 42 · active
```

Project and Session history survive lease replacement. A stale generation must
not retain execution authority. Whether a Session can reattach to a replacement
generation depends on canonical-state and continuity guarantees; it is not an
implicit provider fallback.

### Session: Project-owned history, Environment-bound execution

A Session belongs to a Project. It may select one of that Project's Environment
Definitions for runtime-backed work. The association is execution context, not
ownership:

```text
Project: Boring UI
├── Session A → Mac development
├── Session B → OVH development
└── Session C → default Environment not yet leased
```

The Session's CWD is relative to the selected Environment's canonical primary
Workspace. Provider-private roots do not enter prompts, browser DTOs, or
persisted product identity.

Conceptually:

```ts
interface SessionRuntimeBinding {
  environmentRef: string;
  relativeCwd: string;
}
```

Effecting operations must be fenced by the current lease/generation. The
product Session references the stable Environment definition; it is not owned
by the ephemeral lease. Changing Environment after effects is explicit. The
product must choose whether that means fork, validated reattachment, or a
recorded runtime transition before implementing Environment switching.

### Filesystem Resource, policy, and request-scoped grant

A filesystem resource is provider-owned data identity. Policy determines who
may access it. The effective `RuntimeFilesystemBinding` is a request-scoped
grant derived server-side from current authenticated context:

```text
resource + policy + actor + operation
              ↓ authorize now
request-scoped Filesystem Grant
```

A grant includes logical filesystem identity, read/write access, and
installed authoritative operations. It is reauthorized on every operation and
must not become a durable authorization record.

The browser-safe identity inside one authorized scope remains:

```ts
interface UiFileResource {
  filesystem: string;
  path: string;
}
```

That pair is scope-relative. A reference persisted or transported across
Projects must add a trusted scope such as Project or Environment scope. A path
or `{ filesystem, path }` pair alone is not globally unique.

### Environment Mount: separate execution realization

Filesystem access does not grant execution. A named filesystem may be virtual,
remote, filtered, or actor-dependent and have no POSIX realization.

An Environment Mount is a separate provider/runtime decision that makes an
already-authorized resource visible inside Bash at a logical path:

```text
Filesystem Grant       Can file tools access this resource now?
Environment Mount      Is this resource physically visible to commands?
```

Only one direction is valid:

```text
mount requires authorization
```

The reverse is forbidden:

```text
readable  does not imply mounted
writable  does not imply mounted
mounted   does not follow from filesystem identity
```

The primary `user` filesystem is already coherently realized with Bash by the
Workspace+Sandbox pairing invariant. Named filesystems default to file-tools
only. A future mount needs an explicit logical execution path and physical
provider enforcement; this is where sandbox/provider work becomes necessary.

Actor-varying resources cannot be baked into a shared execution namespace. If
one actor can read `company_context` and another cannot, either the resource
stays file-tools-only or they receive separately enforced Environment views.

## Why there is no `ProjectRoot` object now

The Environment already exposes one canonical primary Workspace root. Both of
these provider-private locations can appear to the Agent as `/`:

```text
Mac provider: /Users/example/code/boring-ui
OVH provider: /workspaces/boring-ui
Agent view:   /
```

Session CWD is relative to that root. A first-class `ProjectRoot` would merely
rename a relation that is currently 1:1 and add no capability.

If an active Project later needs another executable repository, add an explicit
Environment resource/mount for that consumer. Do not redefine every Project as
a filesystem and do not infer executable attachments from repositories found
on the same host.

## Filesystems are not Projects

The two axes serve different purposes:

```text
Project navigation
    chooses the durable body of work and Session history

Filesystem selection
    chooses a currently authorized data namespace inside that runtime view
```

Example:

```text
Project: Boring UI
├── Environment primary filesystem: user · readwrite + coherent Bash
├── company_context · readonly file grant, no Bash mount
└── design_reference · readonly file grant, no Bash mount
```

`company_context` is not another Project. Conversely, Boring UI and Seneca are
not named filesystems merely because both repositories exist on OVH.

## MVP compatibility mapping

No broad rename or new table is required to preserve these boundaries:

| Current concept                                                 | MVP interpretation                                                                         |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Current Boring Workspace identity                               | Project/runtime authorization scope; presented as Project in a multi-project product shell |
| Current Workspace root                                          | Default Environment's canonical primary Workspace                                          |
| AgentHost canonical runtime identity + provisioning fingerprint | Environment Definition identity/facts                                                      |
| Environment lease generation                                    | Running incarnation and fencing identity                                                   |
| Sandbox                                                         | Execution realization within the lease                                                     |
| `RuntimeFilesystemBinding`                                      | Request-scoped Filesystem Grant                                                            |
| `{ filesystem, path }`                                          | File identity within the current authorized scope                                          |
| Session CWD                                                     | Path relative to the selected Environment's primary Workspace                              |

For the initial 1:1 product, one current Boring Workspace may remain a fused
aggregate containing one Project and one default Environment configuration.
The UI can show only the Project. Contracts must not treat Project identity as
an interchangeable lease/generation identifier.

## Break conditions

A new stored relation or runtime feature is justified only by a concrete
consumer.

### One Project needs multiple Environments

```text
Project: Boring UI
├── Mac development
└── Cloud preview
```

Add explicit Environment definitions under the Project. Session selection and
continuity policy become visible product behavior.

### One Project needs an additional executable repository

```text
Project: Boring UI
└── OVH Environment
    ├── primary repository → /
    └── authorized dependency repository → /projects/dependency
```

Add an explicit Environment attachment/mount with provider realization and
same-view conformance. Do not infer it from named filesystem access.

### A Session needs a worktree

Prefer a lease whose canonical primary Workspace is the worktree. The Session
continues to belong to the same Project. Do not expose the provider's host path.

### Work genuinely spans independent Projects

Keep one primary Project for Session ownership and attach only the explicitly
authorized resources required for the task. Introduce cross-Project Session
semantics only after a product demonstrates that one-primary-Project is
insufficient.

## Invariants

1. A Session belongs to a Project; it is not owned by an Environment lease.
2. A Project survives Environment replacement, migration, and deletion.
3. A runtime-backed Session uses one selected Environment at a time.
4. Environment changes after effects are explicit and fenced.
5. Session CWD is relative to the canonical primary Workspace.
6. Provider-private roots never become browser or model-visible identity.
7. Physical co-location never implies shared Project or Environment authority.
8. Project sets and executable attachments are declared, never discovered by
   scanning paths or Git repositories.
9. Filesystem grants are request-scoped and reauthorized per operation.
10. Filesystem access never implies Bash, Git, network, secrets, or compute.
11. A named resource enters Bash only through explicit Environment
    realization with matching authorization and provider enforcement.
12. File identity is `{ filesystem, path }` only within its authorized scope;
    cross-scope persistence adds trusted scope identity.
13. Project/session navigation does not acquire an Environment lease.
14. File tools, search, UI, Git, and Bash observe one canonical byte view for
    every filesystem explicitly realized in an Environment.

## Effects on active work

### PR #1000: filesystem data plane

Keep PR #1000 focused on server-authorized filesystem discovery, structured
`{ filesystem, path }` identity, current-operation authorization, and one Files
surface. It does not create Projects, select Environments, or make named
filesystems executable.

### PR #1038: AgentGateway/AgentHost cutover

After PR #1000, preserve request-scoped bindings and structured file identity
through the new HTTP projection. AgentHost owns runtime-scope resolution and
lease lifecycle; it does not become Product Workspace or Project identity.

### Multi-project navigation

The product shell lists Projects and Sessions without booting inactive runtime
views. Opening a Project or runtime-backed Session resolves its Environment.
This is distinct from the Files root selector inside the active Project.

### Executable attachments

Defer until a named consumer needs an additional repository visible to Bash.
That follow-up must define provider realization, Git targeting, revocation,
watch/events, and same-view conformance. It must not expand PR #1000 or the
AgentGateway cutover.

## Open decisions

1. May a planning-only Session defer Environment selection while remaining
   workspace-backed, or is the Project's default Environment assigned at
   creation without acquiring a lease?
2. Does changing Environment after effects fork a Session, perform an explicit
   validated reattachment, or record runtime segments in one history?
3. What name should a future executable secondary resource use:
   Environment mount, executable attachment, or project dependency?
4. When does Product Workspace become explicit instead of an implicit
   sole-user container?
5. Is AgentHost's canonical runtime identity stable across reprovisioning, or
   is a stable Environment Definition identity required above each generation?
