# [BYOK Codex] Finish bring-your-own-key with OpenAI Codex sign-in

Owner request (2026-09-04) for the Boring Factory. Feature name `BYOK Codex`, epic key `byok-codex`. Source of truth: `docs/issues/1082/plan.md` (r3), `key-scope-decision.md`, `provider-onboarding-plan.md`, `pi-async-credential-store-decision.md`, and the ratified `docs/issues/820/byok-secret-vault-plan.md`. Merged already: vault contract (16f.1), vault crypto core (#1132), pi async credential store (#1500). Open and far behind `main`: PR #1145 (S1 durable persistence + external rollback anchor, `feat/1082-s1-persistence`) and PR #1164 (slice B startup credential registry + vault composition, stacked on #1145).

Goal: an owner can connect their own OpenAI Codex account (pi's `openai-codex` OAuth provider) and API-key providers through the vault, durably, with the Factory seats and normal agents using those credentials, and the two open PRs land instead of rotting.

## Slices, in dependency order

1. **[BYOK Codex] Land S1 persistence on main** — bring `feat/1082-s1-persistence` onto the epic branch (rebase or merge from main, fix forward), keep every test; proof: vault conformance suite with Postgres, snapshot-replay fails closed, `pnpm --filter @hachej/boring-agent test`.
2. **[BYOK Codex] Land the startup credential registry** — bring #1164's composition onto the epic branch; proof: `startupComposition.test.ts` green, agent suite green. Depends on 1.
3. **[BYOK Codex] Owner credential routes and registry wiring** (plan S3) — host-only CRUD routes for provider credentials, no plaintext in any response; proof: route tests plus a redaction test. Depends on 2.
4. **[BYOK Codex] OpenAI Codex OAuth through the vault** — device-flow login and refresh for pi's `openai-codex` provider stored in the vault, selectable per workspace; proof: an end-to-end token round-trip test through the vault backend and one live login recorded as a receipt (owner runs the browser step at Gate 2 if needed). Depends on 3.
5. **[BYOK Codex] DEK rotation and crypto-shred** (plan S2) — proof: interrupted-rotation resume test. Depends on 1; parallel with 3 and 4.

## Proof for Gate 2

Agent and workspace suites green at the epic head, `pnpm lint:invariants`, and a demo of the credential settings surface with a connected Codex account (demo sandbox when Vercel quota allows, otherwise screenshots in the PR).

## Risks

Stacked branches 186 commits behind main: expect conflicts in Bead 1; fix forward, never rewrite pushed history. Key-scope decision is frozen; do not reopen it. OAuth UI was deferred in plan r3 S4; this request schedules it explicitly.
