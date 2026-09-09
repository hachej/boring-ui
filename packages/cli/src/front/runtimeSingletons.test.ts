import { afterEach, describe, expect, test } from "vitest"
import { loadWorkspaceRuntimeSingleton } from "./runtimeSingletons"

const originalSingletons = globalThis.__BORING_RUNTIME_SINGLETONS__

afterEach(() => {
  globalThis.__BORING_RUNTIME_SINGLETONS__ = originalSingletons
})

describe("loadWorkspaceRuntimeSingleton", () => {
  test("restores the real JSX development runtime with the broad workspace singleton", async () => {
    globalThis.__BORING_RUNTIME_SINGLETONS__ = {
      ...globalThis.__BORING_RUNTIME_SINGLETONS__,
      "react/jsx-dev-runtime": undefined,
      "@hachej/boring-workspace": undefined,
    }
    delete globalThis.__BORING_RUNTIME_SINGLETONS__["react/jsx-dev-runtime"]

    await loadWorkspaceRuntimeSingleton()

    const singletons = globalThis.__BORING_RUNTIME_SINGLETONS__ as Record<string, Record<string, unknown>>
    expect(typeof singletons["react/jsx-dev-runtime"]?.jsxDEV).toBe("function")
    expect(singletons["@hachej/boring-workspace"]).toBeDefined()
  }, 20_000)
})
