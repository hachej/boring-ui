/**
 * Tests for the hot-reload coordinator and associated hardening.
 *
 * Covers:
 *  1. Concurrent load race (per-id promise lock)
 *  2. Partial registration rollback
 *  3. Factory error vs registry error distinction
 *  4. Stale record cleanup (unload of not-loaded id)
 *  5. loadedAt uses Date.now() (number, not Date object)
 *  6. Reserved ID prevention
 *  7. Semver format validation
 *  8. Path traversal edge cases
 *  9. Glob safety
 * 10. Double-register guard in capturing API
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { ComponentType } from "react"
import { PluginCoordinator } from "../coordinator"
import type {
  CoordinatorCommandRegistry,
  CoordinatorPanelRegistry,
  CoordinatorSurfaceResolverRegistry,
  CoordinatorRegistries,
  BoringPluginFactory,
  BoringPluginRuntimeRecord,
} from "../coordinator"
import { createCapturingAPI } from "../authoring"
import type { BoringPluginManifest } from "../manifest"
import {
  isSafePluginRelativePath,
  isSafePluginRelativeGlob,
  validateBoringPluginManifest,
} from "../manifest"

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeManifest(overrides: Partial<BoringPluginManifest> = {}): BoringPluginManifest {
  return {
    id: "test-plugin",
    version: "1.0.0",
    ...overrides,
  }
}

const DummyComponent: ComponentType<unknown> = () => null

/** A factory that registers one panel and one command. */
const basicFactory: BoringPluginFactory = (api) => {
  api.panels.register({ id: "panel-a", label: "Panel A", component: DummyComponent })
  api.commands.register({ id: "cmd-a", label: "Command A", handler: () => {} })
}

/** Build a minimal in-memory registry set. */
function makeRegistries(overrides: Partial<CoordinatorRegistries> = {}): {
  registries: CoordinatorRegistries
  panelsMap: Map<string, unknown>
  commandsMap: Map<string, unknown>
} {
  const panelsMap = new Map<string, unknown>()
  const commandsMap = new Map<string, unknown>()

  const panels: CoordinatorPanelRegistry = {
    register(id, reg) {
      panelsMap.set(id, reg)
    },
    unregisterByPluginId(pluginId) {
      for (const [id, reg] of panelsMap) {
        if ((reg as { pluginId?: string }).pluginId === pluginId) {
          panelsMap.delete(id)
        }
      }
    },
  }

  const commands: CoordinatorCommandRegistry = {
    registerCommand(reg) {
      commandsMap.set(reg.id, reg)
    },
    unregisterByPluginId(pluginId) {
      for (const [id, reg] of commandsMap) {
        if ((reg as { pluginId?: string }).pluginId === pluginId) {
          commandsMap.delete(id)
        }
      }
    },
  }

  const registries: CoordinatorRegistries = {
    panels,
    commands,
    ...overrides,
  }

  return { registries, panelsMap, commandsMap }
}

// ---------------------------------------------------------------------------
// 1. Concurrent load race
// ---------------------------------------------------------------------------

