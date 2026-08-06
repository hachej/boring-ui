// @vitest-environment node

import { existsSync } from "node:fs"
import { readdir, stat } from "node:fs/promises"
import { delimiter, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test, vi } from "vitest"
import { BeadsOperationError, createWorkspaceBeadsOperations, isAllowedBeadsReadArgs, isValidBeadId, type BeadsOperationFailureKind, type BeadsOperations } from "./beadsOperations"
import { createBeadsTaskSource } from "./beadsSource"
import { createTaskSourceRegistryFromConfig } from "./sourceConfig"
import { createTaskSourceRegistry } from "./sourceRuntime"
import { createTaskSourceService } from "./taskSourceService"

function operations(handler: (args: readonly string[]) => string | Promise<string>): BeadsOperations & { runRead: ReturnType<typeof vi.fn> } {
  const runRead = vi.fn(async (args: readonly string[]) => ({ stdout: await handler(args) }))
  return { runRead } as BeadsOperations & { runRead: ReturnType<typeof vi.fn> }
}

function withVersion(handler: (args: readonly string[]) => string | Promise<string>) {
  return operations((args) => args[0] === "--version" ? "br 0.2.16\n" : handler(args))
}

const listArgs = ["list", "--all", "--json", "--no-auto-flush", "--no-auto-import", "--no-db"]
const showArgs = (id: string) => ["show", "--json", "--no-auto-flush", "--no-auto-import", "--no-db", "--", id]
const localBeadsRuntimeAvailable = process.platform === "linux"
  && existsSync("/usr/bin/bwrap")
  && (process.env.PATH ?? "").split(delimiter).some((entry) => entry && existsSync(resolve(entry, "br")))

