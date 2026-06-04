import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"

const testDir = dirname(fileURLToPath(import.meta.url))
const cliSource = join(testDir, "..", "server", "cli.ts")

test("boring-ui does not expose plugin self-test commands", async () => {
  const source = await readFile(cliSource, "utf8")

  expect(source).not.toContain('positionals[0] === "plugin"')
  expect(source).not.toContain('positionals[0] === "test-plugin"')
  expect(source).not.toContain("handlePluginCommand")
  expect(source).not.toContain("handleTestPluginCommand")
  expect(source).not.toContain("runPluginSelfTest")
})
