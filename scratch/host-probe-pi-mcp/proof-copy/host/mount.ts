// The host: `mountApp(definition, assets, url)` is the whole input. It makes the Worker (Better Auth on D1, the Api over HTTP and MCP, the
// page, each person's agent home, files when `needs` says so). It reads the definition and names no app: grep this folder for one.
import { CloudflareD1 } from "@alchemy.run/better-auth/CloudflareD1";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as DomainAi from "@alchemy.run/domain/Ai";
import * as DomainCloudflare from "@alchemy.run/domain/Cloudflare";
import * as DomainHttp from "@alchemy.run/domain/Http";
import { Stage } from "alchemy";
import { McpProtocol, McpServer } from "effect/ai";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as Etag from "effect/http/Etag";
import * as HttpPlatform from "effect/http/HttpPlatform";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HSR from "effect/http/HttpServerRequest";
const { HttpServerRequest } = HSR;
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import type { AppDefinition } from "../contract/define-app.ts";
import { linkBases, linkConfig, routeConfig, routeEnv } from "./agents/env.ts";
import { makeHome } from "./agents/home.ts";
import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { Auth, AuthLive, SCOPES } from "./auth.ts";
import { SPIKE } from "./config.ts";
import { DOOR_HEADER, SessionLive } from "./session.ts";
import { workerProps } from "./stage.ts";

