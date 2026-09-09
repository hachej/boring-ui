# [Agent Package Lifecycle] What changed, visually

**PR:** [#1310](https://github.com/hachej/boring-ui/pull/1310)
**Reviewed product code:** `fbe8873fbf8e93f9e00c9f6d24a59c0fc2525816`
**Current integration candidate:** `351ec6276a7464ce21c5b42cb52dffaade7aa469`
**Base/current main:** `68dcb7db8822f721c6b45d0731e01a46fa364f28`
**Route:** **PROTECTED** — public Agent API and package-boundary contracts changed; owner Gate 2 is required.

## Structure — the boundary that changed

```diff
 Workspace / CLI / standalone composition
   discover package descriptors
   @hachej/boring-agent/server
-    one invalid configured package can abort unrelated Agents
+    loadConfiguredAgentFleet isolates the invalid package
+    resolveDefaultAgentFleet distinguishes absent from malformed config
     createAgentHost
       Agent catalog
-        version may disappear or gain a fabricated digest
+        version remains; digest appears only when supplied/computed
       AgentGateway
-        retryable preflight can permanently occupy/reject a request key
+        retryable pre-effect state can be atomically reclaimed
       AgentRequestLedger (public contract)
+        retryable state + prepare(key, payloadDigest) atomic reclaim
         ├── in-memory implementation
         └── SQLite state-qualified CAS implementation
```

## Call flow — same-key retry before effects

```diff
 createSession(requestId, payload)
   ledger.prepare(requestId, payloadDigest)
   preflight
-    failure -> pending/rejected record; retry replays failure/in-progress
+    retryable failure -> ledger.retry(requestId, error); no effect begins
+  retry with same requestId + same payloadDigest
+    ledger.prepare(requestId, payloadDigest)
+      atomically reclaims only matching retryable state + digest
+    preflight succeeds
   ledger.beginEffect(requestId)
   create session
```

## Contract — catalog identity

```diff
 AgentSummary.definition
- { version, digest: synthesizedFromDto } | omitted
+ { version }
+ { version, digest }  // only when package/provider supplied or computed it
```

## Files — responsibility map

```diff
 packages/agent/
 ├── src/server/agentDefinition/
-│   └── fleet resolution couples one seat failure to host startup
+│   ├── loadConfiguredAgentFleet.ts       # isolate invalid packages
+│   └── resolveDefaultAgentFleet.ts       # absent config falls back; malformed stays fatal
 ├── src/server/agent-host/
-│   └── preflight and ledger states disagree about retryability
+│   ├── embeddedGateway.ts                # classify preflight and reclaim before effects
+│   ├── requestLedger.ts                  # in-memory retryable transition
+│   ├── sqliteRequestLedger.ts            # state-qualified transactional CAS
+│   └── retryablePreflightFailure.ts      # normalize plain/retryable gateway failures
 └── src/shared/gateway/types.ts
-    └── prior request-ledger seam
+    └── public Agent summary/ledger contract reflects lifecycle semantics

 packages/{workspace,cli}/ + apps/*-playground/
-  stale or weakened composition expectations
+  public-seam regressions for sibling isolation, scope, inventory, and retry
```

## Sequence — package boot and runtime retry

```mermaid
sequenceDiagram
    participant C as Workspace / CLI
    participant F as Agent fleet resolver
    participant H as Agent Host
    participant L as Request ledger
    participant R as Runtime
    C->>F: discovered descriptors + configured seats
    F-->>C: default + valid Agents; diagnostics for invalid sibling
    C->>H: createAgentHost(resolved fleet)
    C->>H: createSession(requestId, payload)
    H->>L: prepare(requestId, digest)
    H->>R: preflight
    R-->>H: retryable failure
    H->>L: retry(requestId, error) (pre-effect)
    C->>H: retry same requestId + payload
    H->>L: prepare atomically reclaims by state + digest
    L-->>H: admitted
    H->>R: preflight, then begin effect
    H-->>C: session created
```

## Review focus

1. **Public seam:** `AgentRequestLedger` and `AgentSummary.definition` semantics intentionally changed, so automatic admission is disallowed even though package production churn is only `144 + 41 = 185` lines.
2. **Ownership:** Workspace discovers/composes; Agent owns fleet validation, identity projection, preflight classification, and ledger transitions.
3. **Safety:** retry reclaim is limited to same key + same payload while still pre-effect; terminal outcomes and conflicts remain stable.
4. **Evidence:** product SHA `fbe8873f` has green CI and clean review; integration candidate `351ec6276` has exact-SHA sandbox proof and receives its own current-head CI/review before Gate 2.
