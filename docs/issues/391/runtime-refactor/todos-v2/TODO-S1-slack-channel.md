# TODO-S1 — Slack reference channel (`@hachej/boring-channel-slack`)

Handoff: self-contained work order for one autonomous coding agent (pi or gpt-5.5-xhigh). Cite plan files by relative path. No prior conversation assumed.

## Context (read first)

- Plan: `docs/issues/391/runtime-refactor/06-migration-phases.md` § "Phase S1" (deliverables + exit criteria). S1 depends on T2.
- Plan: `docs/issues/391/runtime-refactor/08-pluggable-agent-surfaces.md` § "Surface adapters" → "Channel ingress for free", § "Two handles (hard rule)", § "Human-in-the-loop", § "Event stream contract", and the reference-adapters table (Slack row). Read in full.
- Dependencies (must land first): **T1** (event envelope + on-stream approvals + `resolveInput`), **T2** (public transport contract + `sessionId`-only APIs), **P1** (`createAgent()` façade from `@hachej/boring-agent/server`). Note: `createAgent()` does **not** exist yet in the repo — `packages/agent/src/server/` currently exports `createAgentApp` (`createAgentApp.ts`) and `registerAgentRoutes` (`registerAgentRoutes.ts`) only. Consume `createAgent().send/resolveInput/replay/sessions` per `08` § "The headless façade"; if P1 has not landed, block on it — do not reach into harness internals.
- `@flue/slack` API (verified against the flue clone `packages/slack/src/index.ts`, Apache-2.0, pin `1.0.0-beta.x`; deps = `hono` + `@slack/types`, ZERO `@flue/runtime` imports):
  - `createSlackChannel<E>(options): SlackChannel<E>`.
  - `SlackChannelOptions { signingSecret: string; bodyLimit?: number; events?(input): SlackHandlerResult; interactions?(input): SlackHandlerResult; commands?(input): SlackHandlerResult }` — omitting a callback omits that route.
  - Callback inputs: `SlackEventsHandlerInput { c: Context<E>; payload: SlackEventsApiPayload }`, `SlackInteractionsHandlerInput { c; payload: SlackInteractionPayload }` (union incl. `SlackBlockActionsPayload { type:'block_actions'; actions: SlackBlockAction[]; user; team; response_url?; ... }`), `SlackCommandsHandlerInput { c; payload: SlackSlashCommandPayload }`.
  - `SlackHandlerResult = undefined | JsonValue | Response | Promise<...>` (return nothing → empty 200).
  - `SlackChannel { routes: ChannelRoute[]; conversationKey(ref: SlackThreadRef): string; parseConversationKey(id): SlackThreadRef }`. `SlackThreadRef { teamId; channelId; threadTs }`. Codec format is `slack:v1:<teamId>:<channelId>:<threadTs>` (URL-encoded segments), verified round-trip-checked in `parseConversationKey`.
  - `ChannelRoute { method: string; path: string; handler: Handler<E> }` where `Handler` is a Hono handler operating on a `Context` whose `c.req.raw` is a WHATWG `Request`.
  - Signature verification, payload parsing, and URL-verification challenge are handled **inside** the package. Retries are NOT deduped by the package (dedupe on `event_id` in the adapter).
- Egress is NOT in `@flue/slack`. Use `@slack/web-api` `WebClient` (`chat.postMessage`, `chat.update`) — verified as the plan's chosen egress (`08` Slack row).
- Existing package layout to mirror for a new workspace package: `packages/boring-bash/package.json` (scripts: `build`=`tsup`, `typecheck`=`tsc --noEmit`, `test`=`vitest run --passWithNoTests`, `check:invariants`, `lint`), exports map with `.`/`./shared`/`./server`. `pnpm-workspace.yaml` already globs `packages/*` — a new `packages/channels/slack` is NOT matched by `packages/*`; **add `packages/channels/*` to `pnpm-workspace.yaml`**.
- Two-handles rule (`08`): `sessionId` is runtime-owned; `conversationKey` is the surface-owned addressing handle. The adapter keeps its own `conversationKey → sessionId` map. Public agent APIs accept `sessionId` only.

