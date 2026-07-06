# C2 — Model Gateway + Policy Plan

## Today / Delta

Today, provider availability derives from saved provider keys plus custom gateway providers (`src/taskpane/init.ts:269-310`). The provider connect UI has a build-time allowlist that is explicitly UI-level only and fail-open on bad config (`src/ui/provider-allowlist.ts:1-10`, `src/ui/provider-allowlist.ts:31-58`). `/model` only opens the model selector (`src/commands/builtins/model.ts:17-45`); the selector patch filters by active provider but not by model-id policy (`src/compat/model-selector-patch.ts:68-73`); default model selection can fall back to any configured provider or absolute `openai/gpt-5.5` (`src/taskpane/default-model.ts:83-145`). Custom OpenAI-compatible gateways already exist (`src/auth/custom-gateways.ts:192-216`, `src/auth/custom-gateways.ts:259-312`).

Delta (issue #551 phase 5): the default production path routes all model traffic through a Boring-hosted OpenAI-compatible gateway. BYO-key providers are optional and off by default. The wrapper gets a real model policy — allowed providers, allowed model ids/regexes, default model, whether custom gateways are user-editable, whether direct provider login surfaces are visible — enforced at **every** selection path: the selector, `/model`, default fallback, restored sessions, and API-key prompting.

## OPEN GATEWAY DECISION (must be resolved before the server bead lands)

Undecided, blocking the boring-ui server bead:

1. Whether boring-ui hosts an OpenAI-compatible proxy route (versus fronting an external gateway service).
2. Which token authenticates the gateway: the A1 workspace token, or a gateway-specific short-lived token issued by the hub.
3. Where the model allowlist lives (server-side gateway config vs wrapper policy vs both, and which side is authoritative).

Record the resolution in this file and in the boring-ui gateway bead's PR before implementation.

## Deliverables

- `src/wrapper/model-policy.ts`: `isAllowedProvider(provider)`, `isAllowedModel({provider, id})`, `getBoringGatewayConfig(userToken)`, `coerceToAllowedModel(model, fallback)`.
- Boring gateway seeded after login via `saveOpenAiGatewayConfig()` over `customProviders` from `initAppStorage()`; no OpenAI-key prompt unless BYO mode is enabled.
- Policy enforcement at every selection path: `refreshConfiguredProviders()` filtering, model-selector patch, `applyModelSelection()` guard, policy-aware `pickDefaultModel()`, restored-session rejection/coercion, fail-closed `agent.getApiKey()` for disallowed providers.
- Curated UI surfaces: provider rows/welcome overlay follow wrapper policy or are hidden in gateway-only mode; "Use a custom OpenAI-compatible gateway" hidden unless BYO custom gateway is enabled; `/model` shows only allowed models.
- The boring-ui gateway server bead (lands in `hachej/boring-ui`, gated on the OPEN GATEWAY DECISION above).

## Exit Criteria

- In gateway-only mode, the user can pick only Boring-approved gateway models.
- A restored session using a now-disallowed provider is coerced to the configured default with a toast/log, not silently kept.
- `/model`, status-bar picker, provider settings, welcome login, and runtime API-key prompting all enforce the same policy.
- BYO-key mode is explicitly enabled by config and covered by tests.
- `npm run test:models` passes; policy tests cover selector/default/session-restore paths.