describe("1. Concurrent load race", () => {
  it("serializes concurrent load calls for the same id", async () => {
    const events: string[] = []

    // Slow factory: resolves after a tick
    let resolveFirst!: () => void
    const firstLatch = new Promise<void>((res) => { resolveFirst = res })

    const slowFactory: BoringPluginFactory = async (api) => {
      events.push("first:start")
      await firstLatch
      api.panels.register({ id: "slow-panel", label: "Slow", component: DummyComponent })
      events.push("first:end")
    }

    const fastFactory: BoringPluginFactory = (api) => {
      events.push("second:start")
      api.panels.register({ id: "fast-panel", label: "Fast", component: DummyComponent })
      events.push("second:end")
    }

    const { registries } = makeRegistries()
    const coordinator = new PluginCoordinator({ registries })
    const manifest = makeManifest()

    const p1 = coordinator.load(manifest, slowFactory)
    const p2 = coordinator.load(manifest, fastFactory)

    // The first load is waiting. Let it finish.
    resolveFirst()
    const [r1, r2] = await Promise.all([p1, p2])

    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)

    // The second factory must start only after the first has finished.
    const firstEnd = events.indexOf("first:end")
    const secondStart = events.indexOf("second:start")
    expect(firstEnd).toBeLessThan(secondStart)
  })

  it("second load waits even if the first fails", async () => {
    const { registries } = makeRegistries()
    const coordinator = new PluginCoordinator({ registries })
    const manifest = makeManifest()

    const failingFactory: BoringPluginFactory = () => {
      throw new Error("boom")
    }
    const goodFactory: BoringPluginFactory = (api) => {
      api.panels.register({ id: "panel-ok", label: "OK", component: DummyComponent })
    }

    const p1 = coordinator.load(manifest, failingFactory)
    const p2 = coordinator.load(manifest, goodFactory)

    const [r1, r2] = await Promise.all([p1, p2])

    expect(r1.ok).toBe(false)
    expect(r2.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 2. Partial registration rollback
// ---------------------------------------------------------------------------

describe("2. Partial registration rollback", () => {
  it("rolls back panel registrations when command registration fails", async () => {
    const { registries, panelsMap, commandsMap } = makeRegistries()

    // Make command registration throw on the first call
    let commandCallCount = 0
    const originalRegisterCommand = registries.commands.registerCommand.bind(registries.commands)
    registries.commands.registerCommand = (reg) => {
      commandCallCount++
      if (commandCallCount === 1) {
        throw new Error("command registry rejected")
      }
      originalRegisterCommand(reg)
    }

    const coordinator = new PluginCoordinator({ registries })

    const factory: BoringPluginFactory = (api) => {
      api.panels.register({ id: "panel-1", label: "P1", component: DummyComponent })
      api.panels.register({ id: "panel-2", label: "P2", component: DummyComponent })
      api.commands.register({ id: "cmd-1", label: "C1", handler: () => {} })
    }

    const result = await coordinator.load(makeManifest(), factory)

    expect(result.ok).toBe(false)
    // Both panels must be rolled back
    expect(panelsMap.size).toBe(0)
    expect(commandsMap.size).toBe(0)
    expect(coordinator.isLoaded("test-plugin")).toBe(false)
  })

  it("rolls back both panels and commands when the second command throws", async () => {
    const { registries, panelsMap, commandsMap } = makeRegistries()

    let commandCallCount = 0
    registries.commands.registerCommand = (reg) => {
      commandCallCount++
      if (commandCallCount === 2) {
        throw new Error("second command rejected")
      }
      commandsMap.set(reg.id, reg)
    }

    const coordinator = new PluginCoordinator({ registries })

    const factory: BoringPluginFactory = (api) => {
      api.panels.register({ id: "p1", label: "P1", component: DummyComponent })
      api.commands.register({ id: "c1", label: "C1", handler: () => {} })
      api.commands.register({ id: "c2", label: "C2", handler: () => {} })
    }

    const result = await coordinator.load(makeManifest(), factory)

    expect(result.ok).toBe(false)
    // Must be fully rolled back, not partial
    expect(panelsMap.size).toBe(0)
    expect(commandsMap.size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 3. Factory error vs registry error
// ---------------------------------------------------------------------------

describe("3. Factory error vs registry error", () => {
  it("reports 'factory-error' in diagnostic when the factory itself throws", async () => {
    const { registries } = makeRegistries()
    const coordinator = new PluginCoordinator({ registries })

    const factory: BoringPluginFactory = () => {
      throw new TypeError("plugin code crashed")
    }

    const result = await coordinator.load(makeManifest(), factory)

    expect(result.ok).toBe(false)
    expect(result.diagnostics.length).toBeGreaterThan(0)
    const msg = result.diagnostics[0].message
    expect(msg).toMatch(/factory-error/)
    expect(msg).toMatch(/plugin code crashed/)
  })

  it("reports 'registry-error' in diagnostic when a registry throws with _registryRejection marker", async () => {
    const { registries } = makeRegistries()

    const registryError = Object.assign(new Error("duplicate panel id"), {
      _registryRejection: true,
    })
    registries.panels.register = () => { throw registryError }

    const coordinator = new PluginCoordinator({ registries })

    const factory: BoringPluginFactory = (api) => {
      api.panels.register({ id: "p1", label: "P1", component: DummyComponent })
    }

    const result = await coordinator.load(makeManifest(), factory)

    expect(result.ok).toBe(false)
    const msg = result.diagnostics[0].message
    expect(msg).toMatch(/registry-error/)
  })

  it("reports 'factory-error' when registry throws without the marker", async () => {
    const { registries } = makeRegistries()

    registries.panels.register = () => { throw new Error("plain error") }

    const coordinator = new PluginCoordinator({ registries })

    const factory: BoringPluginFactory = (api) => {
      api.panels.register({ id: "p1", label: "P1", component: DummyComponent })
    }

    const result = await coordinator.load(makeManifest(), factory)

    expect(result.ok).toBe(false)
    // Without the marker, classified as factory-error (conservative)
    const msg = result.diagnostics[0].message
    expect(msg).toMatch(/factory-error/)
  })
})

// ---------------------------------------------------------------------------
// 4. Stale record cleanup — unload of not-loaded plugin
// ---------------------------------------------------------------------------

describe("4. Stale record cleanup", () => {
  it("returns ok:false with a warning when unloading a plugin that is not loaded", async () => {
    const { registries } = makeRegistries()
    const coordinator = new PluginCoordinator({ registries })

    const result = await coordinator.unload("not-loaded-plugin")

    expect(result.ok).toBe(false)
    expect(result.diagnostics.length).toBeGreaterThan(0)
    expect(result.diagnostics[0].kind).toBe("warning")
    expect(result.diagnostics[0].message).toMatch(/not currently loaded/)
  })

  it("succeeds when unloading a plugin that is actually loaded", async () => {
    const { registries, panelsMap } = makeRegistries()
    const coordinator = new PluginCoordinator({ registries })

    await coordinator.load(makeManifest(), basicFactory)
    expect(panelsMap.size).toBe(1)

    const result = await coordinator.unload("test-plugin")
    expect(result.ok).toBe(true)
    expect(panelsMap.size).toBe(0)
    expect(coordinator.isLoaded("test-plugin")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 5. loadedAt timestamp
// ---------------------------------------------------------------------------

describe("5. loadedAt timestamp", () => {
  it("loadedAt is a number (Date.now()), not a Date object", async () => {
    const { registries } = makeRegistries()
    const coordinator = new PluginCoordinator({ registries })

    const before = Date.now()
    const result = await coordinator.load(makeManifest(), basicFactory)
    const after = Date.now()

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { loadedAt } = result.record
    expect(typeof loadedAt).toBe("number")
    expect(loadedAt).toBeGreaterThanOrEqual(before)
    expect(loadedAt).toBeLessThanOrEqual(after)
  })
})

// ---------------------------------------------------------------------------
// 6. Reserved ID prevention
// ---------------------------------------------------------------------------

describe("6. Reserved ID prevention", () => {
  it("rejects a plugin whose id is in the reservedIds list", async () => {
    const { registries } = makeRegistries()
    const coordinator = new PluginCoordinator({
      registries,
      reservedIds: ["workspace-core", "chat-panel"],
    })

    const result = await coordinator.load(
      makeManifest({ id: "workspace-core" }),
      basicFactory,
    )

    expect(result.ok).toBe(false)
    const msg = result.diagnostics[0].message
    expect(msg).toMatch(/reserved/)
  })

  it("accepts a plugin whose id is not in the reservedIds list", async () => {
    const { registries } = makeRegistries()
    const coordinator = new PluginCoordinator({
      registries,
      reservedIds: ["workspace-core"],
    })

    const result = await coordinator.load(makeManifest({ id: "my-plugin" }), basicFactory)
    expect(result.ok).toBe(true)
  })

  it("validateBoringPluginManifest rejects reserved ids when passed via options", () => {
    const result = validateBoringPluginManifest(
      { id: "forbidden-id", version: "1.0.0" },
      { reservedIds: ["forbidden-id"] },
    )
    expect(result.valid).toBe(false)
    if (result.valid) return
    expect(result.issues[0].code).toBe("INVALID_ID")
    expect(result.issues[0].message).toMatch(/reserved/)
  })
})

// ---------------------------------------------------------------------------
// 7. Semver format validation
// ---------------------------------------------------------------------------

describe("7. Semver format", () => {
  it("accepts valid semver strings", () => {
    const valid = ["1.0.0", "0.0.1", "1.2.3", "1.0.0-beta.1", "1.0.0+build.1"]
    for (const version of valid) {
      const r = validateBoringPluginManifest({ id: "ok", version })
      expect(r.valid).toBe(true)
    }
  })

  it("rejects non-semver version strings with INVALID_VERSION", () => {
    // These are syntactically strings but fail semver format
    const invalidFormat = ["1", "1.0", "v1.0.0", "1.0.0.0", "latest"]
    for (const version of invalidFormat) {
      const r = validateBoringPluginManifest({ id: "ok", version })
      expect(r.valid).toBe(false)
      if (!r.valid) {
        expect(r.issues.some((i) => i.code === "INVALID_VERSION")).toBe(true)
      }
    }
  })

  it("rejects empty string version with MISSING_REQUIRED_FIELD", () => {
    const r = validateBoringPluginManifest({ id: "ok", version: "" })
    expect(r.valid).toBe(false)
    if (!r.valid) {
      expect(r.issues.some((i) => i.code === "MISSING_REQUIRED_FIELD" && i.field === "version")).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// 8. Path traversal edge cases
// ---------------------------------------------------------------------------

describe("8. isSafePluginRelativePath — edge cases", () => {
  const safe = (p: string) => expect(isSafePluginRelativePath(p)).toBe(true)
  const unsafe = (p: string) => expect(isSafePluginRelativePath(p)).toBe(false)

  it("rejects empty string", () => unsafe(""))
  it("rejects '.'", () => unsafe("."))
  it("rejects '..'", () => unsafe(".."))
  it("rejects paths starting with '/'", () => unsafe("/etc/passwd"))
  it("rejects paths with null bytes", () => unsafe("foo\0bar"))
  it("rejects Windows drive paths (backslash separator)", () => unsafe("C:\\Users\\foo"))
  it("rejects Windows drive paths (forward slash separator)", () => unsafe("C:/Users/foo"))
  it("rejects UNC paths starting with '\\\\'", () => unsafe("\\\\server\\share"))
  it("rejects URL-encoded traversal %2e%2e", () => unsafe("src/%2e%2e/evil"))
  it("rejects URL-encoded traversal %2E%2E (uppercase)", () => unsafe("src/%2E%2E/evil"))
  it("rejects URL-encoded traversal mixed case", () => unsafe("src/%2e%2E/evil"))
  it("rejects paths containing backslashes", () => unsafe("src\\evil"))
  it("rejects '../foo'", () => unsafe("../foo"))
  it("rejects 'foo/../bar'", () => unsafe("foo/../bar"))

  it("accepts 'plugin.ts'", () => safe("plugin.ts"))
  it("accepts 'src/index.ts'", () => safe("src/index.ts"))
  it("accepts 'deep/nested/file.js'", () => safe("deep/nested/file.js"))
  it("accepts filenames with dots that are not traversal", () => safe("component.test.tsx"))
  it("accepts paths starting with a dot segment that is not '..'", () => safe(".hidden/file.ts"))
})

// ---------------------------------------------------------------------------
// 9. Glob safety
// ---------------------------------------------------------------------------

describe("9. isSafePluginRelativeGlob", () => {
  const safe = (p: string) => expect(isSafePluginRelativeGlob(p)).toBe(true)
  const unsafe = (p: string) => expect(isSafePluginRelativeGlob(p)).toBe(false)

  it("rejects negation patterns starting with '!'", () => unsafe("!src/**"))
  it("rejects brace expansion containing '..'", () => unsafe("{../evil,ok}"))
  it("rejects brace expansion with nested traversal", () => unsafe("src/{foo,../../bar}"))
  it("rejects '**' combined with '..'", () => unsafe("**/../secret"))
  it("rejects '..' combined with '**'", () => unsafe("../foo/**"))
  it("rejects empty string", () => unsafe(""))
  it("rejects '..'", () => unsafe(".."))

  it("accepts '**/*.ts'", () => safe("**/*.ts"))
  it("accepts 'src/**/*.test.ts'", () => safe("src/**/*.test.ts"))
  it("accepts '{foo,bar}/*.ts'", () => safe("{foo,bar}/*.ts"))
  it("accepts simple file globs", () => safe("src/*.ts"))
})

// ---------------------------------------------------------------------------
// 10. Double-register guard in capturing API
// ---------------------------------------------------------------------------

describe("10. Double-register guard", () => {
  it("throws if the same panel id is registered twice in one factory call", () => {
    const { api } = createCapturingAPI()

    api.panels.register({ id: "panel-x", label: "P1", component: DummyComponent })

    expect(() => {
      api.panels.register({ id: "panel-x", label: "P2", component: DummyComponent })
    }).toThrow(/panel id "panel-x".*already registered/)
  })

  it("throws if the same command id is registered twice in one factory call", () => {
    const { api } = createCapturingAPI()

    api.commands.register({ id: "cmd-x", label: "C1", handler: () => {} })

    expect(() => {
      api.commands.register({ id: "cmd-x", label: "C2", handler: () => {} })
    }).toThrow(/command id "cmd-x".*already registered/)
  })

  it("allows the same panel id on separate capturing API instances (separate factory calls)", () => {
    const handle1 = createCapturingAPI()
    const handle2 = createCapturingAPI()

    handle1.api.panels.register({ id: "shared-panel", label: "P1", component: DummyComponent })

    // Should NOT throw — each factory call gets its own capturing API
    expect(() => {
      handle2.api.panels.register({ id: "shared-panel", label: "P2", component: DummyComponent })
    }).not.toThrow()
  })

  it("flush captures all registrations made before the double", () => {
    const { api, flush } = createCapturingAPI()

    api.panels.register({ id: "p1", label: "P1", component: DummyComponent })
    api.commands.register({ id: "c1", label: "C1", handler: () => {} })
    api.panels.register({ id: "p2", label: "P2", component: DummyComponent })

    // Now trigger a double — throws
    expect(() => {
      api.panels.register({ id: "p1", label: "Dup", component: DummyComponent })
    }).toThrow()

    // Flush still works — returns what was captured before the throw
    const captured = flush()
    expect(captured.panels).toHaveLength(2)
    expect(captured.commands).toHaveLength(1)
  })

  it("coordinator catches a double-register as a factory-error and rolls back", async () => {
    const { registries, panelsMap } = makeRegistries()
    const coordinator = new PluginCoordinator({ registries })

    const factory: BoringPluginFactory = (api) => {
      api.panels.register({ id: "dup", label: "First", component: DummyComponent })
      api.panels.register({ id: "dup", label: "Second", component: DummyComponent }) // throws
    }

    const result = await coordinator.load(makeManifest(), factory)

    expect(result.ok).toBe(false)
    expect(result.diagnostics[0].message).toMatch(/factory-error/)
    expect(panelsMap.size).toBe(0)
    expect(coordinator.isLoaded("test-plugin")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// General coordinator integration
// ---------------------------------------------------------------------------

describe("PluginCoordinator — general", () => {
  it("loads a valid plugin and records it", async () => {
    const { registries, panelsMap, commandsMap } = makeRegistries()
    const coordinator = new PluginCoordinator({ registries })

    const result = await coordinator.load(makeManifest(), basicFactory)

    expect(result.ok).toBe(true)
    expect(panelsMap.has("panel-a")).toBe(true)
    expect(commandsMap.has("cmd-a")).toBe(true)
    expect(coordinator.isLoaded("test-plugin")).toBe(true)
  })

  it("reloads a plugin (unload+load) when load is called for an already-loaded id", async () => {
    const { registries, panelsMap } = makeRegistries()
    const coordinator = new PluginCoordinator({ registries })

    await coordinator.load(makeManifest(), basicFactory)
    expect(panelsMap.has("panel-a")).toBe(true)

    // Second load replaces the first
    const updatedFactory: BoringPluginFactory = (api) => {
      api.panels.register({ id: "panel-b", label: "Panel B", component: DummyComponent })
    }
    const r2 = await coordinator.load(makeManifest(), updatedFactory)

    expect(r2.ok).toBe(true)
    expect(panelsMap.has("panel-a")).toBe(false)
    expect(panelsMap.has("panel-b")).toBe(true)
  })

  it("listLoaded returns all loaded plugins", async () => {
    const { registries } = makeRegistries()
    const coordinator = new PluginCoordinator({ registries })

    const manifests = [
      makeManifest({ id: "plugin-one" }),
      makeManifest({ id: "plugin-two" }),
    ]

    for (const manifest of manifests) {
      await coordinator.load(manifest, () => {})
    }

    const loaded = coordinator.listLoaded()
    expect(loaded.map((r) => r.id).sort()).toEqual(["plugin-one", "plugin-two"])
  })

  it("getRecord returns undefined for an unloaded plugin", () => {
    const { registries } = makeRegistries()
    const coordinator = new PluginCoordinator({ registries })
    expect(coordinator.getRecord("nonexistent")).toBeUndefined()
  })

  it("includes a manifest validation diagnostic when the manifest is invalid", async () => {
    const { registries } = makeRegistries()
    const coordinator = new PluginCoordinator({ registries })

    const result = await coordinator.load(
      makeManifest({ id: "INVALID ID!" }),
      basicFactory,
    )

    expect(result.ok).toBe(false)
    expect(result.diagnostics[0].message).toMatch(/INVALID_ID/)
  })
})
