---
github: https://github.com/hachej/boring-ui/issues/900
issue: 900
state: ready-for-agent
updated: 2026-07-22
flag: flag:boring-mcp-composio-catalog
track: fast
---

# gh-900 Ship one full-catalog Composio integration for Seneca

## Scope decision

The owner narrowed the product on 2026-07-22 to the fastest sellable path:

- **one Composio integration** in generic Seneca;
- the complete Composio app/toolkit catalog;
- all valid Composio app-native tools discoverable and callable;
- the fastest launch requires one exact Ask User approval for **every** call;
- optional verified direct reads are a post-launch optimization, not a sale
  blocker; and
- no official MCP Registry, custom MCP URLs, user-supplied servers, `stdio`,
  remote workbench, or remote bash.

The named consumer is
[`hachej/seneca#35`](https://github.com/hachej/seneca/issues/35). The owner
further clarified that Seneca must be a **thin wrapper around Composio**, not an
independent integration marketplace: Composio remains the source of truth for
apps, tools, schemas, managed auth, connections, and execution. Boring adds only
product identity/isolation, secret-safe transport, bounded output, and the
server-side approval guard. This plan is about an Agent consuming Composio
tools. It does not change #806's opposite-direction Agent MCP ingress or
Constellation's curated connector mode.

## Problem

Seneca already integrates `@hachej/boring-mcp` and Composio, but the product is
hard-coded to Notion and Airtable:

- Seneca front options enable only `notion` and `airtable`;
- Seneca server connector configs list only those two toolkit IDs;
- `@hachej/boring-mcp` exports only two default provider templates;
- each Composio Session sends `toolkits.enable: [toolkitId]`, so it sees one
  toolkit rather than the full catalog;
- internal discovery searches only that configured toolkit;
- raw Composio meta-tools are hidden; and
- execution is limited to exact static read-only allowlists through
  `mcp_readonly_call`.

The transport, source ownership, redaction, rate limits, schema hashing,
provider calls, Composio hosted links, and Ask User UI already exist. The fast
path is to generalize those seams for one Composio catalog, not build another
MCP marketplace or secret system.

## Sellable user journey

1. User opens **MCP → Composio**.
2. User searches the full Composio app catalog.
3. User selects an app and completes Composio's hosted connection flow.
4. The connected app appears under the single Composio integration.
5. The Agent searches relevant tools without loading the whole catalog into its
   context.
6. The Agent describes the selected tool and receives its current schema.
7. Every launch-version call opens one exact Ask User approval form.
8. Approval invokes the exact reviewed call once; denial/cancel/stale approval
   invokes nothing.
9. User can inspect connections and revoke an app account.

The product promises access to the Composio catalog. It does not promise that
every vendor works without setup: many apps use Composio managed auth, while
others require a custom auth configuration in the isolated Composio project.
The UI reports `Connect`, `Connected`, `Needs provider setup`, `Expired`, or
`Revoked` honestly.

## Solution

### Thin wrapper boundary

Replace the app-level Notion/Airtable toolkit array with one `composio` adapter
identity per current Seneca user/workspace scope. This is not a second catalog
or provider model. Do not mirror Composio's app registry, generate one Boring
template per provider, normalize provider-specific auth, or persist tool copies
as authoritative records.

The adapter keeps only what the host boundary requires:

- opaque Boring source identity and current actor/workspace ownership;
- a stable opaque Composio subject;
- secret-free connection/account references needed for selection and revocation;
- source revision plus short-lived schema/policy cache keys; and
- no API key, OAuth token, MCP Session headers, or auth URL secrets.

Every app/tool/schema/connection response is fetched from current Composio APIs
or its Session MCP surface and returned through bounded/redacted DTOs. For the
initial sale, retain the current personal authority: each Seneca user gets
isolated Composio connections under their workspace. Do not block this launch on
#820's future workspace-shared credential-vault migration. The operator
Composio API key stays server-only. When #820 `16f.4` later migrates MCP
onboarding, it must inventory and quarantine personal sources rather than
automatically promoting them to workspace-wide authority.

### Full-catalog Composio Session

Create Composio v3 Sessions with:

- `mcp: true`;
- no `toolkits.enable` filter, which leaves the full catalog discoverable;
- connection management enabled;
- Composio sandbox/workbench disabled; and
- one stable opaque Composio subject per Boring source.

The adapter is a shallow mapping over Composio Connect's own meta-tool flow:

- Composio search answers the Agent's tool query;
- Composio schema retrieval describes selected tool slugs;
- Composio connection management supplies hosted auth/link state; and
- Composio execution invokes the selected app-native tool after the host guard.

Do not reimplement those capabilities. Raw execution/control-plane meta-tools
remain unreachable so they cannot bypass Boring's one approval interception;
`COMPOSIO_REMOTE_BASH_TOOL` and `COMPOSIO_REMOTE_WORKBENCH` stay disabled.
“All tools” means every valid app-native tool exposed by Composio MCP for every
provider, not Composio infrastructure controls.

### Query-driven tool catalog

Keep the context-efficient Boring bridge instead of generating thousands of
Agent tools:

- `mcp_servers_list` reports the Composio source;
- `mcp_tools_search` sends the actual query through internal Composio search;
- `mcp_tool_describe` retrieves the current complete schema;
- `mcp_readonly_call` remains only as a compatibility alias during rollout; and
- new `mcp_tool_call` is the one general execution boundary.

Current `McpTransportClient` supports only `listTools` and `callTool`, while the
catalog locally filters a full list. Slice 900.1 must add an optional bounded
provider search/describe seam at the managed-catalog adapter level. The Composio
adapter maps it to Composio search/schema meta-tools; curated transports retain
the current bounded list/filter fallback. Do not push Composio-specific methods
into generic MCP transport or silently list the full catalog.

Search is paginated and bounded, but Boring does not build an independent
catalog index. Each transient tool result preserves:

- toolkit, tool slug, and current Composio version/account selection;
- title and description marked as provider-supplied untrusted text;
- input/output schemas and canonical schema hash;
- Composio behavior tags/annotations;
- source and policy revisions;
- host risk reasons; and
- execution mode: `direct`, `approval-required`, or `blocked`.

Catalog and schema caches are bounded and short-lived. Before execution, the
server refreshes the exact selected tool when an expected schema hash is
supplied. Account, source, tool version, or schema drift invalidates the cached
decision.

### Connection management

The MCP overlay searches Composio toolkits server-side and requests a hosted
connection link for a selected toolkit. Only toolkit slugs returned by the live
Composio catalog are accepted. Connect URLs remain HTTPS and match reviewed
Composio origins.

If multiple connected accounts exist for one toolkit, the current user must
select the active account. The adapter pins the exact account in the Composio
Session `connectedAccounts`/`connected_accounts` mapping (or the documented
Session execute `account` field) and enables Composio's explicit-selection mode
when multiple accounts are allowed. It never silently adopts Composio's
most-recent-account fallback. Changing the active account patches/recreates the
Session, increments source revision, and invalidates pending approval. The early
real-Composio spike must prove the MCP execution uses the pinned account; if it
cannot, stop rather than claim account-safe execution.

Disconnect/revoke calls the current Composio connected-account endpoint,
verifies the result, marks local metadata revoked, and prevents subsequent
calls. A provider failure returns a stable error and never reports a false local
success.

## Tool policy

### Availability versus automatic execution

All protocol-valid app-native tools are available through search/describe/call.
A tool is blocked only when:

- metadata/schema is invalid, oversized, or secret-bearing;
- no usable connection/account exists;
- the source is expired/revoked/unavailable;
- deployment policy explicitly denies that class; or
- current actor/source ownership fails.

Absence from the old Notion/Airtable allowlist is no longer a block.

### Direct reads are post-launch

The sellable launch does not build a risk-classification engine: every otherwise
allowed tool call is approval-required. This is simpler and strictly safer.

A later optional slice may add direct reads behind a separate server flag after
sampling real Composio metadata. It may execute directly only when trusted
current metadata explicitly says read-only, non-destructive,
non-administrative, and not open-world; unknown or contradictory metadata stays
approval-required. Disabling that future flag returns calls to approval-required
and never disables the catalog.

### Approval-required calls

Write, destructive, admin, open-world, and unknown tools use one server-enforced
state machine:

```text
validate bounded JSON input
-> authorize current actor/source/account
-> refresh exact schema and host policy
-> canonicalize exact input
-> ask current user through the shared Ask User runtime
-> on approval, re-authorize and re-describe
-> require identical actor/session/source/account/tool/version/schema/policy
   and canonical-argument digest
-> atomically consume one approval nonce
-> dispatch exactly once without automatic retry
-> redact and validate provider result
-> record value-free outcome
```

The Agent cannot skip approval by calling a raw Composio meta-tool because raw
meta-tools are unreachable. Prompt instructions are usability guidance only;
security lives at provider dispatch.

Approval is **Approve once** or deny/cancel. The form uses escaped,
server-authored labels and shows:

- app/account;
- tool name;
- host risk reasons;
- mutable-state and unknown-outcome warnings; and
- a lossless canonical rendering of every argument.

Provider descriptions, model prose, tool output, Markdown, and HTML never become
trusted approval copy. Tool arguments may contain sensitive business data and are shown losslessly to
the approving current user under the existing protected Ask User store; they
are never copied into value-bearing audit/log records. Composio/API/session/OAuth
credentials are never accepted as tool arguments. Oversized arguments fail
closed rather than receiving a truncated approval.

Approval binds a process-local one-use nonce, current session, source/account,
tool/version, schema/policy/source revisions, and argument digest. The exact
normalized object shown is the object sent; Boring does not add defaults after
approval. Any drift while waiting produces `approval-stale` with zero provider
calls.

No tool execution is automatically retried. If the provider may have committed
before a timeout, return `outcome-unknown`; do not invite an automatic duplicate.
Use a provider-supported operation/idempotency identifier or status check only
when that exact tool supports one.

## One shared Ask User runtime

Seneca currently proves that one stable `createAskUserServerPlugin` object must
own both the blocking tool waiter and browser bridge handlers. Preserve that
invariant explicitly:

1. construct one Ask User store/runtime;
2. pass it to the Ask User server plugin;
3. pass the same runtime to the MCP execution approver; and
4. pass current Agent session ID, abort signal, and user principal into every
   approval request.

This is grounded in Seneca's deployed `@hachej/boring-ask-user@0.1.89`
composition: `src/server/plugins.ts` creates one explicit server plugin/runtime,
and production commit `e5e82c86253774079035de57f32588c289008de7` proved its
blocking tool → browser answer → resumed Agent path. The upstream full-app does
not need to adopt Ask User for this consumer slice; Seneca #35 owns that exact
front/server dependency and composition.

Timeout, abort, cancellation, missing UI, rate limit, another pending question,
answer from another principal/session, or process restart all deny execution.
The current in-process coordinator is acceptable for Seneca's one app replica.
A multi-replica launch requires sticky ownership or a distributed coordinator
and is out of this fast path.

The Ask User durable store may contain the exact displayed business arguments
under its current mode-`0600` workspace-root protection. It must never contain
the Composio API key, provider OAuth tokens, MCP Session headers, raw approval
capability, or account secret.

## Security boundary

The narrowed Composio-only scope removes arbitrary endpoint SSRF and arbitrary
OAuth issuer handling from this launch. Outbound destinations are deployment
configuration plus URLs returned by authenticated Composio APIs, not browser or
model input.

Required controls remain:

- isolated Composio production project/account;
- operator API key resolved server-side from approved secret storage;
- reviewed HTTPS Composio API, connection-link, and MCP endpoint origin policy;
- no browser/workspace/prompt/session/log exposure of API key, OAuth tokens, or
  Session headers;
- response/error redaction and seeded canary tests;
- bounded timeouts, bodies, schemas, results, connections, search, and calls;
- no automatic provider-call retry;
- current actor/workspace/source checks before every catalog/account/tool call;
- toolkit/account IDs accepted only from validated Composio responses;
- tool descriptions/results treated as untrusted data, never policy; and
- vendor DPA, subprocessors, data residency, incident history, billing, and
  managed-auth limitations accepted before production sale.

The session MCP URL must be HTTPS, contain no credentials, and match the
reviewed Composio endpoint policy. If Composio changes its endpoint domains, the
operator updates reviewed configuration; the app does not accept a user URL.

## UI

The existing MCP overlay becomes a single **Composio** experience:

### Catalog

- searchable/paginated app cards;
- app logo/name and secret-free auth readiness;
- Connect, Connected, Needs setup, Expired, or Revoked state;
- no provider-template dropdown; and
- no Registry or custom-server tab.

### Connections

- connected app/account label;
- active account selection when multiple accounts exist;
- refresh and revoke;
- last verified time and safe errors; and
- tool browser with Direct / Approval required / Blocked badges.

### Approval

Reuse the Questions/Inbox surface. Do not build a second modal or approval
store. Copy is server-authored and action-specific.

The front reads enabled capabilities from an authenticated server DTO. It does
not infer production authority from `VITE_*` flags alone.

## Stable errors

Extend the canonical MCP error registry rather than returning ad hoc strings.
Implementation tests freeze names for at least:

- Composio catalog/session/account unavailable;
- connection/auth required or expired;
- toolkit/account not found without cross-user existence leakage;
- invalid/oversized tool metadata or schema drift;
- tool direct-execution not allowed;
- approval denied, stale, unavailable, conflicting, expired, or rate-limited;
- provider timeout, error, and outcome unknown;
- body/result/rate/concurrency limits; and
- secret leak guard.

Browser and Agent responses contain stable code, safe message, and request ID,
not raw Composio responses, URLs with sensitive parameters, or stack traces.

## Flags and rollback

### Flags

- Existing `BORING_MCP_PROD_ENABLED` remains the outer production switch.
- Add one full-catalog Composio mode flag.
- Add one general approval-gated execution flag.
- Reserve one future direct-read flag; it is absent/off for the sellable launch.
- The server exposes effective capabilities to the front.

Static Notion/Airtable read-only mode remains the default compatibility path for
Constellation or other curated apps. Seneca explicitly selects Composio catalog
mode.

### Rollout

1. Before changing contracts, run one isolated real-Composio capability spike:
   prove an unfiltered full-catalog Session, disabled sandbox/workbench,
   controlled meta-tool reachability, bounded search/schema, and exact pinned
   account execution with a disposable account. Record sanitized request/response
   shapes; stop if any assumption fails.
2. Land full-catalog session/search/account behavior behind flags with existing
   curated consumers unchanged.
3. Land exact Ask User approval for every execution and keep execution disabled.
4. Land the one-Composio UI and server capability DTO.
5. Pack the affected package cohort and install tarballs in a clean Seneca
   checkout.
6. Publish through the normal release process and pin exact versions in Seneca.
7. Create an isolated production Composio project, configure the operator key,
   and accept the vendor/security/billing review.
8. Deploy Seneca with catalog and execution flags off; verify current web and
   Ask User health.
9. Enable catalog plus approval-required execution.
10. Prove one managed-auth app and one provider-setup-required state.
11. Prove an approved read, approved disposable write, denial, stale approval,
    revoke, and unknown-outcome behavior against test accounts only.
12. Observe error/approval/latency/rate/billing signals on the current
    `prod.senecaapp.ai` deployment.
13. Execute Seneca issue #36's reviewed, reversible cutover so
    `app.senecaapp.ai` reaches this deployment and `prod.senecaapp.ai` remains a
    rollback alias. Its Cloudflare, TLS, auth, Stripe-accounting, and live proof
    gates are mandatory.
14. Keep the legacy Fly/Neon environment recoverable until boring-ui #877
    completes archive, observation, two-person deletion, and billing proof.

### Rollback

1. Disable general execution: catalog/search/describe remain; calls return stable
   unavailable/not-allowed.
2. Disable full-catalog mode: while the old Seneca UI is retained during
   observation it may return to curated mode; after that UI is removed, MCP is
   hidden/unavailable rather than promising a missing screen.
3. Disable outer MCP production gate: core Seneca web/Agent and Ask User remain.
4. Any future direct-read flag disables back to approval-required.

Rollback never retries an ambiguous call, clears revocation, promotes a personal
connection, exposes a secret, or rewrites stored data. No new credential schema
is required for this fast path.

## Test seams

### Highest public seams

1. fake Composio HTTP API plus fake Session MCP server;
2. real MCP SDK client transport through the Boring adapter;
3. full source/catalog/describe/call facade;
4. one real Ask User runtime: call blocks, browser answers, exact one dispatch;
5. Fastify source/catalog/account routes with actor/workspace checks; and
6. MCP overlay contract tests plus Seneca production E2E.

### Required upstream tests

#### Full catalog

- Session request omits toolkit enable filter;
- sandbox/workbench disabled;
- internal meta-tools only, never listed/callable by Agent;
- search uses actual query, pagination, limits, and schema retrieval;
- all valid app-native search results become catalog entries;
- malformed/oversized/secret metadata fails closed;
- account/tool/version/schema changes invalidate cache;
- managed-auth versus provider-setup-required state; and
- multiple accounts require explicit active selection.

#### Policy and execution

- every launch-version call requires approval;
- no pre-approval path exists for read/write/destructive/admin/unknown calls;
- raw `COMPOSIO_MULTI_EXECUTE_TOOL` cannot bypass policy;
- approval, denial, cancel, timeout, abort, owner mismatch, replay, and stale
  revisions all assert exact provider-call count;
- duplicate answer/nonces never dispatch twice;
- provider timeout after dispatch reports unknown and does not retry;
- input/output/schema/rate/concurrency bounds; and
- provider descriptions/results cannot inject approval UI markup or policy.

#### Identity and secrets

- user/workspace A cannot list/use B's source/account;
- fake IDs fail before Composio calls;
- revoke prevents later use;
- API key, Session headers, OAuth/token/cookie/auth-code canaries are absent from
  browser DTOs, Agent output, Ask User files/transcripts, sessions, errors, and
  captured logs; and
- personal-source migration compatibility remains unchanged pending #820.

### Required Seneca proof

```bash
pnpm agents:compile
pnpm typecheck
pnpm test
pnpm build
pnpm e2e
```

Production proof records:

- exact image digest and package pins;
- public and direct-origin health;
- one full-catalog search;
- managed connection and revoke using a disposable account;
- approved read;
- approved disposable write, denial, and stale zero-call result;
- no raw Composio secret in logs/files/transcripts;
- flags-off rollback and restore; and
- vendor/security and operations acceptance.

## Acceptance

The fast sellable release is complete when:

1. Seneca displays one Composio integration, not Notion/Airtable provider cards.
2. Catalog search is not restricted by a static toolkit allowlist.
3. A user can connect any toolkit supported by the configured Composio project
   and its managed/custom auth readiness is represented honestly.
4. All valid app-native tools are searchable/describable/callable through the
   bounded proxy surface.
5. Raw Composio control-plane/workbench/bash tools are unreachable.
6. Every launch-version call requires one exact current-user approval and
   cannot reach Composio before approval.
7. Drift, denial, cancel, timeout, replay, or wrong user/session produces zero
   provider calls.
8. Ambiguous provider outcomes are not retried automatically.
9. User/workspace/account isolation, revocation, stable errors, rate limits,
   and secret redaction pass deterministic tests.
10. Curated static consumers do not broaden unless they select catalog mode.
11. Exact packages are released/pinned in Seneca and production rollback is
    executed successfully.

## Slices

### Slice 900.1 — Full-catalog Composio backend

**Delivers:** First, a no-contract real-Composio capability spike proving
unfiltered Session behavior, sandbox/workbench disablement, meta-tool control,
query/schema bounds, and exact pinned-account execution. Then a thin Composio
adapter identity, optional managed search/describe seam, shallow
query/schema/connection mapping, bounded transient caches, source/tool
revisions, and curated compatibility. No provider templates or mirrored catalog.

**Blocked by:** Isolated Composio development project/key and disposable test
account for the spike. No production/customer secret.

**Proof:** Sanitized live capability record plus fake deterministic fixtures;
`@hachej/boring-mcp` typecheck/test/build, real fake MCP transport, secret
canaries, full-app compatibility, standards/security review.

**Review budget:** One focused upstream PR.

### Slice 900.2 — General calls with exact Ask User approval

**Delivers:** Launch policy `approval-required|blocked`, `mcp_tool_call`,
`mcp_readonly_call` compatibility alias, injected approver, one shared Ask User
runtime composition, one-use revision/digest-bound approval, value-free audit,
and outcome-unknown handling. No direct-read classifier on the sale path.

**Blocked by:** 900.1.

**Proof:** real blocking Ask User -> browser answer -> one fake Composio call;
approve/deny/cancel/stale/replay/timeout matrices; secret scan; thermo/security
review.

**Review budget:** One focused execution-boundary PR.

### Slice 900.3 — One-Composio UI and capabilities

**Delivers:** Live Composio-backed catalog, connections, active-account
selection, tool detail, server-authoritative capabilities, and approval copy in
the existing Questions/Inbox surface. Seneca keeps the old UI behind capability
selection through the observation window; if it is removed later, catalog-mode
rollback disables MCP rather than promising a missing curated screen.

**Blocked by:** Stable 900.1–900.2 contracts.

**Proof:** front tests, accessibility/keyboard checks, screenshots, responsive
proof, high-taste UI review.

**Review budget:** One UI PR.

### Slice 900.4 — Release and Seneca production proof

**Delivers:** Pack/install qualification, normal package release, exact Seneca
pins/composition, isolated Composio project/secret, deployment flags,
non-destructive production E2E on `prod.senecaapp.ai`, then issue #36's exact-SHA
Cloudflare cutover making `app.senecaapp.ai` canonical while retaining `prod` as
a rollback alias. The legacy environment remains recoverable under #877.

**Blocked by:** 900.1–900.3; release/deployment/vendor/security approval;
Seneca #36 Cloudflare DNS API access and approved Stripe accounting transition.

**Proof:** upstream package gates, clean Seneca gates, tarball/lock integrity,
image digest, live Composio test-account evidence, secret scans,
`app.senecaapp.ai` self-hosted origin marker/health/auth/payment proof,
DNS/config rollback and restore, operations review, and #877 retention proof.

**Review budget:** One release qualification, one Seneca PR, one production
proof record.

### Optional post-launch slice 900.5 — Verified direct reads

**Delivers:** Sampled/accepted Composio risk metadata authority, conservative
`direct|approval-required|blocked` classification, a direct-read server flag,
and deterministic contradiction/unknown tests.

**Blocked by:** Successful sellable launch plus a recorded sample of live
Composio metadata. It is not part of 900.1–900.4 or the domain cutover.

## Dependency graph

```text
900.1 live spike + full-catalog backend
  -> 900.2 approval for every call
    -> 900.3 one-Composio UI
      -> 900.4 release + Seneca proof
        -> optional 900.5 verified direct reads
```

This is intentionally linear and small. Do not create a large Bead graph. Each
slice can be one tracked PR/slice under issue #900 and Seneca #35.

## Out of scope

- MCP Registry or marketplace.
- User-supplied/custom MCP URLs.
- `stdio`, SSE fallback, local MCP processes, or package installation.
- Multiple MCP providers in the Seneca UI.
- Composio workbench, remote bash, or raw meta-tools.
- General provider credential vault or multiple same-provider credential
  profiles; #820 owns future workspace-shared custody.
- Multi-replica Ask User coordination.
- Generated direct app tools loaded into model context.
- Automatic tool-call retry or false exactly-once guarantees.
- Constellation policy broadening.

## Stop conditions

Stop and amend instead of improvising if:

1. full-catalog Sessions cannot disable remote sandbox/workbench;
2. Composio Session MCP cannot prove the selected/pinned account is the account
   used for execution;
3. raw execution meta-tools can bypass Boring policy;
4. approval cannot bind exact arguments/revisions and revalidate before call;
5. Ask User would be reconstructed separately for waiter and browser handlers;
6. Composio Session/account secrets would enter browser, workspace, prompt,
   transcript, session, log, or error;
7. Seneca would require arbitrary endpoint/OAuth handling to call this release
   complete; or
8. a production proof requires customer data or irreversible actions.

## Planning proof and review record

```bash
git diff --check
test -z "$(git diff --name-only origin/main...HEAD | grep -v '^docs/')"
rg -n 'Composio|Ask User|approval|required|rollback|Out of scope' \
  docs/issues/900/plan.md
```

Grounding:

- Composio Sessions expose the full toolkit catalog by default when no toolkit
  filter is supplied, recommend meta-tool discovery for broad Agents, support
  toolkit pagination plus exact `connectedAccounts` account pinning, behavior
  tags, and sandbox disablement:
  <https://docs.composio.dev/docs/configuring-sessions> and
  <https://docs.composio.dev/docs/managing-multiple-connected-accounts>.
- Composio Connect uses seven meta-tools for discovery, auth, schema, and
  execution without loading the full catalog:
  <https://docs.composio.dev/docs/composio-connect>.
- Managed versus custom auth limitations:
  <https://docs.composio.dev/docs/custom-app-vs-managed-app>.
- MCP tool annotations are hints and human denial must remain possible:
  <https://modelcontextprotocol.io/specification/2025-11-25/server/tools>.

Review record:

- Code reconnaissance covered current Boring MCP/Ask User and Seneca production
  composition.
- The first broad plan received three web-assisted adversarial security passes.
  Their approval TOCTOU, replay, prompt-injection, version/account identity, and
  ambiguous-outcome findings remain integrated in this narrowed plan.
- The owner explicitly removed Registry/custom-server scope and required a thin
  Composio wrapper to optimize time to sale. That removes arbitrary endpoint
  SSRF, dynamic OAuth issuer, custom credential-profile, egress-proxy, mirrored
  provider catalog, and provider-template work from the critical path.
- A fresh adversarial thin-wrapper review removed the launch-time direct-read
  classifier (all launch calls require approval), added the early live Composio
  spike, grounded exact account pinning, named the managed search/describe seam,
  grounded Seneca's deployed shared Ask User runtime, and made UI rollback
  honest.
- CI on plan PR #901 was green before this scope reduction. Re-run after this
  revision.
