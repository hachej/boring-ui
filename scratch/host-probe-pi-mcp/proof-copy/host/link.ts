// GENERIC (to move into @hachej/boring-agent/alchemy): the calling side of the MCP link. An app's agent acts in another app's MCP door as the
// same person. The person agrees once at the other app (standard OAuth 2.1: discovery, dynamic client registration, authorization code with
// PKCE, refresh). The credential lives in the person's own home (`kv`), is read only here, and is never given to the model: a tool gets the
// remote answer or a refusal sentence. Knows no app: a link is an id, a title and a base address from the deploy.
export type Kv = { get(k: string): Promise<any>; put(k: string, v: unknown): Promise<void>; delete(k: string): Promise<unknown> };
type Cred = { clientId: string; access: string; refresh?: string; expiresAt: number; user: string; email?: string; since: string };
export type RemoteTool = { name: string; description?: string; inputSchema: Record<string, unknown> };
export type Reply = { text: string; isError: boolean };

const META = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientInfo": { name: "boring-link", version: "0" }, "io.modelcontextprotocol/clientCapabilities": {} };
const b64url = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
const rand = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
export const sha256Hex = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (x) => x.toString(16).padStart(2, "0")).join("");
const form = (o: Record<string, string>) => ({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: new URLSearchParams(o).toString() });
const json = async (url: string, init?: RequestInit) => { const r = await fetch(url, init); const j: any = await r.json().catch(() => ({})); return { status: r.status, j }; };

const metas = new Map<string, any>();
/** RFC 9728 then RFC 8414: the door says which server asks the person, the server says its endpoints. */
const discover = async (base: string) => {
  if (metas.has(base)) return metas.get(base);
  const prm = await json(`${base}/.well-known/oauth-protected-resource/mcp`);
  const issuer = new URL(prm.j.authorization_servers?.[0] ?? "");
  const meta = await json(`${issuer.origin}/.well-known/oauth-authorization-server${issuer.pathname === "/" ? "" : issuer.pathname}`);
  if (!meta.j.authorization_endpoint) throw new Error(`link: ${base} has no OAuth discovery`);
  metas.set(base, meta.j);
  return meta.j;
};

export const startUrl = (origin: string, id: string) => `${origin}/_link/${id}/start`;
const sentence = (why: "unlinked" | "revoked", title: string, url: string) => (why === "unlinked"
  ? `Cette personne n'a pas relié son compte « ${title} ». Rien n'a été fait. Invite-la à ouvrir ${url} pour le relier (une fois), puis recommence.`
  : `Le lien avec « ${title} » a été retiré du côté « ${title} ». Rien n'a été fait. Invite la personne à ouvrir ${url} pour le relier de nouveau.`);

/** The browser goes to this address: the other app's sign-in and « agree » page, then back to `/_link/<id>/callback`. */
export const start = async (kv: Kv, id: string, base: string, origin: string, clientName: string) => {
  const meta = await discover(base), redirect = `${origin}/_link/${id}/callback`;
  let reg = await kv.get(`link:${id}:client`);
  if (reg?.redirect !== redirect || reg?.base !== base) {
    const r = await json(meta.registration_endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: clientName, redirect_uris: [redirect], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none", application_type: redirect.startsWith("https:") ? "web" : "native", scope: "openid offline_access" }) });
    if (!r.j.client_id) throw new Error(`link: registration refused (${r.status})`);
    reg = { clientId: r.j.client_id, redirect, base }; await kv.put(`link:${id}:client`, reg);
  }
  const verifier = rand(), state = rand();
  await kv.put(`link:${id}:pending`, { state, verifier, clientId: reg.clientId, redirect, token: meta.token_endpoint, userinfo: meta.userinfo_endpoint, at: Date.now() });
  const u = new URL(meta.authorization_endpoint);
  for (const [k, v] of Object.entries({ response_type: "code", client_id: reg.clientId, redirect_uri: redirect, scope: "openid offline_access", state, code_challenge: b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))), code_challenge_method: "S256" })) u.searchParams.set(k, v);
  return u.toString();
};

