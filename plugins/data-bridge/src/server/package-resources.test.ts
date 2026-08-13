import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { createDataBridgeServerPlugin } from "./index"

const packageRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

describe("data bridge package resources", () => {
  it("declares and publishes its generic BSL skill", () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"))
    expect(manifest.files).toContain("skills")
    expect(manifest.pi.skills).toEqual(["skills/bsl-querying"])
    expect(manifest.pi.systemPrompt).not.toMatch(/Healio|tenant_id/)
    expect(existsSync(join(packageRoot, "skills/bsl-querying/SKILL.md"))).toBe(true)

    const plugin = createDataBridgeServerPlugin({ workspaceRoot: "/workspace", agentTool: false })
    expect(plugin.packageResources).toHaveLength(1)
    expect(plugin.packageResources?.[0]?.packageName).toBe("@hachej/boring-data-bridge")
    expect(fileURLToPath(plugin.packageResources?.[0]?.packageRoot as URL)).toBe(`${packageRoot}/`)
  })
})
