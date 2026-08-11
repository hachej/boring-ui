# SBX1 control-plane API — the v1 contract (E2B-shaped subset, sovereign auth)

This is the **contract** document for the sandbox service's Layer-1 control-plane
API. The architecture doc
([`../../direction/sandbox-service-architecture.md`](../../direction/sandbox-service-architecture.md))
says *why* Layer 1 is the product; the execution plan
([`plan-sbx14.md`](plan-sbx14.md)) says *how and when* the v1 slice of it ships.
This document is the single authority on *the API surface itself*: the v1
endpoints, the capability + single-use-nonce auth handshake, the E2B-shaped
coverage map, and the `SandboxProviderV1` mapping. The plan and the architecture
doc reference this file; they do not restate it.

**Grounding.** Every claim here is cited. `[RESEARCH]` points at the raw research
spec [`references/control-plane-api-spec.md`](references/control-plane-api-spec.md)
(verified against E2B JS SDK v2.38.2 / Python v2.37.1 and the public OpenAPI
reference, plus our own shipped code); `[E2B-INT]` at
[`references/e2b-internals-architecture.md`](references/e2b-internals-architecture.md)
(E2B `infra` source tree); `[SURVEY]` at
[`references/build-vs-adopt-survey.md`](references/build-vs-adopt-survey.md)
(Docker-AuthZ CVE / build-vs-adopt); `[ISO]` at
[`references/isolation-choices-primary-sources.md`](references/isolation-choices-primary-sources.md)
(competitor isolation quotes). No decision below is ungrounded.

---

## 1. Posture — E2B-shaped subset, not a drop-in

The v1 surface is **modeled on E2B's public SDK/API** as an **E2B-shaped subset**.
It matches E2B's lifecycle/exec/fs **verb shape**, so an E2B-familiar agent's
minimal loop — create → run command → read/write files → kill — ports to our
surface with a thin client (`[RESEARCH]` §1, §4). Execution then runs on EU
infrastructure we own, under isolation we own: the sovereignty delta E2B
structurally cannot offer (architecture §7).

It is deliberately **not a drop-in** for full E2B SDK usage. The GTM framing is
*E2B-familiar surface, subset coverage, migration needs adaptation* — never
"drop-in." The honest gap list:

- **Streaming stdout/stderr on the wire** (`onStdout`/`onStderr`, E2B's most-used
  ergonomic) — v1 returns a buffered blob; streaming is a v1.1 target (§4).
- **Background commands / `sendStdin` / PTY** — no equivalent; v2 (§4).
- **`connect()` / `list()` / `getInfo` / metadata / labels** — no distinct verb;
  v1.1+ (§3.1).
- **Create-time / per-command `envs` value pass-through** — replaced by value-free
  `credentialRefs` (stronger, but a client code change; v1 fail-closes non-empty
  `credentialRefs`) (§3.2).
- **`getHost(port)` public URLs** — nothing in the protocol; kills dev-server /
  preview use cases in v1; v2 (§3.3).
- **6 MiB fs transfer cap, no signed-URL bulk path** — streamed bulk is v1.1 (§3.3).
- **`@e2b/code-interpreter` `runCode`** — the surface most published E2B agent
  examples use; **not modeled**. A `runCode`-style convenience would layer over
  `exec` in a client, never as a wire verb (§3.2).
- **The edge API-key compat shim** that makes an unmodified E2B SDK authenticate
  at all is **unscheduled until v2** (§5, architecture §5). Without it, an
  unmodified E2B SDK cannot authenticate against our surface.

Net: **E2B-familiar verb shape, subset coverage; migration needs adaptation.**
Full SDK compatibility (streaming + list + shim) is a v1.1→v2 deliverable, not a
v1 fact (`[RESEARCH]` §4).

### Backend-neutrality

E2B's public surface names no Firecracker/microVM/KVM terms — all abstractions are
neutral (`template`/`sandboxID`/`envd`/public URL) even though E2B runs Firecracker
underneath (`[RESEARCH]` §1.7; `[E2B-INT]` §1, where the microVM lives only in the
data-plane `orchestrator`, never the `api` contract). We adopt the same discipline:
our public verbs name no gVisor/Docker/runsc specifics. The one leak today is the
`isolation: "docker-runsc-systrap"` string in the **health** response — the
*public* health response should report a **tier**, not the runtime (`[RESEARCH]`
§4 backend-neutrality note). The create/exec/fs data path is already neutral.

