# Composio security preflight

This checklist gates any boring-mcp implementation that talks to Composio or another managed connector provider.

The foundation plugin is provider-neutral. A Composio adapter may only land after this checklist is green for the target app/environment, or after the owner explicitly accepts the named gaps for a non-production spike.

## Required before product provider calls

- [ ] The Composio project/account used by the app is isolated from unrelated production data.
- [ ] `COMPOSIO_API_KEY` is resolved server-side only.
- [ ] The key is stored in an app-approved secret backend such as server environment, Vault, KMS, or another server-only secret store.
- [ ] The key is never exposed to browser bundles, workspace files, agent prompts, session transcripts, audit payloads, or logs.
- [ ] MCP session headers are treated as secret material.
- [ ] Provider OAuth codes, provider access tokens, refresh tokens, cookies, and raw connected-account secrets are never returned to browser or agent tools.
- [ ] Browser DTOs for connect/status/probe/search/describe contain only secret-free source/tool/status summaries.
- [ ] Log redaction covers connector API keys, MCP session headers, OAuth codes, bearer tokens, cookies, and seeded canary strings.
- [ ] Provider result/error redaction is tested with seeded canaries before agent/browser output.
- [ ] Revoke/disconnect and connected-account status behavior is verified for each live provider slice.
- [ ] Data residency, subprocessors, DPA/security review, and incident-history risk are accepted for production use, or the work is explicitly marked non-production.

## Adapter implementation rules

A managed connector adapter must keep these boundaries:

```txt
browser/UI       → boring-mcp app-owned endpoints only
agent tools      → boring-mcp bridge tools only
boring-mcp       → connector provider through server-only adapter
connector secret → server-only resolver, never DTO/log/prompt/workspace file
```

Forbidden in adapter PRs:

```txt
raw connector API key in front/shared code
raw MCP session headers in browser DTOs
raw provider OAuth token in source/tool DTOs
raw connector meta-tools exposed as agent tools
provider execution before deny-before-allow policy passes
```

## PR evidence template

Every managed connector PR must include:

```txt
Secret resolver used:
Secret values printed/logged: no
Browser DTO contains session headers/tokens: no
Canary redaction test: pass
Disconnect/revoke status checked: pass or accepted gap
DPA/security/subprocessor status: accepted / non-production only / blocked
Line cap output: <n> / <cap>
Thermo review: GREEN
```

## Owner acceptance for temporary gaps

For non-production spikes, a gap may be accepted only when the PR states:

```txt
accepted gap:
owner:
reason:
expiration / follow-up PR:
production blocked until resolved: yes/no
```

Production launch cannot depend on unresolved gaps unless explicitly accepted by the owner in the launch PR.