describe("Beads task source", () => {
  test("uses the fixed read argv and maps list cards without host paths", async () => {
    const ops = withVersion((args) => {
      expect(args).toEqual(listArgs)
      return JSON.stringify({
        issues: [
          {
            id: "root.1",
            title: "Implement source",
            description: `line one\n${"x".repeat(600)}`,
            status: "in_progress",
            priority: 1,
            issue_type: "feature",
            assignee: "worker-1",
            labels: ["tasks", "beads"],
            parent: "root",
            source_repo_path: "/private/worktree",
          },
          { id: "root.2", title: "Unknown status", status: "brand_new" },
        ],
      })
    })
    const source = createBeadsTaskSource({ operations: ops })

    await expect(source.listTasks({})).resolves.toEqual([
      expect.objectContaining({
        id: "root.1",
        number: "root.1",
        title: "Implement source",
        statusId: "in-progress",
        priority: "P1",
        issueType: "feature",
        assignee: "worker-1",
        tags: ["tasks", "beads"],
        epic: { id: "root", title: "root" },
        adapterId: "beads:workspace",
      }),
      expect.objectContaining({ id: "root.2", statusId: "other" }),
    ])
    const cards = await source.listTasks({})
    expect(cards[0]?.description?.length).toBeLessThanOrEqual(512)
    expect(JSON.stringify(cards)).not.toContain("/private/worktree")
    expect(ops.runRead).toHaveBeenNthCalledWith(1, ["--version"], expect.any(Object))
    expect(ops.runRead).toHaveBeenNthCalledWith(2, listArgs, expect.any(Object))
    expect(ops.runRead).toHaveBeenNthCalledWith(3, listArgs, expect.any(Object))
  })

  test("maps bounded detail, safe metadata, and native relations", async () => {
    const id = "root.4"
    const ops = withVersion((args) => {
      expect(args).toEqual(showArgs(id))
      return JSON.stringify([{
        id,
        title: "Provider",
        description: "Full description",
        acceptance_criteria: "All tests pass",
        notes: "Read only",
        status: "open",
        priority: 2,
        issue_type: "feature",
        assignee: "worker",
        updated_at: "2026-08-04T00:00:00Z",
        created_at: "2026-08-03T00:00:00Z",
        created_by: "planner",
        source_repo: "issue-1072",
        source_repo_path: "/home/private/worktree",
        parent: "root",
        dependencies: [
          { id: "root", title: "Epic", status: "open", dependency_type: "parent-child" },
          { id: "root.3", title: "Contract", status: "closed", dependency_type: "blocks" },
        ],
        children: [{ id: "root.4.1", title: "Child", status: "open", dependency_type: "parent-child" }],
        dependents: [{ id: "root.6", title: "Converge", status: "open", dependency_type: "blocks" }],
        related: [{ id: "other", title: "Other", status: "open", dependency_type: "related" }],
        discovered_from: { id: "idea", title: "Idea", status: "closed" },
      }])
    })
    const source = createBeadsTaskSource({ operations: ops })

    const detail = await source.getTask?.({}, { taskId: id })

    expect(detail).toMatchObject({
      task: { id, priority: "P2", issueType: "feature", assignee: "worker", epic: { id: "root", title: "Epic" } },
      body: "Full description",
      acceptanceCriteria: "All tests pass",
      notes: "Read only",
      updatedAt: "2026-08-04T00:00:00Z",
    })
    expect(detail?.metadata).toContainEqual({ id: "source-repository", label: "Source repository", value: "issue-1072" })
    expect(JSON.stringify(detail)).not.toContain("/home/private/worktree")
    expect(detail?.relations.map(({ direction, id: relationId }) => `${direction}:${relationId}`)).toEqual([
      "blocked-by:root.3",
      "blocks:root.6",
      "child:root.4.1",
      "parent:root",
      "related:idea",
      "related:other",
    ])
    expect(ops.runRead).toHaveBeenLastCalledWith(showArgs(id), expect.any(Object))
  })

  test.each([
    "--db=/tmp/other.db",
    "--config",
    "../escape",
    "has space",
    "control\nchar",
    "éclair",
    "-leading",
    "x".repeat(257),
  ])("rejects unsafe ID %j before execution", async (id) => {
    const ops = withVersion(() => "[]")
    const source = createBeadsTaskSource({ operations: ops })
    await expect(source.getTask?.({}, { taskId: id })).rejects.toMatchObject({ code: "TASK_BEADS_ID_INVALID", status: 400 })
    expect(ops.runRead).not.toHaveBeenCalled()
  })

  test("rejects malformed and mismatched detail responses", async () => {
    const multiple = createBeadsTaskSource({ operations: withVersion(() => JSON.stringify([
      { id: "one", title: "One", status: "open" },
      { id: "two", title: "Two", status: "open" },
    ])) })
    await expect(multiple.getTask?.({}, { taskId: "one" })).rejects.toMatchObject({ code: "TASK_BEADS_INVALID_RESPONSE" })

    const invalidRelation = createBeadsTaskSource({ operations: withVersion(() => JSON.stringify([{
      id: "one",
      title: "One",
      status: "open",
      dependencies: [{ id: "--db=outside", dependency_type: "blocks" }],
    }])) })
    await expect(invalidRelation.getTask?.({}, { taskId: "one" })).rejects.toMatchObject({ code: "TASK_BEADS_INVALID_RESPONSE" })
  })

  test("rejects malformed list shapes and duplicate IDs", async () => {
    const malformed = createBeadsTaskSource({ operations: withVersion(() => JSON.stringify([])) })
    await expect(malformed.listTasks({})).rejects.toMatchObject({ code: "TASK_BEADS_INVALID_RESPONSE" })

    const duplicate = createBeadsTaskSource({ operations: withVersion(() => JSON.stringify({
      issues: [
        { id: "same", title: "One", status: "open" },
        { id: "same", title: "Two", status: "open" },
      ],
    })) })
    await expect(duplicate.listTasks({})).rejects.toMatchObject({
      code: "TASK_BEADS_DUPLICATE_ID",
      retryable: false,
    })
  })

  test.each<[BeadsOperationFailureKind, string, number, boolean]>([
    ["binary-not-found", "TASK_BEADS_BINARY_NOT_FOUND", 503, false],
    ["timeout", "TASK_BEADS_TIMEOUT", 504, true],
    ["output-too-large", "TASK_BEADS_OUTPUT_TOO_LARGE", 502, true],
    ["command-failed", "TASK_BEADS_COMMAND_FAILED", 502, true],
    ["not-found", "TASK_BEADS_NOT_FOUND", 404, false],
    ["store-not-found", "TASK_BEADS_STORE_NOT_FOUND", 404, false],
    ["store-unhealthy", "TASK_BEADS_STORE_UNHEALTHY", 409, true],
    ["runtime-unavailable", "TASK_BEADS_RUNTIME_UNAVAILABLE", 409, false],
  ])("maps operation %s to %s", async (kind, code, status, retryable) => {
    const source = createBeadsTaskSource({ operations: withVersion(() => { throw new BeadsOperationError(kind) }) })
    await expect(source.listTasks({})).rejects.toMatchObject({ code, status, retryable })
  })

  test("rejects unsupported versions and retries a transient version check", async () => {
    const unsupported = createBeadsTaskSource({ operations: operations(() => "br 1.0.0\n") })
    await expect(unsupported.listTasks({})).rejects.toMatchObject({ code: "TASK_BEADS_VERSION_UNSUPPORTED" })

    let attempt = 0
    const transient = operations((args) => {
      if (args[0] === "--version" && attempt++ === 0) throw new BeadsOperationError("timeout")
      return args[0] === "--version" ? "br 0.2.16\n" : JSON.stringify({ issues: [] })
    })
    const source = createBeadsTaskSource({ operations: transient })
    await expect(source.listTasks({})).rejects.toMatchObject({ code: "TASK_BEADS_TIMEOUT" })
    await expect(source.listTasks({})).resolves.toEqual([])
  })
})

