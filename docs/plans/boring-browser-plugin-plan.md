# Browser plugin — Option B implementation

**State:** implemented behind an explicit immutable default-off app flag; local qualified-container proof required; hosted support fail-closed until provider qualification. PR #1493 remains the single delivery PR.

## Ratified authority/mechanism boundary (R1)

The Host owns identity, selected Environment generation, service/image qualification, effect admission, projection grants, revocation, audit, and lifecycle. Browser-Use is only the pinned browser mechanism. The browser plugin cannot select or discover a runtime/provider/service/image and never receives RuntimeBundle, Sandbox, arbitrary exec, ports, upstream URLs, or provider credentials. It exposes exactly `browser_observe` and `browser_act`; lifecycle/takeover remain authenticated UI routes. No Browser-Use Agent/model/cloud/MCP catalog or generic dispatcher exists.

## Exact Environment and fixed service

`EnvironmentLease` has an opaque immutable generation ID and exact retain/release semantics. Trusted app composition resolves the addressed Agent session, retains that binding's exact lease, and may acquire only a qualified `trusted-service-v1`. The service accepts a closed operation enum, hard idle/absolute TTLs, and named observer/controller projections. It has no caller-provided command, argv, environment, image, host, port, or service ID.

This does **not** introduce a general persistent-process platform. It is one statically configured protocol and image with no registration/discovery API. Unknown cleanup remains a reconciliation error and retains the Environment reference. This explicitly reconciles the persistent-process non-goal.

## Isolation refinement

The qualified image runs under dedicated UID `boring-browser` in a private container/network namespace. Ordinary Agent bash runs in a different namespace and cannot read the profile, X socket, VNC password, Unix control socket, or enter the service namespace. Observer VNC is view-only; controller VNC is input-enabled; both require authentication.

Browser-Use 0.13.8 supports CDP URLs only. The earlier absolute “no TCP CDP listener” requirement is therefore refined to **no CDP endpoint outside the isolated trusted-service namespace**. Browser-Use's loopback CDP is permitted only inside that namespace, never projected or published, and qualification proves an independently namespaced Agent cannot reach it. This refinement was owner-approved; shared-namespace secrets remain forbidden.

## Pair-local projections and same-origin broker

Projection authority is captured on each acquired provider pair/RuntimeBundle; provider-global workspace preview maps are removed. Disposed pairs reject new projections. The Workspace broker stores sealed upstream URLs/tokens server-side and returns only an opaque same-origin bootstrap grant bound to workspace, Agent, session, and Environment generation. Grants are one-use. HttpOnly path-scoped cookies authorize HTTP and WebSocket relay. Revocation synchronously rejects future requests and destroys active sockets, then performs provider cleanup best-effort. Client authorization/cookies are stripped upstream; upstream Set-Cookie and cross-origin redirects are blocked.

Blaxel's pinned SDK has no preview-token deletion primitive and cannot prove the dedicated service identity/private channel. Its browser service support is therefore **unsupported**, not emulated. Pair-local generic projection cleanup is fenced locally; sealed Blaxel tokens expire by short TTL.

## Browser composition

`BrowserHostCapability` is a pre-bound trusted app capability. A browser session retains one exact Environment and calls only fixed operations. Every takeover/return/generation abort revokes and rotates opaque observer/controller views. The plugin factory reads no ambient enablement variable: app composition passes explicit `enabled: boolean`; false contributes no server behavior. Consequential action plans remain immutable, hashed, and admitted per action.

Front composition receives only same-origin opaque projection URLs. It never receives a port, provider/runtime identity, raw VNC/CDP endpoint, image, or upstream URL.

## Qualification and rollout gates

`plugins/browser/src/runtime/image/Dockerfile` pins the base digest and Browser-Use wheel hash. `qualify-image.sh` proves installed versions, dedicated UID/private bytes, view-only observer versus controller, same-Chromium observe/act, no passwordless VNC, Agent CDP denial, and cleanup. The local image ID is evidence only; a qualified registry digest plus provider conformance is required for hosted enablement.

Production remains default-off. No production-readiness claim is valid until one hosted provider proves unchanged protocol/image isolation, same-origin HTTP/WS revocation, and the end-to-end takeover tracer.
