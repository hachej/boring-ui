import { TASK_ERROR_CODES } from "../shared"
import { describe, expect, it, vi } from "vitest"
import {
  createTaskArtifactFolder,
  DEFAULT_TASK_ARTIFACT_PATH_TEMPLATE,
  resolveTaskArtifactPath,
  taskArtifactFolderStatus,
  taskArtifactPathTemplate,
  TaskArtifactFolderError,
  type TaskArtifactWorkspace,
} from "./taskArtifactFolder"

class MemoryWorkspace implements TaskArtifactWorkspace {
  readonly entries = new Map<string, "file" | "dir">()
  readonly mkdir = vi.fn(async (path: string) => { this.entries.set(path, "dir") })

  async stat(path: string): Promise<{ kind: "file" | "dir" }> {
    const kind = this.entries.get(path)
    if (!kind) throw Object.assign(new Error("missing"), { code: TASK_ERROR_CODES.WORKSPACE_FILE_MISSING })
    return { kind }
  }
}

describe("task artifact path resolver", () => {
  it("uses the GitHub task id in the default path", () => {
    expect(DEFAULT_TASK_ARTIFACT_PATH_TEMPLATE).toBe("docs/issues/{taskId}")
    expect(taskArtifactPathTemplate(undefined)).toBe(DEFAULT_TASK_ARTIFACT_PATH_TEMPLATE)
    expect(resolveTaskArtifactPath(DEFAULT_TASK_ARTIFACT_PATH_TEMPLATE, {
      adapterId: "github:workspace",
      taskId: "776",
      number: "#776",
    })).toBe("docs/issues/776")
  })

  it("encodes every placeholder as one deterministic safe segment", () => {
    expect(resolveTaskArtifactPath("tasks/{adapterId}/{taskId}/{number}", {
      adapterId: "github:team/repo",
      taskId: "../776",
      number: "#776",
    })).toBe("tasks/github%3Ateam%2Frepo/%2E%2E%2F776/%23776")
    expect(resolveTaskArtifactPath("tasks/{taskId}", {
      adapterId: "adapter",
      taskId: "CON",
      number: "1",
    })).toBe("tasks/_CON")
  })

  it.each([
    "/absolute/{taskId}",
    "C:/drive/{taskId}",
    "../escape/{taskId}",
    "docs//{taskId}",
    "docs\\{taskId}",
    "docs/{title}",
    "docs/prefix-{taskId}",
    "docs/NUL",
    "docs/-option",
    "docs/\0bad",
  ])("rejects unsafe templates: %s", (template) => {
    expect(() => resolveTaskArtifactPath(template, { adapterId: "a", taskId: "1", number: "1" }))
      .toThrow(TaskArtifactFolderError)
  })
})

describe("task artifact folder operations", () => {
  it("inspects without creating, then creates exactly once", async () => {
    const workspace = new MemoryWorkspace()
    await expect(taskArtifactFolderStatus(workspace, "docs/issues/776")).resolves.toEqual({ path: "docs/issues/776", exists: false })
    expect(workspace.mkdir).not.toHaveBeenCalled()

    await expect(createTaskArtifactFolder(workspace, "docs/issues/776")).resolves.toEqual({ path: "docs/issues/776", exists: true })
    await expect(createTaskArtifactFolder(workspace, "docs/issues/776")).resolves.toEqual({ path: "docs/issues/776", exists: true })
    expect(workspace.mkdir).toHaveBeenCalledTimes(1)
    expect(workspace.mkdir).toHaveBeenCalledWith("docs/issues/776", { recursive: true })
  })

  it("rejects a file at the configured folder path", async () => {
    const workspace = new MemoryWorkspace()
    workspace.entries.set("docs/issues/776", "file")
    await expect(taskArtifactFolderStatus(workspace, "docs/issues/776")).rejects.toMatchObject({
      code: TASK_ERROR_CODES.ARTIFACT_PATH_CONFLICT,
      status: 409,
    })
  })
})
