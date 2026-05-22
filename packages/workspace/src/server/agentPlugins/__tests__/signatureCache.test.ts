import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import {
  PLUGIN_SIGNATURE_CACHE_FILE,
  clearPluginSignatureCache,
  pluginFileSignature,
  readPluginSignatureCache,
  writePluginSignatureCache,
} from "../signatureCache"

describe("signatureCache", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "boring-sigcache-"))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  describe("readPluginSignatureCache", () => {
    test("returns null when the cache file is absent", () => {
      expect(readPluginSignatureCache(dir)).toBeNull()
    })

    test("returns null for malformed JSON", () => {
      writeFileSync(join(dir, PLUGIN_SIGNATURE_CACHE_FILE), "{ not json", "utf8")
      expect(readPluginSignatureCache(dir)).toBeNull()
    })

    test("returns null when version is not 1", () => {
      writeFileSync(
        join(dir, PLUGIN_SIGNATURE_CACHE_FILE),
        JSON.stringify({ version: 2, serverSignature: "abc", loadedAt: 1 }),
        "utf8",
      )
      expect(readPluginSignatureCache(dir)).toBeNull()
    })

    test("returns null when the payload is not an object", () => {
      writeFileSync(join(dir, PLUGIN_SIGNATURE_CACHE_FILE), "[]", "utf8")
      expect(readPluginSignatureCache(dir)).toBeNull()
      writeFileSync(join(dir, PLUGIN_SIGNATURE_CACHE_FILE), '"a-string"', "utf8")
      expect(readPluginSignatureCache(dir)).toBeNull()
    })

    test("returns null when serverSignature is the wrong type", () => {
      writeFileSync(
        join(dir, PLUGIN_SIGNATURE_CACHE_FILE),
        JSON.stringify({ version: 1, serverSignature: 42, loadedAt: 1 }),
        "utf8",
      )
      expect(readPluginSignatureCache(dir)).toBeNull()
    })

    test("accepts serverSignature: null (no server entry on load)", () => {
      writeFileSync(
        join(dir, PLUGIN_SIGNATURE_CACHE_FILE),
        JSON.stringify({ version: 1, serverSignature: null, loadedAt: 7 }),
        "utf8",
      )
      const cache = readPluginSignatureCache(dir)
      expect(cache).toEqual({ version: 1, serverSignature: null, loadedAt: 7 })
    })

    test("defaults loadedAt to 0 when missing or non-numeric", () => {
      writeFileSync(
        join(dir, PLUGIN_SIGNATURE_CACHE_FILE),
        JSON.stringify({ version: 1, serverSignature: "abc" }),
        "utf8",
      )
      expect(readPluginSignatureCache(dir)).toEqual({
        version: 1,
        serverSignature: "abc",
        loadedAt: 0,
      })
    })
  })

  test("write → read round-trips and stamps loadedAt", () => {
    const before = Date.now()
    writePluginSignatureCache(dir, { serverSignature: "12345:42" })
    const cache = readPluginSignatureCache(dir)
    expect(cache?.version).toBe(1)
    expect(cache?.serverSignature).toBe("12345:42")
    expect(cache?.loadedAt).toBeGreaterThanOrEqual(before)
  })

  test("clearPluginSignatureCache removes the file (no-op when absent)", () => {
    writePluginSignatureCache(dir, { serverSignature: null })
    expect(readPluginSignatureCache(dir)).not.toBeNull()
    clearPluginSignatureCache(dir)
    expect(readPluginSignatureCache(dir)).toBeNull()
    // Idempotent — second clear must not throw.
    clearPluginSignatureCache(dir)
  })

  describe("pluginFileSignature", () => {
    test('returns "missing" for undefined or nonexistent paths', () => {
      expect(pluginFileSignature(undefined)).toBe("missing")
      expect(pluginFileSignature(join(dir, "nope.ts"))).toBe("missing")
    })

    test("returns `${mtimeMs}:${size}` for an existing file", () => {
      const path = join(dir, "f.ts")
      writeFileSync(path, "hello", "utf8")
      const sig = pluginFileSignature(path)
      expect(sig).toMatch(/^\d+(\.\d+)?:5$/)
    })
  })
})
