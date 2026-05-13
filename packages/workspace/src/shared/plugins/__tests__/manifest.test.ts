import { describe, expect, it } from "vitest"
import {
  BORING_PLUGIN_MANIFEST_ERROR_CODES,
  isSafePluginRelativeGlob,
  isSafePluginRelativePath,
  isValidBoringPluginId,
  validateBoringPluginManifest,
} from "../manifest"

describe("package.json plugin manifest helpers", () => {
  it("validates ids accepted by package.json#boring", () => {
    expect(isValidBoringPluginId("playground-data")).toBe(true)
    expect(isValidBoringPluginId("@scope/name".replace(/^@/, "").replaceAll("/", "-"))).toBe(true)
    expect(isValidBoringPluginId("")).toBe(false)
    expect(isValidBoringPluginId("../escape")).toBe(false)
    expect(isValidBoringPluginId("-plugin")).toBe(false)
  })

  it("accepts safe relative paths and rejects escapes", () => {
    expect(isSafePluginRelativePath("front/index.tsx")).toBe(true)
    expect(isSafePluginRelativePath("agent/index.ts")).toBe(true)
    expect(isSafePluginRelativePath("../secret")).toBe(false)
    expect(isSafePluginRelativePath(".")).toBe(false)
    expect(isSafePluginRelativePath("/etc/passwd")).toBe(false)
    expect(isSafePluginRelativePath("C:/tmp/file.ts")).toBe(false)
    expect(isSafePluginRelativePath("front\\index.tsx")).toBe(false)
    expect(isSafePluginRelativePath("bad\0path")).toBe(false)
  })

  it("keeps glob helper conservative", () => {
    expect(isSafePluginRelativeGlob("src/**/*.ts")).toBe(true)
    expect(isSafePluginRelativeGlob("!src/**/*.ts")).toBe(false)
    expect(isSafePluginRelativeGlob("../src/**")).toBe(false)
  })

  it("exports stable manifest error codes", () => {
    expect(BORING_PLUGIN_MANIFEST_ERROR_CODES.INVALID_ID).toBe("INVALID_ID")
    expect(BORING_PLUGIN_MANIFEST_ERROR_CODES.INVALID_VERSION).toBe("INVALID_VERSION")
    expect(BORING_PLUGIN_MANIFEST_ERROR_CODES.INVALID_FIELD).toBe("INVALID_FIELD")
    expect(BORING_PLUGIN_MANIFEST_ERROR_CODES.INVALID_PATH).toBe("INVALID_PATH")
    expect(BORING_PLUGIN_MANIFEST_ERROR_CODES.MISSING_REQUIRED_FIELD).toBe("MISSING_REQUIRED_FIELD")
  })
})

describe("validateBoringPluginManifest", () => {
  it("accepts package.json#boring for workspace/UI entrypoints", () => {
    const result = validateBoringPluginManifest({
      name: "@hachej/boring-plugin-playground",
      version: "1.2.3",
      boring: {
        front: "front/index.tsx",
        server: "server/index.ts",
        label: "Playground Data",
      },
    })

    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.packageJson.boring?.front).toBe("front/index.tsx")
    }
  })

  it("strips legacy package.json#boring UI registration arrays", () => {
    const result = validateBoringPluginManifest({
      name: "legacy-ui-arrays",
      version: "1.0.0",
      boring: {
        front: "front/index.tsx",
        panels: [{ id: "ignored", title: "Ignored" }],
        commands: [{ id: "ignored-command", title: "Ignored" }],
        leftTabs: [{ id: "ignored-tab", title: "Ignored", panelId: "ignored" }],
        surfaceResolvers: [{ id: "ignored-resolver", surfaceKind: "x", panelId: "ignored" }],
      },
    })

    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.packageJson.boring).toEqual({
        front: "front/index.tsx",
      })
    }
  })

  it("accepts package.json#pi for agent/Pi contributions", () => {
    const result = validateBoringPluginManifest({
      name: "boring-plugin-agent-tools",
      version: "0.0.1",
      pi: {
        extensions: ["agent/index.ts"],
        skills: ["agent/skills"],
        packages: [{ source: "file:.", extensions: ["agent/index.ts"] }],
        systemPrompt: "Use the plugin tools for plugin data.",
      },
    })

    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.packageJson.pi?.extensions).toEqual(["agent/index.ts"])
      expect(result.packageJson.pi?.skills).toEqual(["agent/skills"])
    }
  })

  it("accepts one package with both pi and boring namespaces", () => {
    const result = validateBoringPluginManifest({
      name: "boring-plugin-full-stack",
      version: "1.0.0-beta.1",
      boring: { front: "front/index.tsx", server: false },
      pi: { extensions: ["agent/index.ts"] },
    })

    expect(result.valid).toBe(true)
  })

  it("rejects packages without pi or boring metadata", () => {
    const result = validateBoringPluginManifest({ name: "plain-package", version: "1.0.0" })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.issues).toContainEqual(expect.objectContaining({ code: "MISSING_REQUIRED_FIELD", field: "boring|pi" }))
    }
  })

  it("rejects unsafe paths in either namespace", () => {
    const result = validateBoringPluginManifest({
      name: "bad-plugin",
      version: "1.0.0",
      boring: { front: "../front.tsx" },
      pi: { extensions: ["/tmp/agent.ts"] },
    })

    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "INVALID_PATH", field: "boring.front" }),
        expect.objectContaining({ code: "INVALID_PATH", field: "pi.extensions[0]" }),
      ]))
    }
  })

  it("rejects unsafe pi package sources", () => {
    const result = validateBoringPluginManifest({
      name: "bad-package-sources",
      version: "1.0.0",
      pi: {
        packages: [
          "/tmp/plugin",
          { source: "../escape" },
          { source: "file:/tmp/plugin" },
        ],
      },
    })

    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "INVALID_PATH", field: "pi.packages[0]" }),
        expect.objectContaining({ code: "INVALID_PATH", field: "pi.packages[1].source" }),
        expect.objectContaining({ code: "INVALID_PATH", field: "pi.packages[2].source" }),
      ]))
    }
  })

  it("leaves nested pi package resource filters to Pi", () => {
    const result = validateBoringPluginManifest({
      name: "pi-owned-package-resources",
      version: "1.0.0",
      pi: {
        packages: [
          {
            source: "file:.",
            extensions: ["../pi-owned-pattern.ts"],
            skills: ["+pi-owned-skill-filter"],
            prompts: ["pi-owned-prompt.md"],
          },
        ],
      },
    })

    expect(result.valid).toBe(true)
  })

  it("rejects boring.id; package.json#name is the plugin identity", () => {
    const result = validateBoringPluginManifest({
      name: "x",
      boring: { id: "filesystem", front: "front/index.tsx" },
    })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.issues).toContainEqual(expect.objectContaining({ code: "INVALID_FIELD", field: "boring.id" }))
    }
  })
})
