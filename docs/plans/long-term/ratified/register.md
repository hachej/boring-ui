# Findings register

Rows paste unchanged between reports, this register, and issues.
`reported` never triggers work. `disproven` rows are kept permanently.

## Open — security & authorization

| id | statement | evidence | conf | sev | filed |
|---|---|---|---|---|---|
| F-33-G1 | External plugins with `boring.server` are imported and executed in the unsandboxed host | `scan.ts:325`; `runtimeBackendRegistry.ts:228,241,243,186` | verified | critical | private — #1261 predicate |
| F-33-G2 | Scope brand emits no runtime value (`declare const … unique symbol`) | `shared/gateway/types.ts:38-48` | verified | critical | — |
| F-33-G3 | D27 workspace BYOK unimplemented; `ModelCapabilityIssuer` absent | `models/modelConfig.ts:92-98,112` | verified | critical | — |
| F-33-G4 | MCP grants gate display, not execution | `git grep` → 2 files; `composioManagedConnector.ts:281` | verified | critical | — |
| F-33-G15 | Model credentials cached beyond one invocation | C4 audit | reported | critical | — |
| F-33-G5 | Streamed events delivered without re-verifying scope | `embeddedGateway.ts:155` + subscribe closure | verified | high | — |
| F-33-G6 | Credential vault built, zero consumers | `git grep withResolvedCredential` | verified | high | — |
| F-33-G7 | Direct-mode shell inherits service env + host HOME | 3-hop trace to `{...process.env}` | verified | high | — |
| F-33-G16 | 23 convention-only / 15 enforced-by-code / 2 structural | C5 audit | reported | high | — |
| F-33-G14 | Mount resolution is check-then-bind | PR #1166 + bwrap source | reported | medium | PR #1166 |

## Open — durability, tools, DX

| id | statement | evidence | conf | sev | filed |
|---|---|---|---|---|---|
| F-33-G8 | Three (four) owners of session state; cursor fabricated by `Math.max` | `harnessPiChatService` | verified | high | — |
| F-33-G13 | Durable stream flag-gated off, one DB per host | `eventStreamStore.ts` | verified | high | — |
| F-33-G17 | Provisioning has no cross-process lock | C3 audit | reported | high | — |
| F-33-G9 | Tool collision machinery has no runtime caller | `mergeTools.ts` | verified | medium | #1226 |
| F-33-G10 | Host-tool precedence is untested and emergent | `buildAgentComposition.ts:181` | verified | medium | #1226 |
| F-33-G11 | Scaffold emits a broken slash command | both templates | verified | medium | #1233 |
| F-33-G12 | First run sends the developer to a second CLI | `cli/README.md` | verified | medium | #1233 |
| F-33-G18 | 6 concepts before step 1 vs 3 for peers | W17 study | reported | medium | #1233 |

## Disproven — kept

| id | statement | why it failed |
|---|---|---|
| F-33-C1 | "~3,700 lines of reconciliation" | components total 3,035 |
| F-33-C2 | "Flue's timeout is preemptive" | its own reference says cooperative |
| F-33-C3 | "Remove the date from the prompt" | there is no date; saves 0 |
| F-33-C4 | "Add an environment tail" | duplicates existing rules |
| F-33-C5 | "Replacing pi's prompt is a very high saving" | 692 tokens; the named API does not exist |
| F-33-C6 | L0 schema sketch | 8 fatal flaws |
| F-33-C8 | "Do L0 + L3, stop there" | creates the split authority it exists to remove |
| F-33-C9 | Always-on startup banner | no peer validates it; eve shows the `--json` leak |
| F-33-C10 | Inline key into pi's auth file / literal `--api-key` | foreign format; shell history and process listings |
| F-33-C11 | `verify` executes registration | destroys the static verifier's contract |
| F-33-C12 | Infer plugin shape silently | it is a trust branch, not a convenience |
| F-33-C13 | "Skill-path docs are broken" | live references resolve |
| F-33-C14 | "Tenancy is what the field charges for" | not supported by the two examples |
| F-33-R43 | `call_tool` preserves tool identity | pi emits only `toolName:"call_tool"` |

## Run summary

**2026-W33** · 6 competitors + pi · 6 subsystems audited · 6 spikes · 8 adversarial passes.
32 findings open, 14 disproven. Nine of the fourteen disproven were the orchestrator's own claims.
Filed: #1226 (rewrite), #1233 (DX), #1261 (external plugins), PR #1166, #900.