describe("Beads read authority and config", () => {
  test.each([
    "ok",
    "root.child_1",
    "A-1",
  ])("accepts option-safe ID %s", (id) => expect(isValidBeadId(id)).toBe(true))

  test("allows only the fixed version/list/show protocol", () => {
    expect(isAllowedBeadsReadArgs(["--version"])).toBe(true)
    expect(isAllowedBeadsReadArgs(listArgs)).toBe(true)
    expect(isAllowedBeadsReadArgs(showArgs("root.1"))).toBe(true)
    expect(isAllowedBeadsReadArgs(["close", "root.1"])).toBe(false)
    expect(isAllowedBeadsReadArgs(["show", "--json", "--", "--db=x"])).toBe(false)
    expect(isAllowedBeadsReadArgs([...showArgs("root.1"), "extra"])).toBe(false)
  })

  test("rejects an uninitialized Workspace without creating store files", async () => {
    const root = fileURLToPath(new URL("../../test-fixtures/uninitialized-workspace", import.meta.url))
    const before = await readdir(`${root}/.beads`)
    const workspace = {
      root,
      runtimeContext: { runtimeCwd: root },
      async stat(relPath: string) {
        const info = await stat(`${root}/${relPath}`)
        return { kind: info.isDirectory() ? "dir" as const : "file" as const }
      },
    }
    const source = createBeadsTaskSource({ operations: createWorkspaceBeadsOperations(workspace) })
    await expect(source.listTasks({})).rejects.toMatchObject({
      code: "TASK_BEADS_STORE_NOT_FOUND",
      retryable: false,
    })
    expect(await readdir(`${root}/.beads`)).toEqual(before)
  })

  test.runIf(localBeadsRuntimeAvailable)("disposes pinned runtime descriptors after successful reads", async () => {
    const root = fileURLToPath(new URL("../../../..", import.meta.url))
    const workspace = {
      root,
      runtimeContext: { runtimeCwd: root },
      async stat(relPath: string) {
        const info = await stat(`${root}/${relPath}`)
        return { kind: info.isDirectory() ? "dir" as const : "file" as const }
      },
    }
    const before = (await readdir("/proc/self/fd")).length
    const operations = createWorkspaceBeadsOperations(workspace)
    await expect(operations.runRead(["--version"], { timeoutMs: 10_000, maxOutputBytes: 1_024 })).resolves.toEqual({ stdout: "br 0.2.16\n" })
    expect((await readdir("/proc/self/fd")).length).toBeGreaterThanOrEqual(before + 2)
    await operations.dispose?.()
    await operations.dispose?.()
    expect((await readdir("/proc/self/fd")).length).toBeLessThanOrEqual(before + 1)
    await expect(operations.runRead(["--version"], { timeoutMs: 10_000, maxOutputBytes: 1_024 })).rejects.toMatchObject({ kind: "runtime-unavailable" })
  })

  test.runIf(process.platform === "linux")("closes pinned Workspace descriptors when br resolution fails", async () => {
    const root = fileURLToPath(new URL("../../../..", import.meta.url))
    const workspace = {
      root,
      runtimeContext: { runtimeCwd: root },
      async stat(relPath: string) {
        const info = await stat(`${root}/${relPath}`)
        return { kind: info.isDirectory() ? "dir" as const : "file" as const }
      },
    }
    const before = (await readdir("/proc/self/fd")).length
    const previousPath = process.env.PATH
    process.env.PATH = ""
    try {
      const source = createBeadsTaskSource({ operations: createWorkspaceBeadsOperations(workspace) })
      await expect(source.listTasks({})).rejects.toMatchObject({ code: "TASK_BEADS_BINARY_NOT_FOUND" })
    } finally {
      process.env.PATH = previousPath
    }
    expect((await readdir("/proc/self/fd")).length).toBeLessThanOrEqual(before + 1)
  })

  test("keeps a healthy source visible when remote Beads runtime is unavailable", async () => {
    const healthy = {
      summary: () => ({ id: "healthy", label: "Healthy", capabilities: { move: false } }),
      getBoardConfig: () => ({ adapterId: "healthy", columns: [{ id: "open", title: "Open" }] }),
      listTasks: () => [{ id: "1", number: "1", title: "Healthy", statusId: "open", adapterId: "healthy" }],
    }
    const service = createTaskSourceService(createTaskSourceRegistry([healthy, createBeadsTaskSource()]))
    await expect(service.listTasks({})).resolves.toMatchObject({
      tasks: [{ id: "1", adapterId: "healthy" }],
      errors: {
        "beads:workspace": {
          code: "TASK_BEADS_RUNTIME_UNAVAILABLE",
          retryable: false,
        },
      },
    })
  })

  test("strictly composes GitHub and one Beads provider", () => {
    const registry = createTaskSourceRegistryFromConfig({ providers: [
      { provider: "github", repo: "owner/repo" },
      { provider: "beads" },
    ] })
    expect(registry.listSources().map((source) => source.summary().id)).toEqual([
      "github:owner/repo",
      "beads:workspace",
    ])
  })

  test.each([
    { providers: [{ provider: "beads", cwd: "/tmp" }] },
    { providers: [{ provider: "beads" }, { provider: "beads" }] },
    { providers: [{ provider: "unknown" }] },
    { providers: [{ provider: "github", repo: "not-a-repo" }] },
    { providers: [{ provider: "github", repo: "owner/repo", extra: true }] },
  ])("rejects unsupported or duplicate config %#", (config) => {
    expect(() => createTaskSourceRegistryFromConfig(config)).toThrow()
  })
})