### Public prefix

The verbs are identical to what SBX1.4 built. Every v1 slice (and the S5 manual
proof) ships the internal-daemon `/internal/v1/...` prefix. The rename to a stable
public `/v1/...` is a **v1.1** routing/naming decision with **no schema change**,
promoted alongside `fs/events` and streaming exec (§4). Below, the public `/v1/...`
form names the target surface; the `/internal/v1/...` form is what exists today
(`[RESEARCH]` §2.1).

---

## 2. The v1 endpoint set

Seven routes: one unauthenticated health gate plus six capability-guarded sandbox
routes. This is the whole v1 API — the daemon invents no verb beyond this fixed
set (plan Decision 4). Each guarded route runs the same ordered guard chain before
it reaches the runtime: **body-size bound → content-type/schema check → auth
rate-limiter → capability decode/verify → binding authorize → runtime proxy →
redacted response.** No route touches Workspace, Docker, the invocation cache, or
the lease timer before every guard passes (§3.4).

| Public verb + path | Internal path (today) | Op | Guards before runtime | E2B `SandboxService` RPC |
| --- | --- | --- | --- | --- |
| `GET /v1/health` | `GET /internal/v1/health` | health | none — public admission facts only | (no direct RPC; E2B exposes cluster health via Consul, ours is a single-box evidence/digest gate) |
| `POST /v1/sandboxes` | `POST /internal/v1/sandboxes` | create | schema → limiter → capability(create) → deterministic `sandboxId` → digest pin | `SandboxService.Create` |
| `POST /v1/sandboxes/{id}/exec` | `.../internal/v1/sandboxes/{id}/exec` | exec | + binding authorize by `sandboxId` | (envd `Process.Start`, proxied) |
| `POST /v1/sandboxes/{id}/fs` | `.../fs` | fs | + binding authorize | (envd `Filesystem.*` + HTTP up/download) |
| `GET /v1/sandboxes/{id}/fs/events` | `.../fs/events` | events | + binding authorize, bounded SSE | (envd `Filesystem.WatchDir`) |
| `POST /v1/sandboxes/{id}/renew` | `.../renew` | renew | + binding authorize | `SandboxService.Update` (TTL) |
| `DELETE /v1/sandboxes/{id}` | `DELETE /internal/v1/sandboxes/{id}` | delete | + binding authorize | `SandboxService.Delete` |

`list`, `pause`, `checkpoint` from E2B's RPC set (`[E2B-INT]` §1 appendix) are
deliberately absent: `list` is v1.1, `pause`/`checkpoint` are the v2 UFFD
snapshot/restore tier (§4; architecture §4). The wire contract already exists in
`packages/boring-sandbox/src/shared/remoteWorkerProtocolV1.ts` (client in
`providers/remote-worker/protocolClient.ts`); auth headers (`REMOTE_WORKER_HEADERS_V1`)
are `x-boring-internal-token` (capability), `x-boring-request-id`,
`x-boring-protocol-version` (`[RESEARCH]` §2.1).

### 2.1 Lifecycle

| Verb | Status | Contract |
| --- | --- | --- |
| `POST /v1/sandboxes` — **create** | HAVE | Modeled on E2B `Sandbox.create()`. Returns `sandboxId`, `runtimeCwd=/workspace`, `leaseExpiresAtMs`, and an authenticated `bindingReceipt` (`RemoteWorkerCreateResponseSchemaV1`). **Differs from E2B:** the daemon **constructs** the create request server-side from an already-authorized `workspaceId`; it never accepts a caller-supplied workspace identity or a raw container spec. E2B accepts a client `templateID`; we accept a template *reference* validated against pinned digests, never raw container params (`[RESEARCH]` §2.4, §3.2, §4). |
| `DELETE /v1/sandboxes/{id}` — **kill** | HAVE | Modeled on E2B `Sandbox.kill()` → `{ disposed: true }` (`[RESEARCH]` §2.4). |
| `POST /v1/sandboxes/{id}/renew` — **TTL keepalive** | HAVE | Our equivalent of E2B `setTimeout` / idle-timeout. `idleTimeoutMs` (≤ 30 min) → new `leaseExpiresAtMs` (`[RESEARCH]` §2.4). |
| **connect / reconnect** | PARTIAL | E2B has an explicit `Sandbox.connect()` with pause/auto-resume. We have no distinct verb: a fresh capability is minted per operation against an existing `sandboxId`, and the stored binding record is the source of truth. Reconnecting an events stream after expiry needs a fresh capability. **Intentional divergence** — no long-lived connection handle on the isolation boundary (`[RESEARCH]` §2.4). |
| `GET /v1/sandboxes` — **list** | NEW (v1.1+) | E2B `Sandbox.list()`. Not present in `RemoteWorkerOperationSchemaV1`; deferred so v1 does not become product-complete (architecture §6). |
| **getInfo / metadata / labels** | NEW (v1.1+) | E2B `getInfo`/create-time `metadata`. Not modeled on our create today (create carries `sessionId`, `clientLeaseId`, digests); deferred. |
| **pause / resume / snapshot / fork** | NEW (v2) | E2B `pause`/`createSnapshot`/`fork` back their UFFD snapshot/restore fast-start (`[E2B-INT]` §1). v2 only — harvest E2B's proven snapshot plumbing (architecture §5 TAKE row), never build in v1 (architecture §6). |

