# TODO-S1 — Slack reference channel (`@hachej/boring-channel-slack`)

Handoff: self-contained work order for one autonomous coding agent (pi or gpt-5.5-xhigh). Cite plan files by relative path. No prior conversation assumed.

## Context (read first)

- Plan: `docs/issues/391/runtime-refactor/INDEX.md` § "Phase S1" (deliverables + exit criteria). S1 depends on T2 and P6a/BBP6-009.
- Plan: `docs/issues/391/runtime-refactor/architecture/08-pluggable-agent-surfaces.md` § "Surface adapters" → "Channel ingress for free", § "Two handles (hard rule)", § "Human-in-the-loop", § "Event stream contract", and the reference-adapters table (Slack row). Read in full.
- Dependencies (must land first): **T1** (event envelope + on-stream approvals + `resolveInput`), **T2** (public transport contract + `sessionId`-only APIs), **P1** (`createAgent()` façade from the canonical `@hachej/boring-agent/core` entry). Note: `createAgent()` does **not** exist yet in the repo — `packages/agent/src/server/` currently exports `createAgentApp` (`createAgentApp.ts`) and `registerAgentRoutes` (`registerAgentRoutes.ts`) only. Consume `createAgent().send/resolveInput/stream/sessions` per `08` § "The headless façade"; if P1 has not landed, block on it — do not reach into harness internals.
- `@flue/slack` API (architecture 08 verified Flue @ `ffbe359`; this prep worktree does **not** vendor Flue, so BBS1-002's first action must re-resolve npm metadata and validate the installed package/types before coding; pin the **exact resolved** `1.0.0-beta.<N>` — never `.x`; deps = `hono` + `@slack/types`, ZERO `@flue/runtime` imports):
  - `createSlackChannel<E>(options): SlackChannel<E>`.
  - `SlackChannelOptions { signingSecret: string; bodyLimit?: number; events?(input): SlackHandlerResult; interactions?(input): SlackHandlerResult; commands?(input): SlackHandlerResult }` — omitting a callback omits that route.
  - Callback inputs: `SlackEventsHandlerInput { c: Context<E>; payload: SlackEventsApiPayload }`, `SlackInteractionsHandlerInput { c; payload: SlackInteractionPayload }` (union incl. `SlackBlockActionsPayload { type:'block_actions'; actions: SlackBlockAction[]; user; team; response_url?; ... }`), `SlackCommandsHandlerInput { c; payload: SlackSlashCommandPayload }`.
  - `SlackHandlerResult = undefined | JsonValue | Response | Promise<...>` (return nothing → empty 200).
  - `SlackChannel { routes: ChannelRoute[]; conversationKey(ref: SlackThreadRef): string; parseConversationKey(id): SlackThreadRef }`. `SlackThreadRef { teamId; channelId; threadTs }`. Codec format is `slack:v1:<teamId>:<channelId>:<threadTs>` (URL-encoded segments), verified round-trip-checked in `parseConversationKey`.
  - `ChannelRoute { method: string; path: string; handler: Handler<E> }` where `Handler` is a Hono handler operating on a `Context` whose `c.req.raw` is a WHATWG `Request`.
  - Signature verification, payload parsing, and URL-verification challenge are handled **inside** the package. Retries are NOT deduped by the package (dedupe on `event_id` in the adapter).
- Egress is NOT in `@flue/slack`. Use `@slack/web-api` `WebClient` (`chat.postMessage`, `chat.update`) — verified as the plan's chosen egress (`08` Slack row).
- Existing package layout to mirror for a new workspace package: `packages/boring-bash/package.json` (scripts: `build`=`tsup`, `typecheck`=`tsc --noEmit`, `test`=`vitest run --passWithNoTests`, `check:invariants`, `lint`), exports map with `.`/`./shared`/`./server`. `pnpm-workspace.yaml` already globs `packages/*` — a new `packages/channels/slack` is NOT matched by `packages/*`; **add `packages/channels/*` to `pnpm-workspace.yaml`**. Root `build:packages` is also filtered to `./packages/*` + `./plugins/*`; in the same S1 PR, add `--filter './packages/channels/*'` (or the exact package filter) so `pnpm run build:packages`, root `typecheck`, and root `test` include the Slack package.
- Current `@hachej/boring-agent` manifest has no `./core` or `./testing` export yet. P1 adds `./core`; S1 BBS1-006 adds `./testing`. If `@hachej/boring-agent/core` is absent, STOP+report P1 missing. When BBS1-006 lands, add both `packages/agent/package.json` export-map entry and `packages/agent/tsup.config.ts` entry for `testing/index`.
- **Amendment (2026-07-08):** STOP+report if P6a/BBP6-009's `AgentDefinitionDeclaration` is absent. Slack agent binding must consume that declaration or a lossless projection from the canonical registry; do not create a Slack-local agent/vertical schema.
- Two-handles rule (`08`): `sessionId` is runtime-owned; `conversationKey` is the surface-owned addressing handle. The adapter keeps its own `state.db` `conversationKey → sessionId` map. Public agent APIs accept `sessionId` only.

## Goal / exit criteria

Match `INDEX.md` Phase S1 exit criteria:
1. Same agent + same session store serves the workspace UI **and** a Slack thread.
2. An approval requested in Slack can be answered in Slack or the workspace.
3. The Slack package imports only the public agent contract (`@hachej/boring-agent` client/server) + `@flue/slack` + `@slack/web-api` — no `boring-bash` server code, no provider internals.
4. Adding a second channel (e.g. Teams) needs no new ingress code beyond the per-channel callback; the wrapper is channel-agnostic in shape inside Slack, and extraction waits until a second channel lands.
5. Runs against `runtime: 'none'` and against readonly `company_context` bindings.

## Non-negotiables

- We write only: callback → `agent.start()` (admission; the runtime allocates the `sessionId`) + `agent.stream(sessionId, { startIndex })` (egress); `state.db` `conversationKey → sessionId` store; egress + approval blocks via `@slack/web-api`; the Hono→Fastify handler wrapper kept inside Slack. Ingress (signatures, parsing, codec) comes from `@flue/slack`.
- The Hono→Fastify wrapper lives **inside `packages/channels/slack`** — Slack is the only channel that exists, so a shared package would be a single-consumer abstraction (forbidden). Keep the wrapper channel-agnostic in shape, but do **not** hoist it into a shared package upfront. **Extract `packages/channels/shared` (`@hachej/boring-channel-core`) only when a second `@flue/*` channel actually lands** — that second channel is the state trigger.
- Surface-owned addressing: the adapter owns the `conversationKey → sessionId` map in `state.db`. Never pass `teamId/channelId/threadTs` into agent APIs.
- Addressing isolation: one surface/team+channel+thread cannot resolve another's `sessionId`.
- No provider internals, no `boring-bash` import (governed context arrives as an injected readonly binding via the host, not by importing boring-bash).
- **Environment-attachment / env-options note (`09` security invariant 5):** the readonly `company_context` (or any governed fs) attachment REQUIRES a workspace-bound context (`BoundFilesystemContext.workspaceId` is real). The Slack-only / pure deploy runs `runtime: 'none'` with **no attachments** until the host binds the session to a workspace; the adapter **never synthesizes a `workspaceId`** to attach governed context. So exit criterion 5's two env options are: (a) `runtime: 'none'` (no workspace binding, no attachments), and (b) readonly `company_context` bindings **only when the host has bound the Slack session to a workspace**.

## Do NOT

- Do NOT reimplement Slack signature verification, payload parsing, the URL-verification challenge, or the `conversationKey` codec — all are in `@flue/slack`.
- Do NOT create a second approval channel; approvals ride the agent event stream (T1) and resolve via `agent.resolveInput(sessionId, requestId, response)`.
- Do NOT block the Slack webhook on the full agent turn — ack fast (Slack's 3s rule), stream egress asynchronously.
- Do NOT create an upfront shared `@hachej/boring-channel-core` package for a single channel — keep the Hono→Fastify wrapper inside `packages/channels/slack` until a second `@flue/*` channel exists.
- Do NOT touch `/home/ubuntu/projects/boring-ui-v2`. Work on a dedicated branch/worktree per the PR-PLAN branch naming; never commit to main directly; every bead lands as a PR per INDEX.

## Beads

### BBS1-001 — Hono→Fastify channel handler wrapper (inside the Slack package) (M)
- Description: Util that mounts `@flue/*` `ChannelRoute[]` (Hono handlers over WHATWG `Request`) behind Fastify. Lives inside `packages/channels/slack` — **not** an upfront shared package (single consumer).
- Files: create `packages/channels/slack/src/mountChannelRoutes.ts` (+ export from `src/index.ts`); add `packages/channels/*` to `pnpm-workspace.yaml` (needed for the Slack package itself); update root `package.json` `build:packages` so the aggregate build includes `./packages/channels/*`.
- Notes: `mountChannelRoutes(fastify, basePath, routes: ChannelRoute[])` — for each route, register a Fastify handler that builds a WHATWG `Request` from the Fastify `req` (method, URL, headers, raw body — Slack signature check needs exact bytes, so capture the raw body buffer, do not let Fastify JSON-parse the channel routes) and invokes the Hono `handler` via a minimal Hono `Context` (or a mini `Hono` app: `const app = new Hono(); app.on(method, path, handler)` then `app.fetch(request)`). Map the returned `Response` back to Fastify (status, headers, body). Prefer the mini-Hono-app path — least glue, both documented as trivial in `08`. Keep its shape channel-agnostic (so a future second `@flue/*` channel can reuse it), but **do not hoist it to a shared package yet** — extract `packages/channels/shared` (`@hachej/boring-channel-core`) **only when that second channel actually lands** (state trigger; no-abstraction-without-two-consumers).
- Tests: `packages/channels/slack/src/__tests__/mountChannelRoutes.test.ts` — a fake `ChannelRoute` echoing `req.raw` headers/body proves exact-byte passthrough and status/header mapping.
- Acceptance: raw request bytes reach the Hono handler unmodified; response round-trips; the wrapper is channel-agnostic in shape but ships inside the Slack package (no upfront shared package).

### BBS1-002 — Slack package skeleton + ingress wiring (M)
- Description: `@hachej/boring-channel-slack` in `packages/channels/slack`; wire `createSlackChannel` callbacks to `agent.start()` (admission) + `agent.stream()` (egress).
- **First action (before any code — the pin is non-negotiable):** RESOLVE and record the **exact** published `@flue/slack` version from npm metadata (`npm view @flue/slack version` / `npm view @flue/slack dist-tags` — the current `1.0.0-beta.<N>`) and write that resolved exact version into `package.json` as the literal pin (e.g. `"@flue/slack": "1.0.0-beta.7"`, no `^`/`~`/`.x`). `1.0.0-beta.x` in this pack is a **placeholder for "the beta line", not a valid pin** — never ship `.x`. Record the resolved version + resolution date in the PR description so the pin is auditable. If the installed package's exported symbols differ from the API above, STOP+report with the exact installed version and diff; do not reimplement Slack ingress.
- Files: `packages/channels/slack/package.json` (deps: `@flue/slack` pinned to the **exact resolved `1.0.0-beta.<N>`** version — see First action, `@slack/web-api`, `@hachej/boring-agent` [contract only], `hono`), `tsconfig.json`, `tsup.config.ts`, `src/index.ts`, `src/createSlackAdapter.ts`. (No `@hachej/boring-channel-core` dep — the Hono→Fastify wrapper is local, BBS1-001.)
- Notes: `createSlackAdapter({ agent, signingSecret, slackToken, sessionStore, botUserId })` builds `createSlackChannel({ signingSecret, events, interactions, commands })`. In `events`: on a `message`/`app_mention` event, derive `SlackThreadRef` (`teamId` from `payload.team_id`, `channelId`/`threadTs` from the event — use `event.thread_ts ?? event.ts`), compute `conversationKey(ref)`, dedupe on `payload.event_id`, then resolve the runtime-owned `sessionId` **via the two-handles flow — the store never allocates it (BBS1-003)**: look it up with `sessionStore.get(conversationKey)`; if **absent (first message)**, call `agent.start({ content: text, actor, originSurface: 'slack' })` **without a `sessionId`** — the adapter writes `originSurface: 'slack'` on session creation (the `originSurface` field on `AgentSendInput` — type defined in P1/BBP1-002; session-create provenance semantics specified in `TODO-T2` BBT2-001; consumed by S3's origin badge) — and persist `sessionStore.set(conversationKey, receipt.sessionId)`; if **present**, issue the follow-up turn on the existing session (`agent.start({ sessionId, content: text, actor })`). Return `undefined` (fast 200) while streaming egress in the background from the receipt's `{ sessionId, startIndex }` (BBS1-004). Ignore bot's own messages (`event.bot_id`/`botUserId`). Export the channel `routes` for `mountChannelRoutes`.
- Tests: `packages/channels/slack/src/__tests__/ingress.test.ts` — a signed `event_callback` with a **first** user message triggers exactly one `agent.start` **without a `sessionId`** and persists `conversationKey → receipt.sessionId`; a **second** message on the same thread issues a follow-up on the stored `sessionId` (no new allocation, store `get` hit); a duplicate `event_id` triggers none; a bot message is ignored.
- Acceptance: first message-in → one `agent.start` (runtime allocates the `sessionId`); follow-ups reuse the stored `sessionId`; retries/self-messages suppressed; webhook returns fast.

### BBS1-003 — `conversationKey → sessionId` `state.db` store (S)
- Description: Surface-owned addressing map (the two-handles rule).
- Files: `packages/channels/slack/src/sessionStore.ts` (interface + default impl).
- Notes: Interface `SlackSessionStore { get(conversationKey): Promise<string | undefined>; set(conversationKey, sessionId): Promise<void>; }` — **a get/set mapping only. The store NEVER allocates `sessionId`s.** The runtime owns `sessionId` allocation (two-handles rule): on the **first** message for a `conversationKey` the adapter calls `agent.start(input)` **without** a `sessionId` and persists `conversationKey → receipt.sessionId` via `set(...)`; every later message for that key looks the `sessionId` up via `get(...)` and reuses it. The store is a pure address-book, not a session factory. **Default for the reference adapter: a `state.db` table** `slack_sessions(conversation_key PRIMARY KEY, session_id, created_at, updated_at)` behind the same interface — self-contained, portable, and aligned with T1's backend state-store discipline. An in-memory `Map` implementation is allowed for tests only. Isolation: keys are opaque `slack:v1:...` strings; a lookup for team A's key can never return team B's session.
- Tests: `.../__tests__/sessionStore.test.ts` — after `set(key, sid)`, `get(key)` returns `sid` (stable per-thread mapping); distinct keys map to distinct sessions; a foreign/unknown key returns `undefined` (addressing isolation). Assert the store exposes no allocation method — it never mints a `sessionId`.
- Acceptance: stable per-thread session mapping persisted in `state.db` (runtime-allocated `sessionId` from `agent.start`); the store only gets/sets; isolation holds; in-memory `Map` usage is confined to tests.

### BBS1-004 — Egress: text-delta batching into message updates (M)
- Description: Subscribe to the agent event stream and project it into Slack messages via `@slack/web-api`.
- Files: `packages/channels/slack/src/egress.ts`.
- Notes: For a turn, `agent.stream(sessionId,{startIndex})` — the read primitive: replay-from-offset + live-tail of `AgentEvent`s (T1 envelope). Post an initial `chat.postMessage` (thread_ts = the ref's threadTs) to get a `ts`, then **batch text deltas and `chat.update` that message on a throttle**. Throttle strategy (specify + implement): coalesce deltas and flush at most once per throttle interval (**~1000 ms is an illustrative default, not a spec constant** — tune against Slack `chat.update` tier-3 limits, which tolerate steady updates but 429 bursts), plus an immediate flush on turn end / tool boundary; on 429 respect `Retry-After`. Map activity events → a lightweight status line (edit the same message or a leading context block); tool calls → a compact summary block. Keep one Slack message per assistant turn (grow it), not one per delta.
- Tests: `.../__tests__/egress.test.ts` (fake `WebClient`) — N text deltas over <1s produce 1 `postMessage` + bounded `chat.update` count (not N); turn-end forces a final flush; a 429 backs off.
- Acceptance: deltas batched (update count ≪ delta count); final content correct; 429 handled.

### BBS1-005 — Approvals: agent request → Slack interactive blocks → `resolveInput` (M)
- Description: Round-trip HITL over Slack, on the same event stream (`08` HITL).
- Files: `packages/channels/slack/src/approvals.ts`; wire the `interactions` callback in `createSlackAdapter`.
- Notes: When an approval/input-request event appears in the stream, render Slack `actions` blocks (Approve/Deny buttons) with `value` encoding `{ conversationKey, requestId }` (or a short opaque token mapping to it). In the `interactions` callback, on a `SlackBlockActionsPayload` (`type:'block_actions'`), parse the button `value`, resolve `sessionId` via the store, call `agent.resolveInput(sessionId, requestId, response)` where `response` is a `ResolveInputResponse` (the union defined in `TODO-T1`/`BBT1-004`) — an Approve/Deny button maps to `{ kind: 'approval', decision: 'approve' | 'deny' }`, a form submission to `{ kind: 'input', values }` — and update the message to reflect the decision. Because approvals are durable on the stream (T1), the same request can be answered from the workspace UI instead — do not add Slack-local state that would desync.
- Tests: `.../__tests__/approvals.test.ts` — an approval event renders buttons; a signed `block_actions` Approve calls `resolveInput` with the right `sessionId`/`requestId`; answering the same request from a second surface is consistent (no double-resolve error).
- Acceptance: Slack button answers the parked turn; cross-surface answer works.

### BBS1-006 — Surface adapter conformance suite (neutral home; Slack first subject) (M)
- Description: The reusable surface-adapter conformance suite named in `08` § "Conformance" item 4 lives in a **neutral home from the start** — the `@hachej/boring-agent/testing` subpath — with Slack as the first subject. S2 is the named second consumer (satisfying the two-consumer rule that justifies the shared home); it imports the suite from this subpath, never from the Slack package.
- Files: create `packages/agent/src/testing/surfaceAdapterConformance.ts` (generic, framework-agnostic — no Slack import) and expose it via a new `./testing` subpath in `packages/agent/package.json` (mirror the existing `./shared`/`./eval` export entries — `dist/testing/index.{js,d.ts}` — and add the matching tsup build entry so the subpath resolves) + `packages/channels/slack/src/__tests__/slackConformance.test.ts` (Slack subject) importing the suite from `@hachej/boring-agent/testing`. Do **not** house the generic suite inside the Slack package.
- Notes: The generic suite asserts, against a subject exposing `{ deliverInbound, collectOutbound, answerApproval, addressingKeyOf }`: (a) message-in → events-out ordering; (b) approval round-trip resolves the turn; (c) **addressing isolation** — a second subject's key cannot resolve the first's session. Run Slack against `runtime: 'none'` AND against a readonly `company_context` binding injected by the host (governed-context answering) — proving exit criterion 5 without importing boring-bash (the binding is supplied to `createAgent` by the test harness).
- Tests: the two files.
- Acceptance: `passed` for both runtime modes; isolation check fails a crossed key.

### BBS1-007 — Fastify mount example / host wiring doc (S)
- Description: Show a host mounting the Slack adapter via the local, channel-agnostic wrapper (proves the wrapper shape is reusable later without extracting it now).
- Files: `packages/channels/slack/README.md` + a runnable `packages/channels/slack/examples/mount.ts`.
- Notes: `mountChannelRoutes(fastify, '/slack', adapter.routes)`; env: `SLACK_SIGNING_SECRET`, `SLACK_BOT_TOKEN`. Note that a Teams channel can reuse the wrapper shape when it lands; until then the code remains local to Slack. No boring-bash import anywhere in the example.
- Tests: typecheck of the example (include it in the package tsconfig).
- Acceptance: example compiles; README documents the two-handles + no-boring-bash rules.

## Verification — exact commands verified against package.json scripts (new packages mirror boring-bash)

```bash
# after adding packages/channels/* to pnpm-workspace.yaml, adding packages/channels/* to root build:packages, and installing:
pnpm install
pnpm --filter @hachej/boring-channel-slack run build       # tsup
pnpm --filter @hachej/boring-channel-slack run typecheck   # tsc --noEmit
pnpm --filter @hachej/boring-channel-slack run test        # vitest run
pnpm --filter @hachej/boring-agent run build               # proves the new ./testing subpath resolves
pnpm --filter @hachej/boring-agent run test                # runs surface-adapter conformance factory tests

# import-boundary + repo regression
pnpm audit:imports        # must show no boring-bash / provider-internal import from the slack package
pnpm run build:packages   # must include @hachej/boring-channel-slack via the packages/channels/* filter
pnpm run test
```
(New package `package.json` scripts MUST be: `build: tsup`, `typecheck: tsc --noEmit`, `test: vitest run --passWithNoTests`, `lint: pnpm run typecheck`, mirroring `packages/boring-bash/package.json`.)

## Review gates

- `packages/channels/slack` dependency list contains no `@hachej/boring-bash` and no provider internals (grep + `pnpm audit:imports`).
- Ingress code writes zero signature/parsing/codec logic — all from `@flue/slack`.
- Egress update count is bounded and ≪ delta count; 429 handled.
- Approval answerable from both Slack and workspace (no Slack-local desync).
- Addressing isolation test present and failing on a crossed key.
- `@flue/slack` pinned to the **exact resolved** `1.0.0-beta.<N>` version (resolved from npm metadata as BBS1-002's first action and recorded in the PR) — never a `.x`/range placeholder.
- `@hachej/boring-agent/testing` exists as a real package subpath (`package.json` export + tsup entry), and the generic conformance suite lives there, not in the Slack package.
