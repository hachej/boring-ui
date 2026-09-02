---
github: https://github.com/hachej/boring-ui/issues/1082
issue: 1082
state: accepted
updated: 2026-09-02
revision: r1.1
track: owner
---

# Decision memo — adopt Pi's asynchronous CredentialStore API (r1.1)

**Decision:** Upgrade the coordinated `@earendil-works/pi-*` packages from
0.80.7 to a compatible release exposing the asynchronous `CredentialStore`
and `ModelRuntime` APIs. Use 0.84.3 as the initial migration target. Implement
the Seneca vault adapter as a scope-bound `CredentialStore`; do not implement
the previously planned remote `AuthStorageBackend` adapter.

This decision supersedes the `AuthStorage.fromStorage()` /
`AuthStorageBackend { withLock, withLockAsync }` integration formerly described
in [`provider-onboarding-plan.md`](provider-onboarding-plan.md) r3. The
controlling r4 plan now forbids that legacy path.

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

The currently tested, lockfile-pinned Pi 0.84.4 `@earendil-works/pi-ai`
package exports:

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
  authorizedWorkspaceScope,
  verifiedAuthority,
  executionMode: "interactive",
  providerId: "openai-codex",
});
```

The Core-issued opaque workspace scope and its current-authority verifier are the
authorization inputs. The store calls `verifyCurrent(scope)` at every credential
operation and derives the actor from that result; caller-provided workspace/user
or execution-mode strings are never authority. For the first OpenAI Codex slice,
the store resolves
only personal `(workspaceId, userId, "openai-codex")` custody and has no
workspace, env, file, or global-auth fallback. A server-policy composite store
preserves existing behavior for non-Codex providers. Any future layered funding
model requires a separate approved policy; it is not latent behavior in this
constructor. Subscription credentials are personal and interactive-only.
`userId` is derived from the authenticated request and retained only in the live
operation context, then included in persistence keys, lock keys, audit records,
and AAD v2. One shared runtime/transcript handle remains keyed by session and
workspace; its delegating store resolves a fresh immutable actor-bound inner
store for each operation. The live actor sits in a revocable operation lease,
not raw AsyncLocalStorage data. The delegating store rechecks the same lease after
every asynchronous verifier/store boundary and before returning material, and
passes its abort signal to actor-store writes so they can reject before commit.
Completion revokes the lease, so detached descendants and lookups already waiting
on remote I/O fail closed. Interactive follow-ups receive a fresh lease at Pi's
one-at-a-time queue-drain boundary, before `prepareNextTurn` and automatic
compaction; `message_start` is too late. Operation-scoped runtimes force native
follow-up mode to `one-at-a-time` so one provider request has one payer. The
runtime never caches an actor or accepts one from an untrusted browser field.

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
7. delete superseded ciphertext and emit a value-free lifecycle audit event;
8. release the lock in `finally` and best-effort clear temporary byte buffers.

For the personal Codex MVP, expected-version CAS is the stale-write fence. The
plan does not depend on the earlier single workspace-wide rollback counter: that
counter cannot authenticate multiple independently versioned personal records,
and OVH KMS metadata has not been qualified as an atomic monotonic store.
Rollback-resistant state continuity, if required later, needs a separate
complete-scope protocol and recovery design.

The initial Postgres implementation uses a dedicated connection with a
session-level advisory lock plus expected-version CAS; the advisory lock is not
called a fencing token. Do not hold a normal business transaction open across
the provider network request. Apply a bounded refresh-callback deadline and tie
its abort signal to lock-connection health where supported. Return a connection
to the pool only after unlock is positively confirmed; destroy it after failed
or ambiguous unlock. Cancellation must stop waiting callers without abandoning
a committed write or leaking a lock.

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

Boring's coordinated Pi 0.84.3 migration is merged in PR #1500 at commit
`150465a03966ac316c609ceecd28bf487d9297c2`. Seneca still consumes the older
published `@hachej/boring-agent` release until the new coordinated Boring
packages are published and adopted. The migrated Boring runtime uses this
coordinated 0.84.3 family:

- `@earendil-works/pi-coding-agent`;
- `@earendil-works/pi-agent-core`;
- `@earendil-works/pi-ai`;
- `@earendil-works/pi-client`;
- `@earendil-works/pi-protocol`;
- `@earendil-works/pi-tui` where applicable.

These packages were upgraded as one tested set; 0.80.x and 0.84.x runtime
packages are not mixed in Boring. PR #1500 replaced `AuthStorage` +
`ModelRegistry` construction with `ModelRuntime`, adapted model and provider
surfaces, and established the asynchronous injection seam while preserving
existing env/file behavior. Actor propagation and production vault injection
remain later slices. Seneca consumes the change only after coordinated Boring
packages are published.

PR #1500 is the historical prerequisite, not the forward version ceiling. On
2026-09-02 npm reported 0.84.4 as latest, and PR 1 advanced the complete
coordinated set (`pi-coding-agent`, `pi-agent-core`, `pi-ai`, `pi-client`,
`pi-protocol`, `pi-telemetry`, and `pi-tui`) to exact 0.84.4 pins. Every later
implementation slice re-checks npm, pins the full family to one exact version,
and runs published-package contract/conformance tests. Any intentional holdback
must record the latest version, failing contract, retained version, and owner
approval; floating or mixed family versions are forbidden.

In-memory stores remain isolated test tools and are never production custody.

## Delivery order

1. **Completed — Pi compatibility PR #1500:** Pi 0.84.3 `ModelRuntime` migration
   preserving existing env/file behavior is merged with green post-merge CI.
2. **Actor propagation PR:** preserve opaque verifier-backed credential authority
   in revocable per-operation leases; recheck leases across remote I/O and pass
   cancellation to writes; keep one shared session/runtime/transcript handle;
   activate one-at-a-time follow-up actors at Pi's queue-drain boundary before
   preparation/compaction; and resolve actor-aware model catalogs only after
   authorization.
3. **OVH KMS qualification PR:** implement and live-qualify the production
   `WorkspaceKekProviderV1` adapter against disposable resources and one
   manually provisioned canary wrapping key.
4. **Personal Codex store PR:** implement the subject-scoped `CredentialStore`,
   personal AAD v2, complete-scope advisory locking, expected-version CAS, and
   strict `openai-codex` no-fallback composition.
5. **OpenAI Codex route/UI PR:** use Pi's device-code login, metadata status,
   actor-aware model availability, needs-reauth handling, and disconnect for
   personal interactive use only.
6. **Seneca canary PR:** consume published Boring packages, register schema and
   configuration, and enable one-workspace canary access.

The controlling detailed acceptance and deferrals are in
[`provider-onboarding-plan.md`](provider-onboarding-plan.md) r4.

## Acceptance gates

- Existing interactive streaming, tools, model selection, custom providers,
  cancellation, and session resume pass after the Pi upgrade.
- No production path creates or reads global `auth.json`.
- Two processes requesting an expired credential normally produce one provider
  refresh and one durable outcome while lock ownership remains healthy; a
  lock-connection-loss race fails closed locally, is observable, and is not
  falsely described as exactly once across PostgreSQL and the provider.
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
