import { describe, expect, it } from "vitest"
import {
  isSafePluginRelativePath,
  isValidBoringPluginId,
  validateBoringPluginManifest,
  validateBoringPluginManifestText,
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

  it("rejects removed package.json#boring UI registration arrays", () => {
    const result = validateBoringPluginManifest({
      name: "removed-ui-arrays",
      version: "1.0.0",
      boring: {
        front: "front/index.tsx",
        outputs: [],
        panels: [{ id: "ignored", title: "Ignored" }],
        commands: [{ id: "ignored-command", title: "Ignored" }],
        leftTabs: [{ id: "ignored-tab", title: "Ignored", panelId: "ignored" }],
        surfaceResolvers: [{ id: "ignored-resolver", surfaceKind: "x", panelId: "ignored" }],
      },
    })

    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "INVALID_FIELD", field: "boring.outputs" }),
        expect.objectContaining({ code: "INVALID_FIELD", field: "boring.panels" }),
        expect.objectContaining({ code: "INVALID_FIELD", field: "boring.commands" }),
        expect.objectContaining({ code: "INVALID_FIELD", field: "boring.leftTabs" }),
        expect.objectContaining({ code: "INVALID_FIELD", field: "boring.surfaceResolvers" }),
      ]))
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

  it("accepts boring.id as an explicit package discovery identity", () => {
    const result = validateBoringPluginManifest({
      name: "x",
      boring: { id: "filesystem", front: "front/index.tsx" },
    })
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.packageJson.boring?.id).toBe("filesystem")
    }
  })

  it("accepts hosted iframe panel manifests", () => {
    const result = validateBoringPluginManifest({
      name: "hosted-panel",
      version: "1.0.0",
      boring: { id: "hosted-panel", label: "Hosted", iframePanels: [{ id: "main", title: "Main", entry: "panel.html", placement: "right" }] },
    })
    expect(result.valid).toBe(true)
    if (result.valid) expect(result.packageJson.boring?.iframePanels?.[0]?.entry).toBe("panel.html")
  })

  it("rejects unsafe hosted iframe entries", () => {
    const result = validateBoringPluginManifest({
      name: "hosted-panel",
      boring: { iframePanels: [
        { id: "main", title: "Main", entry: "../panel.html" },
        { id: "main", title: "Other", entry: "panel.txt" },
      ] },
    })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "INVALID_PATH", field: "boring.iframePanels[0].entry" }),
        expect.objectContaining({ code: "INVALID_PATH", field: "boring.iframePanels[1].entry" }),
      ]))
    }
  })

  it("allows hosted iframe duplicate panel ids for hosted-scan diagnostics", () => {
    const result = validateBoringPluginManifest({
      name: "hosted-panel",
      boring: { iframePanels: [
        { id: "main", title: "Main", entry: "panel.html" },
        { id: "main", title: "Other", entry: "other.html" },
      ] },
    })
    expect(result.valid).toBe(true)
  })

  it("rejects oversized manifest text before parsing", () => {
    const result = validateBoringPluginManifestText("{" + "\"x\":" + JSON.stringify("x".repeat(300 * 1024)) + "}")
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.issues[0]).toEqual(expect.objectContaining({ code: "SIZE_LIMIT_EXCEEDED" }))
  })

  it("rejects invalid boring.id", () => {
    const result = validateBoringPluginManifest({
      name: "x",
      boring: { id: "bad plugin", front: "front/index.tsx" },
    })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.issues).toContainEqual(expect.objectContaining({ code: "INVALID_ID", field: "boring.id" }))
    }
  })
})
