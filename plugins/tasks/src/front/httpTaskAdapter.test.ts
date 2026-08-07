import { describe, expect, test, vi } from "vitest"
import type { WorkspacePluginClient } from "@hachej/boring-workspace"

import { createHttpTaskAdapter, TaskHttpError } from "./httpTaskAdapter"

const summary = {
  id: "source-a",
  label: "Source A",
  capabilities: { move: false, detail: true },
}

type TaskClient = Pick<WorkspacePluginClient, "getJson" | "postJson">

function client(postJson: (path: string, body?: unknown) => Promise<unknown>) {
  const postJsonMock = vi.fn(postJson)
  return {
    value: { getJson: vi.fn(), postJson: postJsonMock } as unknown as TaskClient,
    postJson: postJsonMock,
  }
}

describe("HTTP task adapter", () => {
  test("shares one list request between board config and task loading", async () => {
    const taskClient = client(async () => ({
      ok: true,
      configs: { "source-a": { adapterId: "source-a", columns: [{ id: "todo", title: "Todo" }] } },
      tasks: [{ id: "1", number: "1", title: "One", statusId: "todo", adapterId: "source-a" }],
      errors: {},
    }))
    const adapter = createHttpTaskAdapter(summary, taskClient.value)

    const [config, tasks] = await Promise.all([adapter.getBoardConfig(), adapter.listTasks()])

    expect(config.adapterId).toBe("source-a")
    expect(tasks).toHaveLength(1)
    expect(taskClient.postJson).toHaveBeenCalledTimes(1)
  })

  test("preserves stable source code and retryability from partial list output", async () => {
    const taskClient = client(async () => ({
      ok: true,
      configs: {},
      tasks: [],
      errors: {
        "source-a": {
          sourceId: "source-a",
          code: "TASK_BEADS_TIMEOUT",
          message: "Beads read timed out.",
          retryable: true,
          stale: true,
        },
      },
    }))
    const adapter = createHttpTaskAdapter(summary, taskClient.value)

    await expect(adapter.listTasks()).rejects.toMatchObject({
      name: "TaskHttpError",
      code: "TASK_BEADS_TIMEOUT",
      retryable: true,
      stale: true,
      message: "Beads read timed out.",
    })
  })

  test("loads uncached detail and preserves typed HTTP error bodies", async () => {
    const taskClient = client(async (path) => {
      if (path.endsWith("/get")) {
        return {
          ok: true,
          detail: {
            task: { id: "1", number: "1", title: "One", statusId: "todo", adapterId: "source-a" },
            body: "Full body",
            metadata: [],
            relations: [],
          },
        }
      }
      return { ok: true }
    })
    const adapter = createHttpTaskAdapter(summary, taskClient.value)

    await expect(adapter.getTask?.({ taskId: "1" })).resolves.toMatchObject({ body: "Full body" })
    expect(taskClient.postJson).toHaveBeenCalledWith(
      "/api/boring-tasks/sources/tasks/get",
      { sourceId: "source-a", taskId: "1" },
    )

    const failingClient = client(async () => {
      throw Object.assign(new Error("Task not found. (404)"), {
        status: 404,
        body: { code: "TASK_NOT_FOUND", message: "Task not found.", retryable: false },
      })
    })
    const failing = createHttpTaskAdapter(summary, failingClient.value)
    await expect(failing.getTask?.({ taskId: "missing" })).rejects.toEqual(expect.objectContaining({
      name: "TaskHttpError",
      code: "TASK_NOT_FOUND",
      retryable: false,
      status: 404,
    }))
  })

  test("TaskHttpError remains an Error for compatibility", () => {
    expect(new TaskHttpError("TASK_SOURCE_ERROR", "failed", true)).toBeInstanceOf(Error)
  })
})
