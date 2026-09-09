# [Agent Package Lifecycle] Actual-head revalidation

**PR:** [#1310](https://github.com/hachej/boring-ui/pull/1310)
**Previously approved head (invalidated by drift):** `dbdcdf41ee9992f6ec4ec7d4ad31a04f65c3e87e`
**Externally advanced head:** `63295636ce286e9df6c2d53378aa01c13fd7fcc9`
**Prior reviewed integration candidate:** `a10ab3f5274d13d15a1db41d1f0090ec40502499`
**Reviewed product/integration code:** `109815ccfd61976dcdbb9762f53d7670d968a9f1`
**Current-main docs integration:** `7d8cff5e393eb83a1572e612fa4e5ec001160c96`
**Integrated main:** `7338404c0f8a8d09016545ee79a7b321ef48c9d3`
**Route:** **PROTECTED** — public Agent API and package-boundary contracts changed; owner Gate 2 must be re-raised for the new artifact head.

## External drift — what advanced after approval

```diff
 approved PR head dbdcdf41
+ fc597fcd  changed-workspace verification (main)
+ a35727d0  Factory host polling (main)
+ a8180e43  WhatsApp channel runtime (main)
+ 0889bf79  Bead ledger union merge (main)
+ 17d9d03c  toast delivery (main)
+ 3a594dce  plugin singleton exports (main)
+ 63295636  merge dbdcdf41 + main@3a594dce (external branch push)
+ 65c1059e  transcription quality (subsequent main drift)
+ a10ab3f5  merge current main@65c1059e
+ 695dc0fd  invite idempotency (later main)
+ 966eaf78  package cleanup (later main)
+ 109815cc  merge current main@966eaf78 (reviewed product code)
+ 8f325af4  Native Creation ratified docs (main)
+ 7338404c  id-aware Bead merge driver (main)
+ 7d8cff5e  conflict-free docs/metadata current-main merge
```

The `dbdcdf41..63295636` delta is **main integration, not a docs-only or new PR-authored feature delta**: six commits authored by Julien Hurault were integrated by merge commit `63295636` authored by hachej. It includes broad product code from main (Agent channel/runtime composition, WhatsApp, CLI/core singleton exports, UI toast delivery, Factory host and changed-workspace tooling) plus tests/docs/metadata. The follow-up `a10ab3f5` integrates `65c1059e`; product code SHA `109815cc` integrates later main commits `695dc0fd` and `966eaf78` without source conflicts. Package Cleanup touched `lifecycle.test.ts`; the merge retained both main cleanup coverage and this PR’s retry lifecycle coverage. Main then added Native Creation standards/docs and an id-aware Bead merge driver; `7d8cff5e` integrates those docs/metadata changes without runtime-code changes.

## Structure — the PR-owned boundary remains unchanged against current main

```diff
 Workspace / CLI / standalone composition
   discover package descriptors
   @hachej/boring-agent/server
-    one invalid configured package can abort unrelated Agents
+    invalid packages are diagnosed/excluded while valid siblings boot
+    absent fleet config falls back; malformed present config stays fatal
     Agent catalog
-      version may disappear or gain a fabricated digest
+      version remains; digest appears only when supplied/computed
     AgentGateway
-      retryable preflight can permanently occupy a request key
+      retryable pre-effect state is atomically reclaimable
       AgentRequestLedger (public contract)
+        prepare(key, payloadDigest) + retry(key, error)
         ├── in-memory implementation
         └── SQLite state-qualified CAS implementation
```

## Sequence — same-key retry before effects

```mermaid
sequenceDiagram
    participant App as Workspace / CLI
    participant Host as Agent Host
    participant Ledger as Request ledger
    participant Runtime
    App->>Host: createSession(key, payload)
    Host->>Ledger: prepare(key, digest)
    Host->>Runtime: preflight
    Runtime-->>Host: retryable failure
    Host->>Ledger: retry(key, error), no effect
    App->>Host: retry same key and payload
    Host->>Ledger: prepare atomically reclaims matching state + digest
    Host->>Runtime: preflight then begin effect
    Host-->>App: session created
```

## Deterministic classification

```text
Complete candidate diff: 7338404c...7d8cff5e
Package production:      144 additions + 41 deletions = 185
Excluded package churn:  533 additions + 109 deletions = 642
                         (package tests, fixtures, package docs)
App test churn reviewed:  8 additions + 9 deletions = 17
All non-production churn: 541 additions + 118 deletions = 659
Size trigger:             185 <= 500 -> does not match
Protected triggers:       public Agent API/contracts + package-boundary behavior
Result:                   PROTECTED -> owner Gate 2 required
```

The production count includes the published gateway conformance helper. The numerical >500 calculation applies only to production code under `packages/`: package tests/fixtures/docs contribute `533 + 109 = 642`, while two app tests contribute another `8 + 9 = 17`, for reproducible total non-production churn `541 + 118 = 659`. Tests, fixtures, docs, generated output, and `.beads` remain reviewed. No auth, billing, permissions, secrets, migration, deletion-heavy, shared-design-system, release, or policy-authority trigger was found in the PR-owned current-main diff.

## Exact-SHA proof and review

- Sandbox `6546657a-4f5a-43e7-9f60-6de037a7f938` verified `.factory-sha` and HEAD `109815cc`.
- Agent lifecycle/gateway/standalone/conformance plus main-overlap suites: **10 files, 129 passed / 6 skipped, no type errors**.
- Agent playground gateway smoke: **1 passed**.
- CLI Agent-host composition: **12 passed** after building its normal Workspace/tasks package artifacts; the first attempt's missing built package was an environment setup failure, not an assertion failure.
- Workspace server/package-discovery consumers: **2 files, 69 passed**.
- Agent, CLI, and Workspace typechecks: **PASS**.
- `pnpm audit:imports`, `pnpm lint:invariants`, `git diff --check 966eaf78...109815cc`, and merge-base/ancestry checks: **PASS**; branch was `0 behind / 24 ahead` at proof time.
- Independent product review: fresh session `ba9f96b4-5081-4656-86f1-240a1645090d`, model `openai-codex/gpt-5.6-sol`, brief digest `sha256:be741a3b94a6b95f4ffe848c81efeb66d225acfa66b4289e9d7371aec3cdc9e0`. Verdict **APPROVE**, standards/spec and thermo clean, and **cross-package abstraction PASS** after inspecting real Agent producers and Workspace/Core/CLI/standalone/playground consumers. It specifically verified Package Cleanup’s removed private modules have no remaining runtime imports and the merged lifecycle coverage is intact. Prior review `45b928aa` at `a10ab3f5` found only stale artifacts. Current-docs review session `6c0035c4-f54b-440c-87ba-eafe0a9664bd`, digest `sha256:46a75fdf527f90c9d84ed4c5c79523ef8e58e9ce1499891e86e751dcb1b04ce8`, found standards/spec and thermo PASS plus explicit abstraction PASS; its sole finding was that the excluded arithmetic omitted two app tests. The corrected `541 + 118 = 659` accounting above fixes it.

## Owner validation

1. Open `.handoff/pr-1310-presentation.html` and confirm the external-head/current-main drift is explicit.
2. Inspect the public ledger and fleet flow above against the linked production paths.
3. Confirm reviewed product-code CI is green, later commits are docs/metadata only, and GitHub reports `MERGEABLE/CLEAN`.
4. Approve or request changes only for the exact artifact head named in the refreshed PR body.

**Rollback:** before merge, defer/close the PR. After merge, revert the PR merge commit through protected main. No publish, release, deployment, migration, or deletion is authorized.
