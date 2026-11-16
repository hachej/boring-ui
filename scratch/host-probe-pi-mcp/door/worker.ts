// STAND-IN door. The real door (proof-copy/host/mount.ts: Domain's toMcp + Better Auth's OAuth provider on D1) could not be installed
// (npm refuses @alchemy.run/better-auth + better-auth 1.7.7 on the base: see README.md), so it was not run.
// What is REAL here: the MCP layer, effect 4.1.4's `McpServer.layerHttpRequestScoped` with `McpProtocol.v2026_07_28` only, the same call
// proof-copy/host/mount.ts makes. Its routes, 401 challenge and well-known documents repeat proof-copy/host/mount.ts.
// What is STAND-IN: the OAuth authorization server (register, authorize, token, userinfo) is a few lines of test code with generated
// values, and the tools are two plain ones. Nothing here is secret: every token is random and lives in this isolate's memory.
import { McpProtocol, McpServer, Tool, Toolkit } from "effect/ai";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpRouter from "effect/http/HttpRouter";
import * as Schema from "effect/Schema";

const SCOPES = ["openid", "offline_access"];
let TTL = 3600; // access token lifetime in seconds; `/_ttl?s=5` makes the next tokens count as expired for pi-mcp (it refreshes 30 s early)

const Todos = Tool.make("TodoApi_Todos_get", { description: "The to-dos of a person.", parameters: Schema.Struct({ key: Schema.String }), success: Schema.Struct({ items: Schema.Array(Schema.String) }) });
const Add = Tool.make("TodoApi_AddTodo_send", { description: "Add a to-do.", parameters: Schema.Struct({ text: Schema.String }), success: Schema.Struct({ number: Schema.Number }) });
const tools = Toolkit.make(Todos, Add);
const items: string[] = ["acheter du papier"];
const ToolsLive = tools.toLayer({
  TodoApi_Todos_get: () => Effect.succeed({ items }),
  TodoApi_AddTodo_send: ({ text }: { text: string }) => Effect.sync(() => { items.push(text); return { number: items.length }; }),
} as never);
const McpLive = McpServer.layerHttpRequestScoped({ name: "todo", version: "0.0.1", path: "/mcp", protocols: [McpProtocol.v2026_07_28], registrations: McpServer.toolkit(tools).pipe(Layer.provide(ToolsLive)) } as never);
const web = HttpRouter.toWebHandler(McpLive as never, { disableLogger: true } as never);

const rand = (n = 24) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (x) => x.toString(16).padStart(2, "0")).join("");
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const b64url = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

type Client = { redirect: string[] };
const clients = new Map<string, Client>(), codes = new Map<string, { clientId: string; redirect: string; challenge: string }>();
const access = new Map<string, { sub: string; exp: number }>(), refresh = new Map<string, { sub: string; clientId: string; used: boolean }>();
const stats = { register: 0, authorize: 0, tokenCode: 0, tokenRefresh: 0, refreshReused: 0, userinfo: 0, mcpPosts: 0 };

