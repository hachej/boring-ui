---
github: https://github.com/hachej/boring-ui/issues/1056
issue: 1056
state: ready-for-human
updated: 2026-08-04
track: owner
flag: not-needed
---

# gh-1056 Project, Environment, Session, and filesystem authority model

## Problem

`Workspace`, Project content, runtime placement, filesystem access, and
Environment leases are easy to conflate while the implementation remains 1:1.
That ambiguity risks making repositories into filesystems, making Sessions
owned by ephemeral runtimes, or letting data access imply execution.

## Solution

Land one architecture-only note that defines the product and runtime vocabulary,
normal cardinalities, authority boundaries, MVP compatibility mapping, and
break conditions. Do not change runtime types or behavior in this slice.

## Decisions

- Product Workspace is the personal/company ownership and navigation boundary.
- Project is durable Session/content identity.
- Project owns zero or more Environment Definitions; one is implicit/default in
  the current MVP.
- Session belongs to Project and uses an Environment for runtime-backed work.
- Environment Lease/generation is replaceable runtime authority, not Session
  ownership.
- The Environment's primary Workspace is the Project root; no first-class
  `ProjectRoot` object is introduced.
- Request-scoped Filesystem Grants remain distinct from optional provider-owned
  Environment mounts.
- Physical co-location never implies shared authority.
- Current Boring Workspace can remain a fused 1:1 Project/default-Environment
  aggregate until a concrete consumer breaks the cardinality.

## Flag / Abstraction

- Needed?: No runtime behavior changes.
- Path: `docs/PROJECT_ENVIRONMENT_MODEL.md`
- Rollback: Revert the documentation PR; no schema, API, or runtime migration.

## Test Seams

- Highest public seam: repository documentation links and architecture
  consistency with `docs/DECISIONS.md`.
- Existing prior art: Decisions 7e, 19, 21, 28, and 29; issue #391 Environment
  documents; PR #1000 filesystem contracts; issue #909 AgentGateway plan.
- Avoid testing: runtime behavior, UI, providers, or speculative attachment
  APIs in this documentation-only slice.

## Acceptance

- [x] Dedicated note defines Workspace, Project, Environment Definition,
      Environment Lease/generation, Session, Filesystem Grant, and Environment
      Mount.
- [x] Session ownership and execution binding are separate.
- [x] Project → Environment is the normal direction.
- [x] `ProjectRoot` is explicitly rejected for the current 1:1 model.
- [x] Filesystem access does not imply execution.
- [x] Current Boring terminology has a no-rename MVP mapping.
- [x] PR #1000 and PR #1038 scope consequences are recorded.
- [x] Open decisions remain explicit rather than silently resolved.

## Proof

- Exact command: `prettier --check docs/PROJECT_ENVIRONMENT_MODEL.md docs/issues/1056/plan.md && git diff --check`
- Screenshot/demo: N/A.
- Manual steps: inspect all relative Markdown links and compare the note's
  invariants with Decisions 7e, 28, and 29.
- Waiver if proof is not possible: no runtime behavior changes.

## Slices

### Slice: architecture note

**Delivers:** One linked vocabulary/model note and this historical issue plan.
**Blocked by:** Human architecture review before the model becomes normative or
runtime work is dispatched.
**Proof:** Prettier check, relative-link validation, clean documentation diff.
**Review budget:** inside; documentation-only.

## Out of Scope

- Runtime code, schema, route, UI, or package API changes.
- Project switcher or cross-Project session index implementation.
- Multiple Environment selection UI.
- Executable named-filesystem attachments.
- Sandbox/provider mounts.
- Session Environment migration or reattachment protocol.
- Changes to PR #1000 or PR #1038.

## Open Questions

1. May planning-only Sessions defer Environment selection?
2. What explicit protocol governs Environment changes after effects?
3. What is the final name of a future executable secondary resource?
4. When does Product Workspace become explicit?
5. Is the current canonical runtime identity stable across reprovisioning?
