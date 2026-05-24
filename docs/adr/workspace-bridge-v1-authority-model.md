# ADR: WorkspaceBridge v1 Authority Model

Status: Accepted for implementation once bead `boring-ui-v2-reorg-r32b` closes.

Date: 2026-05-23

## Context

Workspace plugins and runtime SDKs need protected request/response access to host capabilities without each plugin owning custom Fastify routes. The existing UI bridge is a side-effect lane for frontend commands, not an authority boundary. Ask-user and Macro expose the immediate pressure points:

- ask-user needs an agent tool to wait for browser/user input without a plugin-owned server route/export.
- Macro browser UI and runtime SDKs need domain/data access without hardcoded localhost URLs, ad-hoc auth headers, or canonical `/api/macro/*` data routes.

Implementation must remain package-neutral: `@hachej/boring-agent` stays workspace-neutral; workspace/core inject workspace bridge specifics through generic seams.

## Decision

### 1. WorkspaceBridge has two lanes

- `emitUiEffect(effect)` is the UI side-effect lane. It may open/focus panes or emit display hints. It is never the authority for a domain mutation.
- `call(op, input, options)` / `registerHandler(op, handler)` is the bounded host capability RPC lane.

Legacy `postCommand`/`postUiCommand` names are hard-renamed to `emitUiEffect`. v1 has no backward-compatible alias.

### 2. Caller boundary and actor attribution are separate

`callerClass` describes the transport/source boundary:

- `browser`
- `runtime`
- `server`

Actor attribution describes who the action represents for audit/debugging:

- `actorKind`: `human | agent | system | service`
- `performedBy`: redacted identity label/id
- `onBehalfOf`: optional redacted delegated identity label/id

Actor attribution is observability/audit context only in v1. It is not a new authorization layer and does not change v1 `RateLimitPolicy` key shape.

Spoofing rule: request bodies cannot set trusted caller/actor attribution. Browser auth derives human attribution, runtime token claims/env derive agent attribution, and trusted server calls explicitly choose system/service attribution through server-side context.

### 3. Local CLI/no-auth remains trusted local

Local CLI/no-auth mode remains lightweight and trusted-local. v1 does not add a local development token. This posture must be documented wherever the bridge HTTP transport is documented.

### 4. Bridge authorization policy

`BridgeAuthPolicy` resolves caller identity, caller class, capabilities, actor attribution, and audit labels before handlers run.

- Browser callers use the app shell/browser auth policy.
- Runtime callers use scoped runtime bridge tokens injected into direct/local/vercel runtimes.
- Server callers use explicit trusted server context.

Runtime tokens are scoped by workspace/session/capabilities/expiry/jti and are not persisted to transcripts or logs.

### 5. Idempotency and replay

Token `jti` prevents blind token replay but not semantic operation retries. Mutating/retryable ops declare operation-level idempotency policy.

Required v1 policies:

| Operation | Policy |
|---|---|
| `human-input.v1.request` | idempotency key required per tool call |
| `human-input.v1.answer` | one-shot idempotency key; conflicting replay rejected |
| `human-input.v1.cancel` | one-shot idempotency key; conflicting replay rejected |
| `macro.v1.transform.persist` | idempotency key required |

Replay/idempotency storage must support atomic check-and-set.

### 6. Pending-question coordinator lives in workspace

Workspace owns a small generic pending-question coordinator for `human-input.v1.*` state/wait/answer/cancel/timeout/abandon/nonce/transcript plumbing.

The ask-user plugin owns:

- `ask_user` agent tool and Pi extension glue
- Questions UI/pane/forms/status rendering
- labels/help text/docs
- form-specific payloads and schemas in plugin/shared code

Workspace must not import ask-user plugin UI or form-specific schema internals. If previous ask-user server store/runtime code exists, Phase 8A should extract/adapt proven logic into the workspace coordinator instead of duplicating behavior.

### 7. Ask-user is a hard cutover

There is no compatibility window for old ask-user server route/export behavior.

The supported v1 path is:

1. ask-user Pi extension receives explicit in-process WorkspaceBridge context.
2. agent tool calls `human-input.v1.request`.
3. workspace pending-question coordinator records/waits.
4. browser Questions UI answers/cancels through `human-input.v1.answer` / `human-input.v1.cancel`.
5. UI opening/focusing is only an `emitUiEffect` hint.