## Goal / exit criteria

Match `06-migration-phases.md` Phase S1 exit criteria:
1. Same agent + same session store serves the workspace UI **and** a Slack thread.
2. An approval requested in Slack can be answered in Slack or the workspace.
3. The Slack package imports only the public agent contract (`@hachej/boring-agent` client/server) + `@flue/slack` + `@slack/web-api` — no `boring-bash` server code, no provider internals.
4. Adding a second channel (e.g. Teams) needs no new ingress code beyond the per-channel callback (proven by the shared Hono→Fastify wrapper).
5. Runs against `runtime: 'none'` and against readonly `company_context` bindings.

## Non-negotiables

- We write only: callback → `agent.send()`; `conversationKey → sessionId` store; egress + approval blocks via `@slack/web-api`; the shared Hono→Fastify handler wrapper. Ingress (signatures, parsing, codec) comes from `@flue/slack`.
- The Hono→Fastify wrapper is **shared and reusable** for every `@flue/*` channel — put it where other channel packages import it (`packages/channels/shared`, package `@hachej/boring-channel-core`), NOT inside the Slack package.
- Surface-owned addressing: the adapter owns the `conversationKey → sessionId` map. Never pass `teamId/channelId/threadTs` into agent APIs.
- Addressing isolation: one surface/team+channel+thread cannot resolve another's `sessionId`.
- No provider internals, no `boring-bash` import (governed context arrives as an injected readonly binding via the host, not by importing boring-bash).

## Do NOT

