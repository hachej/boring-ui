# Factory multi-tab streaming ingress

Issue: #1565. Browser-facing **HTTP/2** is required for reliable multi-tab
Factory use. Four persistent SSE/NDJSON subscriptions per tab exhaust the
shared six-connection HTTP/1.1 pool; API calls and even document navigations
queue forever. TLS alone is not proof: verify the negotiated protocol.

Topology (no agent-host restart or session migration):

```text
browser -- HTTPS / h2 --> Tailscale Serve :8453 (tailnet only)
        -- HTTP/1.1 --> Caddy 127.0.0.1:5221
        -- HTTP/1.1 --> existing Vite :5220 --> existing API :5230
```

The six-connection restriction is in the browser, not these server-side
hops. Caddy flushes streams promptly and proxies Vite's HMR WebSocket.
Its positive 1ms flush setting preserves upstream cancellation on browser
disconnect; an explicit negative flush setting would detach cancellation.
It rewrites only the upstream Host to `localhost:5220`, avoiding Vite's DNS
host rejection without disabling its host allowlist. Its listener is
loopback-only, with no Caddy administration endpoint. The app remains a
no-auth playground: **do not use Tailscale Funnel or publish this proxy to
the internet**. Tailnet membership/ACLs remain the access boundary.

This uses the existing HTTP/2 transport direction in ratified
`ARCHITECTURE-PLAN.md` §5; it adds no gateway, authority, record, or event
semantics. No ratified-plan conflicts. Forced polling would change UI
command fan-out; periodically ending filesystem streams can discard their
replay buffer. Neither is necessary for this deployment fix.

## Install on an existing Linux/Tailscale host

Prerequisites: Caddy at `/usr/bin/caddy`, Tailscale HTTPS enabled, an already
running Factory at :5220, and a user systemd manager. Run from this app's
root. Check :5221 and :8453 are free and inspect existing Tailscale routes
first; never overwrite someone else's service/config or reset Serve.
For a different Factory instance, choose distinct proxy/service/HTTPS ports
and change the upstream :5220 in the template.

```bash
tailscale serve status
ss -ltn '( sport = :5221 or sport = :8453 )'
caddy validate --config ops/Caddyfile --adapter caddyfile
mkdir -p ~/.config/boring-factory ~/.config/systemd/user
# Refuse to overwrite existing installation files; review existing ones first.
cp -n ops/Caddyfile ~/.config/boring-factory/Caddyfile
cp -n ops/boring-factory-proxy.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now boring-factory-proxy.service
sudo tailscale serve --bg --https=8453 http://127.0.0.1:5221
```

Use the **HTTPS URL printed by Tailscale** and bookmark it in place of the
raw IP/HTTP URL. Existing HTTP tabs still use the old connection pool;
close those tabs after opening the new address. Origin-scoped local UI
preferences do not migrate; server-owned sessions and Inbox remain the
same. The old HTTP listener is deliberately left untouched because Vite
and the agent host share a process and restarting it interrupts live work.

Both Serve's `--bg` mapping and the enabled proxy unit persist. On hosts
whose user manager stops at logout, arrange user lingering with the host
owner; this setup does not change that policy. It does not supervise or
restart the existing Factory process.

## Verification

From the repository root, with its Playwright dependency/browser installed:

```bash
URL=https://YOUR-TAILNET-DNS-NAME:8453/
curl --http2 -fsS -o /dev/null -w '%{http_version}\n' "$URL" # must print 2
node apps/factory-playground/scripts/check-multitab-transport.mjs "$URL"
```

The browser check keeps four tabs in **one browser context**, waits for
workspace state and all four stream kinds, rejects loading placeholders and
JS errors, checks actual API negotiation is `h2`, and tracks CDP request IDs
to require all 16 channels to stay live before and after the final API probes.
`readyMs` measures workspace readiness; `streamsReadyMs` also waits for the
filesystem stream's first flushed heartbeat (up to 25 seconds when idle). It does not
send prompts or answer Inbox cards. Never use `networkidle` as the ready
condition for an app with persistent streams.

Also manually verify Inbox artifacts and live chat updates. HTTP/2 removes
connection starvation, not CPU-heavy API handlers; #1563 addresses that
separate cause.

## Rollback (proxy only)

```bash
sudo tailscale serve --https=8453 off
systemctl --user disable --now boring-factory-proxy.service
```

This leaves every other Serve route, the Factory host, its worker turns,
and all data untouched. Retain the configuration files for inspection.
Raw :5220 remains available, with its original HTTP/1.1 multi-tab limit.
