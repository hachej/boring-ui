# C2 — Model Gateway + Policy TODO

### C2-001 — Wrapper Model Policy Module — M

- **Goal:** One shared policy module answers every "is this provider/model allowed" question.
- **Files to touch/create:**
  - `src/wrapper/model-policy.ts`
  - `src/wrapper/__tests__/model-policy.test.ts`
- **Steps:**
  1. Implement `isAllowedProvider(provider: string): boolean`.
  2. Implement `isAllowedModel(model: Pick<Model<Api>, "provider" | "id">): boolean` (ids or regexes from wrapper config).
  3. Implement `getBoringGatewayConfig(userToken): SaveOpenAiGatewayInput`.
  4. Implement `coerceToAllowedModel(model, fallback): Model<Api>`.
  5. Policy config covers: allowed providers, allowed model ids/regexes, default model, custom-gateway editability, provider-login visibility, BYO-key toggle (off by default).
  6. Fail closed on bad/missing policy config — unlike the UI-level `provider-allowlist.ts`, which is explicitly fail-open.
- **VERIFICATION:**
  - `npm test -- model-policy` — allow/deny/coerce/fail-closed cases pass.
  - `npm run check` — exits 0.
- **Acceptance criteria:**
  - Every policy question routes through this module; no second allowlist source.
  - Bad config denies rather than allows.
- **Estimated size:** M.

### C2-002 — Seed the Boring Gateway After Login — M

- **Goal:** Login provisions a first-party OpenAI-compatible gateway provider; no user key prompt in gateway-only mode.
- **Files to touch/create:**
  - `src/wrapper/boring-auth.ts` (post-login hook)
  - `src/wrapper/model-policy.ts` (`getBoringGatewayConfig`)
  - `src/wrapper/__tests__/gateway-seed.test.ts`
- **Steps:**
  1. Use `customProviders` returned by `initAppStorage()` (`src/storage/init-app-storage.ts:12-38`).
  2. Save/update the first-party gateway via `saveOpenAiGatewayConfig()` (`src/auth/custom-gateways.ts:259-312`).
  3. Authenticate the gateway with the A1 token or a hub-issued short-lived gateway token, per the PLAN's OPEN GATEWAY DECISION — do not implement both.
  4. Never ask the user for an OpenAI key unless BYO mode is enabled.
  5. Clear the gateway provider key on logout (C1-005 seam).
- **VERIFICATION:**
  - `npm test -- gateway-seed` — login seeds/updates the gateway; logout clears it; no key prompt in gateway-only mode.
- **Acceptance criteria:**
  - After login, the Boring gateway is the available default provider path.
  - The gateway token choice matches the recorded OPEN GATEWAY DECISION.
- **Estimated size:** M.

### C2-003 — Enforce Policy at Selection Paths (Selector, `/model`, Default) — M

- **Goal:** No UI selection path can produce a disallowed provider/model.
- **Files to touch/create:**
  - `src/taskpane/init.ts` (`refreshConfiguredProviders()` at `src/taskpane/init.ts:276-310`; `applyModelSelection()` at `src/taskpane/init.ts:1690-1715`)
  - `src/compat/model-selector-patch.ts` (`src/compat/model-selector-patch.ts:59-75`)
  - `src/taskpane/default-model.ts` (`pickDefaultModel()` at `src/taskpane/default-model.ts:83-145`)
  - `src/wrapper/__tests__/selection-policy.test.ts`
- **Steps:**
  1. Filter `availableProviders` inside `refreshConfiguredProviders()` before `setActiveProviders()`.
  2. Apply `isAllowedModel()` inside the model selector patch after active-provider filtering.
  3. Guard `applyModelSelection()` before mutating `runtime.agent.state.model`.
  4. Make `pickDefaultModel()` policy-aware so fallback never returns a disallowed model (including the absolute `openai/gpt-5.5` fallback).
- **VERIFICATION:**
  - `npm run test:models` — exits 0.
  - `npm test -- selection-policy` — selector/`/model`/default-fallback cases pass.
- **Acceptance criteria:**
  - Selector, `/model`, status-bar picker, and default fallback only surface allowed models.
- **Estimated size:** M.

### C2-004 — Enforce Policy on Restored Sessions + API-Key Prompting — M

- **Goal:** Persisted state and runtime key prompting cannot bypass policy.
- **Files to touch/create:**
  - `src/taskpane/sessions.ts` (`refreshPersistedModel()` at `src/taskpane/sessions.ts:51-86`)
  - `src/taskpane/init.ts` (`agent.getApiKey()` at `src/taskpane/init.ts:1090-1108`)
  - `src/wrapper/__tests__/session-restore-policy.test.ts`
- **Steps:**
  1. Reject disallowed restored session models in `refreshPersistedModel()` (or immediately after session apply) and coerce via `coerceToAllowedModel()` with a toast/log.
  2. Make `agent.getApiKey()` fail closed for disallowed providers instead of prompting.
- **VERIFICATION:**
  - `npm test -- session-restore-policy` — restored disallowed model coerced with a visible signal; disallowed provider key request fails closed.
- **Acceptance criteria:**
  - A restored session on a now-disallowed provider is coerced to the configured default, not silently kept.
  - No API-key prompt appears for a disallowed provider.
- **Estimated size:** M.

### C2-005 — Curate Provider/Gateway UI Surfaces — M

- **Goal:** Gateway-only mode shows no direct provider login or custom-gateway affordances.
- **Files to touch/create:**
  - `src/commands/builtins/settings-overlay.ts` (`src/commands/builtins/settings-overlay.ts:183-227`)
  - `src/taskpane/welcome-login.ts` (`src/taskpane/welcome-login.ts:35-63`, `src/taskpane/welcome-login.ts:103-190`, `src/taskpane/welcome-login.ts:238-263`)
  - `src/commands/builtins/model.ts` (`src/commands/builtins/model.ts:28-44`)
  - `src/wrapper/__tests__/ui-curation.test.ts`
- **Steps:**
  1. Replace `VISIBLE_PROVIDERS` usage in Settings and the welcome overlay with wrapper policy, or hide provider login entirely when gateway-only.
  2. Hide "Use a custom OpenAI-compatible gateway" unless BYO custom gateway is enabled.
  3. Keep `/model`, showing only allowed models.
- **VERIFICATION:**
  - `npm test -- ui-curation` — gateway-only mode hides provider rows and the custom-gateway option; BYO mode surfaces them.
  - `npm run check` — exits 0.
- **Acceptance criteria:**
  - `/model`, provider settings, and welcome login all follow the same policy module.
  - BYO-key mode is explicitly config-enabled and test-covered.
- **Estimated size:** M.

### C2-006 — boring-ui Gateway Server Bead (tracking) — S

- **Goal:** Track the server half; it lands in `hachej/boring-ui`, not the wrapper fork.
- **Files to touch/create:**
  - boring-ui: the gateway route/config per the resolved OPEN GATEWAY DECISION (files named in that PR)
  - this pack: record the decision resolution in `PLAN.md`
- **Steps:**
  1. Resolve the OPEN GATEWAY DECISION with the owner (proxy route yes/no; authenticating token; allowlist home).
  2. File/land the boring-ui bead per the decision; C2-002 consumes its endpoint.
- **VERIFICATION:**
  - Decision recorded in `PLAN.md`; boring-ui PR linked from this pack.
- **Acceptance criteria:**
  - C2-002's gateway base URL/token path matches the landed server behavior.
- **Estimated size:** S (tracking; server implementation sized in its own boring-ui PR).
