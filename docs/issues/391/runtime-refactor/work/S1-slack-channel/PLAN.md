# S1-slack-channel — Plan

> Phase: Phase S1 — Slack reference channel (after T2; parallel to Phases 4–5) · Work order: [TODO.md](./TODO.md) · Handoff: [HANDOFF.md](./HANDOFF.md)
> Ordering authority: [INDEX.md](../../INDEX.md) · Vision: [VISION.md](../../VISION.md)

## Governing architecture
- [08-pluggable-agent-surfaces.md](../../architecture/08-pluggable-agent-surfaces.md) — surface adapters ("channel ingress for free"), the two-handles rule, HITL, and the event-stream contract; Slack is the reference adapter and first conformance subject.

## Design context
S1 delivers `@hachej/boring-channel-slack` (`packages/channels/slack`) — the first real surface adapter, proving a channel is a thin translation layer over the public agent contract. Ingress (signature verification, payload parsing, the `conversationKey` codec, URL-verification challenge) comes entirely from the pinned `@flue/slack` package; we write only callback → `agent.start()` (admission — the runtime allocates the `sessionId`) + `agent.stream()` egress, the surface-owned `state.db` `conversationKey → sessionId` store, egress + approval blocks via `@slack/web-api`, and a Hono→Fastify handler wrapper kept inside the package (single consumer — no upfront shared package). The two-handles rule holds: `sessionId` is runtime-owned, `conversationKey` is surface-owned; core APIs accept `sessionId` only. Approvals ride the single T1 on-stream channel via `resolveInput`, so a request raised in Slack is answerable in Slack or the workspace. It runs against `runtime: 'none'` and, when the host has bound the session to a workspace, against readonly `company_context` bindings — with no boring-bash import.

Verified current repo reality: `packages/channels/*` is not in `pnpm-workspace.yaml` today (the workspace globs are `packages/*`, `plugins/*`, `packages/agent/examples/*`, `packages/workspace/test-fixtures/*`, `apps/*`), and root `package.json` `build:packages` currently filters only `./packages/*` and `./plugins/*`. S1 must add the channels workspace glob and the root build filter in the Slack package PR. Root `pnpm -r` typecheck/test then sees the package through the workspace glob; `build:packages` sees it only after the filter change.

## Deliverables
- `@hachej/boring-channel-slack` (`packages/channels/slack`): **thin adapter over `@flue/slack` ingress** (pinned; signature verification, payload parsing, `conversationKey` come from the package) — we write only: callback → `agent.start()` for admission/receipt, `agent.stream(sessionId, { startIndex })` for egress, `state.db` `conversationKey → sessionId` store, egress + approval blocks via `@slack/web-api`, Hono→Fastify handler wrapper kept inside Slack but channel-agnostic in shape. Add `packages/channels/*` to `pnpm-workspace.yaml` and add `--filter './packages/channels/*'` (or `--filter @hachej/boring-channel-slack`) to root `build:packages`.
- Surface adapter conformance suite (first consumer): message-in/events-out, approval round-trip, addressing isolation.
- Runs against `runtime: 'none'` and against readonly `company_context` bindings (governed-context answering in Slack).

## Exit criteria
Same agent + same session store serves the workspace UI and a Slack thread; an approval requested in Slack can be answered in Slack or the workspace; Slack package imports only the public agent contract + `@flue/slack`; the wrapper is channel-agnostic in shape inside Slack, with shared extraction deferred until a second channel lands.
