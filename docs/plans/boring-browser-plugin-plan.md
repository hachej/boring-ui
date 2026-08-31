# Runtime-neutral browser plugin implementation plan

**State:** `ready-for-agent` for Slice 1. Architecture and V0 product decisions are final; later rollout gates are explicit below.

## Problem Statement

Add `plugins/browser` as a trusted, statically composed shared app/internal plugin. It must let Boring's Agent observe and act in a Chromium session that the user can watch and exclusively take over through noVNC, without creating a second agent loop or a browser-specific runtime layer.

The feature must remain runtime/provider-neutral:

- the Host remains authoritative for workspace/user/Agent-session identity, selected runtime, capability/effect admission, approvals, records, models, metering, credentials, and environment lifecycle;
- the plugin reuses existing boring-bash/runtime exec, the existing environment generation/lease lifecycle, and PR [#1493](https://github.com/hachej/boring-ui/pull/1493)'s runtime-preview projection;
- Chromium, Browser-Use, Xvfb, VNC, noVNC/websockify, and the fixed launcher are bounded processes in the already selected workspace runtime;
- the plugin contains no `BrowserRuntimeCapability`, provider adapter, process platform, runtime selection, provider branch, provider credential, or plugin-selected image;
- Boring is the sole agent/model/record/metering authority. Browser-Use is the pinned browser-control mechanism, not another agent authority.

## Repository Findings and Reuse Seams

- `packages/agent/src/server/agent-host/environmentLease.ts` owns sharing/disposal of the selected environment generation.
- `packages/agent/src/server/agent-host/buildAgentComposition.ts` and boring-bash already bind execution to that generation's runtime bundle.
- `packages/boring-bash/src/agent/tools/harness/index.ts` and `packages/boring-bash/src/agent/tools/operations/remoteSandbox.ts` are the existing local/hosted execution path.
- `packages/workspace/src/plugins/urlPanePlugin/front/UrlPane.tsx` currently owns iframe behavior that should move to a central shared `RuntimeWebView`.
- PR [#1493](https://github.com/hachej/boring-ui/pull/1493) adds the Host-selected runtime-preview projection. Reconcile its final merged shape; do not duplicate it.
- `packages/workspace/src/server/plugins/defineServerPlugin.ts` is the trusted server contribution seam. App composition may inject narrow server-only callbacks for fixed browser intents, identity verification, environment reference acquisition/release, and runtime preview. It must not expose arbitrary exec or runtime objects to authored/runtime plugins.
- Browser-Use's open-source project supplies the [Python library/CLI](https://github.com/browser-use/browser-use), [official coding-agent skill](https://github.com/browser-use/browser-use/blob/main/skills/browser-use/SKILL.md), and [local MCP server](https://docs.browser-use.com/open-source/customize/integrations/mcp-server).

## Solution

### 1. Central shared `RuntimeWebView`

Create one workspace-owned `RuntimeWebView` seam and reuse it in both:

- `url-pane.panel`, preserving generic absolute-URL and selected-runtime-port behavior; and
- `BrowserPanel`, targeting only the fixed noVNC endpoint.

The shared seam owns target validation, local loopback projection, hosted authenticated HTTPS/WSS projection through #1493, iframe/WebSocket policy, expiry/refresh, retry/reload, cancellation, safe open-external behavior, and sanitized errors. A caller may supply only a validated runtime port/path target; never an upstream host, credentials, runtime/provider identity, or preview secret.

Local projection is explicitly loopback-only (`localhost`, `127.0.0.1`, or `[::1]`, bounded port). Hosted projection stays authenticated and short-lived. noVNC WebSocket auth, upgrade, relative-path, refresh, and revocation behavior are part of this shared contract.

### 2. Trusted `plugins/browser` package

Create `plugins/browser` with front/server/shared/runtime boundaries:

- `BrowserPanel` supplies status, start/stop, viewer, takeover, and return UX and composes the shared `RuntimeWebView` for noVNC;
- authenticated plugin routes own session start/status/stop/view/takeover/return;
- an in-process browser-domain controller owns session state, control epoch, bounded lifecycle, and fixed-launcher intents;
- runtime assets include the fixed launcher and exact dependency locks/digests.

Session start, stop, status/view, takeover, and return are authenticated plugin routes/UI operations, **not model tools**. Routes derive and verify workspace, user, addressed Agent, and Agent session from Host state. Presented IDs are lookup hints and must match Host-owned identity.

The front never receives arbitrary command text, raw MCP/CDP/VNC endpoints, VNC passwords, launcher secrets, runtime/provider credentials or identifiers, placement IDs, or provider credentials. It receives only sanitized domain state and a short-lived `RuntimeWebView` projection.

### 3. Browser-Use directly, pinned, over the same Chromium

Use the open-source Browser-Use project directly rather than reimplementing its browser-control stack:

- pin the Browser-Use CLI/library to one exact released version and integrity digest in the plugin runtime lock;
- vendor or install the matching official `skills/browser-use/SKILL.md` at an exact repository commit/digest; no floating `main`, `latest`, or unreviewed remote skill at runtime;
- run Browser-Use's local MCP server as a bounded launcher-managed process where its supported API is the appropriate local bridge;
- attach Browser-Use to the fixed server-internal CDP endpoint for the **same Chromium** whose display is exported by VNC/noVNC;
- add a compatibility manifest for the pinned Browser-Use version/skill, Python, Chromium, noVNC, and launcher protocol, plus an upgrade test and review procedure.

The official skill contributes bounded browser-operation instructions to Boring's Agent. It does not create a Browser-Use Agent, select or call a model, own history, or become an authority source. Browser-Use cloud models/services and Browser-Use provider credentials are out of scope.

The local Browser-Use MCP server is an implementation detail behind the plugin's thin server-side adapter. Do **not** register its whole catalog as provider-native Boring tools, pass MCP descriptors to the provider, expose raw MCP calls to the model/front, or implement generic OpenCode-style `call_tool`/`execute` dispatch in this feature.

### 4. Exactly two native Boring Agent tools

V0 exposes exactly:

1. `browser_observe` — returns a bounded, redacted structured observation and approved screenshot/artifact references for the current session/control epoch.
2. `browser_act` — accepts one immutable, validated discriminated action plan and executes it through a thin Browser-Use adapter.

No `browser_start`, `browser_stop`, `browser_view`, `browser_takeover`, `browser_return`, generic MCP tool, raw CDP tool, JavaScript evaluator, shell tool, or one-native-tool-per-MCP-operation is added.

A `browser_act` request has a closed schema conceptually equivalent to:

```ts
type BrowserAction =
  | { readonly kind: "navigate"; readonly url: string }
  | { readonly kind: "click"; readonly target: BrowserTarget }
  | { readonly kind: "type"; readonly target: BrowserTarget; readonly text: string }
  | { readonly kind: "select"; readonly target: BrowserTarget; readonly value: string }
  | { readonly kind: "upload"; readonly target: BrowserTarget; readonly resourceRef: string }
  | { readonly kind: "download"; readonly target: BrowserTarget };

type BrowserActionPlan = {
  readonly sessionId: string;
  readonly controlEpoch: number;
  readonly actions: readonly BrowserAction[];
};
```

The implementation may refine target/action variants, but the plan remains a bounded closed discriminated union: no arbitrary tool name, MCP method, command, code, CDP payload, URL credentials, filesystem path, or provider/runtime field.

Processing order is fail-closed:

1. parse and normalize once;
2. validate bounds, destination/resource policy, session identity, and control epoch;
3. deep-freeze/canonically encode and hash the exact normalized plan;
4. perform Host capability/effect admission and bind approval evidence to that exact plan/hash;
5. before each action, recheck session/control epoch and admit that action; every consequential action requires valid action-specific evidence even when the enclosing plan was admitted;
6. map only the admitted variant to the pinned Browser-Use adapter and record the canonical result/unknown outcome.

The adapter cannot silently expand, reorder, retry, or substitute actions after admission. Any changed plan is a new tool call and needs fresh validation/admission. Navigation follows Host egress policy. Submissions, messages, purchases, remote mutations, uploads/download publication, and credentialed effects require applicable durable approval. Passwords/tokens are never tool arguments.

Browser-specific progress may be recorded/emitted as typed browser-domain events correlated to the canonical `browser_act` call. UI and audit may render those events honestly as browser progress. They must not claim that Pi/provider emitted generic nested tool calls or that each Browser-Use/MCP operation has native Pi tool identity.

### 5. Why generic dispatch is rejected

The ratified historical decision [R-33-06](long-term/ratified/recommendations/R-33-06-bounded-tool-catalog/RECOMMENDATION.md) and its spike found that plain `call_tool` preserves only `toolName:"call_tool"`; the called child's identity is lost. Renderers, metering, and per-call approval key off real tool identity, and approval must bind to canonical arguments. The broader architecture history likewise says any future generic dispatch requires first-class recorded child events rather than pretending provider-wire identity exists ([ARCHITECTURE-PLAN-v2-history.md](long-term/ratified/ARCHITECTURE-PLAN-v2-history.md)).

Therefore closed/deferred issue [#1226](https://github.com/hachej/boring-ui/issues/1226) is evidence for a **rejected alternative**, not scope for this feature. This plan does not revive its generic catalog/dispatcher, implement OpenCode `call_tool`/`execute`, invent generic child-event identity, or solve catalog rendering/approval/metering. The two native browser tools keep truthful canonical identity; browser-domain progress stays domain-specific. Generic child-event/catalog work belongs in a separate architecture effort, if ever approved.

### 6. Fixed launcher and bounded lifecycle through existing exec

The plugin ships one fixed launcher with a closed intent vocabulary such as `ensure`, `status`, `observe`, `act`, `takeover`, `return`, and `stop`. Typed server input maps to fixed argv/data. No route, model, or front caller supplies shell, executable, cwd, environment, image, port, upstream URL, daemon option, or provider/runtime identifier.

The launcher uses existing runtime exec to start/check/stop bounded Chromium, Xvfb, VNC/noVNC, Browser-Use CLI/library worker, and local MCP processes. It retains a reference to the existing selected environment generation; it does not create a runtime lease, durable service registry, provider adapter, process platform, or host-global fallback.

Initial bounds: one browser per addressed Agent session, 15-minute idle TTL, 60-minute absolute TTL, fixed start/readiness/stop deadlines, and trusted Host-configured workspace/user quotas. Stop, TTL, flag disable, Host shutdown, runtime invalidation, or health failure revokes view/control, invokes fixed stop when reachable, destroys ephemeral profile/quarantine according to policy, and releases the environment reference exactly once.

### 7. Exclusive Agent/human control

Server state is epoch-fenced:

```text
starting -> agent-controlled <-> human-controlled -> stopping -> stopped
                              \-> error
```

Every observe/action verifies owner and current monotonic `controlEpoch`. Takeover first changes owner/increments epoch and rejects or boundedly settles in-flight Agent work, then revokes/rotates projection and enables VNC input. Return first revokes human input, requires informed consent after credential entry/authentication, captures a fresh observation, then changes owner/increments epoch. Interrupted actions never auto-resume. Client `viewOnly` is defense in depth, not authority.

### 8. Security and data hardening

- Enforce public-destination policy at the strongest existing runtime/network boundary, with Chromium/launcher checks as defense in depth. Deny private/link-local/metadata/control-plane/internal destinations, alternate IP encodings, redirect/DNS-rebinding bypasses, and uncontrolled WebRTC/QUIC escape.
- Human credentials are entered only during human control. Never put them in tools, route queries, launcher argv, logs, records, screenshots intentionally returned to the Agent, or audit events.
- Uploads use authorized workspace resource references only; reject traversal, symlinks, absolute paths, and over-limit files. Downloads stay in bounded quarantine and require an explicit admitted publication step; never auto-execute them.
- Redact DOM secrets, cookies, storage, typed values, raw URLs where sensitive, MCP/CDP/VNC targets, and preview secrets. Raw CDP, cookie/storage export, arbitrary JavaScript, and arbitrary file access are not exposed.
- Audit sanitized session lifecycle, owner/epoch transitions, projection issue/revoke, exact plan hash, action requested/admitted/settled/denied/unknown, approval reference, normalized origin, and artifact metadata under Host-derived accepted-work identity.
- Supply-chain checks verify dependency/skill lock integrity, license/SBOM, vulnerability policy, and upgrade compatibility before rollout.

## User Stories / Scenarios

1. Local CLI user starts a browser from `BrowserPanel`; existing exec launches bounded processes and `RuntimeWebView` displays noVNC over loopback.
2. Boring's Agent calls `browser_observe`, submits one admitted `browser_act` plan, and the user sees Browser-Use control that same Chromium.
3. The user takes over through authenticated UI; a stale/racing Agent action is rejected. After explicit return, the Agent receives a fresh observation.
4. A consequential action lacking exact current approval fails before execution; a later action in an admitted plan is rechecked and denied if its evidence is stale.
5. A hosted workspace uses unchanged plugin bytes, launcher protocol, exec path, and runtime-preview seam; only Host-selected runtime behavior differs.
6. Cross-workspace/session projection replay, private-network navigation, raw MCP/CDP access, and forged session identity fail closed.
7. Stop, expiry, runtime loss, and flag rollback revoke access and release the existing environment reference without introducing a separate process/runtime authority.

## Decisions

- `plugins/browser` is trusted shared app/internal composition and runtime/provider-neutral.
- Existing runtime exec, environment lifecycle, and #1493 projection are reused; no browser capability/provider/process abstraction is introduced.
- `RuntimeWebView` is centralized and shared by URL pane and BrowserPanel/noVNC.
- Browser-Use CLI/library and official skill are exact-pinned; Browser-Use controls the displayed Chromium while Boring alone owns agent/model/record/metering.
- Browser-Use local MCP remains behind a thin adapter; its catalog is not provider-native and no generic dispatcher/child-event project is included.
- V0 has exactly two native tools: `browser_observe` and `browser_act`.
- Session lifecycle/view/control operations remain authenticated routes/UI, never model tools.
- Profiles are ephemeral for V0; Agent/human control is exclusive and epoch-fenced.

## Flag / Abstraction

- **Needed?:** One Host-owned rollout flag; no new browser runtime/provider abstraction.
- **Path:** trusted Host config `BORING_BROWSER_PLUGIN_ENABLED` -> static front/server composition -> narrow server-private callbacks over existing identity, environment, exec, and runtime-preview seams.
- **Rollback:** disable flag, reject starts/tools, revoke projections/control, fixed-stop known sessions when reachable, release environment references, and hide panel/tools. Keep shared `RuntimeWebView`/URL-pane behavior. Never fall back to host-global Chromium or direct upstream access.

## Test Seams

- **Highest public seam:** authenticated browser routes and exactly two native tool registrations using fake fixed exec/Browser-Use adapter/runtime-preview projector; shared `RuntimeWebView` component/route tests; Playwright against composed BrowserPanel and controlled fixtures.
- **Existing prior art:** URL-pane tests, #1493 preview conformance, ask-user package/front/server patterns, live-transcription bounded lifecycle, environment lease tests, and boring-bash local/remote parity.
- **Avoid testing:** Browser-Use/Chromium/noVNC internals, provider SDK details, raw React state, or a generic MCP dispatcher not in the feature.

Required negative tests include:

- exactly two model tools are registered; lifecycle/view/control and Browser-Use MCP catalog are absent from provider-native tools;
- schemas make arbitrary MCP names/args, CDP, command/code, provider/runtime fields, credentials, ports, paths, and upstream URLs impossible or reject them;
- plan canonicalization/deep immutability, tamper-after-approval, action reorder/substitution, stale epoch, exact-plan mismatch, per-consequential-action denial, and unknown-outcome/no-auto-retry;
- no generic child identity/rendering claim; browser progress remains correlated domain events under the canonical `browser_act` call;
- disabled flag, forged/cross-scope identity, replayed/expired projection, simultaneous takeover/action, return-before-input-revocation, and viewer disconnect races;
- local non-loopback and malformed runtime targets; hosted expiry/WSS refresh/revocation;
- private/link-local/metadata IPv4/IPv6, alternate encodings, redirects, DNS rebinding, WebRTC/QUIC, and raw WebSocket bypass;
- credentials/secrets absent from tool args/results, logs, errors, records, snapshots, and audit;
- launcher crash/hang/partial start/stale metadata, MCP worker loss, runtime invalidation, TTL, Host shutdown, and flag disable release lifecycle references exactly once;
- pinned lock/skill digest mismatch fails provisioning; no Browser-Use Agent/model constructor or second metering/record loop is invoked.

## Acceptance

- URL pane behavior is preserved while both URL pane and BrowserPanel/noVNC reuse central `RuntimeWebView`.
- Local HTTP/WS loopback and hosted authenticated HTTPS/WSS projection pass expiry, retry, cancellation, and revocation tests without leaking upstream/provider data.
- The plugin is unchanged across local and hosted runtimes and contains no forbidden runtime/provider/process abstraction.
- Exact Browser-Use CLI/library and official-skill commit/digests are checked in and verified; both drive the same Chromium displayed by noVNC.
- Provider-native registration contains exactly `browser_observe` and `browser_act`.
- `browser_act` executes only its immutable admitted plan through the thin adapter, with exact-plan and per-consequential-action checks and truthful domain progress.
- Start/stop/view/takeover/return work only as authenticated plugin routes/UI.
- Fixed launcher processes use existing exec and selected-environment lifecycle; no model/front input can reach raw MCP/CDP/VNC, arbitrary exec, or credentials.
- Security tests and local tracer pass before hosted proof; hosted proof uses unchanged plugin/runtime-preview; rollout and rollback drills leave no usable grants or leaked environment reference.

## Proof

### Planning validation

```bash
git diff --check -- docs/plans/boring-browser-plugin-plan.md
rg -n 'browser_observe|browser_act|RuntimeWebView|#1226|Browser-Use|runtime-preview' docs/plans/boring-browser-plugin-plan.md
rg -n 'browser_open|browser_click|BrowserRuntimeCapability|provider adapter|generic OpenCode' docs/plans/boring-browser-plugin-plan.md
```

The last command may match only explicit rejected alternatives, negative tests, or prohibitions.

### Implementation commands

```bash
pnpm --filter @hachej/boring-workspace typecheck
pnpm --filter @hachej/boring-workspace test
pnpm --filter @hachej/boring-browser typecheck
pnpm --filter @hachej/boring-browser test
pnpm --filter @hachej/boring-browser build
pnpm --filter @hachej/boring-agent test
pnpm --filter @hachej/boring-bash test
pnpm lint:invariants
pnpm test:changed
git diff --check
```

Narrow test paths may be used during slices, but final proof must include workspace shared-view/URL-pane tests, browser package tests, Agent tool-registration/admission tests, environment lifecycle tests, and boring-bash local/hosted parity.

### Local usable tracer

1. Enable the flag in normal local runtime mode and start through authenticated BrowserPanel UI.
2. Verify fixed launcher invocation through existing runtime exec and exact dependency/skill lock integrity.
3. Display noVNC through shared `RuntimeWebView` loopback projection.
4. On a controlled fixture, call `browser_observe`, then one small `browser_act` plan; capture trace/video showing Browser-Use controlling the identical displayed Chromium.
5. Race action with takeover, change state as human, explicitly return, and observe the exact changed state.
6. Prove one denied consequential action and one correctly approved exact action.
7. Stop, expire, and disable flag in separate runs; preserve sanitized cleanup/reference-release evidence.

Artifacts: Playwright trace/video, accessibility snapshot, narrow/wide screenshots, sanitized route/audit IDs and plan hashes, lock verification, and process cleanup evidence.

### Hosted proof

In one qualified non-production hosted runtime selected by the Host, deploy the **unchanged** plugin bytes, lock, launcher, and protocol:

1. provision/start through existing exec and environment lifecycle;
2. show authenticated HTTPS iframe + WSS noVNC through #1493/shared `RuntimeWebView`;
3. repeat observe/action/takeover/return and same-Chromium proof;
4. reject cross-workspace/session projection replay and private/metadata navigation;
5. exercise projection refresh, MCP/launcher failure, TTL/runtime invalidation cleanup, and flag rollback;
6. preserve sanitized Host audit IDs and cleanup evidence.

If prerequisites, enforceable egress, or authenticated WebSocket preview are unavailable, rollout remains blocked; do not add provider-specific code.

## Slices

### Slice 1: expand central `RuntimeWebView` and migrate URL pane

**Delivers:** Shared target schema/component/client/route over #1493, local loopback and hosted HTTPS/WSS behavior, and URL-pane behavior parity.

**Blocked by:** Reconcile #1493's final merged shape; do not duplicate its Host projection.

**Proof:** Workspace typecheck/tests, loopback HTTP/WS fixture, hosted projection contract fake, URL-pane visual parity.

**Review budget:** Inside one focused slice; security review required for projection policy.

### Slice 2: local usable browser tracer

**Delivers:** Trusted plugin shell, exact Browser-Use/skill pins, fixed launcher through existing exec/environment lifecycle, BrowserPanel using shared view, authenticated lifecycle/control routes, exactly two native tools, controlled-fixture observe + one bounded act, and same-Chromium noVNC proof.

**Blocked by:** Slice 1 and a reviewed compatible dependency lock.

**Proof:** Local usable tracer above, tool-registration/schema/admission tests, same-display trace, fixed-process cleanup.

**Review budget:** Exceeds normal package review; Agent authority, runtime, and security review required.

### Slice 3: security and lifecycle hardening

**Delivers:** Full closed action union, immutable canonical plan/hash, per-action effect checks, epoch races, egress bypass defenses, credential consent/redaction, upload/download quarantine, quotas/TTL/recovery, and sanitized browser-domain audit events.

**Blocked by:** Slice 2 and existing durable approval evidence for any consequential production action.

**Proof:** Required negative suites, credential canaries, tamper/replay/unknown-outcome tests, crash/TTL lifecycle tests, threat-model review.

**Review budget:** Exceeds; authority/security/privacy review required.

### Slice 4: hosted proof with unchanged plugin

**Delivers:** Deployment qualification only; generic fixes are allowed, provider branches are not.

**Blocked by:** Slice 3, merged #1493 seam, bounded-process prerequisites, authenticated WSS preview, cleanup, and enforceable egress in the selected deployment.

**Proof:** Hosted proof above and existing runtime-preview/runtime conformance suites.

**Review budget:** Exceeds; deployment/runtime/security review required.

### Slice 5: flagged rollout and rollback

**Delivers:** Allowlist, metrics/alerts, runbook, canary, retention/quotas, dependency-update cadence, and tested flag rollback before limited production enablement.

**Blocked by:** Slice 4; named operational/security owner and all production gates passing.

**Proof:** Canary artifact, dashboards/alerts, dependency-lock verification, cleanup and rollback drill, owner approval.

**Review budget:** Exceeds; production-owner approval required.

## Wide Refactor Strategy

`RuntimeWebView` is an expand → migrate → contract refactor: introduce the shared seam, migrate URL pane and BrowserPanel, then remove duplicate URL-pane projection/iframe ownership only after parity tests. Do not combine this mechanical contraction with browser process/security work.

## Rollout and Rollback Gates

Production remains off until dependency/SBOM review, authenticated WSS preview, egress enforcement, exact effect approval, credential-return consent, cleanup, audit, quotas, monitoring, and hosted unchanged-plugin proof pass. Start with a non-production allowlist, then a small tenant/workspace canary.

Rollback is the Host flag path described above. The drill must prove tool/panel disappearance, start rejection, projection/control revocation, fixed stop, environment-reference release, and no host-global fallback. Shared `RuntimeWebView` and URL pane remain operational.

## Out of Scope

Browser-Use Agent/model/cloud authority; generic MCP catalog residency or OpenCode `call_tool`/`execute`; generic child-event identity/rendering/approval/metering; new runtime capability/provider/process layers; provider-specific plugin code; arbitrary shell/MCP/CDP/JavaScript/filesystem APIs; plugin-selected runtimes/images; durable/synced browser profiles; public port forwarding; browser automation inside URL pane; simultaneous controllers; CAPTCHA/stealth/evasion; credential vault; autonomous consequential effects without Host authority.

## Open Questions

No open architecture/product question blocks Slice 1. Exact compatible dependency versions/digests are selected and reviewed as the lock artifact at the start of Slice 2; floating versions are never acceptable. Production operations/retention values are rollout inputs, not permission to change the architecture above.

## Adversarial Consistency Review

**Triggered:** yes. This plan crosses runtime projection, browser supply chain, network egress, credentials, external effects, interactive control, and bounded background processes.

**Reviewer:** plan self-check against the model-card adversarial dimensions and ratified R-33-06/#1226 evidence; independent required reviewer gate remains before implementation.

**Accepted findings and revisions:**

- The prior plan exposed many native browser tools and direct BrowserSession operations, conflicting with the final two-tool decision -> replaced with exactly `browser_observe` and immutable-plan `browser_act` over a thin pinned Browser-Use adapter.
- Merely saying Browser-Use remains subordinate did not prove direct project reuse -> added exact CLI/library and official-skill pins, local MCP containment, same-CDP/same-Chromium proof, and compatibility/SBOM gates.
- A local MCP server could accidentally become a generic catalog feature -> explicitly prohibited catalog projection, raw MCP inputs, OpenCode dispatch, and generic child-event work; cited R-33-06 and closed/deferred #1226 as the rejected alternative.
- Plan-level approval alone permits later actions to escape changed state/authority -> exact normalized plan hash plus per-action epoch/admission and action-specific consequential approval are mandatory; no expansion/reorder/retry.
- Browser progress could be misrendered as nested Pi tools -> constrained it to typed domain events correlated under the canonical native tool call, with no provider-wire child-identity claim.
- Lifecycle operations could leak into the model surface -> made start/stop/view/takeover/return route/UI-only and added exact tool-registration tests.
- Browser-local viewing would duplicate URL pane/#1493 -> retained central `RuntimeWebView`, expand/migrate/contract sequencing, and unchanged hosted proof.
- Provider/runtime and raw endpoint leakage remained a pressure point -> fixed launcher inputs and front/model schemas categorically exclude commands, raw MCP/CDP/VNC, ports/upstreams, credentials, and provider/runtime fields.
- A local demo alone would not validate runtime neutrality -> added hosted proof with unchanged plugin bytes and fail-closed qualification rather than provider branches.
- Rollback language did not fully prove cleanup -> added a drill for revocation, fixed stop, exactly-once environment release, and no host-global fallback.

**Remaining non-blocking risks:** Browser-Use/Chromium compatibility and supply-chain churn; availability of durable approval/audit and enforceable egress in production; #1493 merge shape; hosted noVNC WSS behavior. Each is assigned to a lock, slice gate, or rollout blocker rather than widening plugin architecture.

**Verdict:** revised plan is internally consistent, contains all final decisions, and is `ready-for-agent` for Slice 1. Independent reviewer gate is still required before implementation.

## Next Action

`ready-for-agent`: implement Slice 1 only after independent plan review. Do not scaffold browser tools/processes, generic MCP dispatch, child-event infrastructure, or provider/runtime abstractions in that slice.
