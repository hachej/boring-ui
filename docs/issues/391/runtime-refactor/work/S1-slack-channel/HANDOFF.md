# S1-slack-channel — Handoff checklist

Derived strictly from [TODO.md](./TODO.md) and [PLAN.md](./PLAN.md). Tick each before calling this package done. Invent nothing.

## Prerequisites (packages + gates)
- [ ] T2-transport merged — [../T2-transport/HANDOFF.md](../T2-transport/HANDOFF.md)
- [ ] Also requires P1-headless-core merged — [../P1-headless-core/HANDOFF.md](../P1-headless-core/HANDOFF.md) (the `createAgent()` façade; block on P1 if absent — do not reach into harness internals)
- [ ] STOP+report if `createAgent().send/resolveInput/stream/sessions` is not available (P1 not landed)
- [ ] First action, non-negotiable: RESOLVE and record the exact published `@flue/slack` version (`1.0.0-beta.<N>`) as the literal pin — never a `.x`/range placeholder
- [ ] Add `packages/channels/*` to `pnpm-workspace.yaml` and add `--filter './packages/channels/*'` (or `--filter @hachej/boring-channel-slack`) to root `build:packages`; current repo globs/build filters do not include nested `packages/channels/*`

## Beads
- [ ] BBS1-001 — Hono→Fastify channel handler wrapper (inside the Slack package)
- [ ] BBS1-002 — Slack package skeleton + ingress wiring
- [ ] BBS1-003 — `conversationKey → sessionId` `state.db` store
- [ ] BBS1-004 — Egress: text-delta batching into message updates
- [ ] BBS1-005 — Approvals: agent request → Slack interactive blocks → `resolveInput`
- [ ] BBS1-006 — Surface adapter conformance suite (neutral home; Slack first subject)
- [ ] BBS1-007 — Fastify mount example / host wiring doc

## Verification commands
- [ ] `pnpm install`
- [ ] `pnpm --filter @hachej/boring-channel-slack run build`
- [ ] `pnpm --filter @hachej/boring-channel-slack run typecheck`
- [ ] `pnpm --filter @hachej/boring-channel-slack run test`
- [ ] `pnpm --filter @hachej/boring-agent run build`
- [ ] `pnpm --filter @hachej/boring-agent run test`
- [ ] `pnpm audit:imports`
- [ ] `pnpm run build:packages` (includes `@hachej/boring-channel-slack` via root `packages/channels/*` filter)
- [ ] `pnpm run test`

## Review gates
- [ ] `packages/channels/slack` dependency list contains no `@hachej/boring-bash` and no provider internals (grep + `pnpm audit:imports`).
- [ ] Ingress code writes zero signature/parsing/codec logic — all from `@flue/slack`.
- [ ] Egress update count is bounded and ≪ delta count; 429 handled.
- [ ] Approval answerable from both Slack and workspace (no Slack-local desync).
- [ ] Addressing isolation test present and failing on a crossed key.
- [ ] `conversationKey → sessionId` default store is `state.db`; in-memory `Map` usage is confined to tests.
- [ ] `@flue/slack` pinned to the **exact resolved** `1.0.0-beta.<N>` version (recorded in the PR) — never a `.x`/range placeholder.
- [ ] `@hachej/boring-agent/testing` exists as a real package subpath (`package.json` export + tsup entry), and the generic conformance suite lives there, not in the Slack package.

## Exit criteria
- [ ] Same agent + same `state.db` session/addressing store serves the workspace UI **and** a Slack thread.
- [ ] An approval requested in Slack can be answered in Slack or the workspace.
- [ ] The Slack package imports only the public agent contract (`@hachej/boring-agent`) + `@flue/slack` + `@slack/web-api` — no `boring-bash` server code, no provider internals.
- [ ] Hono→Fastify wrapper is channel-agnostic in shape inside Slack; shared extraction is deferred until a second channel lands.
- [ ] Runs against `runtime: 'none'` and against readonly `company_context` bindings.

## Closeout
- [ ] Zero unowned `TODO(remove:*)` markers for this phase
- [ ] PRs merged per [PR-PLAN.md](../../PR-PLAN.md) (this package's section)