### 2.2 Exec

`POST /v1/sandboxes/{id}/exec` — **HAVE.** Modeled on E2B `commands.run()` → exit
code + stdout/stderr. Request (`RemoteWorkerExecRequestV1`): `invocationId`,
single-string `command` (≤ 64 KiB), optional `cwd`, `timeoutMs` (≤ 15 min),
`maxOutputBytes` (≤ 4 MiB), optional value-free `credentialRefs` (§3.2). Response:
`stdoutBase64`/`stderrBase64`, `exitCode`, `durationMs`, `truncated`, optional
`stdoutEncoding`/`stderrEncoding` (`utf-8`|`binary`). The in-guest contract is
`Sandbox.exec(cmd, opts)` in `packages/agent/src/shared/sandbox.ts`, whose
`ExecOptions` already carries `signal`, `timeoutMs`, `maxOutputBytes`,
`onHeartbeat`, and incremental `onStdout`/`onStderr` byte-stream callbacks
(`[RESEARCH]` §2.2).

- **Streaming stdout/stderr** — PARTIAL, v1.1 target. The in-guest layer already
  streams via callbacks, but the wire `exec` response is a buffered base64 blob —
  no per-chunk HTTP stream yet. Matching E2B's streaming `CommandHandle` needs a
  streaming exec response, which is an **additive** change to this verb, not a
  reshape (§4; `[RESEARCH]` §2.2).
- **background handle / `sendStdin` / PTY** — NEW (v2). No equivalent in the
  protocol (`[RESEARCH]` §1.2).
- **`@e2b/code-interpreter` `runCode`** — NOT MODELED. We expose `exec` (a shell
  command), not a language-kernel `runCode`; a `runCode`-style convenience would be
  a client-side wrapper over `exec`, never a distinct wire verb (`[RESEARCH]`
  coverage map).

### 2.3 Filesystem

`POST /v1/sandboxes/{id}/fs` — **HAVE.** Modeled on E2B `sandbox.files.*`.
Implemented as `RemoteWorkerWorkspaceOperationSchemaV1`, a discriminated union on
`op`: `readFile`, `readBinaryFile`, `writeFile`, `writeBinaryFile`,
`readFileWithStat`, `writeFileWithStat`, `writeBinaryFileWithStat`, `unlink`,
`readdir`, `stat`, `mkdir` (`recursive?`), `rename` (`from`/`to`). Text ≤ 6 MiB per
transfer; binary carried base64. E2B `exists` maps to our `stat`. This is a **1:1
map** onto the `Workspace` interface (`packages/agent/src/shared/workspace.ts`);
paths are workspace-relative and **path validation is an adapter concern**
(coding-invariant 4; `[RESEARCH]` §2.3).

- `GET /v1/sandboxes/{id}/fs/events` — **HAVE** (SSE), promote to public in v1.1.
  Modeled on E2B `files.watchDir`; backed by `Workspace.watch()` over an SSE stream
  of `RemoteWorkerFsEventEnvelopeSchemaV1` (`[RESEARCH]` §2.1, §2.3).
- **Bulk / signed-URL upload/download** — PARTIAL. E2B offers signed-URL
  upload/download; we carry binary via base64 ≤ 6 MiB with no streamed multi-MB
  path. Streamed bulk transfer is v1.1 (`[RESEARCH]` §2.3).
