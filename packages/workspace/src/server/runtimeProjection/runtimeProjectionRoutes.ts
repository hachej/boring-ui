import http from "node:http"
import https from "node:https"
import type { IncomingMessage } from "node:http"
import type { Socket } from "node:net"
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import {
  RuntimeProjectionBroker,
  readProjectionCookie,
  type RuntimeProjectionIdentity,
} from "./runtimeProjectionBroker"

const VIEW_PREFIX = "/api/v1/runtime-projection/view/"
const BOOTSTRAP_PREFIX = "/api/v1/runtime-projection/bootstrap/"
const DROP_REQUEST_HEADERS = new Set([
  "authorization", "cookie", "host", "proxy-authorization", "x-forwarded-for",
  "x-forwarded-host", "x-forwarded-proto", "forwarded",
])
const DROP_RESPONSE_HEADERS = new Set([
  "set-cookie", "content-security-policy-report-only", "report-to", "nel",
])

export interface RuntimeProjectionRoutesOptions {
  readonly broker: RuntimeProjectionBroker
  resolveIdentity(request: FastifyRequest): Promise<RuntimeProjectionIdentity>
  resolveUpgradeIdentity(request: IncomingMessage): Promise<RuntimeProjectionIdentity>
}

function safeSuffix(rawUrl: string, prefix: string): { leaseId: string; suffix: string; search: string } | undefined {
  const parsed = new URL(rawUrl, "http://same-origin.invalid")
  if (!parsed.pathname.startsWith(prefix)) return undefined
  const rest = parsed.pathname.slice(prefix.length)
  const slash = rest.indexOf("/")
  const leaseId = slash < 0 ? rest : rest.slice(0, slash)
  const suffix = slash < 0 ? "" : rest.slice(slash)
  try {
    if (!leaseId || suffix.includes("\\") || suffix.split("/").some((part) => decodeURIComponent(part) === "..")) return undefined
  } catch { return undefined }
  return { leaseId, suffix, search: parsed.search }
}

function upstreamTarget(sealed: URL, suffix: string, incomingSearch: string): URL {
  const target = new URL(sealed.toString())
  if (suffix && suffix !== "/") target.pathname = suffix
  const incoming = new URLSearchParams(incomingSearch)
  incoming.delete("grant")
  for (const [key, value] of incoming) target.searchParams.set(key, value)
  target.hash = ""
  return target
}

function requestHeaders(headers: IncomingMessage["headers"]): http.OutgoingHttpHeaders {
  const result: http.OutgoingHttpHeaders = {}
  for (const [name, value] of Object.entries(headers)) {
    if (!DROP_REQUEST_HEADERS.has(name) && value !== undefined) result[name] = value
  }
  return result
}

function sendDenied(socket: Socket, status = "403 Forbidden") {
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
}

export function runtimeProjectionRoutes(
  app: FastifyInstance,
  opts: RuntimeProjectionRoutesOptions,
  done: (error?: Error) => void,
): void {
  app.post(`${BOOTSTRAP_PREFIX}:leaseId`, async (request, reply) => {
    const { leaseId } = request.params as { leaseId: string }
    const body = request.body as { grant?: unknown } | undefined
    const grant = body && Object.keys(body).length === 1 && typeof body.grant === "string" ? body.grant : ""
    const identity = await opts.resolveIdentity(request)
    const consumed = opts.broker.consumeGrant({ leaseId, grant, identity })
    if (!consumed) return reply.code(403).send({ error: "projection_grant_rejected" })
    return reply
      .header("Cache-Control", "private, no-store")
      .header("Set-Cookie", consumed.cookie)
      .send({ url: consumed.location })
  })

  app.all(`${VIEW_PREFIX}:leaseId/*`, async (request, reply) => {
    const parsed = safeSuffix(request.raw.url ?? "", VIEW_PREFIX)
    if (!parsed) return reply.code(400).send({ error: "projection_path_invalid" })
    const identity = await opts.resolveIdentity(request)
    const authorized = opts.broker.authorize({
      leaseId: parsed.leaseId,
      cookie: readProjectionCookie(request.headers.cookie),
      identity,
    })
    if (!authorized) return reply.code(403).send({ error: "projection_rejected" })
    const target = upstreamTarget(authorized.upstream, parsed.suffix, parsed.search)
    const transport = target.protocol === "https:" ? https : target.protocol === "http:" ? http : undefined
    if (!transport) return reply.code(502).send({ error: "projection_upstream_invalid" })

    reply.hijack()
    const upstream = transport.request(target, {
      method: request.method,
      headers: requestHeaders(request.headers),
    }, (response) => {
      const location = response.headers.location
      if (location && new URL(location, target).origin !== target.origin) {
        response.resume()
        reply.raw.writeHead(502, { "Cache-Control": "no-store" }).end()
        return
      }
      const headers: http.OutgoingHttpHeaders = { "cache-control": "private, no-store" }
      for (const [name, value] of Object.entries(response.headers)) {
        if (!DROP_RESPONSE_HEADERS.has(name) && value !== undefined) headers[name] = value
      }
      reply.raw.writeHead(response.statusCode ?? 502, headers)
      response.pipe(reply.raw)
    })
    opts.broker.track(authorized.record, upstream)
    upstream.once("error", () => {
      if (!reply.raw.headersSent) reply.raw.writeHead(502, { "Cache-Control": "no-store" })
      reply.raw.end()
    })
    request.raw.pipe(upstream)
  })

  const onUpgrade = (request: IncomingMessage, socket: Socket, head: Buffer) => {
    void (async () => {
      const parsed = safeSuffix(request.url ?? "", VIEW_PREFIX)
      if (!parsed) return
      const identity = await opts.resolveUpgradeIdentity(request)
      const authorized = opts.broker.authorize({
        leaseId: parsed.leaseId,
        cookie: readProjectionCookie(request.headers.cookie),
        identity,
      })
      if (!authorized) return sendDenied(socket)
      const target = upstreamTarget(authorized.upstream, parsed.suffix, parsed.search)
      const transport = target.protocol === "https:" ? https : target.protocol === "http:" ? http : undefined
      if (!transport) return sendDenied(socket, "502 Bad Gateway")
      const upstreamRequest = transport.request(target, {
        method: "GET",
        headers: { ...requestHeaders(request.headers), connection: "Upgrade", upgrade: request.headers.upgrade ?? "websocket" },
      })
      upstreamRequest.once("upgrade", (response, upstreamSocket, upstreamHead) => {
        const lines = [`HTTP/1.1 ${response.statusCode ?? 101} ${response.statusMessage ?? "Switching Protocols"}`]
        for (const [name, value] of Object.entries(response.headers)) {
          if (DROP_RESPONSE_HEADERS.has(name) || value === undefined) continue
          for (const item of Array.isArray(value) ? value : [value]) lines.push(`${name}: ${item}`)
        }
        socket.write(`${lines.join("\r\n")}\r\n\r\n`)
        if (head.length) upstreamSocket.write(head)
        if (upstreamHead.length) socket.write(upstreamHead)
        opts.broker.track(authorized.record, socket)
        opts.broker.track(authorized.record, upstreamSocket)
        socket.pipe(upstreamSocket).pipe(socket)
      })
      upstreamRequest.once("response", () => sendDenied(socket, "502 Bad Gateway"))
      upstreamRequest.once("error", () => sendDenied(socket, "502 Bad Gateway"))
      upstreamRequest.end()
    })().catch(() => sendDenied(socket))
  }
  app.server.on("upgrade", onUpgrade)
  app.addHook("onClose", async () => app.server.off("upgrade", onUpgrade))
  done()
}