- Do NOT reimplement Slack signature verification, payload parsing, the URL-verification challenge, or the `conversationKey` codec — all are in `@flue/slack`.
- Do NOT create a second approval channel; approvals ride the agent event stream (T1) and resolve via `agent.resolveInput(sessionId, requestId, response)`.
- Do NOT block the Slack webhook on the full agent turn — ack fast (Slack's 3s rule), stream egress asynchronously.
- Do NOT put the Hono→Fastify wrapper inside the Slack package.
- Do NOT touch `/home/ubuntu/projects/boring-ui-v2`. Do NOT commit.

## Beads

### BBS1-001 — Shared Hono→Fastify channel handler wrapper (`@hachej/boring-channel-core`) (M)
- Description: Reusable util that mounts `@flue/*` `ChannelRoute[]` (Hono handlers over WHATWG `Request`) behind Fastify.
- Files: create `packages/channels/shared/` (package `@hachej/boring-channel-core`): `package.json` (mirror boring-bash scripts), `tsconfig.json`, `tsup.config.ts`, `src/index.ts`, `src/mountChannelRoutes.ts`; add `packages/channels/*` to `pnpm-workspace.yaml`.
- Notes: `mountChannelRoutes(fastify, basePath, routes: ChannelRoute[])` — for each route, register a Fastify handler that builds a WHATWG `Request` from the Fastify `req` (method, URL, headers, raw body — Slack signature check needs exact bytes, so capture the raw body buffer, do not let Fastify JSON-parse the channel routes) and invokes the Hono `handler` via a minimal Hono `Context` (or a mini `Hono` app: `const app = new Hono(); app.on(method, path, handler)` then `app.fetch(request)`). Map the returned `Response` back to Fastify (status, headers, body). Prefer the mini-Hono-app path — least glue, both documented as trivial in `08`. Keep it channel-agnostic (works for Teams/Discord/etc.).
- Tests: `packages/channels/shared/src/__tests__/mountChannelRoutes.test.ts` — a fake `ChannelRoute` echoing `req.raw` headers/body proves exact-byte passthrough and status/header mapping.
- Acceptance: raw request bytes reach the Hono handler unmodified; response round-trips; no Slack-specific code in this package.

### BBS1-002 — Slack package skeleton + ingress wiring (M)
- Description: `@hachej/boring-channel-slack` in `packages/channels/slack`; wire `createSlackChannel` callbacks to `agent.send()`.
- Files: `packages/channels/slack/package.json` (deps: `@flue/slack@1.0.0-beta.x` pinned, `@slack/web-api`, `@hachej/boring-channel-core`, `@hachej/boring-agent` [contract only], `hono`), `tsconfig.json`, `tsup.config.ts`, `src/index.ts`, `src/createSlackAdapter.ts`.
- Notes: `createSlackAdapter({ agent, signingSecret, slackToken, sessionStore, botUserId })` builds `createSlackChannel({ signingSecret, events, interactions, commands })`. In `events`: on a `message`/`app_mention` event, derive `SlackThreadRef` (`teamId` from `payload.team_id`, `channelId`/`threadTs` from the event — use `event.thread_ts ?? event.ts`), compute `conversationKey(ref)`, resolve/create `sessionId` via BBS1-003, dedupe on `payload.event_id`, then `agent.send({ sessionId, content: text, actor })` and return `undefined` (fast 200) while streaming egress in the background (BBS1-004). Ignore bot's own messages (`event.bot_id`/`botUserId`). Export the channel `routes` for `mountChannelRoutes`.
- Tests: `packages/channels/slack/src/__tests__/ingress.test.ts` — a signed `event_callback` with a user message triggers exactly one `agent.send` with the right content and a stable `sessionId`; a duplicate `event_id` triggers none; a bot message is ignored.
- Acceptance: message-in → one `agent.send`; retries/self-messages suppressed; webhook returns fast.

### BBS1-003 — `conversationKey → sessionId` store (S)
- Description: Surface-owned addressing map (the two-handles rule).
- Files: `packages/channels/slack/src/sessionStore.ts` (interface + default impl).
- Notes: Interface `SlackSessionStore { get(conversationKey): Promise<string | undefined>; create(conversationKey): Promise<string>; }`. **Default for the reference adapter: an in-memory `Map`** (`conversationKey → sessionId`) — smallest thing that proves the two-handles wiring. *Production option (one line): back it with a workspace-level SQLite table `slack_sessions(conversation_key PRIMARY KEY, session_id, created_at)` — self-contained, portable, matches the DS SQLite from T1 — behind the same interface.* `create()` allocates a fresh runtime `sessionId` (the agent owns it) and records the mapping. Isolation: keys are opaque `slack:v1:...` strings; a lookup for team A's key can never return team B's session.
- Tests: `.../__tests__/sessionStore.test.ts` — same `conversationKey` returns the same `sessionId`; distinct keys map to distinct sessions; a foreign key returns `undefined` (addressing isolation).
- Acceptance: stable per-thread session; isolation holds.

### BBS1-004 — Egress: text-delta batching into message updates (M)
- Description: Subscribe to the agent event stream and project it into Slack messages via `@slack/web-api`.
- Files: `packages/channels/slack/src/egress.ts`.
- Notes: For a turn, `agent.replay(sessionId,{startIndex})` / stream `AgentEvent`s (T1 envelope). Post an initial `chat.postMessage` (thread_ts = the ref's threadTs) to get a `ts`, then **batch text deltas and `chat.update` that message on a throttle**. Throttle strategy (specify + implement): coalesce deltas and flush at most once per throttle interval (**~1000 ms is an illustrative default, not a spec constant** — tune against Slack `chat.update` tier-3 limits, which tolerate steady updates but 429 bursts), plus an immediate flush on turn end / tool boundary; on 429 respect `Retry-After`. Map activity events → a lightweight status line (edit the same message or a leading context block); tool calls → a compact summary block. Keep one Slack message per assistant turn (grow it), not one per delta.
- Tests: `.../__tests__/egress.test.ts` (fake `WebClient`) — N text deltas over <1s produce 1 `postMessage` + bounded `chat.update` count (not N); turn-end forces a final flush; a 429 backs off.
- Acceptance: deltas batched (update count ≪ delta count); final content correct; 429 handled.

### BBS1-005 — Approvals: agent request → Slack interactive blocks → `resolveInput` (M)
- Description: Round-trip HITL over Slack, on the same event stream (`08` HITL).
- Files: `packages/channels/slack/src/approvals.ts`; wire the `interactions` callback in `createSlackAdapter`.
- Notes: When an approval/input-request event appears in the stream, render Slack `actions` blocks (Approve/Deny buttons) with `value` encoding `{ conversationKey, requestId }` (or a short opaque token mapping to it). In the `interactions` callback, on a `SlackBlockActionsPayload` (`type:'block_actions'`), parse the button `value`, resolve `sessionId` via the store, call `agent.resolveInput(sessionId, requestId, response)` where `response` is a `ResolveInputResponse` (the union defined in `TODO-T1`/`BBT1-004`) — an Approve/Deny button maps to `{ kind: 'approval', decision: 'approve' | 'deny' }`, a form submission to `{ kind: 'input', values }` — and update the message to reflect the decision. Because approvals are durable on the stream (T1), the same request can be answered from the workspace UI instead — do not add Slack-local state that would desync.
- Tests: `.../__tests__/approvals.test.ts` — an approval event renders buttons; a signed `block_actions` Approve calls `resolveInput` with the right `sessionId`/`requestId`; answering the same request from a second surface is consistent (no double-resolve error).
- Acceptance: Slack button answers the parked turn; cross-surface answer works.

### BBS1-006 — Surface adapter conformance suite (first consumer) (M)
- Description: The reusable surface-adapter conformance suite named in `08` § "Conformance" item 4, with Slack as first subject.
- Files: create `packages/channels/shared/src/testing/surfaceAdapterConformance.ts` (generic) + `packages/channels/slack/src/__tests__/slackConformance.test.ts` (Slack subject).
- Notes: The generic suite asserts, against a subject exposing `{ deliverInbound, collectOutbound, answerApproval, addressingKeyOf }`: (a) message-in → events-out ordering; (b) approval round-trip resolves the turn; (c) **addressing isolation** — a second subject's key cannot resolve the first's session. Run Slack against `runtime: 'none'` AND against a readonly `company_context` binding injected by the host (governed-context answering) — proving exit criterion 5 without importing boring-bash (the binding is supplied to `createAgent` by the test harness).
- Tests: the two files.
- Acceptance: `passed` for both runtime modes; isolation check fails a crossed key.

### BBS1-007 — Fastify mount example / host wiring doc (S)
- Description: Show a host mounting the Slack adapter via the shared wrapper (proves "second channel = just another callback").
- Files: `packages/channels/slack/README.md` + a runnable `packages/channels/slack/examples/mount.ts`.
- Notes: `mountChannelRoutes(fastify, '/slack', adapter.routes)`; env: `SLACK_SIGNING_SECRET`, `SLACK_BOT_TOKEN`. Note that a Teams channel would reuse `mountChannelRoutes` unchanged. No boring-bash import anywhere in the example.
- Tests: typecheck of the example (include it in the package tsconfig).
- Acceptance: example compiles; README documents the two-handles + no-boring-bash rules.

## Verification — exact commands verified against package.json scripts (new packages mirror boring-bash)

```bash
# after adding packages/channels/* to pnpm-workspace.yaml and installing:
pnpm install
pnpm --filter @hachej/boring-channel-core run typecheck
pnpm --filter @hachej/boring-channel-core run test
pnpm --filter @hachej/boring-channel-slack run build       # tsup
pnpm --filter @hachej/boring-channel-slack run typecheck   # tsc --noEmit
pnpm --filter @hachej/boring-channel-slack run test        # vitest run

# import-boundary + repo regression
pnpm audit:imports        # must show no boring-bash / provider-internal import from the slack package
pnpm run build:packages
pnpm run test
```
(New package `package.json` scripts MUST be: `build: tsup`, `typecheck: tsc --noEmit`, `test: vitest run --passWithNoTests`, `lint: pnpm run typecheck`, mirroring `packages/boring-bash/package.json`.)

## Review gates

- `packages/channels/slack` dependency list contains no `@hachej/boring-bash` and no provider internals (grep + `pnpm audit:imports`).
- Ingress code writes zero signature/parsing/codec logic — all from `@flue/slack`.
- Egress update count is bounded and ≪ delta count; 429 handled.
- Approval answerable from both Slack and workspace (no Slack-local desync).
- Addressing isolation test present and failing on a crossed key.
- `@flue/slack` pinned to an exact `1.0.0-beta.x`.
