import { createServer } from "node:http"
import Fastify from "fastify"
import { afterEach, describe, expect, it, vi } from "vitest"
import { RuntimeProjectionBroker } from "../runtimeProjectionBroker"
import { runtimeProjectionRoutes } from "../runtimeProjectionRoutes"

const identity = { workspaceId: "w", agentTypeId: "a", sessionId: "s", generationId: "g" }
const close: Array<() => Promise<void>> = []
afterEach(async () => Promise.all(close.splice(0).map((fn) => fn())))

describe("runtimeProjectionRoutes", () => {
  it("bootstraps one same-origin cookie and proxies HTTP without forwarding credentials", async () => {
    const seen: Array<{ url?: string; authorization?: string; cookie?: string }> = []
    const upstream = createServer((request, response) => {
      seen.push({ url: request.url, authorization: request.headers.authorization, cookie: request.headers.cookie })
      response.setHeader("Set-Cookie", "upstream=forbidden")
      response.end("qualified-view")
    })
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve))
    close.push(() => new Promise<void>((resolve, reject) => upstream.close((error) => error ? reject(error) : resolve())))
    const address = upstream.address()
    if (!address || typeof address === "string") throw new Error("missing upstream address")

    const broker = new RuntimeProjectionBroker()
    const revoke = vi.fn(async () => {})
    const grant = broker.create({
      identity,
      upstream: {
        url: `http://127.0.0.1:${address.port}/vnc.html?sealed=token`,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        revoke,
      },
    })
    const app = Fastify()
    await app.register(runtimeProjectionRoutes, {
      broker,
      resolveIdentity: async () => identity,
      resolveUpgradeIdentity: async () => identity,
    })
    close.push(() => app.close())

    const bootstrap = await app.inject({ method: "GET", url: grant.bootstrapPath })
    expect(bootstrap.statusCode).toBe(303)
    expect(bootstrap.headers.location).toBe(`/api/v1/runtime-projection/view/${grant.leaseId}/`)
    const cookie = bootstrap.headers["set-cookie"]
    expect(cookie).toContain("HttpOnly")
    const view = await app.inject({
      method: "GET",
      url: bootstrap.headers.location!,
      headers: { cookie: String(cookie).split(";")[0], authorization: "Bearer must-not-forward" },
    })
    expect(view.statusCode).toBe(200)
    expect(view.body).toBe("qualified-view")
    expect(view.headers["set-cookie"]).toBeUndefined()
    expect(seen).toEqual([{ url: "/vnc.html?sealed=token", authorization: undefined, cookie: undefined }])
  })

  it("rejects replay from a different generation before proxying", async () => {
    const broker = new RuntimeProjectionBroker()
    const grant = broker.create({
      identity,
      upstream: {
        url: "http://127.0.0.1:65534/",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        revoke: async () => {},
      },
    })
    const app = Fastify()
    await app.register(runtimeProjectionRoutes, {
      broker,
      resolveIdentity: async () => ({ ...identity, generationId: "stale" }),
      resolveUpgradeIdentity: async () => ({ ...identity, generationId: "stale" }),
    })
    close.push(() => app.close())
    expect((await app.inject({ method: "GET", url: grant.bootstrapPath })).statusCode).toBe(403)
  })
})
