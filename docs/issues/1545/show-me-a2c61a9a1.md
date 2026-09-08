# [Gateway Retry] What changed, visually

**Reviewed code:** `a2c61a9a1d14e650f9d655d53d8bd3ee89ae7f8a`  
**Base / current main:** `68dcb7db8822f721c6b45d0731e01a46fa364f28`  
**Route:** protected owner review — public `AgentRequestLedger` / `createAgentHost` contract  
**Package production churn:** 180 additions + 40 deletions = 220 lines (tests, fixtures, package docs, repository docs, and Bead metadata excluded from the numerical trigger only)

The shipped change makes a pre-effect admission failure retryable without allowing two callers to own the same effect. It also makes the built-in SQLite ledger's terminal-payload retention real while preserving idempotency through permanent key/digest tombstones. No UI surface changed; the evidence is exact-SHA tests, CI, and independent contract review rather than Playwright video.

## Contract and call shape

```diff
 createAgentHost(options)
   choose AgentRequestLedger
+    built-in SQLite <- requestLedgerPath + optional requestRetentionMs
     injected custom ledger <- unchanged current interface
   EmbeddedAgentGateway.effect(request)
     ledger.prepare(key, digest)
-      existing pending request -> always in progress
+      retryable pending request -> exactly one atomic reclaimed owner
+      loser / non-retryable request -> existing replay or in-progress
     admission
+      safe pre-effect failure -> markAdmissionRetryable
     acceptAdmission -> beginEffect -> invoke provider once
     complete | reject | markOutcomeUnknown
+
+  SQLite prepare transaction (when retention enabled)
+    expired terminal payload -> persist permanent key+digest tombstone
+    matching tombstone -> OUTCOME_UNKNOWN (never a new effect)
+    conflicting digest -> REQUEST_CONFLICT
+    unresolved row -> never pruned
```

## Actual shipped flow

```mermaid
sequenceDiagram
    participant Caller
    participant Host as createAgentHost / EmbeddedGateway
    participant Ledger as AgentRequestLedger
    participant Store as SQLite WAL
    participant Effect as Provider effect

    Caller->>Host: request(key, digest)
    Host->>Ledger: prepare(key, digest)
    Ledger->>Store: BEGIN IMMEDIATE + prune eligible terminal payloads + claim
    alt new or sole reclaimed owner
        Store-->>Ledger: created / reclaimed
        Ledger-->>Host: exclusive ownership
        Host->>Ledger: acceptAdmission + beginEffect
        Host->>Effect: invoke exactly once
        Effect-->>Host: receipt / stable failure
        Host->>Ledger: complete / reject
        Host-->>Caller: terminal result
    else another caller owns or completed it
        Store-->>Ledger: existing record / tombstone
        Ledger-->>Host: replay or in-progress
        Host-->>Caller: prior result, IN_PROGRESS, CONFLICT, or OUTCOME_UNKNOWN
    else safe failure before effect
        Host->>Ledger: markAdmissionRetryable
        Host-->>Caller: retryable gateway failure
        Note over Caller,Store: next contenders race atomically; one can reclaim
    end
```

## Files that decide the review

```diff
 packages/agent/src/server/agent-host/
+├── requestLedger.ts                 # in-memory reference supports explicit retry reclaim
+├── sqliteRequestLedger.ts           # transactional reclaim, retention, permanent tombstones
+├── embeddedGateway.ts               # marks only safe pre-effect admission failures retryable
+├── types.ts                         # protected ledger and Host option contract
+├── createAgentHost.ts               # wires retention only to built-in SQLite
 ├── __tests__/
+│   ├── fixtures/requestLedgerClaimWorker.ts  # independent worker/SQLite connection
+│   ├── requestLedger.test.ts         # real contention, boundaries, tombstones, reopen
+│   ├── createAgentHost.test.ts       # public-seam restart/custom-ledger/no-duplicate proof
+│   ├── effectAdmission.test.ts       # effect fencing
+│   └── lifecycle.test.ts             # graceful drain and durable terminalization
+└── testing/gatewayConformance.ts     # adapter-level contract proof
 docs/plans/agent-runtime/gateway/plan.md
+  exact retry, restart, drain, retention, and Level-D deferral contract
```

## Review and proof receipts

- Independent final review: session `103a930d-8d7a-4262-9cea-fdcafa1a8a20`, model `openai-codex/gpt-5.6-sol`, brief digest `sha256:9cdabc4a48c53e4ec1c898ddf5f849edbfb727ac93cd8475563bc416a1e165e5` — **APPROVE**, standards/spec PASS, thermo PASS, explicit package-abstraction PASS.
- Exact-SHA sandbox `662f5467-0f63-4c86-ba77-157da7cb3017`: focused five-suite proof 94 passed / 5 skipped; genuine two-worker SQLite contention 10/10; full Agent suite 239 files passed / 3 skipped and 2342 tests passed / 17 skipped; typecheck, lint, invariants, import audit, and diff checks passed.
- CI: [run 34170049996](https://github.com/hachej/boring-ui/actions/runs/34170049996) — success at the reviewed code SHA.
- Workflow Invariants: [run 34170050017](https://github.com/hachej/boring-ui/actions/runs/34170050017) — success at the reviewed code SHA.
- Earlier review failure: [request changes at `25b2d76e`](https://github.com/hachej/boring-ui/pull/1545#issuecomment-5554988141) was repaired with real worker-thread contention and canonical contract reconciliation.

## Residuals and rollback

Tombstones intentionally grow permanently to preserve idempotency after payload expiry; cleanup is lazy on the next built-in-ledger `prepare`. Level-D evidence-backed abrupt-crash reconciliation remains explicitly deferred, so unresolved abrupt-restart rows remain non-retryable/in-progress. Roll back with new revert commits for the Gateway Retry production commits (and their contract/test companions) in reverse order; preserve current-main merge commits and never force-push.
