import { afterEach, describe, expect, test } from "vitest"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createLocalWorkspaceRegistry } from "../server/localWorkspaces.js"
import {
  startEmbeddedBoringUiServer,
  type EmbeddedBoringUiServer,
} from "../server/embeddedServer.js"

const roots: string[] = []
const servers: EmbeddedBoringUiServer[] = []

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "boring-desktop-server-"))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("startEmbeddedBoringUiServer", () => {
  test("guards static, API, and runtime-plugin routes with the desktop capability", async () => {
    const root = await tempRoot()
    const publicDir = join(root, "public")
    const workspaceRoot = join(root, "workspace")
    const registryPath = join(root, "workspaces.yaml")
    await mkdir(publicDir, { recursive: true })
    await mkdir(workspaceRoot, { recursive: true })
    await writeFile(join(publicDir, "index.html"), '<main id="root">desktop</main>', "utf8")
    const workspace = await createLocalWorkspaceRegistry(registryPath).add(workspaceRoot)

    const server = await startEmbeddedBoringUiServer({
      publicDir,
      registryPath,
      provisionWorkspace: false,
      requestCapability: {
        headerName: "x-boring-desktop-capability",
        token: "test-capability",
      },
    })
    servers.push(server)

    expect(server.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(server.initialUrl).toBe(`${server.origin}/workspace/${workspace.id}`)

    const guardedPaths = [
      "/",
      "/api/v1/workspaces",
      "/api/v1/runtime-plugin-diagnostics",
    ]
    for (const path of guardedPaths) {
      const unauthenticated = await fetch(`${server.origin}${path}`)
      expect(unauthenticated.status).toBe(401)
      expect(await unauthenticated.json()).toEqual({
        error: { code: "UNAUTHORIZED", message: "desktop capability required" },
      })

      const wrongCapability = await fetch(`${server.origin}${path}`, {
        headers: { "x-boring-desktop-capability": "wrong" },
      })
      expect(wrongCapability.status).toBe(401)
    }

    const headers = {
      "x-boring-desktop-capability": "test-capability",
      "x-boring-workspace-id": workspace.id,
    }
    const staticResponse = await fetch(server.origin, { headers })
    expect(staticResponse.status).toBe(200)
    expect(await staticResponse.text()).toContain("desktop")

    const apiResponse = await fetch(`${server.origin}/api/v1/workspaces`, { headers })
    expect(apiResponse.status).toBe(200)
    expect((await apiResponse.json()) as { workspaces: unknown[] }).toMatchObject({
      workspaces: [{ id: workspace.id }],
    })

    const runtimeResponse = await fetch(`${server.origin}/api/v1/runtime-plugin-diagnostics`, { headers })
    expect(runtimeResponse.status).toBe(200)
    expect(await runtimeResponse.json()).toMatchObject({ workspaceId: workspace.id })
  }, 30_000)

  test("throws instead of exiting when frontend assets are missing", async () => {
    const root = await tempRoot()
    await expect(startEmbeddedBoringUiServer({
      publicDir: join(root, "missing-public"),
      registryPath: join(root, "workspaces.yaml"),
      provisionWorkspace: false,
      requestCapability: { headerName: "x-test-capability", token: "token" },
    })).rejects.toThrow("boring-ui frontend not found")
  })

  test("closes idempotently and releases its listener", async () => {
    const root = await tempRoot()
    const publicDir = join(root, "public")
    await mkdir(publicDir, { recursive: true })
    await writeFile(join(publicDir, "index.html"), "desktop", "utf8")
    const server = await startEmbeddedBoringUiServer({
      publicDir,
      registryPath: join(root, "workspaces.yaml"),
      provisionWorkspace: false,
      requestCapability: { headerName: "x-test-capability", token: "token" },
    })
    servers.push(server)

    await Promise.all([server.close(), server.close()])
    await expect(fetch(server.origin)).rejects.toThrow()
  })
})
