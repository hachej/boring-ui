# PR 1547 context

```diff
 create invite request
- effect first; cache a globally keyed response afterward
+ authorize + validate
+ atomically claim [app, operation, workspace, actor, key, payload]
+ effect once for the admitted claim
+ replay only the matching caller's completed response
```

```mermaid
sequenceDiagram
    participant Caller
    participant Route
    participant Claim as Idempotency store
    participant Effect as Invite + mail
    Caller->>Route: POST invite + key
    Route->>Route: authorize owner and validate body
    Route->>Claim: atomic claim scoped to actor/workspace/payload
    alt claimed
      Claim-->>Route: claimed
      Route->>Effect: perform once
      Route->>Claim: persist response
    else matching completed
      Claim-->>Route: replay
    else pending or mismatch
      Claim-->>Route: 409; no effect
    end
```

The previous middleware could only cache a response after the invite side effect, so concurrent requests could both execute and globally scoped receipts could cross authorization boundaries. This revision adds an atomic pre-effect claim, scopes identity to application/operation/workspace/actor plus validated payload, and makes unresolved outcomes fail closed. The nullable migration preserves legacy rows without trusting them for replay. The follow-up repair commits make the complete Core suite reproducible from a clean checkout and merge current main. Review the middleware/store contract first, then the invite route ordering, then the migration and PostgreSQL concurrency proof.

## Key files

- packages/core/src/server/middleware/idempotency.ts
- packages/core/src/server/routes/invites.ts
- packages/core/drizzle/0028_invite_idempotency_claims.sql
- packages/core/src/server/middleware/__tests__/idempotency.postgres.test.ts
- packages/core/src/server/routes/__tests__/idempotency.test.ts

## Why

- packages/core/src/server/middleware/idempotency.ts | atomically claim a caller-scoped request before effects and replay only matching completed receipts
- packages/core/src/server/routes/invites.ts | order owner authorization and canonical validation before claim and invite creation
- packages/core/drizzle/0028_invite_idempotency_claims.sql | preserve legacy receipts while representing unresolved pre-effect claims
- packages/core/src/server/db/schema.ts | align typed persistence with the nullable claim lifecycle
- packages/core/src/server/{index.ts,middleware/index.ts} | expose the extended Core idempotency adapter contract
- packages/core/src/shared/errors.ts | add stable conflict and unresolved-claim error codes
- packages/core/src/server/auth/deleteUserCompletely.ts | keep protected deletion retries compatible with PostgreSQL 18 RESTRICT races
- packages/core/vitest.config.ts | resolve declared workspace seams from source in clean Core checkouts and dedupe React
- packages/core/{tsconfig.json,e2e/**} | typecheck and exercise the updated atomic-claim adapter in the platform scenario
- packages/core/src/**/__tests__/** | prove concurrency, replay isolation, cleanup, shutdown, and deterministic package behavior
- packages/core/docs/README.md | document migration order, mixed-version drain, unresolved reconciliation, and adapter obligations
- packages/core/drizzle/meta/_journal.json | register migration 0028 in generated Drizzle metadata

## Review history

- 2026-09-05 | CI re-verify | FAIL -> fixed | GitHub Actions run 33969101191 | Core E2E adapter lacked `claim`; fixed by 4ff283b563 and subsequent CI passed.
- 2026-09-05 | deep audit | FAIL -> fixed | owner batch review comment 5554897451 | Atomic flow had no material code finding, but clean Core package proof was red; repaired through a4ebc8292a.
- 2026-09-07 | CI re-verify | FAIL -> green | GitHub Actions run 34139219517 | unrelated command-palette UI fixture reproduction diverged at 0048e05082; later exact-head CI is green; no UI production diff in this PR.
- 2026-09-07 | deep audit | PASS | openai-codex/gpt-5.6-sol session 703e0f6a | a4ebc8292a had no material findings; thermo and package abstraction passed.
- 2026-09-07 | current-main re-verify | PASS | sandbox 29c0b98e + GitHub runs 34145602272/34145602232 | bc6df8c8d: Core 1523/1523, focused 16/16, E2E 17/17, typecheck/build/invariants green.
- 2026-09-07 | thermo review | PASS | openai-codex/gpt-5.6-sol session b0caaf10 | exact bc6df8c8d approved with explicit package-abstraction PASS and no material findings.
