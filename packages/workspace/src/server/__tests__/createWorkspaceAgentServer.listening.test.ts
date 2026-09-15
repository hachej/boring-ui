// @vitest-environment node
import { createHash } from "node:crypto"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { createServer, type IncomingMessage } from "node:http"
import { connect, type AddressInfo } from "node:net"
import type { Duplex } from "node:stream"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import { createWorkspaceAgentServer } from "../../app/server/createWorkspaceAgentServer"
import { RuntimeProjectionBroker } from "../runtimeProjection/runtimeProjectionBroker"
import type { RuntimeBackendRegistry } from "../runtimeBackend/runtimeBackendRegistry"

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { await Promise.allSettled(cleanup.splice(0).map((fn) => fn())) })

function acceptWebSocket(request: IncomingMessage, socket: Duplex, message: string): void {
  const key = request.headers["sec-websocket-key"]
  if (typeof key !== "string") { socket.destroy(); return }
  const accept = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64")
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
  const body = Buffer.from(message)
  socket.end(Buffer.concat([Buffer.from([0x81, body.length]), body]))
}

async function websocketResult(url: string, timeoutMs = 500, cookie?: string): Promise<{ opened: boolean; message?: string }> {
  const target = new URL(url)
  return await new Promise((resolve) => {
    const socket = connect(Number(target.port), target.hostname)
    let settled = false
    let data = Buffer.alloc(0)
    const finish = (result: { opened: boolean; message?: string }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      resolve(result)
    }
    const timer = setTimeout(() => finish({ opened: data.includes(Buffer.from("101 Switching Protocols")) }), timeoutMs)
    socket.on("connect", () => socket.write([
      `GET ${target.pathname}${target.search} HTTP/1.1`, `Host: ${target.host}`, "Upgrade: websocket", "Connection: Upgrade",
      "Sec-WebSocket-Version: 13", "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==", ...(cookie ? [`Cookie: ${cookie}`] : []), "", "",
    ].join("\r\n")))
    socket.on("data", (chunk) => {
      data = Buffer.concat([data, chunk])
      const headerEnd = data.indexOf("\r\n\r\n")
      if (headerEnd < 0) return
      const opened = data.subarray(0, headerEnd).includes(Buffer.from("101 Switching Protocols"))
      const frame = data.subarray(headerEnd + 4)
      if (!opened) return finish({ opened: false })
      if (frame.length >= 2 + frame[1]) finish({ opened: true, message: frame.subarray(2, 2 + frame[1]).toString() })
    })
    socket.on("error", () => finish({ opened: false }))
    socket.on("end", () => finish({ opened: false }))
  })
}

async function listeningServer(prefix: string, token: string, broker: RuntimeProjectionBroker) {
  const root = await mkdtemp(join(tmpdir(), "boring-listening-prefix-"))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const app = await createWorkspaceAgentServer({
    workspaceRoot: root, mode: "direct", logger: false, provisionWorkspace: false,
    disableDefaultFileTools: true, externalPlugins: false, routePrefix: prefix, authToken: token,
    runtimeProjection: {
      broker,
      resolveIdentity: async () => ({ workspaceId: "default", agentTypeId: "default", sessionId: "session", generationId: "generation" }),
      resolveUpgradeIdentity: async () => ({ workspaceId: "default", agentTypeId: "default", sessionId: "session", generationId: "generation" }),
    },
  })
  app.server.on("upgrade", (request, socket) => {
    if (request.url === "/sibling-ws") acceptWebSocket(request, socket, `sibling:${prefix}`)
  })
  await app.listen({ host: "127.0.0.1", port: 0 })
  cleanup.push(() => app.close())
  const port = (app.server.address() as AddressInfo).port
  return { app, root, http: `http://127.0.0.1:${port}`, ws: `ws://127.0.0.1:${port}` }
}

async function installRuntimeBackend(app: Awaited<ReturnType<typeof createWorkspaceAgentServer>>, root: string, value: string) {
  const serverPath = join(root, "runtime-server.ts")
  await writeFile(serverPath, `export default { routes(router) { router.get("/logical/suffix", () => ({ value: ${JSON.stringify(value)} })) } }`)
  const registry = (app as typeof app & { __boringRuntimeBackendRegistry: RuntimeBackendRegistry }).__boringRuntimeBackendRegistry
  await registry.reloadFromLoadedPlugins([{
    id: "listening-plugin", version: "1.0.0", revision: 1, rootDir: root, serverPath,
    source: { rootDir: root, kind: "external" },
  }])
}

async function postCommand(base: string, prefix: string, token: string, path: string) {
  return fetch(`${base}${prefix}/api/v1/ui/commands`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ kind: "openFile", params: { path } }),
  })
}

async function poll(base: string, prefix: string, token: string) {
  const response = await fetch(`${base}${prefix}/api/v1/ui/commands/next?poll=true`, { headers: { authorization: `Bearer ${token}` } })
  return { response, body: await response.json() as Array<{ params: { path: string } }> }
}

