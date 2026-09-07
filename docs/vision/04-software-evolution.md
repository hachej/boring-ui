# 4. Software evolution

## Three layers

| Layer | Owns | Never |
|---|---|---|
| **Host** | identity, membership, installation records, activation, data and attention brokering, revocation | runs product code (except explicit `embedded` mode) |
| **Product runtime** | one per installed product: its agents, generated operations, generated UI; durable; isolated by mode | grants itself authority; outlives its installation |
| **Sandbox** | disposable environment lease for tool calls, builds, checks | hosts a product; keeps anything the product needs |

Destroying a sandbox must leave the installed product and its data intact.
The runtime unit is the installation, not the agent: a single-agent product
coincides with the existing per-agent-type rule, so nothing landed changes.

## Runtime modes are policy

`embedded` runs inside the host process and is allowed only on a
single-tenant deployment where the curator is the operator; it is off by
default. `local` runs in a bwrap or runsc lease on the same host. `remote`
runs in a hardware microVM. The host selects the mode per installation; the
product and the builder never do. A product installed for a separate
consumer on a shared host requires `local` or `remote`. The same contract
holds in every mode.

## Composition layers

Host and platform contract · shared packages at exact releases · workspace
overlay · personal overlay · private modules · business data. Preferences
are typed changes over exact versions; a whole-repository fork is an escape
path, not the way to personalize. Business records, session history and
credentials are outside software rollback.

## Release

A release is an immutable manifest under one content digest: parents and
base, package lock (admitted registries and integrity), artifact digests,
behavior digest, the agent definition digests it ships, declared state
compatibility, provenance (requester, the builder's request key), and
evidence references. A candidate becomes a release only through a host
operation that verifies every artifact's bytes are published and match; the
bytes outlive the builder sandbox and are retained for undo and quarantine.
A release declares requirements; it does not carry grants.

## Installation and activation

An installation binds a release to a scope (a workspace, or one member's
personal scope), resource bindings, grants, a runtime mode and a generation
counter. Installing resolves the release's declared requirements against the
scope's bindings and records who accepted which grants. A separate consumer
is a workspace member holding a personal-scope installation; members of one
workspace cannot reach each other's personal runtimes or data. Retiring an
installation stops its runtime and revokes its bindings while retaining the
consumer's records and any artifacts other installations or undo still need.

Activation is compare-and-set against the expected generation vector of every
affected scope — platform contract, package lock, workspace overlay, personal
overlay, state and schema — and settles once under a request key: prepared, then committed or aborted; a
retry returns the settled receipt. A stale generation or an incompatible
contract stops activation. Undo is another activation of a prior release; it
never rewrites history, business data, or completed external effects.
Publication, installation, activation and commercial launch are separate
acts with separate receipts.

Standing authorization lets a curator or organization approve private
changes within a declared change class and budget without being asked each
time. The default is preview and keep; the founder is not the default
approver.

## The change loop

Capture intent → prepare an immutable candidate → verify and preview →
activate → observe and recover. The builder proposes; the host verifies and
activates. Protected checks and release pointers are outside the candidate.
Candidate source, artifacts and previews are private scoped resources
checked on every access; a digest or preview URL is not a grant; revocation
denies further access and cannot undo prior disclosure.

A preview runs in its own state and data namespace with mutating and
external-effect capabilities denied; a previewed operation cannot alter real
records. Use the smallest sufficient lane: preference → composed registered
components → permitted behavior asset → new isolated module → trusted
domain-operation or schema release. A theme change must not masquerade as
novel software; a missing backend authority is not invented by generated UI.

## Three loops, kept apart

**Private adaptation**: a request becomes a checked, kept revision. **Downstream
maintenance**: a supported upstream change preserves local intent or exposes
a precise conflict, reconciling old base, local intent and new base against
stable semantic targets. **Shared improvement**: approved portable material
becomes an optional package another private workspace adopts. A private keep
is not publication; publication is not adoption.

## Reconciliation and quarantine

A retained change is recorded as an intent over stable semantic targets, not
as generated output; reconciliation rebases intents. Compatibility is checked
before activation across schema, operations, bindings and dependencies.
Admitted work keeps executing its pinned release until it completes or is
explicitly migrated; activating a new release drains the old generation
rather than switching a paused job underneath it. Module state is copy-on-write or dual-readable
so undo is possible; business-schema changes are separate trusted migration
releases. Quarantining a digest stops its serving runtime and broker
authority, blocks resume, and exposes recovery; moving a pointer alone does
not remove running code.

## Acceptance ladder

E0 preparation on fixtures · E1 durable revision and one live consumer's
job · E2 personal scope · E3 behavior revision · E4 isolated private module
· E5 upgrade and reconciliation · E6 approved reuse. One consumer earns the
loop; a second, structurally different live consumer earns any cross-domain
claim; kernel promotion still needs the Rule of Three. The first-journey
acceptance proves E1 plus one bounded E5 case (one compatible upstream update
preserving one intent, one incompatible base rejected); it does not close E5,
and schema migration execution stays a named follow-up.

## Crosswalk

Implementation status lives only in [`CROSSWALK.md`](CROSSWALK.md).

| Section | Ruling |
|---|---|
| Three layers; runtime unit; modes | RECONCILIATION §13(b), §13(c); DECISIONS D33 |
| Composition layers; lanes; three loops | §11(b), §11(d); LIFECYCLE |
| Release manifest | §11(c) step 2; §13(d) |
| Installation, activation, undo, standing authorization | §11(c) steps 4–5; §13(d); D33 narrowing D25/D28/D29/D30 |
| Change loop; candidate privacy; revocation | §11(c) steps 1–3; §11(e) |
| Reconciliation, quarantine | §11(c), §11(d); LIFECYCLE |
| Acceptance ladder E0–E6; cross-domain bar | §11, §12(e), §12(f) |
