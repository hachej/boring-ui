import { describe, expect, it } from "vitest"
import {
  BORING_PLUGIN_MANIFEST_ERROR_CODES,
  isValidBoringPluginId,
  isSafePluginRelativeGlob,
  isSafePluginRelativePath,
  validateBoringPluginManifest,
} from "../manifest"

// ---------------------------------------------------------------------------
// isValidBoringPluginId
// ---------------------------------------------------------------------------

describe("isValidBoringPluginId", () => {
  it("accepts minimal 2-char id", () => {
    expect(isValidBoringPluginId("ab")).toBe(true)
  })

  it("accepts kebab-case ids", () => {
    expect(isValidBoringPluginId("csv-viewer")).toBe(true)
    expect(isValidBoringPluginId("my-awesome-plugin")).toBe(true)
  })

  it("accepts alphanumeric ids", () => {
    expect(isValidBoringPluginId("plugin1")).toBe(true)
    expect(isValidBoringPluginId("p1")).toBe(true)
  })

  it("rejects empty string", () => {
    expect(isValidBoringPluginId("")).toBe(false)
  })

  it("rejects single-character id", () => {
    expect(isValidBoringPluginId("a")).toBe(false)
  })

  it("rejects ids with uppercase letters", () => {
    expect(isValidBoringPluginId("CSV-viewer")).toBe(false)
    expect(isValidBoringPluginId("CsvViewer")).toBe(false)
  })

  it("rejects ids with leading hyphens", () => {
    expect(isValidBoringPluginId("-plugin")).toBe(false)
  })

  it("rejects ids with trailing hyphens", () => {
    expect(isValidBoringPluginId("plugin-")).toBe(false)
  })

  it("rejects ids with consecutive hyphens", () => {
    expect(isValidBoringPluginId("csv--viewer")).toBe(false)
  })

  it("rejects ids with spaces", () => {
    expect(isValidBoringPluginId("csv viewer")).toBe(false)
  })

  it("rejects ids longer than 64 characters", () => {
    expect(isValidBoringPluginId("a".repeat(65))).toBe(false)
  })

  it("accepts ids exactly 64 characters", () => {
    // 64-char: starts and ends with alphanumeric, all lowercase
    const id = "a" + "b".repeat(62) + "c"
    expect(id.length).toBe(64)
    expect(isValidBoringPluginId(id)).toBe(true)
  })

  it("rejects non-string inputs", () => {
    expect(isValidBoringPluginId(null as unknown as string)).toBe(false)
    expect(isValidBoringPluginId(undefined as unknown as string)).toBe(false)
    expect(isValidBoringPluginId(123 as unknown as string)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isSafePluginRelativePath
// ---------------------------------------------------------------------------

describe("isSafePluginRelativePath", () => {
  it("accepts simple relative paths", () => {
    expect(isSafePluginRelativePath("plugin.ts")).toBe(true)
    expect(isSafePluginRelativePath("src/index.ts")).toBe(true)
    expect(isSafePluginRelativePath("a/b/c.js")).toBe(true)
  })

  it("rejects empty string", () => {
    expect(isSafePluginRelativePath("")).toBe(false)
  })

  it("rejects absolute paths", () => {
    expect(isSafePluginRelativePath("/etc/passwd")).toBe(false)
    expect(isSafePluginRelativePath("/home/user/file.ts")).toBe(false)
  })

  it("rejects Windows-style absolute paths", () => {
    expect(isSafePluginRelativePath("C:\\foo\\bar")).toBe(false)
    expect(isSafePluginRelativePath("C:/foo/bar")).toBe(false)
  })

  it("rejects traversal paths", () => {
    expect(isSafePluginRelativePath("../secret")).toBe(false)
    expect(isSafePluginRelativePath("../../etc/passwd")).toBe(false)
    expect(isSafePluginRelativePath("src/../../../etc")).toBe(false)
  })

  it("rejects paths that are just '..'", () => {
    expect(isSafePluginRelativePath("..")).toBe(false)
  })

  it("rejects backslash paths", () => {
    expect(isSafePluginRelativePath("src\\index.ts")).toBe(false)
  })

  it("rejects non-string inputs", () => {
    expect(isSafePluginRelativePath(null as unknown as string)).toBe(false)
    expect(isSafePluginRelativePath(undefined as unknown as string)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isSafePluginRelativeGlob
// ---------------------------------------------------------------------------

describe("isSafePluginRelativeGlob", () => {
  it("accepts simple globs", () => {
    expect(isSafePluginRelativeGlob("**/*.ts")).toBe(true)
    expect(isSafePluginRelativeGlob("src/**/*.js")).toBe(true)
    expect(isSafePluginRelativeGlob("*.json")).toBe(true)
  })

  it("rejects negation patterns", () => {
    expect(isSafePluginRelativeGlob("!src/**/*.ts")).toBe(false)
  })

  it("rejects traversal via segments", () => {
    expect(isSafePluginRelativeGlob("../src/**")).toBe(false)
    expect(isSafePluginRelativeGlob("src/../**")).toBe(false)
  })

  it("rejects absolute paths", () => {
    expect(isSafePluginRelativeGlob("/etc/**")).toBe(false)
  })

  it("rejects empty string", () => {
    expect(isSafePluginRelativeGlob("")).toBe(false)
  })

  it("rejects non-string inputs", () => {
    expect(isSafePluginRelativeGlob(null as unknown as string)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// BORING_PLUGIN_MANIFEST_ERROR_CODES
// ---------------------------------------------------------------------------

describe("BORING_PLUGIN_MANIFEST_ERROR_CODES", () => {
  it("exports all expected error codes", () => {
    expect(BORING_PLUGIN_MANIFEST_ERROR_CODES.INVALID_ID).toBe("INVALID_ID")
    expect(BORING_PLUGIN_MANIFEST_ERROR_CODES.INVALID_VERSION).toBe("INVALID_VERSION")
    expect(BORING_PLUGIN_MANIFEST_ERROR_CODES.INVALID_ENTRY_PATH).toBe("INVALID_ENTRY_PATH")
    expect(BORING_PLUGIN_MANIFEST_ERROR_CODES.INVALID_GLOB).toBe("INVALID_GLOB")
    expect(BORING_PLUGIN_MANIFEST_ERROR_CODES.MISSING_REQUIRED_FIELD).toBe("MISSING_REQUIRED_FIELD")
    expect(BORING_PLUGIN_MANIFEST_ERROR_CODES.UNKNOWN_FIELD).toBe("UNKNOWN_FIELD")
  })
})

// ---------------------------------------------------------------------------
// validateBoringPluginManifest
// ---------------------------------------------------------------------------

describe("validateBoringPluginManifest", () => {
  // Valid cases

  it("accepts a minimal valid manifest", () => {
    const result = validateBoringPluginManifest({ id: "my-plugin", version: "1.0.0" })
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.manifest.id).toBe("my-plugin")
      expect(result.manifest.version).toBe("1.0.0")
    }
  })

  it("accepts a fully specified valid manifest", () => {
    const raw = {
      id: "csv-viewer",
      version: "2.3.1",
      label: "CSV Viewer",
      description: "View CSV files in a table",
      runtime: "front",
      permissions: {
        panels: true,
        commands: false,
        surfaceResolvers: false,
        providers: false,
      },
      entry: "src/plugin.ts",
    }
    const result = validateBoringPluginManifest(raw)
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.manifest.label).toBe("CSV Viewer")
      expect(result.manifest.runtime).toBe("front")
      expect(result.manifest.permissions?.panels).toBe(true)
      expect(result.manifest.entry).toBe("src/plugin.ts")
    }
  })

  it("accepts 'server' and 'both' as valid runtimes", () => {
    expect(
      validateBoringPluginManifest({ id: "my-plugin", version: "1.0.0", runtime: "server" }).valid,
    ).toBe(true)
    expect(
      validateBoringPluginManifest({ id: "my-plugin", version: "1.0.0", runtime: "both" }).valid,
    ).toBe(true)
  })

  it("accepts prerelease semver", () => {
    const result = validateBoringPluginManifest({ id: "my-plugin", version: "1.0.0-beta.1" })
    expect(result.valid).toBe(true)
  })

  it("accepts semver with build metadata", () => {
    const result = validateBoringPluginManifest({ id: "my-plugin", version: "1.0.0+build.123" })
    expect(result.valid).toBe(true)
  })

  // Missing required fields

  it("rejects missing id", () => {
    const result = validateBoringPluginManifest({ version: "1.0.0" })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.issues.some((i) => i.code === "MISSING_REQUIRED_FIELD" && i.field === "id")).toBe(true)
    }
  })

  it("rejects missing version", () => {
    const result = validateBoringPluginManifest({ id: "my-plugin" })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.issues.some((i) => i.code === "MISSING_REQUIRED_FIELD" && i.field === "version")).toBe(true)
    }
  })

  it("rejects non-object input", () => {
    expect(validateBoringPluginManifest(null).valid).toBe(false)
    expect(validateBoringPluginManifest("string").valid).toBe(false)
    expect(validateBoringPluginManifest([]).valid).toBe(false)
    expect(validateBoringPluginManifest(42).valid).toBe(false)
  })

  // Invalid id

  it("rejects invalid plugin id with uppercase", () => {
    const result = validateBoringPluginManifest({ id: "MyPlugin", version: "1.0.0" })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.issues.some((i) => i.code === "INVALID_ID")).toBe(true)
    }
  })

  it("rejects id with leading hyphen", () => {
    const result = validateBoringPluginManifest({ id: "-bad", version: "1.0.0" })
    expect(result.valid).toBe(false)
  })

  // Invalid version

  it("rejects non-semver version", () => {
    const result = validateBoringPluginManifest({ id: "my-plugin", version: "not-a-version" })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.issues.some((i) => i.code === "INVALID_VERSION")).toBe(true)
    }
  })

  it("rejects partial version like '1.0'", () => {
    const result = validateBoringPluginManifest({ id: "my-plugin", version: "1.0" })
    expect(result.valid).toBe(false)
  })

  // Invalid entry

  it("rejects absolute entry path", () => {
    const result = validateBoringPluginManifest({
      id: "my-plugin",
      version: "1.0.0",
      entry: "/etc/passwd",
    })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.issues.some((i) => i.code === "INVALID_ENTRY_PATH")).toBe(true)
    }
  })

  it("rejects traversal entry path", () => {
    const result = validateBoringPluginManifest({
      id: "my-plugin",
      version: "1.0.0",
      entry: "../../secret.ts",
    })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.issues.some((i) => i.code === "INVALID_ENTRY_PATH")).toBe(true)
    }
  })

  // Invalid runtime

  it("rejects unknown runtime value", () => {
    const result = validateBoringPluginManifest({ id: "my-plugin", version: "1.0.0", runtime: "browser" })
    expect(result.valid).toBe(false)
  })

  // Invalid permissions

  it("rejects permissions that is not an object", () => {
    const result = validateBoringPluginManifest({
      id: "my-plugin",
      version: "1.0.0",
      permissions: "all",
    })
    expect(result.valid).toBe(false)
  })

  it("rejects permission field with non-boolean value", () => {
    const result = validateBoringPluginManifest({
      id: "my-plugin",
      version: "1.0.0",
      permissions: { panels: "yes" },
    })
    expect(result.valid).toBe(false)
  })

  // Strict mode

  it("rejects unknown fields in strict mode", () => {
    const result = validateBoringPluginManifest(
      { id: "my-plugin", version: "1.0.0", extra: "field" },
      { strict: true },
    )
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.issues.some((i) => i.code === "UNKNOWN_FIELD" && i.field === "extra")).toBe(true)
    }
  })

  it("allows unknown fields when strict is false (default)", () => {
    const result = validateBoringPluginManifest({
      id: "my-plugin",
      version: "1.0.0",
      extra: "field",
    })
    expect(result.valid).toBe(true)
  })

  // Multiple issues at once

  it("collects multiple issues", () => {
    const result = validateBoringPluginManifest({ id: "BAD_ID", version: "not-semver" })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.issues.length).toBeGreaterThanOrEqual(2)
    }
  })
})