- **Ports / `getHost(port)` public URLs** — NEW (v2). E2B exposes per-port public
  URLs; nothing in our protocol — a deliberate v1 gap (§3.3; `[RESEARCH]` §1.4).

---

## 3. Where we deliberately differ

### 3.1 Coverage map (have / partial / new)

| E2B method | Our status | Evidence |
| --- | --- | --- |
| `Sandbox.create` | **HAVE** | `POST /internal/v1/sandboxes`, `RemoteWorkerCreateRequestSchemaV1` |
| `Sandbox.kill` | **HAVE** | `DELETE /internal/v1/sandboxes/{id}` + `Sandbox.dispose?()` |
| `setTimeout` / TTL | **HAVE** | `renew` op, `idleTimeoutMs` (≤ 30m), `leaseExpiresAtMs` |
| `Sandbox.connect` | **PARTIAL** | operate on `sandboxId` w/ fresh capability; no explicit "connect" verb, no pause/auto-resume |
| `Sandbox.list` | **NEW** | no `list` op in `RemoteWorkerOperationSchemaV1` |
| `getInfo` / `metadata` / labels | **NEW** | not modeled on create/response |
| `pause`/`resume`/`snapshot`/`fork` | **NEW (v2)** | none; harvest E2B UFFD snapshot/restore |
| `commands.run` (exit code) | **HAVE** | `exec` op + `Sandbox.exec`; returns exitCode/stdout/stderr |
| streaming stdout/stderr | **PARTIAL** | in-guest `onStdout`/`onStderr` exist; wire response is buffered base64 |
| `commands.run({background})` / handle / `sendStdin` | **NEW** | no background handle, no stdin channel |
| `pty.*` | **NEW** | no PTY in protocol |
| `files.read/write/list/getInfo/exists/makeDir/rename/remove` | **HAVE** | `RemoteWorkerWorkspaceOperationSchemaV1` union (`exists` = `stat`) |
| `files.watchDir` | **HAVE** | SSE `fs/events` + `Workspace.watch()` |
| upload/download (bulk/signed-URL) | **PARTIAL** | binary via base64 ≤ 6 MiB; no streamed / signed-URL path |
| `getHost(port)` public URLs | **NEW (v2)** | nothing in protocol |
| `envs` injection | **HAVE (stronger)** | value-free `credentialRefs` resolved host-side (§3.2); plain `env` also supported |
| auth (`X-API-Key`) | **HAVE (different, stronger)** | capability token + single-use nonce, not reusable API key (§3.4) |

### 3.2 Secret injection — value-free `credentialRefs` (stronger)

E2B passes plain create-time `envs` and per-command `envs` (`[RESEARCH]` §1.5).
Ours carries **value-free `credentialRefs`** resolved host-side, so secret *values*
never cross the wire or reach the box in the request (`[RESEARCH]` §2.2, coverage
map). Plain `env` in `ExecOptions` is still supported for non-secret vars. **In the
v1 internal-first slice the daemon does not deliver sandbox credentials at all:**
non-empty `credentialRefs` fail closed with
`REMOTE_WORKER_SECRET_REFERENCE_REJECTED`; model credentials remain in the Seneca
control plane (plan S1).

### 3.3 No `getHost(port)` public URLs, no raw container spec

E2B exposes per-port public URLs via `getHost(port)` (`[RESEARCH]` §1.4). v1 has no
port exposure and no `client-proxy` ingress; `getHost` is a v2 gap. And the daemon
exposes exec/fs verbs, **never a raw Docker/containerd socket** — there is no "run
this container spec" endpoint. Container-creation parameters are chosen server-side
from admitted evidence/image digests, never passed through from the client
(`[RESEARCH]` §3.2). This is the structural opposite of "proxy Docker" and is what
keeps the auth layer small enough to own (§3.4).

### 3.4 The auth handshake — capability token + single-use nonce

This is where we **must** differ from E2B, and the divergence is the security
selling point, not a gap.

- **E2B model:** every SDK request carries a **long-lived reusable API key**
  (`E2B_API_KEY`, header `X-API-Key`) (`[RESEARCH]` §1.6, §3.1).
