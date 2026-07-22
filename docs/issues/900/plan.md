---
github: https://github.com/hachej/boring-ui/issues/900
issue: 900
state: ready-for-human
updated: 2026-07-22
flag: flag:boring-mcp-catalog-v1
track: owner
---

# gh-900 Full MCP catalogs, remote servers, and approved execution

## Authority and named consumer

This is the canonical reusable-package plan for issue #900. The named product
consumer is generic Seneca issue
[`hachej/seneca#35`](https://github.com/hachej/seneca/issues/35).

This plan is about **agents consuming external MCP tools**. It is not:

- issue #806's opposite-direction ingress, where an external MCP client invokes
  a Boring agent;
- the curated Constellation tenant policy, which may remain a static restricted
  Notion/Airtable deployment; or
- arbitrary local `stdio` process installation on a shared host.

The plan is ready for owner/security review, not implementation dispatch. It
changes public package contracts, workspace authority, OAuth, credential
identity, outbound networking, execution permissions, and the meaning of
“enabled MCP tool.” No Beads are created by this plan.

## Problem

### User problem

Generic Seneca is intended to be a general agent application, but its current
MCP surface exposes only two statically configured Composio toolkits: Notion and
Airtable. A user cannot browse the complete Composio catalog, discover remote
servers from the official MCP Registry, or connect a remote MCP endpoint by
URL. The agent can execute only a small exact read-only allowlist.

The desired product is:

1. every valid Composio app-native tool can be discovered and described;
2. active remote servers in the official MCP Registry can be browsed and
   connected when they offer a compatible endpoint;
3. a workspace owner can add a custom remote HTTPS MCP endpoint;
4. all valid discovered tools remain available through the governed proxy
   surface rather than being silently hidden because they are not on a static
   provider list;
5. only host-classified safe reads execute without interruption; and
6. write, destructive, administrative, open-world, or unknown operations cannot
   reach a provider until the current human explicitly approves that exact
   invocation through Ask User.

### Current implementation

`@hachej/boring-mcp` already supplies valuable foundations:

- an app-left MCP source overlay;
- actor-owned source access and secret-free DTOs;
- a real MCP SDK Streamable HTTP client;
- Composio v3.1 Session creation and hosted connection links;
- source status, discovery, normalized schema hashes, redaction, rate limits,
  timeout wrappers, and stable MCP errors;
- seven context-efficient bridge tools, including search/describe and governed
  read-only execution; and
- app-injected persistence and credential resolution.

The current restrictions are structural, not only configuration:

- `DEFAULT_MCP_PROVIDER_TEMPLATES` contains only Notion and Airtable.
- Seneca's front and server compositions list only those providers.
- every Composio Session sends `toolkits.enable: [toolkitId]` and therefore
  enables exactly one toolkit;
- Composio meta-tools are hidden, while internal discovery searches only the
  configured toolkit and caps the result set;
- `McpDiscoveredTool` drops protocol annotations and output schemas;
- catalog normalization denies any tool not on an exact static read allowlist;
- the only execution bridge is `mcp_readonly_call`;
- `createMcpSdkStreamableHttpTransport` accepts an endpoint but has no hosted
  source lifecycle, OAuth provider, SSRF-safe fetch boundary, redirect policy,
  or credential profile;
- source metadata lives under a per-user server-owned settings key in consuming
  apps; and
- Ask User and MCP are composed as independent runtimes, with no enforcement
  seam connecting approval to provider execution.

### Existing owner-ratified dependency

Issue #820's owner-ratified credential-vault plan already decides that provider
credentials become workspace-scoped, owner-managed, host-resolved credentials;
`@hachej/boring-mcp` must migrate onto that common mechanism instead of creating
another secret store or onboarding surface. Its sequence is:

```text
16f.1 credential/provider contract
-> 16f.2 encrypted vault storage
-> 16f.3 owner-only API-key/OAuth onboarding
-> 16f.4 boring-mcp migration onto the common mechanism
```

Open PR #893 is the current `16f.1` contract candidate. This plan neither copies
nor bypasses it. MCP source/account secrets, OAuth refresh tokens, bearer/API
keys, and session headers must use the landed #820 authority and custody path.
The operator-owned Composio project key remains an operator secret.

This feature also triggers a deliberately deferred #820 decision: custom MCP
servers are a named consumer that needs more than one credential profile for the
same provider kind. The required identity is one profile per remote source,
semantically keyed by `(workspaceId, providerId, profileId)`, where `profileId`
is a host-generated opaque source identity and never caller authority. The
implementation must amend Decision 27/#820 before changing the v1 credential
contract or schema. It must not simulate profiles with tenant-authored dynamic
provider registrations. If approved, slice 900.0 inserts after `16f.1` and before
`16f.2`, because vault schema and onboarding must not first ship a one-profile
identity that this named consumer immediately replaces.

## Solution

### Product surface

The MCP overlay becomes one management surface with four views:

1. **Connected** — workspace MCP sources/accounts, health, provenance, tools,
   authorization state, and disconnect/revoke controls.
2. **Composio apps** — server-side search/pagination over the complete Composio
   toolkit catalog, connection readiness, and on-demand hosted connection.
3. **MCP Registry** — search over a validated last-known-good mirror of active
   official Registry metadata, showing only compatible remote transports as
   connectable.
4. **Custom server** — owner enters a display name and HTTPS Streamable HTTP URL,
   chooses automatic OAuth, no auth, bearer, or an approved API-key mode, and
   reviews the server identity/capabilities discovered by a guarded probe.

Members may list/use workspace-connected sources. Only current workspace owners
may create, connect, replace, disable, revoke, or delete a source or credential.
A source identifier, provider identifier, Registry name, endpoint, or Agent tool
argument never grants workspace authority.

### Meaning of “all tools”

“All tools available” has a precise v1 meaning:

- every protocol-valid **app-native** tool discovered through an enabled source
  can be searched, described, and submitted to the governed `mcp_tool_call`
  boundary;
- tools are not loaded en masse into the model context; the stable
  search/describe/call proxy pattern remains;
- unsupported names, malformed/oversized schemas, secret-bearing metadata, or
  protocol-invalid results fail closed with stable errors rather than entering
  the catalog;
- Composio catalog/auth/schema/execute meta-tools remain server implementation
  details, not agent-callable tools; and
- Composio remote workbench/bash meta-tools are disabled for this release. They
  are a separate remote-code product, not an app-native toolkit action.

Availability is distinct from automatic execution. A catalog entry reports one
of:

- `direct` — host policy has classified the exact current tool as a safe read;
- `approval-required` — the tool is available but needs one exact human
  approval;
- `blocked` — only for invalid protocol data, an unsafe/unavailable source,
  missing authority/credentials, or an explicit deployment deny policy.

The system no longer uses `enabled: false` as a synonym for “not on the old
read-only list.”

### Architecture

```text
MCP overlay / agent bridge
        |
        v
workspace-authorized MCP application service
        |
        +-- catalog adapters
        |     +-- Composio full-catalog Session adapter
        |     +-- official Registry mirror/search adapter
        |
        +-- workspace source/account registry
        |     +-- Composio catalog source + connected toolkit accounts
        |     +-- Registry-derived remote source
        |     +-- custom remote source
        |
        +-- #820 workspace credential resolver
        |     +-- external-managed Composio account reference
        |     +-- standard MCP OAuth refresh/access lifecycle
        |     +-- bearer/API-key profile per remote source
        |
        +-- guarded remote transport
        |     +-- URL/redirect/DNS policy
        |     +-- egress proxy
        |     +-- MCP SDK Streamable HTTP + OAuth provider
        |
        +-- catalog + host risk policy
        |
        +-- governed execution boundary
              +-- direct safe read
              +-- exact Ask User approval -> revalidate -> one provider call
```

`@hachej/boring-mcp` remains the external-MCP consumption owner. Core owns
workspace authorization and the #820 credential store. Ask User owns questions
and human answers. The host app composes these capabilities; no package gains a
second workspace/runtime authority.

## Decisions

### 1. Workspace authority replaces personal source authority

New sources and credentials are workspace-scoped. `createdByUserId` is audit
metadata only. Current membership is checked for every source read and tool
call; current owner role is checked for every lifecycle mutation.

Existing personal `__serverBoringMcpSourcesV1` records stay personal until the
#820 migration performs inventory and consent quarantine. No connection is
automatically promoted, even if only one exists. Promotion requires the
connected member's consent and current owner approval/reconnection. Departed
users and collisions cannot be promoted automatically.

### 2. Credential profiles are source-scoped without dynamic providers

The host registers stable provider kinds such as `composio` and `mcp-remote`.
A custom/Registry remote source receives an opaque host-generated `profileId`
equal to or derived from its opaque source identity. The common credential
resolver accepts that trusted profile identity only through a host-owned MCP
consumer binding.

The browser, model, and endpoint never construct or widen credential references.
A source in workspace A cannot select workspace B's profile, and deleting one
remote source does not revoke another remote source of the same provider kind.
This is the named-consumer amendment required by #820's one-profile decision.

### 3. One Composio catalog source per workspace

Composio uses one virtual catalog source per workspace rather than one static
provider template per app. A random opaque custodian subject identifies the
workspace to Composio; raw Boring workspace/user identifiers are not sent as
Composio `user_id` values. Multiple toolkit accounts live under that custodian
subject and appear as child connection records in the UI. A current workspace
owner must select the active account for a toolkit; execution never inherits
Composio's “most recently connected” fallback. Account selection is a
source-revisioned, auditable metadata change and a tool call rechecks it.

Full-catalog Sessions omit `toolkits.enable`. Search/schema/execute meta-tools
are called only inside the adapter. Toolkit linking remains an authenticated
server route and validates toolkit slugs against live Composio catalog results.
Session sandbox/workbench support is disabled.

Composio managed auth works without app credentials for supported toolkits.
Toolkits requiring custom developer credentials or unsupported auth remain
visible with an actionable “provider setup required” state; “full catalog” does
not claim that every external vendor can authenticate without configuration.

### 4. Registry metadata is discovery, not trust

The official MCP Registry is preview infrastructure and explicitly provides no
uptime or durability guarantee. Seneca does not query it on every user search.
A host adapter refreshes a bounded last-known-good snapshot no more than hourly,
using cursor pagination, schema/size validation, active/latest status filtering,
and atomic replacement only after a complete successful refresh. Search is
local. A cold cache may report Registry unavailable without affecting existing
connections.

At connect time, the source stores the selected Registry name, version, remote
transport, canonical endpoint fingerprint, record hash, publication status,
and retrieval time as provenance. This metadata does not make the server or its
tool annotations trusted. Registry-derived and custom sources deduplicate on the
canonical endpoint fingerprint within one workspace: connecting the same remote
cannot silently create a second credential/profile or bypass a quarantine; the
owner is directed to the existing source or performs an explicit provenance
conversion. A later `deleted` moderation state quarantines new calls
from a Registry-derived source until an owner explicitly reconnects it as a
custom source after seeing the warning; `deprecated` produces a warning.

Only exact HTTPS `streamable-http` remotes are connectable in v1. SSE-only,
package/`stdio`, and unresolved template-variable records remain discoverable
but are marked unsupported. Registry cache loss never deletes a connected
source.

### 5. Custom remote MCP is HTTPS Streamable HTTP only

A custom source accepts a bounded display name and canonical HTTPS URL. URLs
with userinfo, fragments, credential-like query parameters, unsafe schemes, or
excessive length are rejected. Secrets are never placed in the URL.

Supported initial auth modes are:

- standard MCP OAuth 2.1 discovery/authorization;
- no authentication;
- bearer token; and
- a bounded approved API-key header mode.

Arbitrary request headers are not accepted. Hop-by-hop, routing, cookie,
forwarding, host, proxy, and browser security headers cannot be user-defined.
`stdio` commands, npm/package installation, local filesystem server configs,
and legacy SSE fallback are out of scope.

### 6. One outbound network policy covers MCP and OAuth

Every server-side request influenced by a remote source uses one guarded fetch
and egress path, including:

- initial endpoint probe and MCP initialize;
- Streamable HTTP GET/POST;
- OAuth protected-resource metadata;
- authorization-server/OIDC metadata;
- dynamic registration or Client ID metadata fetches when supported;
- token and revocation endpoints; and
- every redirect hop.

The policy:

1. requires HTTPS in production;
2. canonicalizes scheme/host/port/path and rejects userinfo/fragments;
3. rejects ambiguous URL normalization, encoded/alternate IP forms, IPv6 zone
   IDs, unsafe IDNA/punycode transformations, and unapproved ports before DNS;
4. resolves all A/AAAA results and rejects the destination if any address is
   loopback, unspecified, private, link-local, multicast, documentation-only,
   carrier-grade NAT/Tailscale (`100.64.0.0/10`), metadata, or otherwise
   non-global unicast, including IPv4-mapped IPv6 forms;
5. pins an approved resolution for the connection while preserving TLS SNI,
   certificate/SAN hostname verification, and origin isolation, then
   re-resolves/revalidates on a new connection, session, redirect, or token
   refresh; no per-workspace custom CA, TLS bypass, trust-on-first-use,
   cross-authority pool reuse, HTTP/2 origin coalescing, or Alt-Svc escape is
   allowed;
6. disables automatic redirects, validates each hop, caps the chain, forbids
   HTTPS downgrade, and never forwards authorization material across origin;
7. applies connect, headers, body, stream-idle, and total-operation limits;
8. sends only redacted stable errors to browser/agent; and
9. runs behind a production egress proxy/network policy that independently
   blocks private and metadata networks. The proxy is mandatory for every MCP,
   OAuth discovery/authorization-metadata, JWKS/introspection (if used), token,
   refresh, registration, revocation, redirect, and alternate network path;
   environment `NO_PROXY` and direct-socket bypasses are disabled/proven absent.

Application checks without connection pinning are insufficient because of DNS
rebinding/TOCTOU. An egress proxy alone is insufficient because the application
must also bind credentials and OAuth resources to the intended canonical
origin. Both are production gates.

### 7. OAuth follows the standard and the #820 custody boundary

The remote transport uses the current MCP TypeScript SDK OAuth client contract
where it passes conformance; Boring owns multi-tenant state, storage, callback
routing, and network policy.

Each authorization attempt is bound server-side to the current actor,
workspace, source/profile, canonical MCP resource URI, selected authorization
server/issuer, client registration identity, exact callback URI, PKCE verifier,
requested scopes, nonce/state, and short expiry. State is random, one-use, and
consumed atomically. Callback processing rechecks current owner role and
source/profile state before storing anything. Registration metadata, refresh
tokens, and issuer state cannot be reused across source profiles merely because
two endpoints share a host.

Required behavior includes RFC 9728 protected-resource discovery, both required
authorization-server metadata discovery forms, PKCE S256, exact redirect
matching, RFC 8707 `resource` on authorization and token requests, audience/
resource separation, issuer consistency, authorization-response `iss`
validation when supplied (RFC 9207), bounded step-up scope retries, refresh
rotation, and no token passthrough. Missing or inconsistent discovery fails
closed; the client never guesses `/authorize` or `/token` fallback endpoints.
Access tokens are memory-only per call where
the #820 contract requires; refresh tokens use the workspace vault. OAuth URLs
are validated before being returned to the browser and are opened without shell
execution.

A protocol conformance spike against the pinned MCP SDK is a prerequisite. If
the SDK does not satisfy the required discovery/challenge behavior, the slice
must either upgrade to a proven version or add a narrowly tested adapter around
public SDK seams; it must not fork OAuth ad hoc.

### 8. Tool annotations are hints; policy is host-owned

`McpDiscoveredTool` preserves bounded title, input/output schema, and MCP
annotations, but an untrusted server cannot authorize itself by claiming
`readOnlyHint` or omitting `destructiveHint`.

The host-owned policy computes an effective decision from:

- source provenance and host trust tier;
- deployment deny rules;
- provider/tool-specific reviewed policy;
- protocol annotations as non-authoritative evidence;
- schema hash and source revision; and
- effects such as mutation, destruction, administration, credential handling,
  open-world communication, and unknown behavior.

For v1:

- a Composio app-native tool may execute directly only when host policy accepts
  Composio as the metadata authority and current metadata explicitly marks it
  read-only, non-destructive, and not open-world;
- Registry and custom-server annotations are untrusted, so their tools default
  to `approval-required`, including apparent reads;
- a deployment may add an exact reviewed direct-read rule bound to source
  origin, tool name, and schema hash; and
- there is no “trust this whole server forever” browser shortcut.

This preserves direct safe reads without allowing a malicious custom server to
label a destructive action as read-only.

### 9. Risky execution is enforced inside the provider-call boundary

Add a general `mcp_tool_call` bridge. Keep `mcp_readonly_call` as a compatibility
wrapper for curated/read-only deployments during migration. Provider-native
tools remain behind search/describe/call proxy tools to avoid catalog context
bloat.

The general execution state machine is:

```text
validate bounded JSON input
-> authorize current workspace/source/profile
-> fresh describe + source/policy/schema revisions
-> classify through host policy
-> direct safe read OR create exact approval request
-> await Ask User answer
-> on approval, re-authorize and re-describe
-> require identical source revision, policy revision, schema hash,
   tool identity, and canonical-arguments digest
-> consume one approval receipt
-> call provider once (no automatic tool-call retry)
-> redact/validate result
-> append value-free audit outcome
```

Approval is `approve once` or deny/cancel only. It binds actor, workspace,
agent session, source/profile, endpoint fingerprint, active provider account,
tool/version, source/policy/schema revisions, canonical normalized argument
digest, question/approval nonce, and expiration. Changed arguments, schema,
source, policy, account, auth state, membership, or ownership produce a
stale/denied result before provider execution. The exact normalized object shown
to the human is the object sent; Boring adds no post-approval defaults or
rewrites. Provider-side defaults and mutable target state remain an honest
residual risk and are called out in the approval UI. Where a tool/schema exposes
an ETag, revision, precondition, dry-run, operation ID, or idempotency field,
host policy may require and bind it.

The process-local approval ledger performs one atomic
`approved -> dispatching` transition before network dispatch. The nonce is
single-use even for identical arguments; restart discards it and never resumes
dispatch.
Provider-supported idempotency/operation IDs are created before dispatch and
bound to the receipt, but unsupported tools never receive a fake exactly-once
claim. Timeout, abort, missing UI, Ask User rate limit, existing pending
question, process restart, or answer-owner mismatch all fail closed. Network
ambiguity after provider dispatch becomes a first-class `outcome-unknown` state,
is never automatically retried under the old approval, and offers a
provider-specific reconciliation/status action only when one exists.

### 10. Ask User is one explicit shared runtime

The host constructs one Ask User store/runtime and passes that same runtime to:

- `createAskUserServerPlugin`, so browser bridge handlers and the normal
  `ask_user` tool share it; and
- the MCP approval adapter, which calls the runtime directly with the current
  session, abort signal, and `ownerPrincipalId`.

The approval adapter is an injected `McpExecutionApprover` contract. The
`boring-mcp` core execution policy does not rely on the model voluntarily
calling `ask_user`, and provider execution is unreachable before the approver
returns an exact approval.

The question uses server-authored, structured, escaped labels for
source/provenance, tool identity, host risk reasons, mutable-state/unknown-outcome
warnings, and a lossless canonical rendering of every argument after the
existing secret-input guard. Model text, provider descriptions, tool output,
and Markdown/HTML never become trusted approval copy. Secret-like input is
rejected rather than redacted and then sent. If the canonical arguments cannot
fit the approval display bound, execution fails closed instead of presenting a
truncated approval. The workspace-scoped Ask
User store may persist that displayed business input under its existing durable
file protections, but it stores no provider credential, session header,
access/refresh token, endpoint secret, or raw approval capability. Only a
digest/receipt is used for execution enforcement and value-free MCP audit.

The current in-process waiter model is acceptable for Seneca's one app replica.
A multi-replica deployment is a stop condition until Ask User has a distributed
coordinator or sticky single-owner execution proof.

### 11. App configuration is server-authoritative and reversible

The existing master `BORING_MCP_PROD_ENABLED` gate remains. New capabilities are
independently deployment-gated and reported to the front through an
authenticated server capability DTO rather than relying only on compile-time
`VITE_*` values:

- full Composio catalog;
- official Registry browsing;
- custom remote sources;
- general approval-gated execution; and
- direct-read policy.

All new gates default off in production. Static provider-template/read-only mode
remains supported so Constellation does not broaden when Seneca opts into the
generic mode.

## Stable source and catalog contract

The implementation may refine names, but the semantic contract must preserve:

### Source

- opaque source ID;
- workspace authority and audit creator;
- source kind: Composio catalog, Registry remote, or custom remote;
- display name and secret-free endpoint summary/fingerprint;
- Registry/Composio provenance and version where applicable;
- credential profile reference, never credential material;
- connected/needs-auth/expired/revoked/quarantined/error state;
- source revision and timestamps; and
- trust tier assigned by the host, never the server.

### Tool catalog entry

- source and provider/toolkit/account identity plus exact toolkit/tool version;
- provider-native tool name and bounded descriptions marked as untrusted data;
- input/output schemas and schema hash;
- bounded protocol annotations as evidence;
- host effects/risk classification and reasons;
- execution mode: direct, approval-required, or blocked;
- source and policy revisions; and
- secret-free native references.

### Approval/audit receipt

- request/approval ID, actor, workspace, source, and tool;
- source/policy/schema revisions and canonical argument digest;
- decision, timestamps, outcome, stable code, and provider-dispatch state;
- no raw arguments, answers, endpoint credentials, headers, or token material.

## Stable errors

Extend the canonical MCP error registry rather than returning ad hoc strings.
The final names are frozen with implementation tests, covering at least:

- unsafe/unsupported endpoint;
- remote/Registry unavailable;
- source quarantined;
- authentication required, invalid/expired OAuth state, callback subject/source
  mismatch, refresh failure, and insufficient scope;
- tool metadata invalid and source/schema/policy drift;
- approval denied, stale, unavailable, pending conflict, or expired;
- credential absent, revoked, or unreadable (mapped from canonical #820 errors
  without leaking profile existence);
- rate/concurrency/body/result limits; and
- provider outcome unknown after dispatch.

Cross-workspace/source/profile lookup uses non-disclosing not-found behavior.
Errors returned to UI/agent contain stable code, safe message, and request ID,
not raw provider stack traces or URLs.

## Threat model and required controls

| Threat | Required control |
| --- | --- |
| Custom URL reaches App/DB/Tailscale/metadata services | guarded DNS-pinned fetch plus network egress proxy; block all non-global destinations and every redirect/metadata URL |
| DNS rebinding between validation and request | resolve all records, reject any unsafe answer, pin approved connection, revalidate new connections |
| OAuth metadata points to internal or attacker endpoints | run every discovered URL through the same egress/resource/issuer policy |
| OAuth mix-up/code interception | source-bound one-use state, PKCE S256, exact callback, issuer/resource/audience binding, current owner recheck |
| Token or session-header leakage | #820 vault, memory-bounded access token, no URL/query token, redaction/canaries across browser, logs, sessions, approvals, errors |
| Registry entry is malicious or later deleted | Registry is provenance only; untrusted policy; status refresh; quarantine deleted entries |
| Server lies in tool annotations | annotations never authorize untrusted sources; custom/Registry tools require approval unless exact host policy says otherwise |
| Prompt injection asks agent to skip confirmation | approval is in the server call boundary, not prompt convention |
| Approval reused for changed tool/input | bind session, account/tool versions, revisions + canonical argument digest; atomic single-use receipt |
| Mutable provider target changes after approval | show residual warning; bind provider preconditions/ETag/dry-run when available; never claim semantic snapshot without provider support |
| Provider executes twice after timeout | no automatic execution retry; explicit unknown-outcome state; provider idempotency/reconciliation only when supported |
| Tool description/output poisons model or approval | mark as untrusted data; render approval from escaped server-owned fields; later risky calls still require exact approval |
| Another user/workspace uses a source | fresh membership and source/profile scope checks; opaque IDs; not-found semantics |
| Owner adds many endpoints/tools to exhaust host | per-workspace/source limits, body/schema/result caps, bounded Registry mirror, connection/concurrency/rate budgets |
| Remote content injects secrets or malicious UI | text-only escaped rendering, CSP, no HTML execution, redaction/leak guard, no raw auth URL schemes |
| Process restart leaves approval reusable | in-process receipt dies; pending question is abandoned; provider call never resumes automatically |

## Test seams

### Highest public seams

Prefer complete public behavior over private helper tests:

1. a fake Streamable HTTP MCP server behind a controllable DNS/redirect/OAuth
   harness;
2. the `@hachej/boring-mcp` source/catalog/execution facade with real MCP SDK
   client transport;
3. Fastify source/credential/OAuth routes with real Core workspace membership
   and #820 fake/real credential backends;
4. one explicitly shared Ask User runtime: agent MCP call blocks, browser answers,
   revisions are rechecked, and exactly one fake provider call occurs;
5. MCP overlay tests through its HTTP client contract; and
6. clean packed-package installation into Seneca followed by deterministic
   browser + agent E2E.

### Required deterministic matrices

#### Network and OAuth

- public IPv4/IPv6 success;
- loopback, private, link-local, multicast, CGNAT/Tailscale, metadata,
  IPv4-mapped IPv6, mixed safe/unsafe DNS answers, and IP-literal negatives;
- safe DNS first then rebind negative;
- redirect to private/cross-origin/downgrade/too-many hops;
- OAuth metadata/token/revocation URL SSRF;
- missing/malformed resource metadata, guessed-fallback rejection, issuer or
  authorization-response `iss` mismatch, cross-profile client-registration
  reuse, missing PKCE S256, state replay/expiry, callback wrong
  actor/workspace/source/profile, exact redirect mismatch, scope step-up bounds,
  refresh race/rotation, and revocation;
- no auth, OAuth, bearer, and approved API-key modes; forbidden headers fail;
- timeout, body/header/schema/result, concurrent connection, and rate bounds.

#### Authority and credential isolation

- owner can mutate; editor/viewer/nonmember cannot;
- members can use an enabled workspace source under registered policy;
- two workspaces × two remote profiles × concurrent calls observe only matching
  fake-provider canaries;
- same provider kind with two sources resolves two distinct profiles;
- caller-supplied profile/workspace/provider mismatch fails before decrypt/fetch;
- revoke/tombstone blocks the next call and never falls back;
- existing personal MCP records are inventoried/quarantined and never
  auto-promoted.

#### Catalog and policy

- Composio Session omits toolkit restriction and disables sandbox/workbench;
- two accounts for one toolkit require an explicit active-account selection;
  removing/changing that selection invalidates source revision and no call uses
  Composio's most-recent fallback;
- toolkit/tool version and schema drift invalidate cached execution metadata;
- query-driven internal meta-tool discovery is paginated/bounded and raw
  `COMPOSIO_*` tools never enter the agent catalog;
- managed-auth and provider-setup-required states are distinct;
- Registry complete-snapshot replacement, cursor pagination, cache fallback,
  active/latest filtering, record hashes, invalid record bounds, duplicate
  Registry/custom endpoint handling, and deleted quarantine;
- all valid app-native tools are searchable/describable;
- malformed tool/schema/secret metadata fails closed;
- untrusted `readOnlyHint` cannot obtain direct execution;
- exact host read policy requires matching origin/tool/schema;
- source, policy, and schema revisions invalidate cached decisions.

#### Approval and execution

- direct host-classified read invokes once without a question;
- every other risk class blocks before provider call and creates one question;
- approve once invokes exactly once; deny/cancel/timeout/abort/no UI does not
  invoke;
- question answer from another principal/session is denied;
- argument, schema, policy, source, endpoint, active account/tool version,
  credential, or membership change while waiting produces stale/denied with zero
  calls;
- duplicate answer/replay cannot invoke twice and the ledger transition to
  dispatch is atomic;
- provider timeout after dispatch records unknown outcome and does not retry;
  supported operation/idempotency IDs permit bounded reconciliation without a
  second side effect;
- secret/canary corpus is absent from question, transcript, DTO, tool output,
  audit, errors, and captured logs.

### Avoid testing

- MCP SDK private implementation details when stock-client/server behavior proves
  the contract;
- Composio's own OAuth implementation beyond the app's request/response boundary;
- generated direct provider tools or thousands of tool definitions in prompt;
- local `stdio` execution;
- a second credential store, Workspace authority, runtime composer, or approval
  UI; and
- live destructive actions against real customer/provider data.

## Flag, rollout, and rollback

### Flags

- Existing master MCP production gate remains the outer switch.
- New catalog, Registry, custom remote, general execution, and direct-read
  features are separate server-authoritative gates.
- Static curated/read-only mode is the compatibility default.

### Rollout

1. Land #820 `16f.1`, then owner-ratify 900.0's source-scoped profile
   amendment before `16f.2` schema/storage and `16f.3` onboarding. Re-read the
   landed contract and record the amended Bead edges.
2. Land #820 `16f.2`–`16f.3`, then `16f.4`'s personal-to-workspace MCP migration
   with existing curated behavior unchanged.
3. Land remote egress/OAuth and new data contracts dark; qualify with fake
   endpoints and no production routes.
4. Enable full Composio catalog in development with an isolated Composio
   project, server-side operator key, no sandbox/workbench, and test accounts.
5. Enable the Registry mirror, then custom URL onboarding, while execution
   remains approval-required.
6. Enable direct reads only for exact host-reviewed policy (initially eligible
   Composio read-only/non-open-world tools).
7. Pack the affected package cohort and install into a clean Seneca checkout.
8. Publish through the normal release process with owner approval; Seneca pins
   exact versions/integrity.
9. Deploy Seneca with all new flags off, then enable one capability at a time.
10. Run controlled production proof using disposable accounts and a Boring-owned
    remote MCP test server; no customer data or irreversible tool is used.
11. Observe provider errors, approval rate/latency, blocked SSRF attempts,
    Registry freshness, token refresh failures, and unknown outcomes before
    widening availability.

### Rollback

Disable, in order: direct-read policy, general execution, custom remote,
Registry, and full-catalog Composio. Existing curated Notion/Airtable read-only
mode and web/agent operation remain available if their retained path is healthy.

Rollback never:

- decrypts new credentials back into generic settings;
- clears revocation tombstones;
- promotes personal sources;
- changes workspace membership;
- retries an approval/provider call; or
- downgrades below the #820 schema/package floor after migration.

Registry cache and custom-source metadata may remain inert. Credential records
remain encrypted for forward recovery or explicit owner deletion.

## Acceptance

The reusable feature is complete only when:

1. Composio app/toolkit discovery has no static toolkit allowlist and all valid
   app-native tools are searchable/describable through bounded proxy tools.
2. An owner can browse a validated official Registry snapshot and connect a
   compatible active remote without Registry metadata granting trust.
3. An owner can add a custom HTTPS Streamable HTTP URL and complete supported
   auth without exposing credentials to browser state, URLs, workspace files,
   prompts, sessions, approvals, logs, or errors.
4. Multiple remote sources of the same provider kind have isolated
   source-scoped credential profiles under the owner-ratified #820 extension.
5. Current membership precedes every use; current owner role precedes every
   lifecycle mutation; cross-workspace/profile attempts do not reveal existence.
6. All remote/OAuth server-side requests pass DNS-pinned application validation
   and an independent production egress policy.
7. Tool annotations from untrusted servers never authorize direct execution.
8. Every valid tool is direct, approval-required, or blocked for a stable
   security/configuration reason; absence from an old static list is not a block.
9. A risky/unknown call cannot reach the provider before the same human answers
   an exact Ask User question, and post-answer drift/replay cannot reuse approval.
10. A direct read, approved call, denial, timeout, stale approval, and ambiguous
    provider outcome each produce a value-free auditable result with a stable
    code.
11. Curated static/read-only consumers remain unchanged unless they explicitly
    select generic mode.
12. The package cohort is tested from tarballs, released normally, pinned in
    Seneca, deployed behind flags, live-smoked non-destructively, observed, and
    rollback-proven.

## Proof

Expected upstream gates, refined to exact filenames in each slice:

```bash
pnpm --filter @hachej/boring-core typecheck
pnpm --filter @hachej/boring-core test
pnpm --filter @hachej/boring-agent typecheck
pnpm --filter @hachej/boring-agent test
pnpm --filter @hachej/boring-mcp typecheck
pnpm --filter @hachej/boring-mcp test
pnpm --filter @hachej/boring-ask-user typecheck
pnpm --filter @hachej/boring-ask-user test
pnpm lint:invariants
pnpm audit:imports
```

Expected clean Seneca consumer gates:

```bash
pnpm agents:compile
pnpm typecheck
pnpm test
pnpm build
pnpm e2e
```

Additional proof artifacts:

- SSRF/DNS/redirect/OAuth conformance matrix output;
- egress-proxy negative probe showing App/DB/Tailscale/metadata targets received
  no request;
- raw Postgres and artifact/log canary scans from #820 plus MCP-specific values;
- real shared Ask User runtime trace: pending -> exact answer -> one provider
  call, plus stale/deny zero-call traces;
- exact Registry snapshot timestamp/status and degraded-cache proof;
- package tarball contents, registry versions, and lockfile integrity;
- production image digest, flags, controlled source/tool identities, health,
  audit outcomes, executed rollback, and restored state; and
- independent standards, security, UI/UX, and operations reviews.

## Slices

### Slice 900.0 — Ratify profile identity and freeze dependencies

**Delivers:** An amendment to Decision 27/#820 defining source-scoped MCP
credential profiles, authority/selection semantics, and the relationship to the
landed `16f.1` contract. Re-inventory current #820/#805 PRs and `boring-mcp`
after merge; record exact symbols and no-overlap sequencing.

**Blocked by:** Owner/security approval of this plan; resolution of open PR
#893 as the candidate `16f.1` base. Do not overwrite another writer's contract.
This slice blocks #820 `16f.2`/`16f.3` if the profile amendment is accepted,
because their schema and APIs must use the final identity.

**Proof:** Decision diff; two-source/two-workspace semantic fixture; dependency
DAG with the new `16f.1 -> 900.0 -> 16f.2` edge; docs-only checks; adversarial
security review.

**Review budget:** Inside one plan/contract PR. No runtime behavior.

### Slice 900.1 — Guarded remote transport and OAuth conformance

**Delivers:** One reusable remote endpoint policy, DNS-pinned/manual-redirect
fetch, egress-proxy contract, bounded Streamable HTTP transport, OAuth client
provider/state adapter, stable errors, and fake DNS/redirect/OAuth harness.

**Blocked by:** 900.0; exact #820 credential resolver/OAuth seams available for
integration or represented by fakes without a second store.

**Proof:** Full network/OAuth deterministic matrix; MCP SDK stock-server/client
smoke; typecheck/test/invariants; security re-review.

**Review budget:** One focused security PR. No UI and no production enablement.

### Slice 900.2 — Dynamic catalogs and source model

**Delivers:** Workspace source/provenance contracts, Composio virtual catalog
source, unrestricted toolkit Session configuration with internal query-driven
meta-tools, connected toolkit account model, official Registry LKG mirror,
Registry/custom source creation contracts, and migration compatibility types.

**Blocked by:** 900.1; serialize with #820 `16f.4` if it touches the same MCP
source/onboarding files.

**Proof:** Composio/Registry/source matrices; secret-free DTO scans; existing
curated tests unchanged; package test/typecheck/build.

**Review budget:** Likely two PRs if Composio and Registry/source persistence
cannot remain independently reviewable; one writer owns overlapping contracts.

### Slice 900.3 — General tool policy and exact approval execution

**Delivers:** Preserved annotations/output schema, host risk/effects policy,
`direct|approval-required|blocked`, general `mcp_tool_call`, compatibility
`mcp_readonly_call`, source/policy/schema revisions, canonical argument digest,
value-free audit receipts, and injected approver contract.

**Blocked by:** 900.2; host trust policy reviewed.

**Proof:** catalog/policy/approval matrices with provider-call spies; drift and
replay negatives; no automatic retry; stable errors; thermo/security review.

**Review budget:** One focused execution-boundary PR.

### Slice 900.4 — Ask User and provider-credential composition

**Delivers:** One explicit shared Ask User store/runtime, MCP Ask User approval
adapter, owner-bound questions, source-scoped credential resolution, Composio
external-managed custody, remote OAuth/bearer/API-key lifecycle, personal-source
quarantine migration, and current-authority checks.

**Blocked by:** 900.3 and #820 `16f.2`–`16f.4`; any multi-replica deployment is
blocked pending a coordinator decision.

**Proof:** real blocking Ask User -> browser bridge answer -> exact one-call
integration; two-workspace/two-profile credential matrix; raw DB/log/transcript
canary scans; revoke/tombstone proof.

**Review budget:** Exceeds one PR. Split reusable credential/source migration
from Ask User execution composition, with one writer at a time for shared files.

### Slice 900.5 — MCP overlay and server-authoritative capabilities

**Delivers:** Connected/Composio/Registry/Custom views, owner/member affordances,
source/tool/risk/provenance detail, OAuth/connect handoff, capability DTO,
loading/error/empty/quarantine states, and accessible approval copy.

**Blocked by:** Stable server contracts from 900.2–900.4.

**Proof:** front contract tests, keyboard/accessibility checks, screenshots for
all four views and approval states, responsive proof, high-taste UI review.

**Review budget:** One UI PR after contracts stabilize.

### Slice 900.6 — Compatibility, release, and clean Seneca qualification

**Delivers:** App-binding factory supports explicit curated and generic modes;
existing full-app/Constellation behavior remains curated; affected packages are
packed, installed in a clean Seneca checkout, tested, released, and pinned.

**Blocked by:** 900.1–900.5; normal release approval.

**Proof:** package gates, curated compatibility suite, tarball export/content
check, clean Seneca gates, exact registry versions/integrity.

**Review budget:** Upstream compatibility/release PR plus separate Seneca
integration PR.

### Slice 900.7 — Seneca deployment and controlled production proof

**Delivers:** Seneca #35 generic-mode composition, persistent Registry cache,
egress proxy/network policy, operator Composio secret, server flags, monitoring,
controlled live Composio/Registry/custom sources, approval E2E, observation, and
executed rollback/restore.

**Blocked by:** 900.6; owner access/secret/vendor-risk/deployment approval; an
isolated Composio project and Boring-owned public MCP test server.

**Proof:** exact image/package versions; browser and agent E2E; non-destructive
live calls; SSRF canary negative; redacted logs/audit; rollback/restore; security
and operations review.

**Review budget:** One Seneca code PR and one explicit production proof record.

## Dependency graph

```text
#820 16f.1
    |
    v
900.0 owner profile amendment + contract freeze
    |
    v
#820 16f.2 -> 16f.3 -> 16f.4 curated workspace migration
                                  |
                                  v
                                900.1 guarded transport/OAuth
                                  |
                                  v
                                900.2 catalogs/sources
                    |
                    v
                                900.3 policy/approval boundary
                                  |
                                  v
                                900.4 credentials + shared Ask User runtime
                                  |
                                  v
                                900.5 UI
                                  |
                                  v
                                900.6 compatibility/release
                                  |
                                  v
                                900.7 Seneca production proof
```

The runtime path is intentionally mostly linear because the same MCP contracts
and files are affected and credential/auth/source decisions must settle before
UI and release. Beads are appropriate after owner approval, but they must be
created from then-current #820 IDs, checked with `br dep cycles`, and inspected
with `bv --robot-insights`; no Beads are created by this plan PR.

## Stop conditions

Stop and amend/route instead of improvising if:

1. Decision 27/#820 does not approve multiple source-scoped profiles for custom
   MCP servers.
2. The landed #820 resolver cannot bind a profile without accepting authority
   from browser/model input.
3. A proposed implementation stores any custom credential/token in user
   settings, source metadata, URL, browser, workspace file, transcript, or log.
4. Safe remote fetch cannot pin validated DNS connections or production cannot
   enforce independent private-network egress denial.
5. MCP OAuth conformance requires copying/forking the protocol instead of using
   a reviewed public SDK seam.
6. Provider execution can occur before approval or approval cannot be bound to
   exact revisions and arguments.
7. The host would trust arbitrary server annotations or a Registry listing for
   direct execution.
8. Ask User would be reconstructed separately for bridge and execution, or a
   multi-replica deployment cannot guarantee the answering runtime owns the
   waiter.
9. Full Composio discovery requires exposing raw management/remote-bash
   meta-tools to the agent.
10. Constellation/static consumers broaden without explicit configuration.
11. A release or production proof requires real destructive actions, customer
   credentials/data, raw secrets in commands, or unpublished workspace links.

## Out of scope

- Hosted user-supplied `stdio`, package commands, or local MCP binaries.
- Legacy SSE remote transport in v1.
- Trusting an entire custom server permanently from one browser click.
- Automatic retry of provider tool execution.
- Durable or cross-replica approval resumption.
- Direct generation of every provider tool into model context.
- Composio remote workbench/bash, local code execution, or arbitrary sandbox
  credential delivery.
- Tenant-authored general provider definitions outside the guarded MCP remote
  source kind.
- Billing, marketplace ratings, malware scanning claims, or Registry trust
  scores.
- Cross-workspace credentials, public credential sharing, or plaintext export.
- Changes to #806 MCP ingress or agent-fleet/runtime authority.

## Open owner decisions

These decisions require explicit owner/security ratification before `/exec`:

1. **Credential profile amendment:** adopt one profile per remote MCP source,
   semantically `(workspaceId, providerId, profileId)`, while keeping Composio
   one workspace profile with multiple custodian-managed toolkit accounts.
2. **Trust default:** custom and Registry tools, including apparent reads,
   require approval unless an exact host policy recognizes source origin, tool,
   and schema; Composio-only safe read metadata may be trusted by deployment
   policy.
3. **Meta-tool boundary:** “all tools” means all valid app-native tools; raw
   Composio management/schema/execute and remote workbench/bash meta-tools stay
   internal/disabled.
4. **Production network gate:** custom remote support does not launch until both
   DNS-pinned app validation and an independent egress proxy/network policy are
   proven.

## Grounding sources

- Composio Sessions: sessions expose every toolkit by default when no toolkit
  filter is supplied; meta-tools are the recommended broad-agent discovery
  shape; tag filters exist; sandbox/workbench can be disabled:
  <https://docs.composio.dev/docs/configuring-sessions>.
- Composio Connect/auth: dynamic meta-tools and managed versus custom auth:
  <https://docs.composio.dev/docs/composio-connect>,
  <https://docs.composio.dev/docs/authentication>, and
  <https://docs.composio.dev/docs/custom-app-vs-managed-app>.
- Official MCP Registry: remote records and Registry aggregator API/cache/status
  expectations; the service has no uptime or durability guarantee:
  <https://modelcontextprotocol.io/registry/remote-servers> and
  <https://modelcontextprotocol.io/registry/registry-aggregators>.
- MCP authorization: RFC 9728 discovery, OAuth 2.1, PKCE, RFC 8707 resources,
  token handling, and redirect requirements:
  <https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization>.
- MCP tools: human-in-the-loop guidance and annotations as untrusted hints:
  <https://modelcontextprotocol.io/specification/2025-11-25/server/tools>.
- MCP security best practices: SSRF, DNS rebinding, redirects, OAuth URL safety,
  token passthrough, scope minimization, and local `stdio` risk:
  <https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices>.

## Planning proof and review record

Plan-only proof:

```bash
git diff --check
test -z "$(git diff --name-only origin/main...HEAD | grep -v '^docs/')"
rg -n 'hachej/seneca/issues/35|#820|Ask User|SSRF|approval|required|rollback' \
  docs/issues/900/plan.md
```

Review status:

- Direct code and contract reconnaissance completed against Boring
  `origin/main` at `86d38893a`, Seneca `origin/main` at `e5e82c8`, current
  `@hachej/boring-mcp`/Ask User sources, owner-ratified #820 plan, and open PRs
  #887/#893.
- Official Composio, MCP Registry, MCP authorization/tools, and MCP security
  documents were re-fetched on 2026-07-22; a live Registry v0.1 response was
  schema-checked for remote records and status metadata.
- Three web-assisted adversarial passes were run after the first complete
  draft. Integrated findings: OAuth issuer/registration binding and `iss`, no
  guessed discovery fallbacks, URL/TLS/pool/proxy bypass cases, explicit
  account/version identity, Registry/custom dedupe, atomic single-use approval,
  structured injection-resistant consent, mutable-resource TOCTOU honesty,
  provider idempotency/reconciliation, and first-class unknown outcome.
- APR and a fresh repository subagent review were unavailable in this
  long-running session (`apr`/Oracle absent; session subagent cap exhausted).
  This is not a review waiver. Before merge, run fresh independent
  architecture/security and UI/test-seam reviews, integrate accepted findings,
  and record convergence here. The plan remains `ready-for-human` until those
  reviews and the four owner decisions above are resolved.
