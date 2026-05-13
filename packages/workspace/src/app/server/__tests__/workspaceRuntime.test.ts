import { describe, expect, test } from "vitest"
import {
  createWorkspaceBridgeRegistry,
  createWorkspaceProvisioningCache,
  resolveWorkspaceIdFromRequest,
  validateWorkspaceIdSegment,
} from "../workspaceRuntime"

describe("workspace runtime helpers", () => {
  test("validates workspace ids as opaque path-safe segments", () => {
    expect(validateWorkspaceIdSegment(" ws-123 ")).toBe("ws-123")
    expect(() => validateWorkspaceIdSegment("")).toThrow("workspace id is required")
    expect(() => validateWorkspaceIdSegment("../repo")).toThrow("invalid workspace id")
    expect(() => validateWorkspaceIdSegment("/tmp/repo")).toThrow("invalid workspace id")
    expect(() => validateWorkspaceIdSegment("foo/bar")).toThrow("invalid workspace id")
    expect(() => validateWorkspaceIdSegment("foo\\bar")).toThrow("invalid workspace id")
    expect(() => validateWorkspaceIdSegment("foo\0bar")).toThrow("invalid workspace id")
  })

  test("resolves workspace id from header before SSE query", () => {
    expect(resolveWorkspaceIdFromRequest({
      headers: { "X-Boring-Workspace-Id": "from-header" },
      query: { workspaceId: "from-query" },
    } as never)).toBe("from-header")
    expect(resolveWorkspaceIdFromRequest({
      headers: {},
      query: { workspaceId: "from-query" },
    } as never)).toBe("from-query")
    expect(resolveWorkspaceIdFromRequest({
      headers: {},
      query: { workspaceId: ["from-query"] },
    } as never)).toBe("from-query")
  })

  test("bridge registry isolates bridges by workspace id", () => {
    const registry = createWorkspaceBridgeRegistry()
    const first = registry.get("workspace-a")
    expect(registry.get("workspace-a")).toBe(first)
    expect(registry.get("workspace-b")).not.toBe(first)
    expect(() => registry.get("../workspace-a")).toThrow("invalid workspace id")
  })

  test("provisioning cache dedupes concurrent work by resolved root", async () => {
    const calls: string[] = []
    const cache = createWorkspaceProvisioningCache(async (root) => {
      calls.push(root)
    })

    await Promise.all([
      cache.ensure("/tmp/workspace-a"),
      cache.ensure("/tmp/../tmp/workspace-a"),
    ])

    expect(calls).toEqual(["/tmp/workspace-a"])
  })

  test("provisioning cache retries after synchronous failures", async () => {
    let attempts = 0
    const cache = createWorkspaceProvisioningCache(() => {
      attempts += 1
      if (attempts === 1) throw new Error("boom")
      return Promise.resolve()
    })

    await expect(cache.ensure("/tmp/workspace-sync-fail")).rejects.toThrow("boom")
    await expect(cache.ensure("/tmp/workspace-sync-fail")).resolves.toBeUndefined()
    expect(attempts).toBe(2)
  })
})
