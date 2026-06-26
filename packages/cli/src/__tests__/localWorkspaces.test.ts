import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, test } from "vitest"
import { createLocalWorkspaceRegistry } from "../server/localWorkspaces.js"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

test("adds and lists directory-backed workspaces", async () => {
  const root = await makeTempDir("boring-cli-registry-root-")
  const project = await makeTempDir("boring-cli-registry-project-")
  const registry = createLocalWorkspaceRegistry(join(root, "workspaces.yaml"))

  const added = await registry.add(project, { name: "Project" })
  expect(added.name).toBe("Project")
  expect(added.available).toBe(true)

  await expect(registry.list()).resolves.toEqual([expect.objectContaining({
    id: added.id,
    path: project,
    available: true,
  })])
})

test("rejects existing non-directory workspace paths", async () => {
  const root = await makeTempDir("boring-cli-registry-root-")
  const fileDir = await makeTempDir("boring-cli-registry-file-")
  const file = join(fileDir, "not-a-directory.txt")
  await writeFile(file, "hello", "utf-8")
  const registry = createLocalWorkspaceRegistry(join(root, "workspaces.yaml"))

  await expect(registry.add(file)).rejects.toThrow("workspace path is not a directory")
  await expect(registry.list()).resolves.toEqual([])
})

test("keeps missing workspace paths as unavailable", async () => {
  const root = await makeTempDir("boring-cli-registry-root-")
  const missing = join(root, "missing-project")
  const registry = createLocalWorkspaceRegistry(join(root, "workspaces.yaml"))

  const added = await registry.add(missing, { name: "Missing" })
  expect(added.available).toBe(false)
  await expect(registry.get(added.id)).resolves.toEqual(expect.objectContaining({
    name: "Missing",
    available: false,
  }))
})

test("creates missing workspace directories when requested", async () => {
  const root = await makeTempDir("boring-cli-registry-root-")
  const missing = join(root, "created-project")
  const registry = createLocalWorkspaceRegistry(join(root, "workspaces.yaml"))

  const added = await registry.add(missing, { name: "Created", createIfMissing: true })
  expect(added.available).toBe(true)
  await expect(registry.get(added.id)).resolves.toEqual(expect.objectContaining({
    name: "Created",
    path: missing,
    available: true,
  }))
})
