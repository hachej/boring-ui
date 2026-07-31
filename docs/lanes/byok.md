# Lane brief — BYOK — per-workspace model credentials

Tracking issue: #1010 (authoritative). This file is the working brief; keep it in sync as the lane executes.

## Today (verified against `origin/main`, 2026-07-31)
- Encrypted generic settings store: table `workspace_settings` (`packages/core/src/server/db/schema.ts:106-119`), pgcrypto `pgp_sym_encrypt/decrypt` with the app-wide `WORKSPACE_SETTINGS_ENCRYPTION_KEY` (`PostgresWorkspaceStore.ts`). `GET` returns masked `configured` booleans only.
- **Provider API keys for model calls do not come from Boring at all.** `createHarness.ts:583-588` calls Pi's `AuthStorage.create()` + `ModelRegistry.create()`; the comment states credentials are Pi-owned. Extra providers register from env (`server/models/modelConfig.ts`).

## Dormant — the contract is built and unreachable
`packages/agent/src/shared/credentials/` is a complete frozen BYOK contract: `registry.ts` (provider definitions incl. `llm`), `bindings.ts` (delivery `host-only|sandbox-pipe|sandbox-tmpfs`), `ref.ts`, `authority.ts` (opaque scope, Core-owned verifier), `lease.ts` (resolver + lease with `dispose()`), `sandboxDelivery.ts` (ships a deliberate not-implemented resolver). Server side: `server/credentials/hostResolver.ts`, `withResolvedCredential.ts`.
**Its only reference outside the module is the barrel re-export** (`server/index.ts:234-236`). Nothing constructs a registry or resolver. The harness never touches these types.

## Delta to "a user pastes their key and their agents use it"
1. **UI** — none exists. The only key-entry surfaces in the repo are Stripe/LemonSqueezy for credits.
2. **Store backend** — no `CredentialStoreBackendV1` implementation on main.
3. **Authority verifier** — no Core implementation of `WorkspaceCredentialAuthorityVerifierV1` (only a fake in tests).
4. **Injection seam** — the hard one. The harness has nowhere to accept an invocation-scoped credential; it delegates wholesale to Pi's env-only path.
5. **Precedence policy** (workspace key vs instance fallback) is documented (`docs/DECISIONS.md:450`) with no code.
6. `sandbox-pipe`/`sandbox-tmpfs` delivery is a stub.

## Parked PR #917 does not close this
Storage + crypto only (+4179/-27): vault schema migration `0024_byok_credential_vault.sql`, `PostgresCredentialVaultStore`, AES-256-GCM envelopes, per-workspace DEKs, local/OVH-KMS KEK selector. Its body explicitly defers UI, credential lifecycle API, and resolver wiring to bead 16f.3, and live OVH-KMS qualification to the owner.

## Gate
Decision `wt-391-forward-0jpy.30` made the **model-policy cap revisit mandatory before BYOK or the v2 remote tracer, whichever lands first**. It is not currently a bead and nothing forces it. Resolve it as part of this lane.

## Shared-substrate note
See the substrate issue: MCP's per-server credentials and this lane are the same missing component. Evidence: the encrypted settings table's only observed content is MCP registration data (`__serverBoringMcpSourcesV1`), and bead `wt-391-forward-16f.7` wants BYOK migrated *off* that table.

Refs #391, #917

## Status

Not started. This branch is the lane seed — a draft PR so the lane has a visible home before work begins.
