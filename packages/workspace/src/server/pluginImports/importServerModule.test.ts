import Module from "node:module"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"

const tempDirs: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tmp(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(process.cwd(), prefix))
  tempDirs.push(dir)
  return dir
}

async function importFreshServerModule() {
  vi.resetModules()
  return import("./importServerModule")
}

type ModuleLoader = {
  _load: (this: unknown, request: string, parent?: unknown, isMain?: boolean) => unknown
}

function mockJitiLoad(mock: "missing-createJiti" | "unavailable"): () => void {
  const loader = Module as unknown as ModuleLoader
  const originalLoad = loader._load
  loader._load = function (this: unknown, request: string, parent?: unknown, isMain?: boolean) {
    if (request === "jiti") {
      if (mock === "missing-createJiti") return {}
      throw new Error("simulated jiti unavailable")
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  return () => {
    loader._load = originalLoad
  }
}

describe("importServerModule", () => {
  test("hotReload=true imports fresh modules with jiti moduleCache disabled", async () => {
    const dir = await tmp("boring-server-import-")
    const serverPath = join(dir, "server.ts")

    await writeFile(serverPath, "export default { value: 'one' }\n", "utf8")
    const { importServerModule } = await importFreshServerModule()

    const first = await importServerModule(serverPath, true)
    expect(first.default).toEqual({ value: "one" })

    await writeFile(serverPath, "export default { value: 'two' }\n", "utf8")
    const second = await importServerModule(serverPath, true)
    expect(second.default).toEqual({ value: "two" })
  })

  test("hotReload=true falls back to native import and warns once when jiti lacks createJiti", async () => {
    const dir = await tmp("boring-server-import-missing-jiti-create-")
    const firstPath = join(dir, "first.mjs")
    const secondPath = join(dir, "second.mjs")
    await writeFile(firstPath, "export default { value: 'native-one' }\n", "utf8")
    await writeFile(secondPath, "export default { value: 'native-two' }\n", "utf8")

    const restoreLoad = mockJitiLoad("missing-createJiti")
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const { importServerModule } = await importFreshServerModule()

      await expect(importServerModule(firstPath, true)).resolves.toMatchObject({ default: { value: "native-one" } })
      await expect(importServerModule(secondPath, true)).resolves.toMatchObject({ default: { value: "native-two" } })
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0]?.[0]).toContain("createJiti not exported")
      expect(warn.mock.calls[0]?.[0]).toContain("Falling back to native import()")
    } finally {
      restoreLoad()
    }
  })

  test("hotReload=true falls back to native import when jiti cannot be required", async () => {
    const dir = await tmp("boring-server-import-unavailable-jiti-")
    const serverPath = join(dir, "server.mjs")
    await writeFile(serverPath, "export default { value: 'native-fallback' }\n", "utf8")

    const restoreLoad = mockJitiLoad("unavailable")
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const { importServerModule } = await importFreshServerModule()

      await expect(importServerModule(serverPath, true)).resolves.toMatchObject({ default: { value: "native-fallback" } })
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0]?.[0]).toContain("simulated jiti unavailable")
    } finally {
      restoreLoad()
    }
  })

  test("hotReload=false uses native import without warning about jiti", async () => {
    const dir = await tmp("boring-server-import-native-")
    const serverPath = join(dir, "server.mjs")
    await writeFile(serverPath, "export default { value: 'native' }\n", "utf8")

    const restoreLoad = mockJitiLoad("unavailable")
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const { importServerModule } = await importFreshServerModule()

      await expect(importServerModule(serverPath, false)).resolves.toMatchObject({ default: { value: "native" } })
      expect(warn).not.toHaveBeenCalled()
    } finally {
      restoreLoad()
    }
  })
})
