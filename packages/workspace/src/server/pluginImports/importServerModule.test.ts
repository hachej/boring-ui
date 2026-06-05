import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import { importServerModule } from "./importServerModule"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tmp(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

describe("importServerModule", () => {
  test("hotReload=true imports fresh modules with jiti moduleCache disabled", async () => {
    const dir = await tmp("boring-server-import-")
    const serverPath = join(dir, "server.ts")

    await writeFile(serverPath, "export default { value: 'one' }\n", "utf8")
    const first = await importServerModule(serverPath, true)
    expect(first.default).toEqual({ value: "one" })

    await writeFile(serverPath, "export default { value: 'two' }\n", "utf8")
    const second = await importServerModule(serverPath, true)
    expect(second.default).toEqual({ value: "two" })
  })
})
