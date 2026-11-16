# host-probe-pi-mcp (scratch, never merged)

Base: `origin/host-contract` at `6cb216afb` (plain `npm ci`, no flag; pinned `@earendil-works/pi-mcp` 1.5.2, effect 4.1.4, wrangler 4.156.0).

Run: `node scratch/host-probe-pi-mcp/probe/pi-mcp.mjs` (starts the door on :8801 and the caller on :8802 under `wrangler dev --local`, prints one block per piece, stops both by pid).

- `door/` stand-in door. Real: effect's `McpServer.layerHttpRequestScoped` with `McpProtocol.v2026_07_28` only. Stand-in: the OAuth server and two plain tools.
- `caller/` the Workers bundle (one Durable Object) that runs pi-mcp's public exports.
- `proof-copy/` read-only copy of the MCP proof's sources (`/var/tmp/boring-studio-work/p0-mcp` at `081bf1e`: contract, todo app, host/*.ts). Not run: `npm install` of `@alchemy.run/better-auth`, `@alchemy.run/cloudflare`, `better-auth` 1.7.7 and `@better-auth/oauth-provider` 1.7.7 on this base is refused (ERESOLVE, `@sveltejs/kit` peer: optional `^2` of better-auth against `>=3` of Alchemy's frontend-frameworks), so the real door could not be started.