- **Our model:** every operation is authorized by a **short-lived capability** in
  `x-boring-internal-token` whose claims (`RemoteWorkerCapabilityClaimsSchemaV1`)
  bind `protocolVersion`, `workerId`, `workspaceId`, `operation`, `sandboxId`,
  `requestDigest` (SHA-256 of the exact request), `issuedAtMs`/`expiresAtMs`, and a
  **single-use `nonce`**. Max lifetime is **5 minutes**
  (`REMOTE_WORKER_MAX_CAPABILITY_LIFETIME_MS`). The nonce is recorded in a
  persistent store; replay is rejected (`REMOTE_WORKER_CAPABILITY_REPLAY`). The
  capability is scoped to one operation on one workspace/sandbox and bound to the
  request digest — it cannot be lifted and replayed against a different call
  (`[RESEARCH]` §3.1).
- **Consumed nonces survive a daemon restart** via **transactional global nonce
  uniqueness across processes/connections** (delivered by plan S2). The earlier
  boot-epoch proposal is intentionally **subsumed** by transactional uniqueness:
  V1 stores **no epoch column**, and the concurrent-connection "exactly one
  accepted, one replay" test is the fencing proof (`[RESEARCH]` §3.1; plan S2).
- **Why we diverge — grounded in the Docker-AuthZ CVE class:** *own your security
  edge; never inherit someone else's reusable-key or bolt-on authz on your
  isolation boundary.* The primary source is **CVE-2024-41110** (Docker Engine
  AuthZ-plugin bypass, CVSS 10.0) — an authorization layer bolted in front of a
  root-equivalent runtime socket failed because the daemon forwarded a body-less
  request past it (`[SURVEY]` "Security lesson — the Docker-AuthZ CVE class"). A
  leaked E2B key grants standing access until rotated; a leaked boring capability
  is already expired and already consumed. This is the OWN disposition of the
  TAKE/ADAPT/OWN/RE-HOST split (architecture §5) made concrete.
- **v1 auth caveat (stated plainly):** the capability/nonce model is genuinely
  stronger *per request* — but in v1 both the issuer (Seneca) and the verifier (the
  daemon) derive from **one static shared secret the plan's threat model calls
  host-root-equivalent**. A leaked capability is already dead; a leaked *secret* is
  the whole box. The per-request strength is real; the v1 key material is not yet
  multi-tenant (architecture §3; plan "Daemon exposure and threat model").
- **`sandboxId` alone never authorizes.** Every request loads the stored binding
  record by `sandboxId` and compares all binding claims to the independently
  authorized capability *before* touching Workspace, Docker, the invocation cache,
  or the lease timer; no request body or box-reported identity may replace the
  stored binding. Cross-workspace combinations return one stable, non-revealing
  code (`REMOTE_WORKER_SANDBOX_WORKSPACE_MISMATCH`) with zero Docker effect —
  satisfying coding-invariant 8 (`[RESEARCH]` §3.2).
- **Edge compat shim — NOT in v1.** A public SDK user cannot present one static key
  at the boundary. The compat shim accepts a public API key **at the edge** and
  **mints per-operation capabilities server-side**; the key never reaches the
  isolation boundary (`[RESEARCH]` §3.1). Until it exists, Seneca (holding the
  static secret and minting capabilities client-side) **is** the privileged
  first-party path in the capability-issuance dimension (architecture §3). The shim
  is a named **v2** deliverable (architecture §5, "Multi-tenant auth & API keys")
  and a hard precondition of the public-opening gate (plan "Public-opening gate").

---

## 4. Version staging

Smallest set to prove the sovereign execution path; everything else is explicitly
deferred so v1 does not become product-complete (architecture §6; `[RESEARCH]` §5).

**v1 (ships in SBX1.4) — already built:**
1. `GET  /v1/health` — evidence/qualification/image-digest admission gate.
2. `POST /v1/sandboxes` — create (server-constructed, capability+nonce, binding receipt).
3. `POST /v1/sandboxes/{id}/exec` — run command, exit code, buffered stdout/stderr.
4. `POST /v1/sandboxes/{id}/fs` — read/write/list/stat/mkdir/rename/unlink (+binary).
5. `POST /v1/sandboxes/{id}/renew` — TTL keepalive (idle timeout).
6. `DELETE /v1/sandboxes/{id}` — kill/dispose.
7. Capability + single-use-nonce auth on every call (`x-boring-internal-token`).