Old `@hachej/boring-ask-user/server` routes/exports are removed or fail fast if physical removal must be staged. Duplicate old/new stores, duplicate tools, and old `WorkspaceServerPlugin.agentTools` ask-user authority are not allowed.

`human-input.v1.transcript` is super-admin/debug only. Runtime tokens and normal browser users cannot read it.

### 8. No generic workspace file RPC in v1

v1 does not define generic `workspace-files.v1.read`, `workspace-files.v1.write`, `workspace-files.v1.list`, `artifact.v1.*`, or `workspace-bridge/artifacts/*` APIs.

File/deck/raw/upload behavior remains product-owned and path-validated through existing workspace file/upload/raw-file mechanisms.

Large bridge outputs reuse the existing upload/file-asset/raw-file pipeline:

- `POST /api/v1/files/upload`
- `GET /api/v1/files/raw?path=...`
- `Workspace.writeBinaryFile*` / `Workspace.readBinaryFile*` adapter helpers

Large-output responses return file-asset pointers with workspace-relative `path`, `contentType`, and optional `rawUrl`. There is no separate artifact/cache service.

### 9. Macro v1 bridge surface

Macro data/domain access moves to WorkspaceBridge for bridge-capable callers. Browser UI and runtime SDK calls both use WorkspaceBridge so plugin-owned `/api/macro/*` data routes are not required in the supported architecture.

Required v1 Macro bridge ops:

- `macro.v1.catalog.search`
- `macro.v1.facets.list`
- `macro.v1.series.metadata`
- `macro.v1.series.data`
- `macro.v1.series.lineage`
- `macro.v1.sql.query`
- `macro.v1.transform.persist`

Optional only if the product still needs manual refresh:

- `macro.v1.refresh`
- `macro.v1.refresh.status`

Not bridged in v1:

- deck routes as Macro data RPC
- `/api/macro/ch-query`
- generic `workspace-files.v1.*`

`macro.v1.sql.query` is allowed in v1 only with guardrails:

- read-only verbs only: `SELECT`, `WITH`, `EXPLAIN`, `DESCRIBE`, `SHOW`, `DESC`
- reject multi-statement SQL
- enforce timeout, max rows, and max bytes
- require `macro:sql.query` capability
- audit with caller class, actor attribution, workspace/op/request ids, and redacted SQL/payloads as appropriate

If temporary `/api/macro/*` wrappers exist during migration, they must be thin wrappers over bridge handlers, marked non-canonical/removable, and not required by bridge-capable browser UI or SDKs.

### 10. Package boundaries

- `@hachej/boring-agent` remains workspace-neutral. It may expose generic runtime env/context contribution seams.
- Workspace/core inject WorkspaceBridge runtime env/context.
- Workspace base front/shared code must not value-import from `@hachej/boring-agent`.
- Generated/runtime plugin RPC manifests are deferred from v1. Guardrail: generated/runtime plugins should not add custom Fastify routes or host-process handlers.

### 11. Error, audit, and redaction requirements

All bridge errors use stable canonical error codes. No raw ad-hoc string codes.

Audit/logging must include request id, workspace id, op, caller class, actor kind, redacted performedBy/onBehalfOf, auth decision, rate-limit decision where relevant, and handler outcome.

Logs/tests must redact:

- bearer tokens and Authorization headers
- one-shot nonces
- user answers
- file contents
- host absolute paths where sensitive
- full SQL text when sensitive
- full request/response payloads unless explicitly safe fixture data

## Open decisions after this ADR

Only the following v1 defaults remain open for implementation beads or follow-up docs:

1. Exact local rate-limit default numbers per caller/op.
2. Audit retention duration and which super-admin/debug role can read retained audit/transcript data.

No other authority-model decision should be reopened during v1 implementation without a new ADR/update bead.

## Consequences

- Workers can implement bridge contracts and handlers without rereading the full plan.
- Ask-user implementation is forced onto the bridge path and cannot drift back to plugin-owned server routes.
- Macro implementation can remove the route requirement for bridge-capable data/domain operations.
- Large-payload support reuses existing file infrastructure instead of adding a new artifact subsystem.
- Actor attribution improves observability without expanding authorization/rate-limit scope in v1.

## Implementation gate

WorkspaceBridge implementation starts only after this ADR bead (`boring-ui-v2-reorg-r32b`) closes with reviewer approval.