/** What the build step (host/gen.mjs) reads from the app's folder: the page as one HTML string and the skills as text. */
export type Assets = { page: string; skills: Record<string, Record<string, string>> };
const json = (body: unknown, status = 200) => HttpServerResponse.text(JSON.stringify(body), { status, contentType: "application/json" });
const LARGE = 256 * 1024;
const sha256 = async (b: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", b as BufferSource)), (x) => x.toString(16).padStart(2, "0")).join("");

export const mountApp = (def: AppDefinition, assets: Assets, url: string) => {
  // @ts-ignore: a class made inside the function cannot name itself in its own base type
  class AgentHome extends Cloudflare.DurableObject<AgentHome>()("AgentHome") {}
  const files = def.needs?.includes("files");
  const AuthDb = Cloudflare.D1.Database("AuthDb");
  const Files = files ? Cloudflare.R2.Bucket("Files", { forceDestroy: true }) : undefined;

  // each reader's wake: the model's Policy gets the handler that wakes the owner's home (at least once; the key dedupes)
  const wakeLayers = (def.wakes ?? []).map((w) => w.policy.toLayer(Effect.succeed(({ source, event }: any) => Effect.gen(function* () {
    const { env } = (yield* Effect.promise(() => import("cloudflare:workers"))) as any;
    const homes = Object.entries(env).find(([k]) => k.includes("AgentHome"))?.[1] as any;
    yield* Effect.promise(() => homes.getByName(String(source.id)).wake(w.agent, w.key(event), w.message(event)));
  })) as never, { retry: Schedule.recurs(2) }));
  const models = (Layer.mergeAll as any)(...def.models.map((m) => m.layer(Layer.mergeAll(def.handlers, ...wakeLayers)))) as Layer.Layer<any, any, any>;
  const platform = models.pipe(Layer.provide(DomainCloudflare.layerDurableObjects()));
  const AgentHomeLive = makeHome(AgentHome, def, { skills: assets.skills, platform, route: routeEnv, heartbeatMs: 10_000, links: linkBases(def.links) });

  const ServerLive = SessionLive.pipe(Layer.provideMerge(AuthLive), Layer.provideMerge(models), Layer.provide(Layer.mergeAll(DomainCloudflare.layerDurableObjects(), CloudflareD1(AuthDb))));
  const Http = DomainHttp.toHttpApi(def.api as never, { expose: def.expose.page as never });
  const Mcp = DomainAi.toMcp(def.api as never, { expose: (def.expose.mcp ?? []) as never }).pipe(
    Layer.provide(McpServer.layerHttpRequestScoped({ name: def.name, version: "0.0.1", path: "/mcp", protocols: [McpProtocol.v2026_07_28] } as never)));

  class AppWorker extends Cloudflare.Worker<AppWorker>()("AppWorker", workerProps({ name: def.name, prefix: `${SPIKE}-${def.name}` }, url, { dev: { port: Number(process.env.PORT ?? 1338) } }) as never, Effect.gen(function* () {
    const auth = yield* Auth;
    const api = yield* (def.api as never as Effect.Effect<{ fetch: Effect.Effect<HttpServerResponse.HttpServerResponse, never, never> }>);
    const http = yield* HttpRouter.toHttpEffect(HttpApiBuilder.layer((Http as any).api).pipe(Layer.provide((Http as any).layer), Layer.provide([HttpPlatform.layer, Etag.layer])));
    const mcp = yield* HttpRouter.toHttpEffect(Mcp as never);
    const homes: any = yield* AgentHome;
    const bucket: any = Files ? yield* Cloudflare.R2.ReadWriteBucket(Files) : undefined;
    const credentials = yield* routeConfig;
    yield* linkConfig(Object.keys(def.links ?? {}));
    const commit = yield* Config.String("BORING_COMMIT").pipe(Config.withDefault("unknown"));
    const stage = yield* Stage;
    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest;
        const url = new URL(request.url, "http://localhost"), path = url.pathname;
        const host = request.headers["x-forwarded-host"] ?? request.headers.host ?? "localhost", proto = request.headers["x-forwarded-proto"] ?? (/^(localhost|127\.)/.test(host) ? "http" : "https");
        const origin = `${proto}://${host}`;
        const ba: any = yield* auth.auth;
        if (path !== "/mcp" && request.headers[DOOR_HEADER]) return json({ error: "reserved header" }, 400);
        if (path === "/health") return json({ ok: true, app: def.name, stage, commit, credentials });
        if (path.startsWith("/api/auth/")) return yield* auth.fetch;
        // the door's address book for a stock OAuth client (RFC 9728, RFC 8414): where to send the person, which server asks them
        if (def.expose.mcp?.length && path.startsWith("/.well-known/oauth-protected-resource")) return json({ resource: `${origin}/mcp`, resource_name: def.title, authorization_servers: [`${origin}/api/auth`], scopes_supported: SCOPES, bearer_methods_supported: ["header"] });
        if (def.expose.mcp?.length && path.startsWith("/.well-known/oauth-authorization-server")) return HttpServerResponse.fromWeb(yield* Effect.promise(async () => oauthProviderAuthServerMetadata(ba)(new Request(`${origin}${path}`))));
        if (path === "/mcp") {
          // the door says who is calling by one header only the Worker sets; a call with no person at all is a 401 that points to the OAuth discovery
          const h = new Headers(request.headers as Record<string, string>); h.set(DOOR_HEADER, "mcp");
          if (h.get("mcp-method") === "tools/call") {
            const who = (yield* auth.getSession(h).pipe(Effect.orDie)) ?? (/^Bearer /i.test(h.get("authorization") ?? "") ? yield* Effect.promise(() => ba.api.oauth2UserInfo({ headers: h }).then((u: any) => u, () => null)) : null);
            if (!who) return HttpServerResponse.text(JSON.stringify({ error: "unauthorized" }), { status: 401, contentType: "application/json", headers: { "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"` } });
          }
          const web = yield* HSR.toWeb(request).pipe(Effect.orDie);
          return yield* (mcp as never as Effect.Effect<HttpServerResponse.HttpServerResponse>).pipe(Effect.provideService(HSR.HttpServerRequest, HSR.fromWeb(new Request(web, { headers: h }))));
        }
        if (path.startsWith("/agent/") || path.startsWith("/_files/") || path.startsWith("/_link/")) {
          const session = yield* auth.getSession(new Headers(request.headers as Record<string, string>)).pipe(Effect.orDie);
          if (session === null) return HttpServerResponse.text("Unauthorized", { status: 401 });
          const me = session.user.id, home = homes.getByName(me);
          // the MCP link: this person's side of it (`/_link/<id>/...`, what this app's agents need) and the other side (what other apps may do for them here)
          const link = /^\/_link\/([a-z0-9]+)\/(start|callback)$/.exec(path);
          if (link && def.links?.[link[1]!]) {
            const bounce = (to: string) => HttpServerResponse.empty({ status: 302 }).pipe(HttpServerResponse.setHeader("location", to));
            if (link[2] === "start") { const r = yield* home.linkStart(link[1], origin); return r.ok ? bounce(r.url) : json({ error: r.error }, 502); }
            const code = url.searchParams.get("code"), st = url.searchParams.get("state");
            if (!code || !st) return bounce(`/?link_error=${encodeURIComponent(url.searchParams.get("error") ?? "refused")}`);
            const r = yield* home.linkFinish(link[1], code, st);
            return bounce(r.ok ? `/?linked=${link[1]}` : `/?link_error=${encodeURIComponent(r.error)}`);
          }
          if (path === "/agent/links") {
            const db: any = (yield* Effect.promise(() => ba.$context) as any).adapter;
            const consents = (yield* Effect.promise(() => db.findMany({ model: "oauthConsent", where: [{ field: "userId", value: me }] }))) as any[];
            const incoming = yield* Effect.promise(() => Promise.all(consents.map(async (c: any) => ({ clientId: c.clientId, name: (await db.findOne({ model: "oauthClient", where: [{ field: "clientId", value: c.clientId }] }))?.name ?? c.clientId, scopes: c.scopes, since: c.createdAt }))));
            const status = yield* home.linkStatus();
            return json({ outgoing: Object.entries(def.links ?? {}).map(([id, l]) => ({ id, title: l.title, ...(status as any)[id] })), incoming });
          }
          if (path === "/agent/links/revoke" && request.method === "POST") {
            // remove an app's right to act for this person here: its tokens and the consent (the next call of that app is refused, no redeploy)
            const { clientId } = (yield* request.json) as { clientId: string };
            const db: any = (yield* Effect.promise(() => ba.$context) as any).adapter, where = [{ field: "userId", value: me }, { field: "clientId", value: clientId }];
            for (const model of ["oauthAccessToken", "oauthRefreshToken", "oauthConsent"]) yield* Effect.promise(() => db.deleteMany({ model, where }));
            return json({ ok: true });
          }
          if (path === "/agent/me") return json({ id: me, email: session.user.email });
          if (path === "/agent/kit") return yield* home.fetch(request);
          if (path === "/agent/upload" && request.method === "POST" && bucket) {
            const { name, text } = (yield* request.json) as { name: string; text: string };
            if (!/^[\w.\- ]{1,80}$/.test(name)) return json({ error: "nom de fichier refusé" }, 400);
            const bytes = new TextEncoder().encode(text);
            if (bytes.byteLength <= LARGE) return json({ ...(yield* home.saveFile(name, text)), name, stored: "workspace" });
            const sha = yield* Effect.promise(() => sha256(bytes)), id = `${me}/${sha}`;
            yield* bucket.put(id, bytes);
            const pointer = { "boring:blob": 1, id, sha256: sha, size: bytes.byteLength, type: "text/plain", name };
            return json({ ...(yield* home.saveFile(`${name}.blob.json`, JSON.stringify(pointer))), name, stored: "r2", size: bytes.byteLength });
          }
          if (path.startsWith("/_files/") && bucket) {
            const id = decodeURIComponent(path.slice(8));
            if (!id.startsWith(`${me}/`)) return HttpServerResponse.text("not found", { status: 404 });
            const o = yield* bucket.get(id);
            return o ? HttpServerResponse.text(yield* o.text(), { contentType: "text/plain" }) : HttpServerResponse.text("not found", { status: 404 });
          }
          if (stage !== "production" && path === "/agent/info") return json(yield* home.info());
          if (stage !== "production" && /^\/agent\/link-expire\/[a-z0-9]+$/.test(path)) return json(yield* home.linkExpire(path.split("/")[3]!));
          return HttpServerResponse.text("not found", { status: 404 });
        }
        if (path.startsWith("/api/")) return yield* api.fetch;
        if (path === "/" || path === "/consent") return HttpServerResponse.html(assets.page);
        return yield* (http as never as Effect.Effect<HttpServerResponse.HttpServerResponse>);
      }),
    };
  }).pipe(Effect.provide(Layer.mergeAll(ServerLive, AgentHomeLive as never, ...(files ? [Cloudflare.R2.ReadWriteBucketBinding] : []), Cloudflare.SecretsStore.ReadSecretBinding) as never)) as never) {}
  return AppWorker;
};
