---
github: https://github.com/hachej/boring-ui/issues/1082
issue: 1082
state: accepted
updated: 2026-08-31
revision: r1
track: owner
---

# Decision memo — adopt Pi's asynchronous CredentialStore API

**Decision:** Upgrade the coordinated `@earendil-works/pi-*` packages from
0.80.7 to a compatible release exposing the asynchronous `CredentialStore`
and `ModelRuntime` APIs. Use 0.84.3 as the initial migration target. Implement
the Seneca vault adapter as a scope-bound `CredentialStore`; do not implement
the previously planned remote `AuthStorageBackend` adapter.

This decision supersedes the `AuthStorage.fromStorage()` /
`AuthStorageBackend { withLock, withLockAsync }` integration described in
[`provider-onboarding-plan.md`](provider-onboarding-plan.md).

## Why

Pi 0.80.7's coding-agent integration constructs `AuthStorage` over an
`AuthStorageBackend`. That backend requires a synchronous `withLock()` method
as well as `withLockAsync()`. `AuthStorage.fromStorage()` immediately performs
a synchronous reload, and several mutation paths also use the synchronous
method.

Seneca's production credential path cannot implement that contract correctly:

- PostgreSQL reads, writes, and locks are asynchronous;
- OVH KMS authentication, `datakey`, and `datakey-decrypt` are asynchronous
  network operations;
- OAuth refresh may rotate the refresh token and therefore requires one
  serialized read-refresh-write operation across processes;
- blocking the Node.js thread or pretending remote writes are synchronous
  would introduce stale reads, dropped refresh writes, and double-refresh
  races.

A preload-and-flush compatibility adapter is possible, but it would recreate
storage and concurrency behavior that newer Pi already exposes directly. It is
not the production path.

## The target Pi contract

Pi 0.84.3's `@earendil-works/pi-ai` exports:

```ts
interface CredentialStore {
  read(
    providerId: string,
    options?: AuthOperationOptions,
  ): Promise<Credential | undefined>;

  list(
    options?: AuthOperationOptions,
  ): Promise<readonly CredentialInfo[]>;

  modify(
    providerId: string,
    fn: (
      current: Credential | undefined,
    ) => Promise<Credential | undefined>,
    options?: AuthOperationOptions,
  ): Promise<Credential | undefined>;

  delete(
    providerId: string,
    options?: AuthOperationOptions,
  ): Promise<void>;
}
```

The application injects the store into coding-agent:

```ts
const modelRuntime = await ModelRuntime.create({
  credentials: actorCredentialStore,
});
```

`ModelRuntime` and pi-ai remain responsible for provider definitions, OAuth
login, token-expiry detection, refresh, refresh-token rotation, request auth,
model availability, and login/logout orchestration. Seneca owns actor
selection, authorization, durable storage, encryption, tombstones, and audit.

## Scope binding

The public Pi store is keyed by `providerId`. Each Seneca store instance must
therefore be closed over one verified actor and workspace:

```ts
createVaultCredentialStore({
  workspaceId,
  userId,
  interactive: true,
  consumerBinding: "llm-model-call.v1",
});
```

A `providerId` passed to that instance resolves within the immutable scope:

1. personal `(workspaceId, userId, providerId)`;
2. workspace `(workspaceId, "workspace", providerId)` when policy permits;
3. non-suppressed instance fallback when policy permits.

For the first OpenAI Codex slice, only step 1 is enabled. Subscription
credentials are personal and interactive-only. `userId` is derived from the
authenticated request, retained in session context and session cache identity,
and included in persistence keys, lock keys, audit records, and AAD v2. It is
never accepted from an untrusted browser field.

No global `auth.json` is read or written. Tokens never enter the browser,
workspace filesystem, session transcript, tool sandbox, or automation worker.

## Atomic refresh semantics

`modify()` is the only write path and is the critical integration seam. Pi
executes OAuth refresh inside its callback so the store can serialize the full
read-refresh-write operation.

The vault implementation must:

1. acquire a cross-process lock for the complete scope
   `(workspaceId, subjectKind, subjectId, providerId)`;
2. read the current encrypted credential record;
3. unwrap/decrypt it through OVH KMS and the envelope vault;
4. pass the current Pi `Credential` to `fn`;
5. await Pi's refresh/login mutation;
6. encrypt and durably write the returned credential as a fresh credential
   version using CAS/fencing;
7. update the external rollback anchor according to the vault protocol;
8. release the lock in `finally` and best-effort clear temporary byte buffers.

