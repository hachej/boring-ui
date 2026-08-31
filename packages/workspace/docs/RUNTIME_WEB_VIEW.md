# RuntimeWebView

`RuntimeWebView` is the workspace-owned iframe/projection boundary shared by
trusted built-in panels. URL pane is its first caller; browser/noVNC may compose
it in a later gated slice.

## Caller contract

Callers choose one closed source:

- `{ kind: "url", url }` for a browser-direct absolute URL. The component reads
  the URL-pane origin policy and applies it before setting `iframe.src`.
- `{ kind: "runtime", port, path? }` for the Host-selected runtime. The strict
  schema accepts only port 1024–65535 and an absolute bounded path. Hosts,
  upstream URLs, credentials, runtime/provider IDs, and unknown fields are
  rejected.

Runtime sources are projected through authenticated
`POST /api/v1/ui/runtime-web-view/preview`. The #1493 URL-pane route remains as
a compatibility alias but new callers use the central route. The Host derives
the workspace and active runtime; callers cannot select either.

The returned projection is revalidated before framing. Hosted targets must be
credential-free HTTPS. Local HTTP targets must be exactly `localhost`,
`127.0.0.1`, or `[::1]` with an explicit bounded port. A supplied expiry causes
a refresh thirty seconds before expiration. Failed refreshes fail closed and
show a sanitized message. Reload retries projection and remounts the iframe;
unmount/source changes fence late responses.

## iframe and WebSocket behavior

The iframe uses `referrerPolicy="no-referrer"`, `noopener noreferrer` for
external opening, and the URL-pane sandbox policy. `allow-same-origin` is never
granted when the framed origin equals the workspace origin.

Interactive applications such as noVNC must use a relative WebSocket path. In
local mode that resolves to loopback HTTP/WS. In hosted mode it resolves through
the same authenticated HTTPS/WSS projection origin. RuntimeWebView never accepts
or exposes a separate WebSocket host, token, CDP endpoint, VNC password, or
provider address.
