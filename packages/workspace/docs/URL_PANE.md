# URL pane (live demo pane)

The URL pane embeds a **running** surface — a worker's dev server, a preview
host, the hub itself — inside a workspace tab. It is the live half of the
factory's two-artifact worker handoff (gh-1187 S3): the owner reviews the
present-pr page in one pane and the thing itself in the other, without leaving
the workspace and without a `localhost:5xxx` line pasted into chat.

| | |
| --- | --- |
| Plugin id | `url-pane` (built-in, registered by `captureWorkspaceFrontPlugins`) |
| Panel component id | `url-pane.panel` |
| Params | `{ url: string; title?: string }` or `{ runtimePreview: { port; path? }; title? }` |
| Policy source | `GET /api/v1/ui/url-pane/policy` → `{ origins: string[] }` |
| Config | `BORING_URL_PANE_ALLOWED_ORIGINS` |
| Decision code | `packages/workspace/src/shared/urlPane.ts`, composed through central `RuntimeWebView` |

## Opening it

From an agent session in local CLI mode:

```jsonc
{ "kind": "openPanel", "params": {
    "id": "demo:br-1187",
    "component": "url-pane.panel",
    "params": { "url": "http://127.0.0.1:5173/", "title": "br-1187 demo" } } }
```

In a hosted remote sandbox, browser loopback is the user's computer, not the
sandbox. Ask the host to project the active runtime port instead:

```jsonc
{ "kind": "openPanel", "params": {
    "id": "demo:remote",
    "component": "url-pane.panel",
    "params": { "runtimePreview": { "port": 5173, "path": "/" }, "title": "remote demo" } } }
```

The pane delegates iframe and runtime-projection behavior to the shared
[`RuntimeWebView`](./RUNTIME_WEB_VIEW.md); it no longer owns a second projection
implementation.

The current provider implementation creates a private, 15-minute Blaxel preview
token over HTTPS; the underlying preview has a one-hour TTL. The pane resolves
that token through the authenticated workspace API and never treats an
agent-authored public URL as a runtime projection.

Open either form via the `exec_ui` tool, the `openArtifact` shell capability
(`{ type: "panel", panelComponentId: "url-pane.panel", params: { url } }`), or a
direct `POST /api/v1/ui/commands`.

## The security boundary

Browser-direct `url` targets are not fetched server-side, so that form is **not**
an SSRF surface. `runtimePreview` is a separate host-authorized provider
projection: it accepts only a bounded port/path for the authenticated workspace,
never an agent-supplied host or upstream URL. The risk for browser-direct URLs is
that an agent — possibly prompt-injected — frames an arbitrary origin inside the
owner's workspace. The mitigation is an origin allowlist plus a hard iframe
sandbox:

- **Allowlist.** `resolveUrlPaneTarget` accepts only `http:`/`https:`, rejects
  credentials in the URL, and requires the origin to match a configured pattern.
  Patterns are exact origins or `scheme://host:*` (a **port** wildcard only —
  host wildcards are deliberately unsupported).
- **Default (browser-direct only).** Unset config means loopback only: `http://localhost:*`,
  `http://127.0.0.1:*`, `http://[::1]:*`. An explicitly empty
  `BORING_URL_PANE_ALLOWED_ORIGINS` means *closed* — nothing may be framed.
- **Two enforcement points, same function.** The front re-resolves before it
  sets an `src`, and fails closed if the policy endpoint is unreachable; the
  `POST /api/v1/ui/commands` route rejects a disallowed URL with a 400 so an
  agent gets a reason instead of an invisible blocked pane.
- **Sandbox.** `allow-scripts allow-forms allow-popups
  allow-popups-to-escape-sandbox`, plus `allow-same-origin` **only when the
  target origin differs from the workspace's own origin**. That conditional
  matters both ways: without `allow-same-origin` the frame runs on an opaque
  origin and a plain dev server's module scripts are CORS-blocked (a real hub
  demo renders blank); with it on a *same-origin* document, `allow-scripts
  allow-same-origin` would let the frame remove its own sandbox and reach the
  workspace. A different port is a different origin, which covers every real
  worker demo. `referrerPolicy` is `no-referrer`.

Sites that send `X-Frame-Options: DENY` or a restrictive `frame-ancestors` CSP
will refuse to render; that is the remote site's choice, not a pane bug. The
"open in new tab" action is the escape hatch.

## Relation to the HTML viewer

The HTML viewer (`filesystem` plugin) renders a *file* through `srcDoc`; the URL
pane points at a *server*. They are complementary, and the handoff uses both:

```
exec_ui openFile   .handoff/pr-<n>-presentation.html   → HTML viewer pane
exec_ui openPanel  url-pane.panel { url }              → live demo pane
```
