# [Agent Package Lifecycle] Gateway Retry integration

**PR:** [#1310](https://github.com/hachej/boring-ui/pull/1310)
**Reviewed product/integration code:** `1ab6a7de51648769186736cb4c50c4e40b17210f`
**Integrated current main:** `6b86c39bb12fe5d95f8fc56eb6edcfe79e584842`
**Prior artifact head:** `0e58214f5cb0e01f1bc8b5a246ba57f34dfceb6e`
**Route:** **PROTECTED** — public Agent API and package-boundary contracts require a new owner Gate 2 decision.

## What current main changed

```diff
 prior reviewed artifact 0e58214f
+ origin/main 6b86c39b  [Gateway Retry] Recover safe admission failures without overlapping effects
+ merge 2339a8469        integrate current main; resolve seven ledger/gateway conflicts
+ repair 1ab6a7de5       preserve truthful catalog identity and safe runtime-preflight retry
```

Gateway Retry materially replaced the PR's earlier retry terminal state with a stronger public contract: a retryable marker stays on `pending-admission`, `prepare` atomically reclaims it, and SQLite retention prunes only terminal payloads after first writing permanent key/digest tombstones. The merge adopts that main-owned contract rather than retaining two retry state machines.

## Structure — one Agent-owned lifecycle

```diff
 Workspace / CLI / standalone / playground
   discover package descriptors
   @hachej/boring-agent/server
     fleet resolver
+      invalid package -> diagnostic; valid siblings continue
+      absent config -> fallback; malformed present config -> fatal
     Agent catalog
+      version preserved; digest emitted only when supplied/computed
     EmbeddedAgentGateway
       AgentRequestLedger.prepare(key, payloadDigest)
-      retryable terminal record + retry(key, error)
+      pending-admission { retryable: true }
+      markAdmissionRetryable(key)
+      prepare atomically returns reclaimed to one caller
       preflight
+        retryable failure -> mark before acceptAdmission/beginEffect
       accepted effect
         acceptAdmission -> beginEffect -> complete/reject/unknown
     SqliteAgentRequestLedger
+      BEGIN IMMEDIATE + exact-record CAS
+      expired terminal payload -> permanent key/digest tombstone
```

## Sequence — retry remains pre-effect

```mermaid
sequenceDiagram
    participant App as Workspace / CLI
    participant Host as Agent Host
    participant Ledger as Request ledger
    participant Runtime
    App->>Host: createSession(key, payload)
    Host->>Ledger: prepare(key, digest)
    Host->>Runtime: runtime preflight
    Runtime-->>Host: retryable failure
    Host->>Ledger: markAdmissionRetryable(key)
    Note over Ledger: still pending; no admission acceptance or effect
    App->>Host: retry same key + payload
    Host->>Ledger: prepare atomically reclaims marker
    Host->>Runtime: preflight succeeds
    Host->>Ledger: acceptAdmission -> beginEffect
    Host-->>App: one created session
```

## Deterministic classification

```text
Complete candidate diff: 6b86c39b...1ab6a7de5
Package production:      83 additions + 38 deletions = 121
Excluded package tests:  445 additions + 85 deletions = 530
Excluded package docs:   22 additions + 7 deletions = 29
App tests:                8 additions + 9 deletions = 17
Size trigger:             121 <= 500 -> does not match
Protected triggers:       public Agent API/contracts + package-boundary behavior
Result:                   PROTECTED -> owner Gate 2 required
```

The production count uses old and new paths and excludes only tests, fixtures, package docs, generated output, and snapshots from the numerical threshold. Those files remain reviewed. No auth, billing, permissions, secrets, migration, deletion-heavy, shared-design-system, release, or policy-authority trigger was found.

## Exact-SHA proof

Controlled sandbox `62f21b11-8ed3-4449-8188-8d29ee4d8e51` verified both HEAD and `.factory-sha` as exact `1ab6a7de51648769186736cb4c50c4e40b17210f`.

- Agent lifecycle, gateway, request-ledger, conformance, standalone, fleet, and package lifecycle: **12 files, 175 passed / 5 skipped**, no type errors.
- Agent playground real gateway smoke: **1 passed**.
- Workspace real server/discovery consumers: **4 files, 73 passed**.
- CLI real Agent-host composition: **12 passed**.
- Agent, Workspace, and CLI typechecks: **PASS**.
- Agent, Sandbox, Workspace, and Tasks builds used by consumer proof: **PASS**. The workspace-playground source test was not counted because its post-build Vitest resolver could not resolve the package's import-only `@hachej/boring-sandbox/providers/blaxel` export; the same Agent seam is covered by the passing Agent playground, Workspace source consumers, CLI composition, and standalone suites.
- `pnpm audit:imports`: **PASS**, 69 app source files.
- `pnpm lint:invariants`: **PASS**, including Agent Host and cross-package alignment scans.
- `git diff --check 6b86c39b...1ab6a7de5`, worktree diff check, merge-base, and ancestry: **PASS**; `0 behind / 29 ahead` at proof time.

## Independent review

- Initial review session `2071ba37-7056-4a60-b4ca-ea5c04df1f52`, model `openai-codex/gpt-5.6-sol`, digest `sha256:083432b8eca3311e17754daa9f5bf96f800bdf02f5dcfe7071be517667509c60`: timed out without a verdict; no approval inferred.
- Completed fresh review session `a8f70419-173d-4aec-9720-2fcfa72fdc59`, same model, digest `sha256:defb2f0515aa319bf86305a8054c1aa8f5b04c3dd214bd928589193d966ee750`, exact target `1ab6a7de5`: **APPROVE**, no material findings.
- Standards/spec: **PASS**.
- Thermo/race/lifecycle: **PASS**.
- Cross-package abstraction: **PASS** after inspecting the Agent producer and real Workspace, CLI, standalone, and playground consumer paths. Agent retains lifecycle/persistence authority; consumers use public seams and do not reach into ledger storage or harness internals.

## Owner validation

1. Open `.handoff/pr-1310-presentation.html` and start with `embeddedGateway.ts`, `sqliteRequestLedger.ts`, and the fleet resolver.
2. Confirm a retryable runtime preflight is marked while still pending, before `acceptAdmission` and `beginEffect`.
3. Confirm the catalog preserves version-only definitions and package digests without fabricating identity.
4. Confirm the exact reviewed-code SHA, artifact SHA, current main SHA, CI links, and `MERGEABLE/CLEAN` status in the refreshed PR body before deciding.

**Rollback:** before merge, defer or close PR #1310. After merge, revert the PR merge commit through protected `main`; no migration or data deletion is introduced. No publish, release, deployment, file deletion, or merge is authorized by this artifact.
