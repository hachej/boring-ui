# Sandbox Control-Plane API v1 — Spec (E2B-shaped, sovereign auth)

Status: DRAFT — read-only research + spec, no implementation.
Author context: SBX1.4 daemon (PR #1219) is the v1 slice of Layer-1 control plane
(`docs/direction/sandbox-service-architecture.md`). Goal: adopt E2B's proven
public API shape rather than invent one, mapped onto what we already have
(`packages/boring-sandbox`, `packages/boring-bash`).

> §1 (E2B public surface) is verified against the official E2B JS SDK v2.38.2 /
> Python v2.37.1 and the public OpenAPI reference; everything else is grounded in
> code we already ship.

---

## 1. E2B public API surface (reference)

Verified against official SDK reference (JS v2.38.2, Python v2.37.1) and the
public OpenAPI reference. Two packages: `e2b` (core Sandbox) and
`@e2b/code-interpreter` (adds `runCode`). Base API domain `api.e2b.app`
(configurable `domain` for self-host). SDK→in-sandbox agent (`envd`) transport
is gRPC/Connect, wrapped by the SDK.

### 1.1 Lifecycle (`Sandbox` static + instance)
- `Sandbox.create(template?, opts?)` — `opts`: `timeoutMs`(JS, default 300000)/`timeout`(Py sec, default 300), `metadata`, `envs`, `secure`, `allow_internet_access`, `apiKey`, `domain`.
- `Sandbox.connect(sandboxId, opts?)` — auto-resumes if paused.
- `Sandbox.list(opts?)` → `SandboxPaginator` (running + paused, filterable, paginated).
- `Sandbox.kill(sandboxId)` / instance `.kill()`.
- `Sandbox.setTimeout(sandboxId, timeoutMs)` — resets the max-runtime window.
- `Sandbox.getInfo(sandboxId)` → id, templateID, name, metadata, start/end time.
- `Sandbox.getMetrics`, `.pause({keepMemory})`, `.createSnapshot()`, `.fork()`, `.isRunning()`.
- Max continuous runtime: 1h Hobby / 24h Pro; pause/resume persists state beyond that.

### 1.2 Exec (`sandbox.commands`)
- `run(cmd, opts?)` → `CommandResult {stdout, stderr, exitCode, error}` (foreground).
- `run(cmd, {background:true})` → `CommandHandle` (`.wait()`, streaming via callbacks).
- `list()` → `ProcessInfo[]`; `kill(pid)`; `connect(pid)`; `sendStdin(pid,data)`; `closeStdin(pid)`.
- opts: `background`, `envs`, `cwd`, `user`, `timeoutMs`(default 60000), `onStdout`/`onStderr`, `stdin`, `signal`.
- **PTY** (`sandbox.pty`): `create(opts)`, `connect(pid)`, `kill(pid)`, `sendInput(pid,bytes)`, `resize(pid,{cols,rows})`. REST: `process/start|connect|sendinput`.

### 1.3 Filesystem (`sandbox.files`)
- `read(path,{format})` → text/bytes/blob/stream; `write(path,data)` → `WriteInfo`; batch `write(WriteEntry[])`.
- `list(path,{depth})` → `EntryInfo[]`; `getInfo(path)`; `exists(path)`; `makeDir(path)`(recursive); `rename(old,new)`; `remove(path)`.
- `watchDir(path, onEvent, {recursive})` → `WatchHandle` (`.stop()`). Events: `FilesystemEvent`.
- Types: `EntryInfo{name,path,type,owner,permissions,size,modtime}`, `FileType` DIR/FILE/SYMLINK.
- Upload/download via read/write + signed URLs.

### 1.4 Ports / networking
- `getHost(port)` → `PORT-UNIQUEID.e2b.app`; you build `https://…`. `maskRequestHost` option; `secure`/IAM to restrict; `allow_internet_access` for egress.

### 1.5 Env / secrets
- Create-time `envs` (→ REST `envVars`); per-command `envs` on `commands.run`. Plain key/value passed through.

### 1.6 Auth
- Reusable **API key**: `E2B_API_KEY` env or `apiKey`/`api_key` arg. REST header **`X-API-Key`**. Same key for SDK + CLI.
- Per-sandbox tokens in create response: `envdAccessToken`, `trafficAccessToken`.
- REST create: `POST https://api.e2b.app/sandboxes` (`X-API-Key`), body `templateID`(req), `timeout`, `metadata`, `envVars`, `autoPause`, `secure`, `allow_internet_access`, `network`, `iam`, `volumeMounts`. 201 → `sandboxID`, `templateID`, `envdVersion`, `envdAccessToken`, `trafficAccessToken`. Also `list-sandboxes-v2`, `get-sandbox`, `delete-sandbox`, fs `listdir`/`stat`, process `start`/`connect`/`sendinput`.

### 1.7 Backend-neutrality — CONFIRMED
The public SDK/API surface has **no** Firecracker/microVM/KVM/VM-image terms. All
abstractions are neutral: `template`/`templateID`, `sandboxID`, `envd`,
`getHost`/public URL, pause/resume/snapshot. E2B *does* run Firecracker microVMs,
but that fact lives only in infra/blog material, never in the developer contract.
[UNVERIFIED] byte-level field names beyond those above; signed-URL and
restrict-public-access details not fetched in full; versions drift.

---

## 2. Our v1 control-plane API — mapped onto what we have

### 2.1 What already exists (the wire contract is largely built)

The SBX1.4 remote-worker protocol (`packages/boring-sandbox/src/shared/remoteWorkerProtocolV1.ts`,
client in `packages/boring-sandbox/src/providers/remote-worker/protocolClient.ts`)
is already a real HTTP+SSE control plane. Actual routes today:

| Verb + path | Op | Request / Response schema |
| --- | --- | --- |
| `GET /internal/v1/health` | `health` | `RemoteWorkerHealthResponseSchemaV1` (evidence/qualification/image digests, isolation `docker-runsc-systrap`) |
| `POST /internal/v1/sandboxes` | `create` | `RemoteWorkerCreateRequestSchemaV1` → `RemoteWorkerCreateResponseSchemaV1` (returns `sandboxId`, `runtimeCwd=/workspace`, `leaseExpiresAtMs`, authenticated `bindingReceipt`) |
| `POST /internal/v1/sandboxes/{id}/exec` | `exec` | `RemoteWorkerExecRequestSchemaV1` → `RemoteWorkerExecResponseSchemaV1` |
| `POST /internal/v1/sandboxes/{id}/fs` | `fs` | `RemoteWorkerWorkspaceOperationSchemaV1` → `RemoteWorkerWorkspaceResultSchemaV1` |
| `GET /internal/v1/sandboxes/{id}/fs/events` | `events` | SSE stream of `RemoteWorkerFsEventEnvelopeSchemaV1` |
| `POST /internal/v1/sandboxes/{id}/renew` | `renew` | `RemoteWorkerRenewRequestSchemaV1` → `RemoteWorkerRenewResponseSchemaV1` |
| `DELETE /internal/v1/sandboxes/{id}` | `delete` | → `RemoteWorkerDeleteResponseSchemaV1` (`{ disposed: true }`) |

Auth headers (`REMOTE_WORKER_HEADERS_V1`):
`x-boring-internal-token` (capability), `x-boring-request-id`, `x-boring-protocol-version`.

Note the path prefix is `/internal/v1/...` — an internal-daemon naming. To be
"E2B-compatible public API," the public surface should live at a stable public
prefix (e.g. `/v1/sandboxes`) even though v1 keeps the same verbs/schemas.

### 2.2 exec surface (`exec` op)

Request (`RemoteWorkerExecRequestV1`): `invocationId`, `command` (single string,
max 64 KiB), optional `cwd`, optional `credentialRefs` (value-free secret
references, see §3), `timeoutMs` (≤ 15 min), `maxOutputBytes` (≤ 4 MiB).
Response: `stdoutBase64`, `stderrBase64`, `exitCode`, `durationMs`, `truncated`,
optional `stdoutEncoding`/`stderrEncoding` (`utf-8`|`binary`).

Underlying in-guest contract is the `Sandbox.exec(cmd, opts)` interface
(`packages/agent/src/shared/sandbox.ts`): `ExecOptions` has `cwd`, `env`,
`signal` (abort), `timeoutMs`, `maxOutputBytes`, `onHeartbeat`, and incremental
`onStdout`/`onStderr` byte-stream callbacks. `ExecResult` returns `stdout`/`stderr`
as `Uint8Array`, `exitCode`, `durationMs`, `truncated`.

### 2.3 fs surface (`fs` op)

`RemoteWorkerWorkspaceOperationSchemaV1` is a discriminated union on `op`:
`readFile`, `readBinaryFile`, `writeFile`, `writeBinaryFile`, `readFileWithStat`,
`writeFileWithStat`, `writeBinaryFileWithStat`, `unlink`, `readdir`, `stat`,
`mkdir` (`recursive?`), `rename` (`from`/`to`). Text ≤ 6 MiB per transfer;
binary carried base64.

This maps 1:1 onto the `Workspace` interface (`packages/agent/src/shared/workspace.ts`):
`readFile`, `readBinaryFile?`, `writeFile`, `writeBinaryFile?`, `readFileWithStat?`,
`writeFileWithStat?`, `writeBinaryFileWithStat?`, `unlink`, `readdir` (→ `Entry[]`),
`stat` (→ `Stat`), `mkdir({recursive})`, `rename`, plus a `watch()` channel that
backs the SSE `fs/events` stream. All paths workspace-relative; path validation
is an adapter concern (coding-invariant 4). Persistence is not part of the API
surface — declared via `ProviderCapabilities.filesystemPersistence`.

### 2.4 lifecycle surface

- **create** = `POST /sandboxes`. Note: the client (`remote-worker` provider)
  **constructs** the create request from an already-authorized `workspaceId` in
  its landed shared context and refuses to create if none exists. The daemon
  never accepts a caller-supplied workspace identity (§3).
- **connect/reconnect** — not a distinct verb; a fresh capability is minted per
  operation against an existing `sandboxId` (the binding record is the source of
  truth). Reconnecting an events stream after expiry requires a fresh capability.
- **list** — NOT present in the v1 protocol. New (v1.1+).
- **kill** = `DELETE /sandboxes/{id}`.
- **renew** (TTL/keepalive) = `POST /sandboxes/{id}/renew` with `idleTimeoutMs`
  (≤ 30 min) → new `leaseExpiresAtMs`. This is our TTL/idle-timeout model.
- **metadata** — not a first-class field today (create carries `sessionId`,
  `clientLeaseId`, digests). New (v1.1+).

### Coverage map (have / partial / new)

| E2B method | Our status | Evidence |
| --- | --- | --- |
| `Sandbox.create` | **HAVE** | `POST /internal/v1/sandboxes`, `RemoteWorkerCreateRequestSchemaV1` |
| `Sandbox.kill` | **HAVE** | `DELETE /internal/v1/sandboxes/{id}` + `Sandbox.dispose?()` |
| `setTimeout` / TTL | **HAVE** | `renew` op, `idleTimeoutMs`(≤30m), `leaseExpiresAtMs` |
| `Sandbox.connect` | **PARTIAL** | operate on `sandboxId` w/ fresh capability; no explicit "connect" verb, no pause/auto-resume |
| `Sandbox.list` | **NEW** | no `list` op in `RemoteWorkerOperationSchemaV1` |
| `getInfo` / `metadata` / labels | **NEW** | not modeled on create/response |
| `pause`/`resume`/`snapshot`/`fork` | **NEW** | none; v2 (harvest E2B UFFD snapshot/restore) |
| `commands.run` (exit code) | **HAVE** | `exec` op + `Sandbox.exec`; returns exitCode/stdout/stderr |
| streaming stdout/stderr | **PARTIAL** | in-guest `onStdout`/`onStderr` (`ExecOptions`) exist; wire `exec` response is buffered base64 — no per-chunk HTTP stream yet |
| `commands.run({background})` / handle / `sendStdin` | **NEW** | no background handle, no stdin channel |
| `pty.*` | **NEW** | no PTY in protocol |
| `files.read/write/list/getInfo/exists/makeDir/rename/remove` | **HAVE** | `RemoteWorkerWorkspaceOperationSchemaV1` union (`exists` = `stat`) |
| `files.watchDir` | **HAVE** | SSE `fs/events` + `Workspace.watch()` |
| upload/download (bulk/signed-URL) | **PARTIAL** | binary via base64 ≤ 6 MiB; no streamed multi-MB / signed-URL path |
| `getHost(port)` public URLs | **NEW** | nothing in protocol |
| `envs` injection | **HAVE (stronger)** | value-free `credentialRefs` resolved host-side (§3); plain `env` also supported in `ExecOptions` |
| auth (`X-API-Key`) | **HAVE (different, stronger)** | capability token + single-use nonce, not reusable API key (§3) |

---

## 3. Where ours MUST differ from E2B

### 3.1 Auth: capability tokens + single-use nonces, not reusable API keys

E2B authenticates every SDK request with a **long-lived reusable API key**
(`E2B_API_KEY`, sent as a header). Ours is a deliberate security upgrade:

- Each operation is authorized by a **short-lived capability** carried in
  `x-boring-internal-token`, whose claims (`RemoteWorkerCapabilityClaimsSchemaV1`)
  bind: `protocolVersion`, `workerId`, `workspaceId`, `operation`, `sandboxId`
  (for non-create ops), `requestDigest` (SHA-256 of the exact request),
  `issuedAtMs`/`expiresAtMs`, and a **single-use `nonce`**.
- Max capability lifetime is **5 minutes** (`REMOTE_WORKER_MAX_CAPABILITY_LIFETIME_MS`).
- The `nonce` is recorded in a **persistent, append-only nonce store**; replay is
  rejected (`REMOTE_WORKER_CAPABILITY_REPLAY`), and consumed nonces survive a
  daemon restart via **transactional global nonce uniqueness across
  processes/connections** (SBX1.4-C / #1167). The earlier boot-epoch proposal is
  intentionally subsumed by transactional uniqueness (plan S2); V1 stores no
  epoch column, and the concurrent-connection "exactly one accepted, one replay"
  test is the fencing proof.
- The capability is scoped to **one operation on one workspace/sandbox** and
  bound to the request digest — it cannot be lifted and replayed against a
  different call.

Why: the Docker-AuthZ CVE lesson — **own your security edge; never inherit
someone else's reusable-key auth on your isolation boundary**
(`sandbox-service-architecture.md` §5 OWN row). A leaked E2B key grants standing
access until rotated; a leaked boring capability is already expired and already
consumed. This is a strict security improvement over E2B and a sovereignty
selling point.

Trade-off for E2B-compatibility: a public SDK user cannot present one static key.
The compat shim (§4) accepts a public **API key** at the edge and **mints
per-operation capabilities server-side** — the key never reaches the isolation
boundary; it is exchanged for a capability at Layer 1.

### 3.2 The daemon never proxies Docker / the server constructs the create-call

Hard rule from the daemon threat model
(`docs/issues/808/sbx1-own-cloud-provider-plan.md`, §H1 + binding invariants):

- A `sandboxId` **alone never authorizes an operation**. Every request loads the
  stored binding record by `sandboxId` and compares all binding claims to the
  independently-authorized capability **before** touching Workspace, Docker, the
  invocation cache, or the lease timer.
- **No request body or box-reported identity may replace the stored binding.**
  The provider proxy closes over the authorized `workspaceId` + returned
  `sandboxId`; a later op cannot supply a replacement workspace ID.
- The create response carries an **authenticated binding receipt**
  (`RemoteWorkerBindingReceiptSchemaV1`, `payload` + `authenticator`) that the
  client verifies against its requested workspace/lease/worker/digest/expiry
  before constructing either proxy — the server, not the caller, is the source
  of truth for what was created.
- The daemon exposes **exec/fs verbs**, never a raw Docker/containerd socket.
  There is no "run this container spec" endpoint. Cross-tenant/cross-workspace
  combinations return one stable non-revealing code
  (`REMOTE_WORKER_SANDBOX_WORKSPACE_MISMATCH`) with zero Docker effect.

This is the opposite of "proxy Docker": the public API is a small fixed verb set
(`health/create/fs/events/exec/renew/delete`), and container creation parameters
are chosen server-side from admitted evidence/image digests, never passed through
from the client.

---

## 4. E2B-compatibility assessment

**Verdict: structurally close, drop-in achievable at the SDK-shape level; the
auth handshake is where we deliberately diverge (for the better).**

| E2B concept | Our equivalent | Compat |
| --- | --- | --- |
| `Sandbox.create()` | `POST /v1/sandboxes` | Clean — same lifecycle verb |
| `Sandbox.kill()` / list / connect | `DELETE`, (list NEW), reconnect-by-id | create/kill clean; list/connect need adding |
| `commands.run()` / exit code | `exec` op | Clean shape (cmd, cwd, timeout, exit code, stdout/stderr) |
| streaming stdout/stderr | in-guest callbacks exist; wire buffered | Needs a streaming exec response to match E2B |
| `files.read/write/list/...` | `fs` op union | Clean 1:1 |
| `files.watch()` | SSE `fs/events` | Clean |
| `getHost(port)` public URLs | none | NEW — deliberate gap in v1 |
| `E2B_API_KEY` reusable header | capability + single-use nonce | **Deliberate break** — edge shim exchanges an API key for capabilities |
| Firecracker/microVM leakage | none in our surface | Confirmed backend-neutral (see §5 note) |

**GTM value — "sovereign, E2B-compatible":** a customer's E2B-shaped agent code
(create sandbox → run command → read/write files → kill) can target our surface
with a thin client, while their execution runs on EU bare metal under gVisor/
microVM we own — the sovereignty delta E2B structurally cannot offer
(`sandbox-service-architecture.md` §7). We advertise "E2B-compatible surface,
sovereign infra, stronger auth."

**Compatibility we deliberately break for security:**
1. No reusable per-request API key at the isolation boundary — public keys are
   exchanged for short-lived single-use capabilities at the edge.
2. No client-supplied container/Docker spec — the server constructs the create
   call from admitted evidence. (E2B lets you pass a template; we accept a
   template *reference* the daemon validates against pinned digests, never raw
   container params.)

**Backend-neutrality of our own surface:** the public verbs
(`RemoteWorkerOperationSchemaV1`) and their schemas name no Firecracker/gVisor/
Docker specifics. The one isolation string that leaks is in the **health**
response (`isolation: "docker-runsc-systrap"`) — operator/admission metadata,
not part of the create/exec/fs data path. Recommend the *public* health response
omit or abstract this (report a tier, not the runtime), keeping the customer-
facing surface backend-neutral like E2B's.

---

## 5. Minimal v1 API cut (Seneca dogfood)

Smallest set to prove the sovereign execution path end-to-end. Everything else is
explicitly deferred so v1 does not become "product-complete" (guardrail §6 of the
architecture doc).

**v1 (ship now) — already built in SBX1.4:**
1. `GET  /v1/health` — evidence/qualification/image-digest gate (admission).
2. `POST /v1/sandboxes` — create (server-constructed, capability+nonce, binding receipt).
3. `POST /v1/sandboxes/{id}/exec` — run command, exit code, buffered stdout/stderr.
4. `POST /v1/sandboxes/{id}/fs` — read/write/list/stat/mkdir/rename/unlink (+binary).
5. `POST /v1/sandboxes/{id}/renew` — TTL keepalive (idle timeout).
6. `DELETE /v1/sandboxes/{id}` — kill/dispose.
7. Capability + single-use-nonce auth on every call (`x-boring-internal-token`).

**v1.1 (near-term):**
- `GET /v1/sandboxes/{id}/fs/events` (SSE watch) — built; promote to public.
- Streaming exec response (per-chunk stdout/stderr over the wire) to match E2B.
- `GET /v1/sandboxes` — list, and create-time `metadata`/labels.
- Streamed bulk upload/download (beyond the 6 MiB base64 transfer cap).

**v2:**
- Ports / public-URL exposure (`getHost`-equivalent), background processes, PTY.
- Multi-tenant API keys, quotas, metering, billing, console.
- microVM/Firecracker tier as a second `SandboxProviderV1` impl (harvest E2B infra).

---

## Verification notes
- Our-side facts are grounded in read files: `remoteWorkerProtocolV1.ts`,
  `protocolClient.ts`, `providerV1.ts`, `capability.ts`, `invocationSecretsV1.ts`,
  `sandbox.ts`, `workspace.ts`, `sandbox-service-architecture.md`,
  `sbx1-own-cloud-provider-plan.md`.
- E2B-side facts in §1 are from the E2B research pass; anything not confirmed
  from a fetched doc is marked [UNVERIFIED].
