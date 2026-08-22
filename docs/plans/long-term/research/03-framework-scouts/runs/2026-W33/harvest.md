# Harvest — Flue 2.0.3 · eve 0.31.3 · opencode 1.18.16 · Managed Agents · +7 surveyed

## Findings

| id | statement | evidence | conf | sev | status |
|---|---|---|---|---|---|
| F-33-H1 | Flue keeps pi purely in-memory and injects its own record writer; pi's persistence is not used at all | `withastro/flue packages/runtime/src/session.ts` — "Storage: entirely Flue-supplied… writer injected as `ConversationRecordWriter`" | executed | — | open |
| F-33-H2 | The pi *core* is runtime-portable; `session.ts` imports no `node:*` builtin. `pi-coding-agent` is the non-portable package | same file; globals are Web/ECMAScript only | executed | — | open |
| F-33-H3 | Three frameworks independently converge on the same durability contract: admit-before-work, exactly one terminal outcome, at-least-once execution over exactly-once recording | Flue `guide/durability`; eve step journal; Managed Agents event log | reported | — | open |
| F-33-H4 | Uncertain side effects are surfaced, not retried: an unresolved *ordinary* tool call settles as an explicit unknown outcome the model can see | Flue tool-batch repair rules | reported | — | open |
| F-33-H5 | Human input is modelled as a durable journaled pause, not a blocked process; stale answers are demoted and never authorize the original call | eve `docs/tools/human-in-the-loop.md`; Managed Agents `requires_action` | reported | — | open |
| F-33-H6 | Managed Agents snapshots resolved, versioned agent config into every session — drain-by-session rollout with no new substrate | platform.claude.com `agent-setup`, `sessions` | reported | — | open |
| F-33-H7 | opencode's context win is a bounded catalog (~2,000 est-token signature budget) + per-namespace summaries + lexical search over omitted signatures + host-resident object-tree dispatch | `tool/code-mode.ts:10-18,111-123`; `codemode/src/tool-runtime.ts:70-97` | reported | — | open |
| F-33-H8 | "Simplest implementation" is false by measurement: search ≈64 lines, Code Mode core ≥4,284, interpreter runtime 3,294 | file lengths in `packages/codemode` | reported | — | open |
| F-33-H9 | `MCP.toolsMeta()` does not exist in official opencode; it is a third-party fork. Official is `MCP.tools()` | `packages/opencode/src/mcp/index.ts:145-156` | reported | — | open |
| F-33-H10 | Only Mastra and LangGraph Platform ship a real tenancy model, and both gate it commercially | Mastra `ee/` licence; LangSmith plan docs | reported | — | open |
| F-33-H11 | Nobody solves prompt-injection containment, output exfiltration, shell semantics, tool-result authorization, or confused-deputy across chained tools | W16 cross-framework sweep | reported | — | open |
| F-33-H12 | eve's `defineDynamic` would invalidate binding digest, generation pinning, replay assumptions and catalog inspection — do not adopt | W11 analysis | reported | — | wontfix |
| F-33-H13 | Flue rejects incompatible persisted state at startup (schema 5→8) rather than reinterpreting it; operators drain or reseed | `guide/migration` | reported | — | open |
| F-33-H14 | eve prints its wordmark for `info` without checking `--json`, so `eve info --json` is not parseable — cosmetic output escaping into machine mode | `dist/src/cli/run.js`, `commands/info.js` | reported | — | open |

## Not run

- eve executed paths — requires node ≥24, host has 22. All eve findings are source/docs only.
- Live model turns inside worker sandboxes — vault loopback and socket binds denied; the orchestrator ran the live halves by hand.

## Detail

Full reports: `research/r1-flue.md`, `r2-eve.md`, `r3-managed-agents.md`, `r5-source.md`, `r6-field.md`, `w13-opencode.md`, `c2-design-sweep.md`.
