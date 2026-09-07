# Coding Invariants

Critical architectural invariants:

1. No `node:*` imports in `src/shared/**`.
2. No `Buffer` in `src/shared/**`; use `Uint8Array`.
3. Routes and tools receive `Workspace`, not root paths.
4. Path validation is the adapter's job.
5. Workspace and Sandbox swap as a paired `RuntimeModeAdapter`.
6. `UiBridge.postCommand` is the single UI dispatch source; chat
   `data-ui-command` parts are display-only.
7. Workspace base front/shared code has zero value imports from
   `@hachej/boring-agent`.
8. Every error has a stable code from the canonical enum.
9. Pi-tools migration stays locked: shell/file tools flow through pi factories
   plus Operations adapters.
10. The D29 Agent Host gateway layer is Pi-free: non-test files under
    `packages/agent/src/server/agent-host/**` do not import Pi runtimes, only
    `harnessBackend/**` may reference `HarnessPiChatService`, and consumer
    composition roots never reference `AgentHarnessBackend` or its module path.

## Cross-package abstraction review (hard gate)

Owner ruling, 2026-09-07: **every code PR needs an explicit independent PASS
before merge**, including plugin-only changes and small internal fixes. A
change can break a package's abstraction without editing that package. Import
lint, green unit tests and a working demo are necessary evidence where relevant,
not substitutes for semantic boundary review.

The reviewer reads the diff, affected package contracts/public exports and real
callers against the [ratified architecture](https://github.com/hachej/boring-ui/blob/main/docs/plans/long-term/ratified/ARCHITECTURE-PLAN.md)
and [owner rulings](https://github.com/hachej/boring-ui/blob/main/docs/plans/long-term/ratified/RECONCILIATION.md).

These architecture links target the canonical repository, not a vendored copy in
portable Factory skills. In a repo checkout read the corresponding local ratified
files at the reviewed revision; elsewhere retrieve and record the canonical
revision. If the governing contracts cannot be read, the review is BLOCKED.

The reviewer checks:

- **Dependency direction and public seams:** no consumer reaches into another
  package's private source, harness backend, concrete store or implementation
  state; no new cycles or forbidden runtime/shared/front dependencies. Use the
  package's supported export/adapter, not a deep import made to compile.
- **Semantic ownership:** business/domain logic, persistence and host authority
  remain with their ratified owners. No platform special-case for a particular
  plugin/app, duplicate authority path, or consumer-side copy of owned logic.
- **Encapsulation:** a consumer need not know a provider's storage layout,
  renderer, process topology or lifecycle internals. Transport/context types do
  not leak those details across a public seam or silently widen permissions.
- **Contract and substitution:** changed signatures, types, error semantics and
  lifecycle behavior still satisfy real consumers and supported adapters/runtime
  modes, including standalone operation where promised. An intentional contract
  or ownership change needs the owner route even if backward compatible.
- **Proof at the boundary:** inspect producer and consumer, including at least
  one real call path for each changed seam. Run existing import/invariant checks
  and affected consumer/contract tests; add a regression at the public seam for
  a demonstrated leak. Do not mask it with mocks of private implementation.

Record this in the existing review/proof artifact, not a second ledger:

```text
Abstraction review: PASS | BLOCKED
Base / head SHA:
Reviewer:
Packages / public seams / real callers inspected:
Ownership and dependency direction:
Checks and consumer proof (commands, results):
Findings / disposition:
```

For a change with no cross-package effect, PASS must explain why after inspecting
its imports/callers; an empty or omitted section is not a pass. Missing proof,
an unresolved violation or uncertain ownership means BLOCKED. Fix the code and
re-review; ordinary findings do not need an owner interruption. Escalate only
when resolution requires a product/architecture decision or exhausts the review
budget. Do not convert an invariant violation into a proof waiver or treat owner
merge approval as an exception. A deliberate architectural change requires an
explicit owner decision, an updated ratified contract, and a fresh PASS against
that contract. Material diff changes invalidate the affected verdict.

This is a mandatory review procedure. Existing commands such as
`pnpm audit:imports`, `pnpm lint:invariants` and affected-package tests cover
parts of it; they do not yet mechanically enforce this complete semantic gate.
Automatic admission must require its explicit revision-bound verdict per
[boring-loop](boring-loop.md#rollout-and-precedence).
