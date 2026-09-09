import { PassThrough } from "node:stream"
import { describe, expect, it, vi } from "vitest"
import { RuntimeProjectionBroker } from "../runtimeProjectionBroker"

const identity = {
  workspaceId: "workspace-a",
  agentTypeId: "agent-a",
  sessionId: "session-a",
  generationId: "generation-a",
}

function grantFixture() {
  const revoke = vi.fn(async () => {})
  const broker = new RuntimeProjectionBroker()
  const grant = broker.create({
    identity,
    upstream: {
      url: "https://sealed.example/vnc.html?provider_token=secret",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      revoke,
    },
  })
  return { broker, grant, revoke, token: grant.grant }
}

function cookieValue(value: string) {
  return /^boring_projection=([^;]+)/.exec(value)?.[1]
}

describe("RuntimeProjectionBroker", () => {
  it("consumes an opaque grant once and never returns the sealed upstream", () => {
    const { broker, grant, token } = grantFixture()
    expect(grant.bootstrapPath).not.toContain("sealed.example")
    expect(grant.bootstrapPath).not.toContain("secret")
    expect(grant.bootstrapPath).not.toContain(grant.grant)
    const consumed = broker.consumeGrant({ leaseId: grant.leaseId, grant: token, identity })
    expect(consumed?.location).toBe(`/api/v1/runtime-projection/view/${grant.leaseId}/`)
    expect(consumed?.cookie).toContain("HttpOnly; SameSite=Strict")
    expect(broker.consumeGrant({ leaseId: grant.leaseId, grant: token, identity })).toBeUndefined()
  })

  it.each([
    ["workspaceId", "workspace-b"],
    ["agentTypeId", "agent-b"],
    ["sessionId", "session-b"],
    ["generationId", "generation-b"],
  ] as const)("rejects cross-boundary %s replay", (field, value) => {
    const { broker, grant, token } = grantFixture()
    expect(broker.consumeGrant({
      leaseId: grant.leaseId,
      grant: token,
      identity: { ...identity, [field]: value },
    })).toBeUndefined()
  })

  it("expires authority and active sockets at the upstream TTL", async () => {
    const revoke = vi.fn(async () => {})
    const broker = new RuntimeProjectionBroker()
    const grant = broker.create({ identity, upstream: {
      url: "https://sealed.example/view",
      expiresAt: new Date(Date.now() + 30).toISOString(),
      revoke,
    } })
    const consumed = broker.consumeGrant({ leaseId: grant.leaseId, grant: grant.grant, identity })!
    const authorized = broker.authorize({ leaseId: grant.leaseId, cookie: cookieValue(consumed.cookie), identity })!
    const socket = new PassThrough()
    broker.track(authorized.record, socket)
    await vi.waitFor(() => expect(socket.destroyed).toBe(true))
    expect(revoke).toHaveBeenCalledOnce()
  })

  it("immediately rejects the cookie and destroys active sockets on revocation", async () => {
    const { broker, grant, token, revoke } = grantFixture()
    const consumed = broker.consumeGrant({ leaseId: grant.leaseId, grant: token, identity })!
    const cookie = cookieValue(consumed.cookie)
    const authorized = broker.authorize({ leaseId: grant.leaseId, cookie, identity })!
    const client = new PassThrough()
    const upstream = new PassThrough()
    broker.track(authorized.record, client)
    broker.track(authorized.record, upstream)

    await grant.revoke()

    expect(client.destroyed).toBe(true)
    expect(upstream.destroyed).toBe(true)
    expect(broker.authorize({ leaseId: grant.leaseId, cookie, identity })).toBeUndefined()
    expect(revoke).toHaveBeenCalledOnce()
    await grant.revoke()
    expect(revoke).toHaveBeenCalledOnce()
  })
})
