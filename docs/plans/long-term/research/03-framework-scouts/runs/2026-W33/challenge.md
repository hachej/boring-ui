# Challenge — 8 adversarial passes over this run's own output

## Findings

| id | statement | evidence | conf | sev | status |
|---|---|---|---|---|---|
| F-33-C1 | The "~3,700 lines of reconciliation" figure was arithmetically false; its own components total 3,035 | recomputed from the same table | verified | — | disproven |
| F-33-C2 | "Flue enforces the submission timeout preemptively" is contradicted by its own reference: the deadline is checked cooperatively and not during provider calls | `reference/agent-api` vs `guide/durability` | verified | — | disproven |
| F-33-C3 | "Remove the date from the stable prompt" saves nothing — there is no date in pi's prompt or our append | `dist/core/system-prompt.js` | verified | — | disproven |
| F-33-C4 | "Add an environment tail" duplicates existing workspace/path rules and pi's cwd | A3 review | verified | — | disproven |
| F-33-C5 | "Replace pi's default prompt, very high saving" — removable default is 2,767 chars ≈ 692 tokens, and `customPrompt` does not exist; the seam is `DefaultResourceLoader.systemPromptOverride` | A3 review | verified | — | disproven |
| F-33-C6 | The L0 schema sketch had 8 fatal flaws (tree vs log, batch offsets undefined, no retry identity, settlement unenforced, tenancy not isolating) | V4 review | verified | — | disproven |
| F-33-C7 | The corrected schema still had 17 fatal / 20 serious problems; DDL did not execute as written | V5 review | verified | — | open |
| F-33-C8 | "Do L0 + L3, stop" creates the split authority the plan exists to remove — a durable-looking pause over an in-memory waiter | V3 review, with the reproducible sequence | verified | — | disproven |
| F-33-C9 | The always-on five-line startup banner is not validated by any peer; opencode is mode-aware, Flue emits run facts to stderr, eve demonstrates the leak into `--json` | `run.ts:643-730`, `serve.ts:4-19`, `dist/flue.js:1870-1903` | verified | — | disproven |
| F-33-C10 | Writing an API key to `~/.pi/agent/auth.json` and a persistent literal `--api-key` are unsafe (foreign format; shell history and process listings) | C1 review | verified | — | disproven |
| F-33-C11 | `verify` that imports and executes registration destroys the static verifier's contract and is underestimated by >1 order of magnitude | C1 review | verified | — | disproven |
| F-33-C12 | Collapsing the plugin-shape decision is wrong: shape is a capability/trust/lifecycle branch, and runtime tools bypass the sandbox | C1 review + `PLUGIN_SYSTEM.md` | verified | — | disproven |
| F-33-C13 | "Every skill-path pointer in the docs is broken" — false; live references resolve, the one bad pointer is in an archived plan | traced against main | verified | — | disproven |
| F-33-C14 | "Tenancy is what the field charges for" does not follow from two examples; LangGraph custom auth spans LangSmith plans | LangChain docs | verified | — | disproven |

## Contradicts

- Fourteen claims from this run's own harvest, plan and filed issues. All corrected in place: #1226 retitled and annotated, #1233 corrected, plan artifact revised twice.

## Detail

`research/v1`–`v5`, `a1`–`a3`, `c1`. Nine of fourteen were the orchestrator's own claims.
