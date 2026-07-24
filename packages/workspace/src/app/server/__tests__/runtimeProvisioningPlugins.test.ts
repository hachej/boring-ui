import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { describe, expect, it } from "vitest"

import { readWorkspacePluginPackageRuntimePlugins, readWorkspacePluginPackagePiSnapshot } from "../createWorkspaceAgentServer"
import { readBoringPlugins } from "../../../server/agentPlugins/scan"

function createPackage(): string {
  const root = mkdtempSync(join(tmpdir(), "boring-workspace-runtime-plugin-"))
  mkdirSync(join(root, "skills", "macro-transform"), { recursive: true })
  mkdirSync(join(root, "skills", "macro-deck"), { recursive: true })
  mkdirSync(join(root, "front"), { recursive: true })
  mkdirSync(join(root, "server"), { recursive: true })
  mkdirSync(join(root, "agent"), { recursive: true })
  writeFileSync(join(root, "skills", "macro-transform", "SKILL.md"), "# Transform\n")
  writeFileSync(join(root, "skills", "macro-deck", "SKILL.md"), "# Deck\n")
  writeFileSync(join(root, "front", "index.tsx"), 'export default definePlugin({ id: "boring-macro" })\n')
  writeFileSync(join(root, "server", "index.ts"), "export default {}\n")
  writeFileSync(join(root, "agent", "index.ts"), "export default {}\n")
  writeFileSync(join(root, "package.json"), JSON.stringify({
    name: "@boring/macro",
    version: "0.2.0",
    pi: {
      skills: ["skills/macro-transform", "skills/macro-deck"],
      systemPrompt: "Use bm for macro transforms.",
      packages: ["npm:pi-web-access"],
      extensions: ["agent/index.ts"],
    },
    boring: {
      label: "Macro",
      front: "front/index.tsx",
      server: "server/index.ts",
    },
  }, null, 2))
  return root
}

describe("workspace package runtime provisioning input", () => {
  it("maps package.json#pi.skills to structural plugin skills only", () => {
    const root = createPackage()
    const runtimePlugins = readWorkspacePluginPackageRuntimePlugins([root])

    expect(runtimePlugins).toEqual([{ id: "boring-macro", skills: [
      { name: "macro-transform", source: join(root, "skills", "macro-transform") },
      { name: "macro-deck", source: join(root, "skills", "macro-deck") },
    ] }])
  })

  it("keeps pi.systemPrompt/packages/extensions on the Pi path, not provisioning input", () => {
    const root = createPackage()
    const runtimePlugins = readWorkspacePluginPackageRuntimePlugins([root])
    const piSnapshot = readWorkspacePluginPackagePiSnapshot([root])

    expect(runtimePlugins[0]).not.toHaveProperty("systemPrompt")
    expect(runtimePlugins[0]).not.toHaveProperty("piPackages")
    expect(piSnapshot.systemPromptAppend).toContain("Use bm for macro transforms.")
    expect(piSnapshot.packages).toEqual(["npm:pi-web-access"])
    expect(piSnapshot.extensionPaths).toEqual([join(root, "agent", "index.ts")])
  })

  it("leaves boring.front and boring.server discovery unchanged and does not copy source trees", () => {
    const root = createPackage()
    const beforePlugins = readBoringPlugins([root])

    readWorkspacePluginPackageRuntimePlugins([root])

    const afterPlugins = readBoringPlugins([root])
    expect(afterPlugins[0].frontPath).toBe(join(root, "front", "index.tsx"))
    expect(afterPlugins[0].serverPath).toBe(join(root, "server", "index.ts"))
    expect(afterPlugins).toEqual(beforePlugins)
  })
})
