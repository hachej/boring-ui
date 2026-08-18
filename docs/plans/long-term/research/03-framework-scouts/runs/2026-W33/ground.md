# Ground — subsystems: credentials · authorization · provisioning · plugins · tools · durability

## Findings

| id | statement | evidence | conf | sev | status |
|---|---|---|---|---|---|
| F-33-G1 | External plugins declaring `boring.server` are imported and executed in the unsandboxed host; the ownership check runs at dispatch, after module evaluation | `agentPlugins/scan.ts:325`; `runtimeBackendRegistry.ts:228,241,243,186` | verified | critical | open |
| F-33-G2 | `AuthorizedAgentScope`'s brand is `declare const … unique symbol` — no runtime value; D29's non-forgeability is a type-system property | `shared/gateway/types.ts:38-48` | verified | critical | open |
| F-33-G3 | D27 workspace BYOK is not implemented: the model path reads process env only; `ModelCapabilityIssuer` does not exist in `packages/` | `models/modelConfig.ts:92-98,112`; `git grep ModelCapabilityIssuer` → no hits | verified | critical | open |
| F-33-G4 | MCP grants gate display, not execution: `ResolvedMcpConnectorGrant` appears in 2 files, neither on the exec path; boring-mcp uses a static template allowlist | `git grep` → `mcpGrants.ts`, `runtimeCapabilityProjection.ts`; `composioManagedConnector.ts:281` | verified | critical | open |
| F-33-G5 | Scope is verified once at `connectSession` and the claim is captured in a closure; streamed events are delivered with no re-check | `embeddedGateway.ts:155` + subscribe callback | verified | high | open |
| F-33-G6 | The credential vault (envelope crypto, KMS backend, `withResolvedCredential`) is exported from the package index with zero consumers | `git grep withResolvedCredential` outside its own directory | verified | high | open |
| F-33-G7 | Direct-mode shell inherits the full service `process.env` and host `HOME`, making `~/.pi/agent/auth.json` reachable | `createDirectSandbox.ts:100` → `workspacePythonEnv.ts:30,35` → `environment.ts:2` | verified | high | open |
| F-33-G8 | Session state has three owners (four with the durable flag), and the snapshot fabricates a cursor as `Math.max(persisted.seq, liveSeq)` | `harnessPiChatService.readStateBeforeDispose` | verified | high | open |
| F-33-G9 | Tool collision machinery is dead code: nothing sets `collisionPolicy`, and `mergeTools` has no runtime caller | `catalog/mergeTools.ts`; `git grep collisionPolicy` | verified | medium | open |
| F-33-G10 | Host-tool precedence is an untested emergent property of one spread order; pi resolves first-wins | `buildAgentComposition.ts:181`; `pi-agent-core/dist/agent-loop.js:394` | verified | medium | open |
| F-33-G11 | Scaffold registers `<kebab>.page` but the generated slash command opens `<kebab>.panel` | `front-canonical.tsx:24`; `agent-canonical.ts:12` | verified | medium | open |
| F-33-G12 | First run directs the developer to install and authenticate a second CLI in another terminal | `packages/cli/README.md` | verified | medium | open |
| F-33-G13 | Durable stream is flag-gated off and uses one database for the whole host; busy-timeout and backoff are already present | `buildAgentComposition.ts`; `events/eventStreamStore.ts` | verified | high | open |
| F-33-G14 | Mount resolution is check-then-bind: a resolved string is stored and bwrap re-resolves it at bind time | PR #1166 + bwrap source | reported | medium | open |
| F-33-G15 | Model credentials are not invocation-scoped; `AuthStorage`, `ModelRegistry` and pi's `AgentSession` are cached beyond one invocation | C4 audit | reported | critical | open |
| F-33-G16 | Governance controls tally 23 convention-only, 15 enforced-by-code, 2 structural | C5 audit | reported | high | open |
| F-33-G17 | Provisioning has no cross-process lock; partial provisioning can serve a degraded workspace | C3 audit | reported | high | open |
| F-33-G18 | Onboarding requires 6 concepts before step 1 vs 3 for Flue and eve, while producing fewer files and faster feedback | W17 study | reported | medium | open |

## Not run

- B3, B4, B6, B8, B10 equivalents (F-33-G15/G16/G17) not yet traced to call sites by the orchestrator.

## Detail

`research/c3-provisioning-attack.md`, `c4-credentials-attack.md`, `c5-governance-audit.md`, `r9-audit.md`, `w17-dx-study.md`.
