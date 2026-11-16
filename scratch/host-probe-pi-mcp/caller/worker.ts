// The caller: a Worker with one Durable Object (the person's home) that runs each piece of @earendil-works/pi-mcp 1.5.2 inside the Workers
// bundle, against the door at env.DOOR. Public imports only: "@earendil-works/pi-mcp" and "@earendil-works/pi-mcp/oauth".
import { McpClient, StreamableHttpTransport, type McpFetch } from "@earendil-works/pi-mcp";
import {
  completeMcpSignIn, createMcpAuthProvider, discoverOAuthServerInfo, McpRefreshLockBusyError, responseFromRedirectUrl, startMcpSignIn,
  type McpOAuthServerStore, type McpOAuthState,
} from "@earendil-works/pi-mcp/oauth";
import { DurableObject } from "cloudflare:workers";

interface Env { DOOR: string; HOME_DO: DurableObjectNamespace }
const REDIRECT = "https://caller.example.test/mcp/callback"; // https, registered with the door, never followed
const META = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientInfo": { name: "boring-link-probe", version: "0" }, "io.modelcontextprotocol/clientCapabilities": {} };
const err = (e: unknown) => { const x = e as Error; return { name: x?.name, message: String(x?.message ?? e).slice(0, 400), stack: String(x?.stack ?? "").split("\n").slice(0, 4).join(" | ") }; };

/** An `McpOAuthServerStore` over the Durable Object's `storage.kv`: state under one key, the refresh lock a promise chain in the object. */
class KvStore implements McpOAuthServerStore {
  private tail: Promise<unknown> = Promise.resolve();
  readonly lockEvents: string[] = [];
  constructor(private kv: SyncKvStorage, private key: string) {}
  load(): McpOAuthState | undefined { return this.kv.get<McpOAuthState>(this.key); }
  save(state: McpOAuthState): void { this.kv.put(this.key, state); }
  withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(async () => { this.lockEvents.push("in"); try { return await fn(); } finally { this.lockEvents.push("out"); } });
    this.tail = run.catch(() => undefined);
    return run;
  }
}

/** Every call the piece makes through the injected fetch, one line each. */
const spy = (log: string[], inner: McpFetch = (u, i) => fetch(u, i)): McpFetch => async (input, init) => {
  const body = typeof init?.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : null;
  const r = await inner(input, init);
  let text = ""; try { text = (await r.clone().text()).replace(/\s+/g, " ").slice(0, 150); } catch {}
  log.push(`${init?.method ?? "GET"} ${new URL(String(input)).pathname} ${body?.method ?? ""} -> ${r.status} ${text.replace(/(at|rt)_[0-9a-f]{8}[0-9a-f]+/g, "$1_…")}`);
  return r;
};
/** The proof's "try 3": the door has no `initialize` and wants the headers and `_meta` of 2026-07-28 on every request. */
const stateless = (inner: McpFetch): McpFetch => async (input, init) => {
  const h = new Headers(init?.headers); let body = init?.body;
  const j = typeof body === "string" && body.startsWith("{") ? JSON.parse(body) : null;
  if (j?.method === "initialize") return Response.json({ jsonrpc: "2.0", id: j.id, result: { protocolVersion: j.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "door", version: "0" } } });
  if (j?.method === "notifications/initialized") return new Response(null, { status: 202 });
  if (j?.method) { h.set("mcp-protocol-version", "2026-07-28"); h.set("mcp-method", j.method); if (j.params?.name) h.set("mcp-name", j.params.name); j.params = { ...(j.params ?? {}), _meta: { ...(j.params?._meta ?? {}), ...META } }; body = JSON.stringify(j); }
  return inner(input, { ...init, headers: h, body });
};