/** The browser came back with a code: exchange it, keep the credential for this person. */
export const finish = async (kv: Kv, id: string, code: string, state: string) => {
  const p = await kv.get(`link:${id}:pending`);
  if (!p || p.state !== state || Date.now() - p.at > 600_000) throw new Error("link: unknown or expired request");
  await kv.delete(`link:${id}:pending`);
  const t = await json(p.token, form({ grant_type: "authorization_code", code, redirect_uri: p.redirect, client_id: p.clientId, code_verifier: p.verifier }));
  if (!t.j.access_token) throw new Error(`link: the other app refused the code (${t.status} ${t.j.error ?? ""})`);
  const me = (await json(p.userinfo, { headers: { authorization: `Bearer ${t.j.access_token}` } })).j;
  const cred: Cred = { clientId: p.clientId, access: t.j.access_token, refresh: t.j.refresh_token, expiresAt: Date.now() + (t.j.expires_in ?? 3600) * 1000, user: String(me.sub), email: me.email, since: new Date().toISOString() };
  await keep(kv, id, cred); await kv.delete(`link:${id}:gone`);
  return { user: cred.user, email: cred.email };
};

export const status = async (kv: Kv, id: string) => { const c: Cred | undefined = await kv.get(`link:${id}`); return c ? { linked: true, user: c.user, email: c.email, since: c.since } : { linked: false, gone: (await kv.get(`link:${id}:gone`)) ?? undefined }; };
export const forget = async (kv: Kv, id: string) => { await kv.delete(`link:${id}`); };
/** Debug on non-production stages: a fingerprint of the stored credentials, never the credentials. */
/** Stores a credential, and keeps a ledger of the first 16 hex of the SHA-256 of every token ever stored (never a value), so a check can tell whether any of them leaked. */
const keep = async (kv: Kv, id: string, c: Cred) => {
  await kv.put(`link:${id}`, c);
  const seen: string[] = (await kv.get(`link:${id}:seen`)) ?? [];
  for (const t of [c.access, c.refresh]) if (t) { const f = (await sha256Hex(t)).slice(0, 16); if (!seen.includes(f)) seen.push(f); }
  await kv.put(`link:${id}:seen`, seen.slice(-40));
};
export const fingerprints = async (kv: Kv, id: string) => ((await kv.get(`link:${id}:seen`)) as string[] | undefined) ?? [];

const gone = async (kv: Kv, id: string, why: string) => { await kv.delete(`link:${id}`); await kv.put(`link:${id}:gone`, { at: new Date().toISOString(), why }); };
/** Refreshes run one at a time for a person: a refresh token is good once, so a second caller joins the one in flight instead of spending it again. */
const flights = new WeakMap<Kv, Map<string, Promise<string | null>>>();
const refresh = (kv: Kv, id: string, base: string): Promise<string | null> => {
  const m = flights.get(kv) ?? new Map<string, Promise<string | null>>(); flights.set(kv, m);
  let p = m.get(id);
  if (!p) { p = (async () => {
    const c: Cred | undefined = await kv.get(`link:${id}`);
    if (!c) return null;
    if (!c.refresh) { await gone(kv, id, "expired"); return null; }
    const t = await json((await discover(base)).token_endpoint, form({ grant_type: "refresh_token", refresh_token: c.refresh, client_id: c.clientId }));
    if (t.status >= 500) throw new Error(`link: ${base} unavailable (${t.status})`);
    if (!t.j.access_token) { await gone(kv, id, t.j.error ?? `refused ${t.status}`); return null; }
    await keep(kv, id, { ...c, access: t.j.access_token, refresh: t.j.refresh_token ?? c.refresh, expiresAt: Date.now() + (t.j.expires_in ?? 3600) * 1000 });
    return t.j.access_token as string;
  })().finally(() => m.delete(id)); m.set(id, p); }
  return p;
};
/** A valid access token, refreshed when it is about to expire (`force` after a 401). null: no credential, or the other app no longer honours it. */
const access = async (kv: Kv, id: string, base: string, force = false): Promise<string | null> => {
  const c: Cred | undefined = await kv.get(`link:${id}`);
  if (!c) return null;
  if (!force && c.expiresAt - 30_000 > Date.now()) return c.access;
  return refresh(kv, id, base);
};