The initial Postgres implementation should use a dedicated connection with a
session-level advisory lock or an equivalent fenced lock. Do not hold a normal
business transaction open across the provider network request. Cancellation
must stop waiting callers without abandoning a committed write or leaking a
lock.

If `fn` returns `undefined`, preserve the current credential, matching Pi's
contract. `delete()` serializes against `modify()` and writes Seneca's required
revocation/deletion state before making the credential unavailable.

## OAuth and model flow

- **Connect:** an authenticated host route constructs the actor-bound store and
  `ModelRuntime`, calls Pi's `login("openai-codex", "oauth", interaction)`, and
  brokers only safe interaction events (`auth_url`, device/manual-code prompts,
  and progress). The resulting OAuth credential is persisted through the
  injected store; it is never returned to the browser.
- **Use:** interactive session construction injects a store bound to the
  verified funding user. Pi obtains request auth and refreshes an expired
  credential through `modify()`.
- **List models:** use the actor-bound `ModelRuntime` availability surface;
  never construct process-global, workspace-blind auth storage.
- **Disconnect:** call Pi logout orchestration and persist the local
  revoke/tombstone semantics through the bound store. New sessions fail
  closed; behavior for already-running sessions must be explicit.

## Package migration

Seneca currently receives coding-agent 0.80.7 through
`@hachej/boring-agent` 0.1.99. The installed 0.84.3 coding-agent release uses a
coordinated 0.84.3 family:

- `@earendil-works/pi-coding-agent`;
- `@earendil-works/pi-agent-core`;
- `@earendil-works/pi-ai`;
- `@earendil-works/pi-client`;
- `@earendil-works/pi-protocol`;
- `@earendil-works/pi-tui` where applicable.

Upgrade these as one tested set. Do not mix 0.80.x and 0.84.x runtime packages.
The migration occurs upstream in Boring Agent, is published as a new
`@hachej/boring-*` release, and only then is consumed by Seneca.

Expected code changes include:

- replace `AuthStorage` + `ModelRegistry` construction with `ModelRuntime`;
- inject `CredentialStore` through `ModelRuntime.create({ credentials })`;
- adapt model listing/status and provider registration to `ModelRuntime`;
- preserve actor `userId` through session normalization and cache keys;
- keep an in-memory store only for isolated tests, never production custody.

## Delivery order

1. **Pi compatibility PR:** upgrade to 0.84.3 and migrate existing env/file
   behavior to `ModelRuntime` without enabling vault credentials.
2. **Actor propagation PR:** preserve verified `userId` and bind interactive
   session/model-list construction to the actor.
3. **Vault store PR:** implement `CredentialStore` over scoped Postgres
   persistence, distributed locking, envelope crypto, and the selected KEK
   provider; add personal-scope AAD v2.
4. **OpenAI Codex route PR:** broker Pi's native login, status, model
   availability, and disconnect for personal interactive use only.
5. **Seneca release PR:** consume the published Boring packages, register
   migrations/configuration, and enable one-workspace canary access.

The OVH KMS provider and live qualification remain separate prerequisites for
the production release, not for the Pi compatibility PR.

## Acceptance gates

- Existing interactive streaming, tools, model selection, custom providers,
  cancellation, and session resume pass after the Pi upgrade.
- No production path creates or reads global `auth.json`.
- Two processes requesting an expired credential result in one serialized,
  durably persisted refresh outcome.
- Restarting the app resolves the latest rotated credential.
- Cross-user, cross-workspace, provider, field, version, and generation swaps
  fail closed.
- The second workspace member cannot list, resolve, refresh, disconnect, or
  use the connecting member's Codex subscription.
- Subscription credentials cannot fund automations or background agents.
- Canary token material is absent from browser responses, logs, traces,
  transcripts, workspace files, sandbox processes, and error objects.
- KMS outage, lock timeout, CAS conflict, malformed ciphertext, stale anchor,
  and OAuth refresh failure produce stable redacted errors and never fall back
  silently.

## Consequences

**Positive:** the adapter matches Postgres/KMS I/O, Pi keeps ownership of OAuth
and rotating-token correctness, and Seneca avoids a fragile synchronous
compatibility layer.

**Cost:** Boring Agent must migrate to the newer Pi model runtime before the
Codex slice can ship. This adds an explicit compatibility PR, but removes more
complexity and risk than it adds.

**Residual risk:** JavaScript OAuth strings cannot be reliably zeroized, and a
compromised authorized host process can ask KMS to decrypt active material.
Those limitations are unchanged by the storage API choice.
