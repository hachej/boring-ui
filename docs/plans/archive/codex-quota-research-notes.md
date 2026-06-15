# Research: OpenAI Codex subscription quota APIs

## Summary

OpenAI Codex subscription quota can be read either through the official Codex CLI app-server JSON-RPC surface or the underlying ChatGPT WHAM endpoint. For a local dashboard, prefer `codex app-server` (`account/rateLimits/read`) when the `codex` binary and login are available; use direct `GET https://chatgpt.com/backend-api/wham/usage` only as a fallback because it is undocumented/internal and requires ChatGPT OAuth credentials, not a standard OpenAI API key.

## Findings

1. **Primary REST endpoint is WHAM usage** — Community docs and tools identify `GET https://chatgpt.com/backend-api/wham/usage` as the endpoint returning Codex subscription quota windows. Required headers are `Authorization: Bearer <access_token>` and `Accept: application/json`; `ChatGPT-Account-Id: <account_id>` is recommended/optional depending on account setup. Response includes `plan_type`, `rate_limit.primary_window`, `rate_limit.secondary_window`, optional `code_review_rate_limit`, and optional `credits`. [OpenUsage Codex provider docs](https://github.com/robinebers/openusage/blob/main/docs/providers/codex.md)
2. **Window semantics are implementation-ready** — `primary_window` is documented as the 5h rolling window (`limit_window_seconds: 18000`) and `secondary_window` as the 7d/weekly window (`limit_window_seconds: 604800`), each with `used_percent` and `reset_at` Unix seconds. Both windows are enforced simultaneously. [OpenUsage Codex provider docs](https://github.com/robinebers/openusage/blob/main/docs/providers/codex.md)
3. **Codex auth is OAuth/ChatGPT auth, not API keys** — The expected local auth payload contains `tokens.access_token`, `tokens.refresh_token`, `tokens.id_token`, `tokens.account_id`, and `last_refresh`. Lookup locations include `$CODEX_HOME/auth.json`, `~/.config/codex/auth.json`, `~/.codex/auth.json`, and on macOS keychain service `Codex Auth`; keyring/auto modes may remove file auth. [OpenUsage Codex provider docs](https://github.com/robinebers/openusage/blob/main/docs/providers/codex.md)
4. **Token refresh flow exists** — Access tokens are short-lived; refresh when `last_refresh` is older than ~8 days or after 401/403 by POSTing to `https://auth.openai.com/oauth/token` with form fields `grant_type=refresh_token`, client id `app_EMoamEEZ73f0CkXaXp7hrann`, and `refresh_token`. [OpenUsage Codex provider docs](https://github.com/robinebers/openusage/blob/main/docs/providers/codex.md)
5. **Official local alternative: Codex app-server JSON-RPC** — Codex app-server exposes account APIs: `account/read` and `account/rateLimits/read`; the latter returns `rateLimits.primary` and `rateLimits.secondary` with `usedPercent`, `windowDurationMins`, and `resetsAt`. This avoids directly handling OAuth tokens and tracks the account Codex is logged into. [OpenAI Codex app-server README](https://github.com/openai/codex/blob/be5e8fbd379481275d0b7c3823a57a537dac13ec/codex-rs/app-server/README.md)
6. **Existing tools validate app-server approach** — `codex-limit` starts a short-lived `codex app-server`, fetches quota via JSON-RPC, and outputs JSON like `{ limitId, primary: { usedPercent, windowDurationMins, resetsAt }, secondary: ... , plan }`. This is a good implementation model for a dashboard collector. [codex-limit](https://github.com/kajiwara321/codex-limit)

## Suggested normalized JSON

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-06-12T00:00:00.000Z",
  "provider": "openai-codex",
  "source": "codex-app-server",
  "auth": {
    "mode": "chatgpt",
    "accountId": "account-...",
    "email": "user@example.com",
    "plan": "plus"
  },
  "windows": [
    {
      "id": "primary",
      "label": "5h / burst",
      "durationSeconds": 18000,
      "usedPercent": 6,
      "remainingPercent": 94,
      "resetAt": "2026-06-12T05:00:00.000Z",
      "resetAtUnix": 1781230000
    },
    {
      "id": "secondary",
      "label": "weekly",
      "durationSeconds": 604800,
      "usedPercent": 24,
      "remainingPercent": 76,
      "resetAt": "2026-06-18T00:00:00.000Z",
      "resetAtUnix": 1781740800
    }
  ],
  "credits": {
    "hasCredits": true,
    "unlimited": false,
    "balance": 820.6969075
  },
  "raw": {}
}
```

Mapping notes:

- WHAM `rate_limit.primary_window.used_percent` → `windows[id=primary].usedPercent`.
- WHAM `reset_at` is Unix seconds; convert to ISO for UI but preserve numeric value.
- App-server `windowDurationMins` must be multiplied by 60.
- `remainingPercent = max(0, 100 - usedPercent)`.
- Label `durationSeconds === 18000` as `5h / burst`; `604800` as `weekly`; otherwise `custom`.

## Implementation plan

1. Add a plugin agent tool `refresh_codex_quota` that writes `.pi/data/ccusage-dashboard/quota-openai-codex.json`.
2. Collector strategy:
  - First try `codex app-server` if `codex` is on PATH.
  - JSON-RPC sequence: start process `codex -s read-only -a untrusted app-server` (or current Codex-supported equivalent), send `initialize`, `initialized`, then `account/read` and `account/rateLimits/read`.
  - Normalize `rateLimits.primary/secondary`.
  - If app-server unavailable, fallback to direct WHAM using OAuth credentials from `CODEX_HOME/auth.json`, `~/.config/codex/auth.json`, `~/.codex/auth.json`, or vault-provided ChatGPT OAuth fields.
3. Vault expectations:
  - Standard OpenAI API keys are not enough for subscription quotas.
  - Need ChatGPT/Codex OAuth `access_token` and likely `account_id`, or a way to read local Codex auth files/keychain.
4. Cache:
  - Cache at least 60s; 5 min is safer for dashboard polling.
  - On 401/403, try refresh token once, persist updated token only to the same credential source if safe.
  - On 429/server errors, keep previous JSON and update `error` + `stale: true` rather than clearing data.

## Sources

- Kept: OpenUsage Codex provider docs ([https://github.com/robinebers/openusage/blob/main/docs/providers/codex.md](https://github.com/robinebers/openusage/blob/main/docs/providers/codex.md)) — clearest endpoint, auth, response schema, refresh details.
- Kept: OpenAI Codex app-server README ([https://github.com/openai/codex/blob/be5e8fbd379481275d0b7c3823a57a537dac13ec/codex-rs/app-server/README.md](https://github.com/openai/codex/blob/be5e8fbd379481275d0b7c3823a57a537dac13ec/codex-rs/app-server/README.md)) — official local JSON-RPC surface for account/rate limits.
- Kept: codex-limit ([https://github.com/kajiwara321/codex-limit](https://github.com/kajiwara321/codex-limit)) — practical proof that app-server can be used on demand and normalized to JSON.
- Kept: CodexBar docs ([https://github.com/steipete/CodexBar/blob/v0.20/docs/codex.md](https://github.com/steipete/CodexBar/blob/v0.20/docs/codex.md)) — corroborates auth file and app-server fallback behavior.
- Dropped: SEO/blog duplicates unless they added unique auth/response details.

## Gaps

- Need to inspect the local installed Codex CLI version for exact app-server command flags and JSON-RPC schema; flags may change by version.
- Need to verify vault contains ChatGPT OAuth tokens rather than only OpenAI API keys.
- Need to test response shape against this user’s account; some accounts may have extra `code_review_rate_limit` or multiple limit ids.