export class Home extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url), piece = url.pathname.replace(/^\/probe\//, "");
    const door = this.env.DOOR, mcpUrl = `${door}/mcp`, kv = this.ctx.storage.kv;
    const token = async () => ((await (await fetch(`${door}/_test/token`)).json()) as { access_token: string }).access_token;
    const out: Record<string, unknown> = { piece };
    try {
      if (piece === "loaded") {
        out.ok = true; out.exports = { McpClient: typeof McpClient, StreamableHttpTransport: typeof StreamableHttpTransport, startMcpSignIn: typeof startMcpSignIn, createMcpAuthProvider: typeof createMcpAuthProvider };
        out.buffer = typeof Buffer; out.processVersions = typeof (globalThis as any).process?.versions;
      }
      if (piece.startsWith("client")) {
        const mode = piece.split("/")[1]; // asis | protocolOption | adapted
        const log: string[] = [], t = await token();
        const inner = mode === "adapted" ? stateless(spy(log)) : spy(log);
        const client = new McpClient({ name: "boring-link-probe", version: "0", ...(mode === "protocolOption" ? { protocolVersion: "2026-07-28" } : {}) });
        const transport = new StreamableHttpTransport({ url: mcpUrl, headers: { authorization: `Bearer ${t}` }, fetch: inner });
        out.mode = mode;
        try {
          const init = await client.connect(transport);
          out.handshake = { ok: true, protocolVersion: init.protocolVersion, serverInfo: init.serverInfo };
          const tools = await client.listTools(); out.tools = tools.map((x) => x.name);
          const call = await client.callTool("TodoApi_Todos_get", { key: "u1" }); out.call = JSON.stringify(call).slice(0, 200);
          out.fetchCalls = log.length;
        } catch (e) { out.handshake = { ok: false, error: err(e) }; }
        out.wire = log;
        await client.close().catch(() => undefined);
      }
      if (piece === "discovery") {
        const log: string[] = [];
        const info = await discoverOAuthServerInfo(mcpUrl, { fetch: spy(log) });
        out.ok = true; out.issuer = info.authorizationServerMetadata?.issuer; out.authorizationServerUrl = info.authorizationServerUrl;
        out.registration = info.authorizationServerMetadata?.registration_endpoint; out.resource = info.resourceMetadata?.resource; out.wire = log;
        // the 401 path: a call with no token, the transport's own discovery by the challenge
        const r = await fetch(mcpUrl, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/call", "mcp-name": "TodoApi_Todos_get" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "TodoApi_Todos_get", arguments: { key: "u1" }, _meta: META } }) });
        out.challenge = { status: r.status, www: r.headers.get("www-authenticate") };
      }
      if (piece === "signin") {
        const store = new KvStore(kv, "signin");
        const signIn = { serverUrl: mcpUrl, store, settings: {}, redirectUrl: REDIRECT, clientName: "boring-link probe" };
        const started = await startMcpSignIn(signIn);
        out.started = started.kind === "redirect" ? { kind: "redirect", authorizationUrl: started.authorizationUrl.replace(/(code_challenge|state)=[^&]+/g, "$1=…"), redirectUrl: started.redirectUrl, scope: started.scope } : started;
        if (started.kind === "redirect") {
          const r = await fetch(started.authorizationUrl, { redirect: "manual" }); // the stand-in answers 302 to the https redirect URI; never followed
          const location = r.headers.get("location") ?? "";
          out.authorize = { status: r.status, location: location.replace(/(code|state)=[^&]+/g, "$1=…") };
          const response = responseFromRedirectUrl(location, started);
          await completeMcpSignIn({ ...signIn, authorization: started, response });
          const st = store.load();
          out.stored = { hasAccess: !!st?.tokens?.access_token, hasRefresh: !!st?.tokens?.refresh_token, expiresIn: st?.tokensExpireAt ? Math.round((st.tokensExpireAt - Date.now()) / 1000) : null, clientRegistered: !!st?.clientInformation };
          const log: string[] = [];
          const client = new McpClient({ name: "boring-link-probe", version: "0" });
          await client.connect(new StreamableHttpTransport({ url: mcpUrl, headers: { authorization: `Bearer ${st!.tokens!.access_token}` }, fetch: stateless(spy(log)) }));
          const call = await client.callTool("TodoApi_Todos_get", { key: "u1" });
          out.bearerCall = JSON.stringify(call).slice(0, 160); out.wire = log.slice(-2);
          await client.close().catch(() => undefined);
          out.ok = true;
        }
      }
      if (piece === "refresh401") {
        // the door forgets the access token (a restart, a revoked grant): the transport's 401 goes to pi-mcp's auth provider, which refreshes once for two calls
        const store = new KvStore(kv, "r401");
        const signIn = { serverUrl: mcpUrl, store, settings: {}, redirectUrl: REDIRECT, clientName: "boring-link probe" };
        const started = await startMcpSignIn(signIn);
        if (started.kind !== "redirect") throw new Error("expected a redirect");
        const loc = (await fetch(started.authorizationUrl, { redirect: "manual" })).headers.get("location") ?? "";
        await completeMcpSignIn({ ...signIn, authorization: started, response: responseFromRedirectUrl(loc, started) });
        const first = store.load()!.tokens!.access_token;
        await fetch(`${door}/_revoke_access`); await fetch(`${door}/_reset`);
        const log: string[] = [];
        const auth = createMcpAuthProvider({ serverUrl: mcpUrl, store, settings: () => ({}), clientName: "boring-link probe", onChallenge: () => {}, redirectUrl: REDIRECT });
        const client = new McpClient({ name: "boring-link-probe", version: "0" });
        await client.connect(new StreamableHttpTransport({ url: mcpUrl, authProvider: auth, fetch: stateless(spy(log)) }));
        const [r1, r2] = await Promise.all([client.callTool("TodoApi_Todos_get", { key: "u1" }), client.callTool("TodoApi_AddTodo_send", { text: "probe" })]);
        const stats = (await (await fetch(`${door}/_stats`)).json()) as Record<string, number>;
        out.bothAnswered = !!r1 && !!r2; out.tokenRequests = stats.tokenRefresh; out.refreshReused = stats.refreshReused; out.replaced = store.load()!.tokens!.access_token !== first;
        out.wire = log.map((l) => l.slice(0, 90)); out.ok = out.bothAnswered && stats.tokenRefresh === 1;
        await client.close().catch(() => undefined);
      }
      if (piece === "lock") {
        // two callers of the same store (two requests, or two processes with a shared store) both find the access token expired and 401
        const store = new KvStore(kv, "lock");
        const signIn = { serverUrl: mcpUrl, store, settings: {}, redirectUrl: REDIRECT, clientName: "boring-link probe" };
        await fetch(`${door}/_ttl?s=5`);
        const started = await startMcpSignIn(signIn);
        if (started.kind !== "redirect") throw new Error("expected a redirect");
        const loc = (await fetch(started.authorizationUrl, { redirect: "manual" })).headers.get("location") ?? "";
        await completeMcpSignIn({ ...signIn, authorization: started, response: responseFromRedirectUrl(loc, started) });
        await fetch(`${door}/_ttl?s=3600`);
        const before = store.load()!; const refreshBefore = before.tokens!.refresh_token;
        await fetch(`${door}/_reset`);
        const mk = () => createMcpAuthProvider({ serverUrl: mcpUrl, store, settings: () => ({}), clientName: "boring-link probe", onChallenge: () => {}, redirectUrl: REDIRECT });
        const a = mk(), b = mk();
        const t0 = Date.now();
        const [ta, tb] = await Promise.all([a.token(), b.token()]);
        const stats = (await (await fetch(`${door}/_stats`)).json()) as Record<string, number>;
        const after = store.load()!;
        out.expiredBefore = before.tokensExpireAt! - 30_000 <= Date.now();
        out.tokenRequests = stats.tokenRefresh; out.refreshReused = stats.refreshReused; out.ms = Date.now() - t0;
        out.sameTokenForBoth = ta === tb; out.rotated = after.tokens!.refresh_token !== refreshBefore; out.lockEvents = store.lockEvents.join(",");
        out.ok = stats.tokenRefresh === 1 && stats.refreshReused === 0 && ta === tb;
        // and after an eviction of the object: the lock is a promise chain in memory, the tokens are in kv
        out.note = "the lock lives in the object's memory; tokens in storage.kv";
      }
    } catch (e) { out.ok = false; out.error = err(e); }
    return Response.json(out);
  }
}
void McpRefreshLockBusyError;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/probe/")) return Response.json({ ok: true });
    return env.HOME_DO.get(env.HOME_DO.idFromName(url.searchParams.get("home") ?? "home")).fetch(request);
  },
};
