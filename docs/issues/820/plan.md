---
github: https://github.com/hachej/boring-ui/issues/820
issue: 820
state: ready-for-human
updated: 2026-07-19
flag: not-needed
track: owner
---

# gh-820 Workspace BYOK model-key policy

## Outcome

[Decision 27](../../DECISIONS.md#27-workspace-byok-before-platform-billed-model-keys) selects BYOK per workspace for v1, keeps instance `ANTHROPIC_API_KEY` as the self-host/missing-key fallback, and defers platform-billed pooled keys to #809/BL1 after #819 metering. This is a plan-only issue; implementation stays blocked until #391 Step 1A is complete.

## Today — verified on `origin/main`

Baseline inspected: `f93450902be7dfb8c26209f78f0aab49585e85c9` (2026-07-19).

- Core's [`loadConfig()`](../../../packages/core/src/server/config/loadConfig.ts#L170) calls [`resolveConfigFileSecrets()`](../../../packages/core/src/server/config/fileSecrets.ts#L78), which uses `WORKSPACE_SETTINGS_ENCRYPTION_KEY_FILE` only when the direct variable is absent and rejects dual configuration at [`fileSecrets.ts:81`](../../../packages/core/src/server/config/fileSecrets.ts#L81). `loadConfig()` then selects that resolved file value or `WORKSPACE_SETTINGS_ENCRYPTION_KEY` at [`loadConfig.ts:203`](../../../packages/core/src/server/config/loadConfig.ts#L203) and projects it as `config.encryption.workspaceSettingsKey` at [`loadConfig.ts:288`](../../../packages/core/src/server/config/loadConfig.ts#L288). [`createCoreRuntime()`](../../../packages/core/src/app/server/createCoreWorkspaceAgentServer.ts#L698) passes that exact key to `PostgresWorkspaceStore` at [`createCoreWorkspaceAgentServer.ts:713`](../../../packages/core/src/app/server/createCoreWorkspaceAgentServer.ts#L713).
- [`PostgresWorkspaceStore`](../../../packages/core/src/server/db/stores/PostgresWorkspaceStore.ts#L142) already encrypts values with `pgp_sym_encrypt` in [`encryptAndPut()`](../../../packages/core/src/server/db/stores/PostgresWorkspaceStore.ts#L787) and decrypts one workspace/key pair with `pgp_sym_decrypt` in [`decryptSetting()`](../../../packages/core/src/server/db/stores/PostgresWorkspaceStore.ts#L760). [`putWorkspaceSettings()`](../../../packages/core/src/server/db/stores/PostgresWorkspaceStore.ts#L827) writes through that function. [`getWorkspaceSettings()`](../../../packages/core/src/server/db/stores/PostgresWorkspaceStore.ts#L804) reads rows and decrypts only to return metadata (`key`, `configured`, `updated_at`); the authenticated routes likewise return metadata, not plaintext ([`settings.ts:10`](../../../packages/core/src/server/routes/settings.ts#L10)).
- The generic [`WorkspaceStore`](../../../packages/core/src/server/app/types.ts#L41) exposes metadata read/write only at [`types.ts:65`](../../../packages/core/src/server/app/types.ts#L65). There is no server-only plaintext credential resolver yet. The generic settings schema accepts every valid key ([`settings.ts:3`](../../../packages/core/src/server/routes/__schemas__/settings.ts#L3)) and its write route permits editors ([`routes/settings.ts:20`](../../../packages/core/src/server/routes/settings.ts#L20)); a reserved owner-only provider key must close that bypass. The local store is not encrypted, so it cannot become a BYOK store without violating Decision 27.
- Production agent code does not read the literal `ANTHROPIC_API_KEY` itself. [`createPiSession()`](../../../packages/agent/src/server/harness/pi-coding-agent/createHarness.ts#L569) currently creates Pi `AuthStorage`/`ModelRegistry` from normal auth and environment sources at [`createHarness.ts:575`](../../../packages/agent/src/server/harness/pi-coding-agent/createHarness.ts#L575), then passes them to `createAgentSession()` at [`createHarness.ts:668`](../../../packages/agent/src/server/harness/pi-coding-agent/createHarness.ts#L668). The pinned [`@earendil-works/pi-coding-agent@0.80.7`](../../../packages/agent/package.json#L85) resolves auth through `ModelRegistry.getApiKeyAndHeaders()` immediately before each provider stream call ([pinned `sdk.ts:302`](https://github.com/earendil-works/pi/blob/818d67457cdd6b60bce6b121d16b23141c252dd8/packages/coding-agent/src/core/sdk.ts#L302-L307); [pinned `model-registry.ts:745`](https://github.com/earendil-works/pi/blob/818d67457cdd6b60bce6b121d16b23141c252dd8/packages/coding-agent/src/core/model-registry.ts#L745-L788)). That is the exact per-request key seam.
- [`HarnessPiChatService.getAdapter()`](../../../packages/agent/src/server/pi-chat/harnessPiChatService.ts#L685) authorizes session access before passing trusted `workspaceId` in `RunContext` at [`harnessPiChatService.ts:693`](../../../packages/agent/src/server/pi-chat/harnessPiChatService.ts#L693). Cached sessions bypass `createPiSession()` ([`createHarness.ts:518`](../../../packages/agent/src/server/harness/pi-coding-agent/createHarness.ts#L518), so request-time resolution cannot live only in session construction. Normal prompt/follow-up/continuation calls bind that context in [`createRunBoundAdapter()`](../../../packages/agent/src/server/harness/pi-coding-agent/createHarness.ts#L551); queued follow-ups return before their model turn runs, then the existing [`rememberQueuedFollowUpRunContexts()`](../../../packages/agent/src/server/harness/pi-coding-agent/createHarness.ts#L408) reactivates their captured context on `message_start` at [`createHarness.ts:427`](../../../packages/agent/src/server/harness/pi-coding-agent/createHarness.ts#L427). Slash commands may also prompt directly ([`createHarness.ts:819`](../../../packages/agent/src/server/harness/pi-coding-agent/createHarness.ts#L819)).
- The model loop is host-side today; sandbox `exec` is for tools. The existing Vercel-sandbox gate explicitly proves tool execution does **not** receive `ANTHROPIC_API_KEY` ([`harness.test.ts:297`](../../../packages/agent/src/server/tools/harness/__tests__/harness.test.ts#L297)). BYOK must preserve that negative: “per execution” means the authorized model turn, not every shell/tool invocation.

## Delta — smallest implementation

1. Reserve `model_provider.anthropic.api_key` in the existing Postgres `workspace_settings` table. Reject that reserved key on every generic settings write, then add an owner-only set/rotate/clear path and a server-only `WorkspaceStore` secret read; keep every HTTP response metadata-only. `CORE_STORES=local` rejects that reserved setting and continues to use instance env fallback.
2. Compose a narrow `resolveWorkspaceProviderCredential(workspaceId, provider)` function from Core into a credential-aware Pi auth adapter constructed with each session. For first-session model discovery, `createPiSession()` resolves the credential from its authorized `RunContext` and scopes a Pi runtime override only around discovery. For every real model request, the adapter intercepts the pinned `ModelRegistry.getApiKeyAndHeaders()` seam, reads the currently active authorized `RunContext`, resolves again, installs the result only while Pi captures request auth, and removes the override in `finally` before Pi invokes `streamSimple` with the captured key. A managed-provider `hasConfiguredAuth` preflight may report capability, but only the async request seam may admit or reject payment. This covers cached prompt, follow-up, continuation, compaction, and prompt-producing slash-command calls without mutating `process.env` or tying cleanup to an enqueue method that returns before Pi drains work.
3. When the workspace setting is absent, the host reads its instance `ANTHROPIC_API_KEY` and installs that value as the explicit runtime override; if the env key is also absent, execution fails with a stable no-credential error. Hosted workspace execution never falls through to ambient Pi `auth.json`/OAuth. A configured but undecryptable workspace value also fails closed.
4. Keep the secret out of `RuntimeBundle.getRuntimeEnv`, `Sandbox.exec`, browser/shared DTOs, logs, telemetry payloads, Pi JSONL, task/event rows, images, and bundles. If later work needs an event-shaped credential or billing fact, extend the existing [#807 T1 durable-event contract](../807/plan.md#todaydelta-inventory) rather than adding an event bus; #819 remains the metering owner.

The named function is a static server composition seam, not an AgentHost, controller, CAS/publication journal, mutable registry, or second runtime owner.

## Packages

- `@hachej/boring-core`: encrypted setting write/read/clear, owner authorization, stable errors, and host composition.
- `@hachej/boring-agent`: per-request Pi auth capture and cross-workspace/fallback isolation tests.
- Host apps (full-app and the Step 1A Seneca consumer): wire the resolver and prove env-only compatibility plus two-workspace BYOK isolation. `@hachej/boring-sandbox` needs no v1 change.

## Proposed Bead chain

No `.beads` changes are made by this plan.

### 16f.1 — Core encrypted workspace-provider credential seam

**Blocked by:** merged #820 Decision 27/plan and completed #391 Step 1A (through 1A.10b).

**Delivers:** reserved Anthropic setting rejected by the generic writer; Postgres-only server plaintext resolver; owner-only set/rotate/clear; metadata-only responses; local-store rejection; absent-versus-unreadable distinction and stable errors.

**Machine-checkable acceptance gate:**

```bash
pnpm --filter @hachej/boring-core exec vitest run --no-file-parallelism \
  src/server/config/__tests__/loadConfig.test.ts \
  src/server/db/stores/__tests__/workspaceSettingsCrypto.test.ts \
  src/server/routes/__tests__/workspaceProviderCredentials.test.ts
pnpm --filter @hachej/boring-core typecheck
```

The tests must inspect raw Postgres bytes, prove workspace A cannot resolve workspace B's key, prove owner set/rotate/clear and editor/viewer denial, prove an editor cannot bypass the policy through the generic settings endpoint, prove no response contains the canary plaintext, and prove configured-but-undecryptable differs from absent.

### 16f.2 — Per-request Pi credential capture with env fallback

**Blocked by:** 16f.1.

**Delivers:** first-session injection before model selection plus request-time resolution at Pi's `ModelRegistry.getApiKeyAndHeaders()` boundary; explicit absence-only `ANTHROPIC_API_KEY` override; no ambient auth fallback or `process.env` mutation; resolution-scope `finally` cleanup and rotation/clear at the next provider request.

**Machine-checkable acceptance gate:**

```bash
pnpm --filter @hachej/boring-agent exec vitest run \
  src/server/harness/pi-coding-agent/__tests__/workspaceProviderCredentials.test.ts \
  src/server/tools/harness/__tests__/harness.test.ts
pnpm --filter @hachej/boring-agent typecheck
```

The fake-provider tests must run concurrent workspace A/B turns with distinct canaries, observe only the matching key at the provider call, cover cached prompt/follow-up/continuation/slash-command and compaction paths, prove missing-BYOK env fallback, seed ambient auth-file/OAuth credentials and prove they cannot shadow the env or no-credential result, prove unreadable-key fail-closed behavior, and retain the `Sandbox.exec` no-`ANTHROPIC_API_KEY` assertion. A lifecycle regression must block an active prompt, enqueue a follow-up whose API returns, then release Pi to make the queued provider call and observe only that workspace's canary; abort/drain must leave no override, and rotation/clear must affect the next provider request.

### 16f.3 — Host conformance and artifact-negative proof

**Blocked by:** 16f.2.

**Delivers:** full-app env-only compatibility plus the Step 1A host's two-workspace BYOK wiring and rollback-by-clear behavior. No platform-pooled key path.

**Machine-checkable acceptance gate:**

```bash
pnpm --filter @hachej/boring-core exec vitest run --no-file-parallelism \
  src/app/server/__tests__/workspaceProviderCredentials.test.ts
pnpm --filter @hachej/boring-core typecheck
pnpm --filter @hachej/boring-agent typecheck
pnpm lint:invariants
```

The integration fixture must prove two authorized workspaces cannot swap keys, clearing BYOK restores instance fallback, and canary plaintext is absent from captured logs, session/event records, sandbox exec env, and packed image/bundle inputs.

## Non-goals and triggers

- **No platform-billed pooled keys.** Trigger: #819 metering lands, then #809/BL1 approves billing, budgets, payer attribution, and failure policy.
- **No generic provider catalog or OAuth secret broker.** Trigger: a second hosted provider needs workspace BYOK and supplies key-name, rotation, validation, and fallback requirements.
- **No new event bus, usage ledger, or billing event.** Triggered event-shaped work reuses #807 T1; metering stays in #819.
- **No provider key in general sandbox/tool env, images, bundles, sessions, logs, or browser state.** A future model process running inside a sandbox may receive the key only for that process invocation.
- **No AgentHost, controller, CAS/publication journal, mutable runtime registry, deployment resolver, or second Workspace/Sandbox owner.** Any need for one stops this plan and requires a new decision; it is never an implementation shortcut.

## Planning proof

```bash
git diff --check
test -z "$(git diff --name-only origin/main...HEAD | grep -v '^docs/')"
rg -n '^## 27\.|Decision 27' docs/DECISIONS.md docs/issues/820/plan.md
```

## Planning review record

- **Tier 1 — fresh-eyes / Decision 27 and issue plan / revise:** closed generic-settings editor bypass, cached and alternate prompt-path coverage, ambient Pi auth shadowing, and direct-plus-file config wording.
- **Tier 2 — adversarial source and contract audit / revise, then clean:** replaced enqueue-method credential lifetime with request-bound Pi auth capture and added the queued-follow-up lifecycle gate; the final re-review found no remaining material issue.
