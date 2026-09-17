// @vitest-environment node

import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import type { ToolExecContext } from "@hachej/boring-workspace/shared"
import { AppRunnerClient } from "../appRunnerClient"
import { createActivateAppVersionTool, createPublishAppTool, createRollbackAppTool } from "../createAppRunnerTools"
import { createPublishedToolsProvider } from "../createPublishedTools"
import { MemoryAppRunnerStore } from "./memoryAppRunnerStore"

const context: ToolExecContext = {
  abortSignal: new AbortController().signal,
  toolCallId: "call",
  workspaceId: "acme",
  userId: "alice",
}

const manifests = {
  1: { tools: [{ name: "count", description: "Count", input: {}, route: "/count" }] },
  2: { tools: [{ name: "pin", description: "Pin", input: {}, route: "/pin" }] },
}

describe("published lifecycle tool refresh", () => {
  it("follows publish, activate, and rollback through the client/store/provider seam", async () => {
    const root = await mkdtemp(join(tmpdir(), "app-runner-lifecycle-"))
    await mkdir(join(root, "apps", "guestbook"), { recursive: true })
    await writeFile(join(root, "apps", "guestbook", "index.js"), "export default {}\n")
    let current = 1
    let latest = 1
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith("/publish")) {
        latest = 2
        current = 2
        return Response.json({ version: 2, url: "http://hub/w/acme/guestbook/", sha: "sha-2", contentSha: "c2", kind: "app", activated: true })
      }
      if (url.endsWith("/activate")) {
        current = JSON.parse(init?.body as string).version
        return Response.json({ ok: true })
      }
      if (url.endsWith("/rollback")) {
        current = Math.max(1, current - 1)
        return Response.json({ ok: true })
      }
      if (url.endsWith("/versions")) {
        return Response.json({ versions: Array.from({ length: latest }, (_, index) => {
          const version = latest - index
          return { version, kind: "app", sha: `sha-${version}`, created_at: "now", current: version === current }
        }) })
      }
      if (/\/versions\/\d+\/files$/.test(url)) {
        const version = Number(url.match(/versions\/(\d+)/)?.[1]) as 1 | 2
        return Response.json({ manifest: manifests[version] })
      }
      if (url.endsWith("/current")) {
        return Response.json({ version: current, kind: "app", sha: `sha-${current}`, contentSha: `c${current}`, manifest: manifests[current as 1 | 2] })
      }
      return new Response("unexpected", { status: 500 })
    })
    const client = new AppRunnerClient({ baseUrl: "http://hub", fetchImpl: fetchImpl as typeof fetch })
    const store = new MemoryAppRunnerStore()
    await store.upsertApp({ appName: "guestbook", workspaceId: "acme", kind: "app", version: 1, sha: "sha-1", url: "url", updatedAt: "now", toolManifest: manifests[1] })
    const provider = createPublishedToolsProvider({ client, store })
    const names = async () => (await provider(context)).map((tool) => tool.description)

    expect(await names()).toEqual(["Count"])
    expect((await createPublishAppTool({ workspaceRoot: root, client, store }).execute({ appName: "guestbook" }, context)).isError).toBeFalsy()
    expect(await names()).toEqual(["Pin"])
    expect((await createActivateAppVersionTool({ workspaceRoot: root, client, store }).execute({ appName: "guestbook", version: 1 }, context)).isError).toBeFalsy()
    expect(await names()).toEqual(["Count"])
    expect((await createActivateAppVersionTool({ workspaceRoot: root, client, store }).execute({ appName: "guestbook", version: 2 }, context)).isError).toBeFalsy()
    expect((await createRollbackAppTool({ workspaceRoot: root, client, store }).execute({ appName: "guestbook" }, context)).isError).toBeFalsy()
    expect(await names()).toEqual(["Count"])
  })
})