const rpc = async (base: string, token: string | null, method: string, params: object) => {
  const name = (params as any).name as string | undefined;
  const r = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2026-07-28", "mcp-method": method, ...(name ? { "mcp-name": name } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: { ...params, _meta: META } }) });
  const text = await r.text(), body = r.headers.get("content-type")?.includes("event-stream") ? (text.split("\n").find((l) => l.startsWith("data:"))?.slice(5) ?? "{}") : text;
  return { status: r.status, j: (() => { try { return JSON.parse(body); } catch { return {}; } })() };
};

/** The tools of the other app's door (its `expose.mcp`); the list is open, only a call needs the person. */
export const listTools = async (base: string): Promise<RemoteTool[]> => (await rpc(base, null, "tools/list", {})).j.result?.tools ?? [];

/** What to tell about a person who has no working link: never linked, or linked and then removed on the other side. */
export const refusal = async (kv: Kv, id: string, title: string, origin: string): Promise<Reply> => ({ text: sentence((await kv.get(`link:${id}:gone`)) ? "revoked" : "unlinked", title, startUrl(origin, id)), isError: true });

/** Is the link alive: the other app's own userinfo answers for this credential now (a removed link answers 401). The person's key there, or null. */
export const whoami = async (kv: Kv, id: string, base: string): Promise<string | null> => {
  for (const force of [false, true]) {
    const token = await access(kv, id, base, force);
    if (!token) return null;
    const r = await json((await discover(base)).userinfo_endpoint, { headers: { authorization: `Bearer ${token}` } });
    if (r.status === 200 && r.j.sub) return String(r.j.sub);
    if (r.status >= 500) throw new Error(`link: ${base} unavailable (${r.status})`);
  }
  await gone(kv, id, "userinfo 401 after refresh");
  return null;
};

export const timings: number[] = [];
/** One call as the person. A refusal is a sentence the model can relay; the credential never leaves this function. */
export const call = async (kv: Kv, id: string, title: string, base: string, origin: string, tool: string, args: unknown): Promise<Reply> => {
  const t0 = performance.now();
  try { return await callOnce(kv, id, title, base, origin, tool, args); } finally { timings.push(Math.round(performance.now() - t0)); }
};
const callOnce = async (kv: Kv, id: string, title: string, base: string, origin: string, tool: string, args: unknown): Promise<Reply> => {
  let token = await access(kv, id, base);
  if (!token) return refusal(kv, id, title, origin);
  let r = await rpc(base, token, "tools/call", { name: tool, arguments: args });
  if (r.status === 401) { // revoked, or the token is not honoured any more: one refresh, then the person must link again
    const now: Cred | undefined = await kv.get(`link:${id}`);
    token = now && now.access !== token ? now.access : await access(kv, id, base, true); // another call may have refreshed already
    if (!token) return refusal(kv, id, title, origin);
    r = await rpc(base, token, "tools/call", { name: tool, arguments: args });
    if (r.status === 401) { await gone(kv, id, "401 after refresh"); return refusal(kv, id, title, origin); }
  }
  const res = r.j.result;
  if (!res) return { text: `${title}: ${r.j.error?.message ?? `réponse inattendue (${r.status})`}`, isError: true };
  return { text: (res.content ?? []).map((c: any) => c.text ?? "").join("\n"), isError: !!res.isError };
};
