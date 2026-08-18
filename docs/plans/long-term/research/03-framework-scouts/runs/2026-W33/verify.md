# Verify — call-site traces by the orchestrator

Promotions from `reported` to `verified`. Each required finding the call site, not the definition.

## Findings

| id | statement | evidence | conf | sev | status |
|---|---|---|---|---|---|
| F-33-V1 | The scope brand emits no runtime value | read `types.ts:38-48`: `declare const` produces no emitted binding | verified | critical | open |
| F-33-V2 | The model credential path never consults workspace settings | `readApiKeyEnv()` returns an env var *name*; config emits `apiKey: '$'+name` | verified | critical | open |
| F-33-V3 | The credential vault has no consumer | `git grep withResolvedCredential` outside its directory → only the index re-export | verified | high | open |
| F-33-V4 | MCP grants never reach the executable path | `ResolvedMcpConnectorGrant` present in exactly 2 files; boring-mcp uses `getMcpProviderTemplate(...).allowedTools` | verified | critical | open |
| F-33-V5 | Streamed events are delivered without re-verification | `connectSession` verifies once, captures `claim`, subscribe callback re-uses it | verified | high | open |
| F-33-V6 | External plugin server modules are imported into the host | filter *selects* `source.kind === "external" && serverPath`, then `importServerModule(...)` and `routes(...)` | verified | critical | open |
| F-33-V7 | Direct-mode exec inherits the whole service environment | three-hop trace ending at `return { ...process.env }` | verified | high | open |
| F-33-V8 | The scaffold's two templates disagree on the panel id | read both files | verified | medium | open |

## Not run

- F-33-G15 (credential caching), G16 (control tally), G17 (provisioning locks) remain `reported`. They must be traced to call sites before any work is scheduled on them.

## Detail

The pattern these traces exposed — **mechanism built, decision ratified, never wired** — is invisible to anyone reading the module that defines the mechanism. It only appears at the call site. Confirmed in five subsystems.