describe("createWorkspaceAgentServer real listening prefix boundary", () => {
  test("proves composed HTTP, raw backend, projection HTTP/WS, auth, sibling WS, and instance isolation", async () => {
    const upstreamSeen: string[] = []
    const upstream = createServer((request, response) => { upstreamSeen.push(request.url ?? ""); response.end(`projection:${request.url}`) })
    upstream.on("upgrade", (request, socket) => { upstreamSeen.push(request.url ?? ""); acceptWebSocket(request, socket, `projection-ws:${request.url}`) })
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve))
    cleanup.push(() => new Promise<void>((resolve) => upstream.close(() => resolve())))
    const upstreamPort = (upstream.address() as AddressInfo).port

    const brokerA = new RuntimeProjectionBroker()
    const brokerB = new RuntimeProjectionBroker()
    const a = await listeningServer("/owners/a/workspace", "token-a", brokerA)
    const b = await listeningServer("/owners/b/workspace", "token-b", brokerB)
    await installRuntimeBackend(a.app, a.root, "backend-a")
    await installRuntimeBackend(b.app, b.root, "backend-b")

    expect((await fetch(`${a.http}/owners/a/workspace/health`)).status).toBe(200)
    expect((await fetch(`${a.http}/owners/a/workspace/ready`)).status).toBe(200)
    expect((await fetch(`${a.http}/owners/a/workspace/api/v1/ui/state`)).status).toBe(401)
    expect((await fetch(`${a.http}/owners/a/workspace/api/v1/ui/state`, { headers: { authorization: "Bearer token-a" } })).status).toBe(200)

    const backendUrl = `${a.http}/owners/a/workspace/api/v1/plugins/listening-plugin/logical/suffix`
    const backend = await fetch(backendUrl, { headers: { authorization: "Bearer token-a" } })
    expect(backend.status).toBe(200)
    expect(await backend.json()).toEqual({ value: "backend-a" })
    expect((await fetch(`${a.http}/api/v1/plugins/listening-plugin/logical/suffix`, { headers: { authorization: "Bearer token-a" } })).status).toBe(404)
    expect((await fetch(`${a.http}/owners/a/workspace/api/v1/plugins/listening-plugin/`, { headers: { authorization: "Bearer token-a" } })).status).toBe(404)

    const identity = { workspaceId: "default", agentTypeId: "default", sessionId: "session", generationId: "generation" }
    const grant = brokerA.create({ identity, upstream: { url: `http://127.0.0.1:${upstreamPort}/base`, expiresAt: new Date(Date.now() + 60_000).toISOString(), revoke: async () => {} } })
    expect(grant.bootstrapPath.startsWith("/owners/a/workspace/")).toBe(true)
    const bootstrap = await fetch(`${a.http}${grant.bootstrapPath}`, {
      method: "POST", headers: { authorization: "Bearer token-a", "content-type": "application/json" }, body: JSON.stringify({ grant: grant.grant }),
    })
    const cookie = bootstrap.headers.get("set-cookie") ?? ""
    const location = (await bootstrap.json() as { url: string }).url
    expect(location.startsWith("/owners/a/workspace/")).toBe(true)
    expect(cookie).toContain(`Path=/owners/a/workspace/api/v1/runtime-projection/view/${grant.leaseId}/`)
    const suffix = `${location}nested?q=1`
    expect(await (await fetch(`${a.http}${suffix}`, { headers: { authorization: "Bearer token-a", cookie: cookie.split(";", 1)[0] } })).text()).toBe("projection:/nested?q=1")
    const wsSuffix = suffix.replace(/^http/, "ws").replace("?q=1", "socket")
    expect(await websocketResult(`${a.ws}${wsSuffix}`, 1_000, cookie.split(";", 1)[0])).toEqual({ opened: true, message: "projection-ws:/nestedsocket" })
    expect((await websocketResult(`${a.ws}${suffix.replace("/owners/a/workspace", "")}`, 250)).opened).toBe(false)
    expect(await websocketResult(`${a.ws}/sibling-ws`)).toEqual({ opened: true, message: "sibling:/owners/a/workspace" })

    await postCommand(a.http, "/owners/a/workspace", "token-a", "a-only")
    await postCommand(b.http, "/owners/b/workspace", "token-b", "b-only")
    expect((await poll(a.http, "/owners/a/workspace", "token-a")).body.map((x) => x.params.path)).toEqual(["a-only"])
    expect((await poll(b.http, "/owners/b/workspace", "token-b")).body.map((x) => x.params.path)).toEqual(["b-only"])
    await a.app.close()
    expect((await fetch(`${b.http}/owners/b/workspace/health`)).status).toBe(200)
    await postCommand(b.http, "/owners/b/workspace", "token-b", "still-live")
    expect((await poll(b.http, "/owners/b/workspace", "token-b")).body.map((x) => x.params.path)).toEqual(["still-live"])
    expect(upstreamSeen).toContain("/nested?q=1")
  }, 30_000)
})
