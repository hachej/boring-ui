---
github: https://github.com/hachej/boring-ui/issues/942
issue: 942
state: ready-for-agent
updated: 2026-07-25
flag: not-needed
track: standard
---

# gh-942 readonly paths inside the primary workspace filesystem

## Problem

The runtime can make an entire named filesystem binding `readonly` or
`readwrite`, but it cannot make selected paths inside the primary `user`
filesystem readonly while leaving the rest writable.

The current seams are close but incomplete:

- `RuntimeFilesystemBinding` in
  `packages/agent/src/server/runtime/mode.ts` has one filesystem-wide `access`
  value and `RuntimeFilesystemBindingOperations` has read and optional mutation
  methods plus `rejectMutation`;
- the pre-integration copy in
  `packages/boring-bash/src/agent/runtime/types.ts` has the same contract and
  must remain structurally aligned until that copy is retired;
- primary-workspace HTTP and Agent branches can call `Workspace` directly
  instead of a `user` binding; and
- the UI can hide or disable controls, but it is not an authorization boundary.

Healio PR
[`healio-software/web#178`](https://github.com/healio-software/web/pull/178)
proves the product need with a local Workspace decorator, Fastify hooks, and
Docker mode changes. Those are migration inputs, not a sufficient upstream
security model: they create parallel decisions and mode bits alone do not
constrain every shell.

The required result is one runtime-owned host ceiling for normalized paths in
`user`, composed with request governance into one effective binding. Reads
remain available, permitted sibling mutations remain available, and every
mutation surface uses the provider-owned decision. Omitting the host policy
preserves current behavior.

## Effective path capabilities

A scalar `readonly | readwrite` value cannot describe a directory with a
readonly descendant and writable siblings. Keep `binding.access` only for
whole-binding compatibility and expose an additive path decision:

```ts
export type RuntimeFilesystemCapability =
  | 'read'
  | 'write'
  | 'create-child'
  | 'delete'
  | 'move-from'

export interface RuntimeFilesystemAccessDecision {
  readonly filesystem: string
  readonly normalizedPath: string
  readonly access: 'readonly' | 'readwrite' // compatibility summary only
  readonly capabilities: Readonly<Record<RuntimeFilesystemCapability, boolean>>
}

interface RuntimeFilesystemBindingOperations {
  // Existing methods remain.
  resolveAccess?(descriptor: {
    filesystem: string
    path: string
  }): Promise<RuntimeFilesystemAccessDecision>
}
```

`access` is `readonly` when `write` is false and otherwise `readwrite`; callers
must use the named capability for delete, move, and child creation. In
particular, a mixed ancestor can be writable for its own non-destructive
metadata and permit a new writable sibling while still having `delete: false`
and `move-from: false`.

Capabilities are evaluated over normalized path footprints. Two paths
prefix-intersect when either is equal to, or a complete-segment ancestor of,
the other. `.agents` and `.agents/x` intersect; `.agents` and `.agents-old` do
not.

- `read(path)` is unaffected by this readonly policy.
- `write(path)` covers the target and anything replaced by the write.
- `create-child(parent, childName)` covers the normalized final child and every
  parent component the operation would create. The server must authorize the
  proposed final path; a parent DTO cannot grant an arbitrary future name.
- `delete(path)` covers the entire removed subtree.
- `move-from(path)` covers the entire source subtree.
- rename/move additionally requires a server-side destination authorization
  covering the final destination, newly created parents, and any replacement
  subtree. Destination authority is never inferred from the source capability
  or a stale UI projection.

A mutating footprint is denied if it prefix-intersects a host-readonly prefix,
or if request governance denies it. Consequently deleting or renaming a
writable-looking ancestor that contains a readonly descendant is denied. Moving
that ancestor out is also denied. Creating or editing a sibling whose footprint
does not intersect the readonly prefix remains allowed.

`resolveAccess` is optional for existing named bindings. Its absence means the
existing whole-binding `access` applies. The final composed `user` binding added
by this issue always implements it.

## Canonical host policy

The composition root accepts a host-owned list of readonly, workspace-relative
paths. It passes the list to the provider adapter that constructs the Workspace,
Operations, Sandbox, and bindings; routes and tools do not receive raw policy
paths.

For each entry the adapter:

1. accepts only the relative syntax supported by that Workspace provider;
2. normalizes separators and `.` components once;
3. rejects empty, absolute, NUL-containing, and escaping `..` paths;
4. removes trailing separators and duplicate entries;
5. collapses readonly descendants already covered by an ancestor; and
6. freezes the normalized prefixes and includes their revision in runtime
   identity.

Matching uses complete path segments. The policy list is host-private and is
never serialized to Browser or Agent clients.

The provider remains the path and symlink authority. Lexical containment,
provider-specific realpath/symlink handling, nonexistent-target handling, and
policy evaluation happen within its mutation implementation as described
below. No route, tool, or React component compares raw policy strings or
resolves a host path.

## Exactly one effective `user` binding after #939

This work's request-scoped binding and cache integration is blocked on #939.
After #939 lands, its final composition step must merge:

1. the host path ceiling and provider operations; and
2. the request-scoped governance binding/grant

into exactly one effective `filesystem: "user"` binding. The resulting grant is
the intersection of the two inputs:

```text
effective capability(path, operation) =
  host capability(path, operation)
  AND governance binding-wide access
  AND governance path capability when supplied
```

A governance binding with `access: "readonly"` therefore remains readonly for
every path and cannot be broadened by a host `readwrite` summary. Conversely, a
governance `readwrite` grant cannot punch through a host readonly prefix. The
final binding's scalar `access` is `readonly` if either input is binding-wide
readonly; otherwise it is the compatibility `readwrite` summary and callers use
`resolveAccess` for path operations.

Composition validates binding identifiers generically, before dispatch:

- duplicate filesystem identifiers within either input collection are rejected;
- duplicate output identifiers are rejected;
- the intentional host/governance `user` pair is consumed by the merge and
  emits one output entry; and
- routes and tools receive the validated map/unique binding, never use
  `find(...)`, first-match selection, or a special unguarded `user` branch.

#942 must not add a second interim request registry or cache scheme before #939.
Policy revision and the #939 request/runtime identity together key cache reuse;
a policy change creates/reacquires a runtime rather than mutating an in-flight
binding.

## Authoritative mutation boundary and TOCTOU model

`resolveAccess` is projection and preflight only. The authoritative check must
be inside the provider-owned mutation implementation and its critical section,
not in a decorator that checks and then delegates to an unguarded Workspace.
For each mutation, the provider:

1. enters the same provider lock/transaction/descriptor-based critical section
   used to make that mutation safe;
2. resolves and validates every existing and nonexistent component according to
   that provider's confinement rules;
3. computes all affected source, destination, replacement, and implicit-parent
   footprints;
4. evaluates the frozen effective binding capabilities; and
5. performs the mutation before releasing that boundary.

If a provider cannot combine authorization and effect atomically enough to stop
path substitution, it does not claim conformance until it adds serialization or
safe descriptor primitives. Checking in a route and then calling an unrelated
unguarded Workspace is not conforming.

The bounded application-level threat model covers concurrent requests and tools
using the same provider, including rename/symlink substitution races. It does
not claim to stop an independent host process, direct mount writer, or shell in
`operations` mode. Those require the shell boundary below. Tests must state
which adversary is in scope rather than presenting a preflight race test as an
OS isolation proof.

Before implementation, inventory every Workspace re-projection/wrapper and every
mutation entry point (text/binary/write-with-stat, mkdir, unlink/delete, rename,
upload, settings, Operations, plugin-facing Workspace, and provider-specific
variants). Each must either use the guarded provider implementation or be shown
read-only. Keep this inventory as a test table so a later re-projection cannot
silently unwrap the guard.

Race conformance runs competing symlink swaps, source/destination renames,
delete/recreate, replacement, and implicit-parent creation while mutation calls
execute. A denial must have no partial effect, and a permitted sibling operation
must not be spuriously denied.

## Stable typed denial

Export one typed error from the runtime filesystem contract and keep the
pre-integration type copy structurally aligned:

```ts
export class ReadonlyFilesystemMutationError extends Error {
  readonly code = 'readonly' as const
  readonly statusCode = 403 as const
  readonly filesystem: string
  readonly operation: RuntimeFilesystemCapability
}
```

The concrete definition also sets a stable `name` and is recognized at package
boundaries by a narrow type guard on `code`, `statusCode`, `filesystem`, and
`operation`; translation must not depend only on `instanceof`. Paths, host
roots, and policy prefixes are not public error fields.

HTTP serializes every authenticated readonly mutation denial exactly as:

```json
{
  "error": {
    "code": "readonly",
    "message": "user binding is readonly"
  }
}
```

The status is 403. Agent/Operations translation preserves stable code
`readonly` and safe operation metadata in its typed tool error. Missing or
foreign named bindings retain their current non-disclosing behavior and are not
reclassified as authenticated readonly denials. Serialization tests cover the
provider error, cross-package type guard, HTTP body, and Agent error.

## Projections and route response matrix

All projections are derived from the one final binding:

1. **Workspace/provider.** Every inventoried mutation calls the guarded provider
   implementation. Reads are unchanged.
2. **Filesystem binding.** The final `user` binding provides read operations,
   guarded optional mutation operations, and `resolveAccess`.
3. **Operations and Agent tools.** Pi filesystem tools continue through their
   existing factories and Operations adapters, now using the final `user`
   binding rather than a direct bypass.
4. **HTTP.** Routes use the #939 request-scoped effective binding. Route checks
   improve responses but do not replace provider authorization.
5. **Front end.** Components consume server-returned capabilities and never a
   client-side readonly list.

The route contract is additive and explicit:

| Surface | Successful read projection | Mutation/denial behavior |
| --- | --- | --- |
| file JSON read/open | `access` plus capabilities for the requested path | write response stays compatible; provider denial is stable 403 |
| stat | `access` plus capabilities | none |
| tree/list | each entry has its own `access` and capabilities; the listed directory includes its own capabilities where the DTO supports directory metadata | none |
| records/batch read | each returned file record carries its own projection; per-item failures keep the existing batch shape | none |
| raw/download | no JSON projection; set `X-Boring-Filesystem-Access: readonly|readwrite` for the served path | none |
| workspace settings GET | projection describes the settings target | PUT uses the normal provider denial |
| upload, mkdir, write, delete, move | no new success projection required | server recomputes exact target footprints; stable 403 on readonly |

The settings target is `.boring/settings` (not `.boring/settings.json`), including
implicit creation of `.boring`. Raw clients that ignore the additive header and
existing JSON clients that ignore additive fields remain compatible.

The current `readonlySkillFiles` absolute `SKILL.md` read exception is preserved
unchanged by #942. Its absolute paths are checked only by its existing dedicated
allowed-root/realpath confinement and are never normalized as Workspace-relative
host-policy paths, passed to the `user` policy resolver, or treated as user
policy entries. Its response behavior remains compatible. #938 exclusively owns
retiring `readonlySkillFiles` after package skill resources replace that path;
#942 neither removes nor generalizes it. Add regression tests for both the
absolute skill read and rejection outside its allowed roots.

## UI semantics for mixed ancestors

The editor opens a path without `write` in view mode and suppresses autosave.
Tree rename and delete require `move-from` and `delete`, respectively. A mixed
ancestor that contains a readonly descendant therefore shows rename/delete as
disabled even if its `access` summary is `readwrite`. New-file, new-directory,
and upload controls may be offered when the directory is not categorically
closed, but the client submits the proposed name and obeys destination-specific
server authorization. The UI must not treat a parent-level `create-child` value
as authority for every child name.

Keyboard shortcuts, context menus, drag/drop, optimistic save, and upload all
use the same capability meanings. Crafted requests and stale projections still
receive the provider denial. Component tests include a mixed ancestor, a
readonly leaf/subtree, a writable sibling, moving an ancestor that contains a
readonly descendant, and a destination that becomes readonly after projection.

## Shell enforcement

Application operations and shell writes are distinct capabilities. The Sandbox
provider owns and reports the enforcement claim in runtime construction:

- `operations`: guarded Workspace/Operations are enforced; arbitrary shell
  writes are not claimed safe.
- `operations-and-shell`: the provider additionally makes every protected
  prefix non-writable to spawned processes while leaving permitted siblings
  writable.

The runtime bundle carries this provider-owned claim. The Agent tool-composition
owner is the enforcement point for tool availability: when readonly paths exist,
it creates a shell tool only for `operations-and-shell`; for `operations` it
withholds the mutation-capable shell and reports shell unavailable. If a caller
requires strong shell support, runtime creation fails rather than silently
lowering the claim.

The required construction matrix is:

| Host readonly policy | Provider claim | Protected roots at construction | Shell result |
| --- | --- | --- | --- |
| omitted | existing provider mode | n/a | current behavior |
| present | `operations` | existing or nonexistent | filesystem tools allowed; mutation-capable shell withheld |
| present | requested `operations-and-shell`, provider unsupported | any | construction fails closed |
| present | `operations-and-shell` | every protected root exists and provider qualification passes | shell may be exposed |
| present | `operations-and-shell` | any protected root does not exist | construction fails; no unprotected future path |

The existing-root restriction applies only to the strong shell mode; the
operations provider must still deny creation of a configured nonexistent path
and descendants. A later runtime revision may be created after the root exists.
The provider must also reject a strong-mode root whose type/symlink state cannot
be mounted safely.

Local/bubblewrap qualification must demonstrate readonly bind mounts (or an
equivalent provider primitive) for protected roots with a writable surrounding
Workspace. Remote providers must prove an equivalent guarantee. Docker `chmod`
is defense in depth, not `operations-and-shell`, because ownership,
capabilities, replacement, and mount behavior can bypass mode bits. A direct
host shell cannot claim strong mode without an OS-level boundary.

Shell conformance includes redirection, append, temp-file replacement, `mv`,
`rm`, mkdir, and symlink traversal, plus successful reads and writes to a
permitted sibling. The security slice runs dedicated `boring-sandbox`
typecheck/tests and provider integration gates; generic boring-bash tests alone
are insufficient.

## Decisions

1. Use effective path capabilities, not a scalar per-path ACL.
2. Host readonly is a ceiling and binding-wide readonly cannot be broadened.
3. Post-#939 composition emits exactly one effective `user` binding and rejects
   duplicates rather than selecting the first.
4. The provider's mutation critical section is authoritative; projection is not
   a capability.
5. Destructive source footprints include readonly descendants, and moves also
   authorize the complete destination footprint on the server.
6. The typed `readonly` error is the single denial source for HTTP and tools.
7. UI reflects capabilities but never grants them.
8. #942 preserves `readonlySkillFiles`; only #938 retires it.
9. Shell availability is derived from a provider-owned enforcement claim.
10. Omitted configuration preserves legacy primary Workspace behavior.

## Compatibility and rollout

- Existing named binding objects remain compatible because `resolveAccess` is
  optional; existing binding-wide readonly remains restrictive.
- Existing primary consumers with no host policy retain current behavior.
- Additive JSON fields and the raw response header can be ignored by old clients.
- Both runtime binding type copies change in lockstep until their planned
  consolidation.
- No global registry, browser-authored policy, or raw host-path option is added.
- Land contracts and composition only after #939, then provider enforcement,
  HTTP/Agent projections, UI, and shell qualification as separate slices.
- Healio keeps its decorator/hooks until upstream package and provider
  conformance passes. Docker hardening may remain independently.

Rollback is configuration-first: remove the host list, increment the policy
revision, and reacquire the runtime. Never relax only the mount or mutate one
projection in a live runtime. No persistent data migration is required.

## Test seams and required cases

Use a real server through `createWorkspaceAgentServer`, real Pi filesystem tool
factories, provider conformance fixtures, and front contract/component tests.
Avoid asserting private policy arrays or treating UI mocks or `chmod` as the
security proof.

Required cases:

1. exact/descendant readonly matches deny while segment-prefix and ordinary
   siblings remain writable;
2. slash, dot, duplicate, overlap, absolute, escape, NUL, and empty policy
   inputs normalize or reject deterministically;
3. read/list/stat/find/grep and raw download succeed under readonly prefixes;
4. every inventoried write/delete/create path denies with no partial effect;
5. deleting or moving a mixed ancestor containing a readonly descendant denies,
   while creating a permitted sibling succeeds;
6. source and complete destination/replacement footprints are checked for both
   move directions and implicit parents;
7. concurrent symlink swaps, rename/replacement, delete/recreate, and
   nonexistent-parent races cannot bypass provider authorization;
8. governance readwrite plus host readonly is readonly; governance
   binding-wide readonly remains readonly; duplicate identifiers fail
   generically; exactly one final `user` binding reaches routes/tools;
9. omitted policy and existing named-binding suites remain green;
10. policy revision changes reacquire rather than mutate a live binding or reuse
    an incompatible #939 cache entry;
11. typed error and HTTP/Agent serialization are stable and disclose no host
    root or policy list;
12. file/stat/tree/records/settings/raw projections match mutation behavior,
    including the raw header and surfaces with no success projection;
13. mixed-ancestor UI actions use operation capabilities and a stale/crafted
    destination still fails server-side;
14. `readonlySkillFiles` absolute reads keep their current confinement and are
    never evaluated as user policy paths; and
15. every provider claiming `operations-and-shell` passes the construction
    matrix and shell attacks while writes elsewhere succeed.

## Acceptance

- [ ] A selected `user` prefix is readable but cannot be written, created under,
      deleted, moved from, moved into, replaced, or removed through an ancestor.
- [ ] Unselected siblings remain writable, including under a mixed ancestor.
- [ ] Host ceiling and request governance compose into one unique effective
      binding after #939; neither duplicate/first-match behavior nor widening of
      binding-wide readonly is possible.
- [ ] Authorization and mutation share the provider critical section, with race
      and Workspace re-projection inventory proof.
- [ ] HTTP, Agent, Workspace, Operations, UI, and qualified shell behavior agree.
- [ ] Typed denial serialization is stable, safe, and HTTP 403.
- [ ] `.boring/settings`, raw reads, records, stat/tree, no-projection mutations,
      and existing readonly skill reads follow the stated route matrix.
- [ ] Omission preserves current behavior and named filesystems remain
      compatible.
- [ ] A mutation-capable shell is either strongly qualified or withheld.

## Proof

Run package gates in the slice that changes each package; do not claim packages
that the diff does not touch. The expected full integration cohort is:

```bash
pnpm --filter @hachej/boring-agent typecheck
pnpm --filter @hachej/boring-agent test
pnpm --filter @hachej/boring-bash typecheck
pnpm --filter @hachej/boring-bash test
pnpm --filter @hachej/boring-workspace typecheck
pnpm --filter @hachej/boring-workspace test
pnpm --filter @hachej/boring-workspace build
pnpm --filter @hachej/boring-sandbox typecheck
pnpm --filter @hachej/boring-sandbox test
pnpm lint:invariants
```

Record a request/tool matrix, filesystem state after every denied operation,
race results, and provider/mount details for each strong shell mode. Pack exact
artifacts for Healio migration and repeat its HTTP/Agent/UI and shell proof after
removing only its ad hoc policy hooks.

Because this plan can be untracked during review, validation must not rely only
on `git diff --name-only` (which omits untracked files):

```bash
git diff --check -- docs/issues/942/plan.md
! grep -nE '[[:blank:]]+$' docs/issues/942/plan.md
test "$(find docs/issues/942 -type f -print)" = "docs/issues/942/plan.md"
test -z "$(git status --short | grep -vE '^( M|M |A |\?\?) docs/issues/942/(plan\.md)?$|^\?\? docs/issues/942/$')"
rg -n 'prefix-intersect|move-from|#939|critical section|ReadonlyFilesystemMutationError|boring-sandbox|readonlySkillFiles' \
  docs/issues/942/plan.md
```

## Slices

### Slice 942.1 — post-#939 contract and unique composition

**Blocked by:** #939.

**Delivers:** typed capabilities and readonly error in both contract copies;
host-policy normalization/revision; final host/governance intersection; generic
duplicate rejection; exactly one effective `user` binding; structural and cache
identity tests. It exposes no unenforced production configuration.

**Proof:** Agent and boring-bash typecheck/unit tests, structural invariant,
duplicate/binding-wide-readonly cases, and #939 request/cache integration.

### Slice 942.2 — provider mutation security boundary

**Blocked by:** 942.1.

**Delivers:** provider-owned guarded mutations, full footprint semantics,
Workspace re-projection inventory, symlink/nonexistent path handling, and race
conformance. No HTTP or UI projection work.

**Proof:** provider conformance and race suites; reads and writable siblings
remain functional; denied operations have no partial effect.

### Slice 942.3 — HTTP and Agent projection

**Blocked by:** 942.2.

**Delivers:** final `user` binding through routes and real Pi tools; route matrix,
raw header, `.boring/settings`, stable serialization, and explicit
`readonlySkillFiles` compatibility.

**Proof:** real Fastify and tool matrices, error serialization, absolute skill
read confinement, package typecheck/tests, and omission compatibility.

### Slice 942.4 — front-end capability semantics

**Blocked by:** 942.3.

**Delivers:** tree/editor/settings/upload consumers for operation capabilities,
including mixed ancestors, keyboard/drag/drop behavior, and stale destination
handling. No client policy list.

**Proof:** front contract/component/accessibility tests and a manual mixed-tree,
editor, rename, and upload demonstration.

### Slice 942.5 — sandbox and shell security qualification

**Blocked by:** 942.2; 942.3 for Agent shell availability wiring.

**Delivers:** provider-owned enforcement claim, exact tool withholding and
construction matrix, existing-root validation for strong mode, and per-provider
mount/shell conformance.

**Proof:** dedicated `@hachej/boring-sandbox` gates plus redirection,
replacement, rename, remove, mkdir, and symlink tests with successful sibling
writes. Unsupported providers prove shell withholding/fail-closed behavior.

### Slice 942.6 — Healio migration

**Blocked by:** 942.3, 942.4, 942.5, access to the Healio checkout, and a
qualified runtime mode.

**Delivers:** configure `.agents` through the upstream host policy, install exact
packed artifacts, prove parity, then remove Healio's decorator/hooks. Docker
hardening remains optional defense in depth.

**Proof:** artifact/version record, clean consumer gates, repeated
HTTP/Agent/UI/shell matrix, omission rollback, and a focused consumer diff.

## Out of scope

- A general ACL/RBAC language or any allow rule that overrides the host ceiling.
- Browser- or Agent-authored readonly policy.
- Changing named external-filesystem governance or read authority.
- Hiding/redacting readonly content.
- POSIX/Windows permission management as the canonical policy.
- Claiming shell security for an unqualified provider.
- Retiring or generalizing `readonlySkillFiles` (#938 owns retirement).
- Unrelated Workspace, filesystem UI, session, plugin, or gateway refactors.

## Open questions

None blocking after #939. A provider that cannot meet strong shell qualification
uses the specified operations-only-with-shell-withheld behavior; it does not
weaken or relabel the claim.
