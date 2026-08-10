// @vitest-environment node

import fastify from "fastify"
import { describe, expect, test, vi } from "vitest"
import { registerWorkspaceTaskRoutes } from "../workspacePluginRoutes.js"
import type { LocalWorkspace, LocalWorkspaceRegistry } from "../localWorkspaces.js"

const createTaskSourceRegistryFromConfig = vi.fn(() => ({ listSources: () => [] }))
const disposeBeadsOperations = vi.fn(async () => {})
const createWorkspaceBeadsOperations = vi.fn(() => ({
  runRead: vi.fn(async () => ({ stdout: "" })),
  dispose: disposeBeadsOperations,
}))
const createTaskSourceService = vi.fn(() => ({
  listSources: () => [{ id: "beads:workspace" }],
  listTasks: async () => ({ tasks: [], errors: {} }),
}))

vi.mock("@hachej/boring-tasks/server", () => ({
  createTaskSourceRegistryFromConfig: (...args: unknown[]) => createTaskSourceRegistryFromConfig(...args as []),
  createWorkspaceBeadsOperations: (...args: unknown[]) => createWorkspaceBeadsOperations(...args as []),
  createTaskSourceService: (...args: unknown[]) => createTaskSourceService(...args as []),
}))

const createNodeWorkspace = vi.fn((root: string) => ({ root, runtimeContext: { runtimeCwd: root }, stat: async () => ({ kind: "dir" as const }) }))
vi.mock("@hachej/boring-sandbox/providers/node-workspace", () => ({
  createNodeWorkspace: (root: string) => createNodeWorkspace(root),
}))

function registryWith(workspace: LocalWorkspace): LocalWorkspaceRegistry {
  return { get: async (id: string) => (id === workspace.id ? workspace : undefined) } as unknown as LocalWorkspaceRegistry
}

const workspace: LocalWorkspace = {
  id: "ws-1",
  name: "Workspace",
  path: "/srv/ws-1",
  available: true,
  plugins: { tasks: { providers: [{ provider: "beads" }] } },
} as LocalWorkspace

describe("workspace task routes beads wiring", () => {
  test("passes cached beads operations to the task source registry and disposes on close", async () => {
    const app = fastify()
    await registerWorkspaceTaskRoutes(app, registryWith(workspace))

    const first = await app.inject({
      method: "POST",
      url: "/api/boring-tasks/sources/tasks/list",
      headers: { "x-boring-workspace-id": "ws-1" },
      payload: {},
    })
    expect(first.statusCode).toBe(200)
    expect(createTaskSourceRegistryFromConfig).toHaveBeenLastCalledWith(
      workspace.plugins?.tasks,
      expect.objectContaining({
        workspaceRoot: "/srv/ws-1",
        beadsOperations: expect.objectContaining({ runRead: expect.any(Function) }),
      }),
    )
    expect(createNodeWorkspace).toHaveBeenCalledWith("/srv/ws-1")

    // A second request reuses the pinned operations instead of re-creating them.
    await app.inject({ method: "GET", url: "/api/boring-tasks/sources", headers: { "x-boring-workspace-id": "ws-1" } })
    expect(createWorkspaceBeadsOperations).toHaveBeenCalledTimes(1)

    await app.close()
    expect(disposeBeadsOperations).toHaveBeenCalledTimes(1)
  })
})
