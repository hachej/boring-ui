import { resolve } from "node:path"
import { expect, test } from "vitest"
import { collectVitestFileFilters, shouldBuildCliDistForVitestArgv } from "./cliVitestBuildSelection.js"

const base = ["node", "vitest", "run"]

test("CLI dist build selection builds for no selectors and list/full suite commands", () => {
  expect(shouldBuildCliDistForVitestArgv(base)).toBe(true)
  expect(shouldBuildCliDistForVitestArgv(["node", "vitest", "run", "--testNamePattern", "agent dev"])).toBe(true)
  expect(shouldBuildCliDistForVitestArgv(["node", "vitest", "list", "--maxWorkers", "1"])).toBe(true)
})

test("CLI dist build selection builds for integration/dist suites and mixed selectors", () => {
  expect(shouldBuildCliDistForVitestArgv([...base, "src/__tests__/cli.integration.test.ts"])).toBe(true)
  expect(shouldBuildCliDistForVitestArgv([...base, "src/__tests__/agentDev.integration.test.ts"])).toBe(true)
  expect(shouldBuildCliDistForVitestArgv([...base, "agentValidate.integration.test.ts"])).toBe(true)
  expect(shouldBuildCliDistForVitestArgv([...base, "src/eval/__tests__/workspaceModePluginDiscovery.test.ts"])).toBe(true)
  expect(shouldBuildCliDistForVitestArgv([...base, "src/__tests__/folderModeRuntimePlugins.test.ts", "src/__tests__/agentDev.integration.test.ts"])).toBe(true)
})

test("CLI dist build selection builds for directories, broad paths, and unknown selectors", () => {
  expect(shouldBuildCliDistForVitestArgv([...base, "."])).toBe(true)
  expect(shouldBuildCliDistForVitestArgv([...base, "src/__tests__"])).toBe(true)
  expect(shouldBuildCliDistForVitestArgv([...base, resolve(process.cwd(), "src/__tests__")])).toBe(true)
  expect(shouldBuildCliDistForVitestArgv([...base, "src/__tests__/unknown.test.ts"])).toBe(true)
  expect(shouldBuildCliDistForVitestArgv([...base, "folderModeRuntimePlugins"])).toBe(true)
})

test("CLI dist build selection skips only known concrete pure unit test files", () => {
  expect(shouldBuildCliDistForVitestArgv([...base, "src/__tests__/folderModeRuntimePlugins.test.ts"])).toBe(false)
  expect(shouldBuildCliDistForVitestArgv([...base, "./src/__tests__/cliVitestBuildSelection.test.ts"])).toBe(false)
  expect(shouldBuildCliDistForVitestArgv([...base, resolve(process.cwd(), "src/__tests__/folderModeRuntimePlugins.test.ts")])).toBe(false)
})

test("CLI dist build selection parses option values without treating them as files", () => {
  const argv = [...base, "--project", "cli", "--maxWorkers", "1", "--testNamePattern", "static assets", "src/__tests__/folderModeRuntimePlugins.test.ts"]

  expect(collectVitestFileFilters(argv)).toEqual(["src/__tests__/foldermoderuntimeplugins.test.ts"])
  expect(shouldBuildCliDistForVitestArgv(argv)).toBe(false)
})
