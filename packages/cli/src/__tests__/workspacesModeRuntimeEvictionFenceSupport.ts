import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, vi } from "vitest"

const tempDirs: string[] = []
const originalHome = process.env.HOME

export function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((res) => { resolve = res })
  return { promise, resolve }
}

export async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

export async function writePlugin(root: string, name: string): Promise<void> {
  await mkdir(join(root, "front"), { recursive: true })
  await writeFile(join(root, "front", "index.tsx"), "export default function Plugin() { return null }\n", "utf8")
  await writeFile(join(root, "package.json"), JSON.stringify({
    name,
    version: "1.0.0",
    boring: { front: "front/index.tsx", label: name },
  }), "utf8")
}

export function installCleanup(): void {
  afterEach(async () => {
    vi.doUnmock("../server/localWorkspaces.js")
    vi.doUnmock("../server/pluginFrontRuntime.js")
    vi.resetModules()
    process.env.HOME = originalHome
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })
}