**v1.1 (near-term):** promote SSE `fs/events` to public; streaming exec response;
`GET /v1/sandboxes` list + create-time `metadata`; streamed bulk transfer; the
`/internal/v1/...` → `/v1/...` public-prefix rename (no schema change).

**v2:** ports/public URLs (`getHost`-equivalent), background/PTY,
pause/resume/snapshot, multi-tenant keys/quotas/metering, the edge compat shim, the
microVM/Firecracker tier as a second `SandboxProviderV1` impl.

---

## 5. `SandboxProviderV1` mapping and E2B-compatibility posture

### The provider seam

E2B keeps its `api` ↔ `orchestrator` boundary as a gRPC `SandboxService`
(`Create/Update/List/Delete/Pause/Checkpoint`) so a Firecracker backend can swap in
without touching the control plane (`[E2B-INT]` §1 appendix, §8). Our analogous
swap seam is the already-frozen **`SandboxProviderV1`** TS interface
(`packages/boring-sandbox/src/shared/providerV1.ts`), which sits on the **consumer
side of the wire**: Seneca composes the `remote-worker` provider through it (plan
S5). The daemon's routes proxy **in-process to `RunscSessionRuntimeV1`**, not to
this interface, because in v1 the control plane and data plane are the same box.

**Honest status:** today's `SandboxProviderV1` surface is `create` / `invalidate?`
/ `close?` plus the returned pair's `Sandbox` / `Workspace` / `dispose()`. It does
**NOT** currently mirror the six-RPC set — `Update`/`List`/`Pause`/`Checkpoint` have
no direct methods; renew/exec/fs live on the returned pair. E2B-internals §8's
"should mirror exactly that RPC set" is a **recommendation** — a v2-entry alignment
to perform when the microVM provider lands behind the frozen contract, **not** a v1
fact. gVisor today, Firecracker tomorrow, contract unchanged: v2 adds a provider,
it does not reshape the contract (architecture §2 Layer 3).

### Compatibility verdict

**E2B-shaped subset, sovereign infra, stronger auth** — structurally close at the
SDK-shape level; the auth handshake is where we deliberately diverge for the better.

| E2B concept | Our equivalent | Compat |
| --- | --- | --- |
| `Sandbox.create()` | `POST /v1/sandboxes` | Clean — same lifecycle verb |
| `Sandbox.kill()` / list / connect | `DELETE`, (list NEW), reconnect-by-id | create/kill clean; list/connect need adding |
| `commands.run()` / exit code | `exec` op | Clean shape (cmd, cwd, timeout, exit code, stdout/stderr) |
| streaming stdout/stderr | in-guest callbacks exist; wire buffered | Needs a streaming exec response to match E2B |
| `files.read/write/list/...` | `fs` op union | Clean 1:1 |
| `files.watch()` | SSE `fs/events` | Clean |
| `getHost(port)` public URLs | none | NEW — deliberate v1 gap |
| `E2B_API_KEY` reusable header | capability + single-use nonce | **Deliberate break** — edge shim exchanges an API key for capabilities |
| Firecracker/microVM leakage | none in our surface | Confirmed backend-neutral (health-string caveat, §1) |

**We deliberately break two compatibilities for security:** (1) no reusable
per-request API key at the isolation boundary — public keys are exchanged for
short-lived single-use capabilities at the edge; (2) no client-supplied
container/Docker spec — the server constructs the create call from admitted
evidence (`[RESEARCH]` §4).

### Isolation-tier grounding

The API surface is isolation-tier-neutral, but the *tier the create call resolves*
is grounded in primary sources: **v1 = gVisor / runsc, single-tenant, semi-trusted**
(Modal runs dense multi-tenant production on gVisor — "strong isolation
properties," `[ISO]` §1); **v2 dedicated tier = microVM / Firecracker, untrusted
strangers** (Fly.io frames Firecracker as hardware-grade isolation, `[ISO]`).
`gVisor-v1 → microVM-v2` is a Layer-3 provider swap behind the frozen contract, not
an API reshape (architecture §4; `[RESEARCH]` §1.7).

---

> The full raw research — the verified E2B §1 public surface, byte-level schema
> notes, and unverified caveats — lives in
> [`references/control-plane-api-spec.md`](references/control-plane-api-spec.md).
> This document is its consumable, single-voice consolidation; when they differ on
> a verified E2B fact, the reference wins.