const issue = (sub: string, clientId: string, old?: string) => {
  const a = `at_${rand()}`, r = `rt_${rand()}`;
  access.set(a, { sub, exp: Date.now() + TTL * 1000 }); refresh.set(r, { sub, clientId, used: false });
  if (old) refresh.get(old)!.used = true;
  return { access_token: a, token_type: "Bearer", expires_in: TTL, refresh_token: r, scope: SCOPES.join(" ") };
};
const who = (req: Request) => { const m = /^Bearer (.+)$/i.exec(req.headers.get("authorization") ?? ""); const t = m && access.get(m[1]!); return t && t.exp > Date.now() ? t : null; };

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url), path = url.pathname, origin = url.origin;
    if (path === "/_stats") return json(stats);
    if (path === "/_reset") { for (const k of Object.keys(stats)) (stats as any)[k] = 0; return json({ ok: true }); }
    if (path === "/_revoke_access") { const n = access.size; access.clear(); return json({ revoked: n }); }
    if (path === "/_ttl") { TTL = Number(url.searchParams.get("s") ?? 3600); return json({ ttl: TTL }); }
    if (path === "/_test/token") return json(issue(url.searchParams.get("as") ?? "u1", "test-client"));
    if (path === "/health") return json({ ok: true, app: "todo-standin" });
    if (path.startsWith("/.well-known/oauth-protected-resource")) return json({ resource: `${origin}/mcp`, resource_name: "Tâches", authorization_servers: [`${origin}/api/auth`], scopes_supported: SCOPES, bearer_methods_supported: ["header"] });
    if (path.startsWith("/.well-known/oauth-authorization-server")) return json({
      issuer: `${origin}/api/auth`, authorization_endpoint: `${origin}/api/auth/oauth2/authorize`, token_endpoint: `${origin}/api/auth/oauth2/token`, registration_endpoint: `${origin}/api/auth/oauth2/register`,
      scopes_supported: SCOPES, response_types_supported: ["code"], response_modes_supported: ["query"], grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"], code_challenge_methods_supported: ["S256"], authorization_response_iss_parameter_supported: true, userinfo_endpoint: `${origin}/api/auth/oauth2/userinfo`,
    });
    if (path === "/api/auth/oauth2/register" && request.method === "POST") {
      stats.register++;
      const body: any = await request.json();
      const clientId = `client_${rand(8)}`; clients.set(clientId, { redirect: body.redirect_uris ?? [] });
      return json({ client_id: clientId, client_id_issued_at: Math.floor(Date.now() / 1000), redirect_uris: body.redirect_uris, grant_types: body.grant_types, response_types: body.response_types, token_endpoint_auth_method: "none", client_name: body.client_name }, 201);
    }
    // stand-in for sign-in + « agree » at the door: the person is `u1`, already signed in and agreed; the browser is sent straight back with a code
    if (path === "/api/auth/oauth2/authorize") {
      stats.authorize++;
      const q = url.searchParams, clientId = q.get("client_id") ?? "", redirect = q.get("redirect_uri") ?? "";
      if (!clients.get(clientId)?.redirect.includes(redirect)) return json({ error: "invalid_redirect_uri" }, 400);
      if (q.get("code_challenge_method") !== "S256" || !q.get("code_challenge")) return json({ error: "invalid_request" }, 400);
      const code = `code_${rand()}`; codes.set(code, { clientId, redirect, challenge: q.get("code_challenge")! });
      const back = new URL(redirect); back.searchParams.set("code", code); if (q.get("state")) back.searchParams.set("state", q.get("state")!); back.searchParams.set("iss", `${origin}/api/auth`); // Better Auth adds iss (RFC 9207)
      return new Response(null, { status: 302, headers: { location: back.toString() } });
    }
    if (path === "/api/auth/oauth2/token" && request.method === "POST") {
      const f = new URLSearchParams(await request.text()), grant = f.get("grant_type");
      if (grant === "authorization_code") {
        stats.tokenCode++;
        const c = codes.get(f.get("code") ?? ""); codes.delete(f.get("code") ?? "");
        if (!c || c.clientId !== f.get("client_id") || c.redirect !== f.get("redirect_uri")) return json({ error: "invalid_grant" }, 400);
        const ok = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(f.get("code_verifier") ?? ""))) === c.challenge;
        return ok ? json(issue("u1", c.clientId)) : json({ error: "invalid_grant", error_description: "pkce" }, 400);
      }
      if (grant === "refresh_token") {
        stats.tokenRefresh++;
        await new Promise((r) => setTimeout(r, 300)); // slow enough for two callers to overlap
        const rt = f.get("refresh_token") ?? "", r = refresh.get(rt);
        if (!r) return json({ error: "invalid_grant" }, 400);
        if (r.used) { stats.refreshReused++; return json({ error: "invalid_grant", error_description: "refresh token already used" }, 400); }
        return json(issue(r.sub, r.clientId, rt));
      }
      return json({ error: "unsupported_grant_type" }, 400);
    }
    if (path === "/api/auth/oauth2/userinfo") { stats.userinfo++; const t = who(request); return t ? json({ sub: t.sub, email: `${t.sub}@example.test` }) : json({ error: "invalid_token" }, 401); }
    if (path === "/mcp") {
      stats.mcpPosts++;
      // the rule of proof-copy/host/mount.ts: a call (not the open list) with no person is a 401 pointing to the discovery
      if (request.headers.get("mcp-method") === "tools/call" && !who(request)) {
        return json({ error: "unauthorized" }, 401, { "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"` });
      }
      return (web.handler as (r: Request) => Promise<Response>)(request);
    }
    return json({ error: "not found" }, 404);
  },
};
