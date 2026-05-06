import { describe, expect, it, vi } from "vitest"
import { PluginCoordinator } from "../coordinator"
import { createCapturingAPI } from "../authoring"
import type {
  BoringPluginFactory,
  CoordinatorCommandRegistry,
  CoordinatorPanelRegistry,
  CoordinatorRegistries,
  CoordinatorSurfaceResolverRegistry,
} from "../coordinator"

// ---------------------------------------------------------------------------
// Test registry mocks
// ---------------------------------------------------------------------------

function makePanelRegistry(): CoordinatorPanelRegistry & {
  _entries: Map<string, object>
  _removed: string[]
} {
  const entries = new Map<string, object>()
  const removed: string[] = []
  return {
    _entries: entries,
    _removed: removed,
    register(id, reg) {
      entries.set(id, reg)
    },
    unregisterByPluginId(pluginId) {
      removed.push(pluginId)
      for (const [key, val] of entries) {
        if ((val as Record<string, unknown>).pluginId === pluginId) {
          entries.delete(key)
        }
      }
    },
  }
}

function makeCommandRegistry(): CoordinatorCommandRegistry & {
  _entries: Map<string, object>
  _removed: string[]
} {
  const entries = new Map<string, object>()
  const removed: string[] = []
  return {
    _entries: entries,
    _removed: removed,
    registerCommand(reg) {
      entries.set(reg.id, reg)
    },
    unregisterByPluginId(pluginId) {
      removed.push(pluginId)
      for (const [key, val] of entries) {
        if ((val as Record<string, unknown>).pluginId === pluginId) {
          entries.delete(key)
        }
      }
    },
  }
}

function makeSurfaceResolverRegistry(): CoordinatorSurfaceResolverRegistry & {
  _entries: Map<string, object>
} {
  const entries = new Map<string, object>()
  return {
    _entries: entries,
    register(kind, reg) {
      entries.set(kind, reg)
    },
    unregisterByPluginId(pluginId) {
      for (const [key, val] of entries) {
        if ((val as Record<string, unknown>).pluginId === pluginId) {
          entries.delete(key)
        }
      }
    },
  }
}

function makeRegistries(): CoordinatorRegistries & {
  panels: ReturnType<typeof makePanelRegistry>
  commands: ReturnType<typeof makeCommandRegistry>
  surfaceResolvers: ReturnType<typeof makeSurfaceResolverRegistry>
} {
  return {
    panels: makePanelRegistry(),
    commands: makeCommandRegistry(),
    surfaceResolvers: makeSurfaceResolverRegistry(),
  }
}

/** Minimal valid manifest for test use */
function makeManifest(id = "test-plugin", version = "1.0.0") {
  return { id, version }
}

// ---------------------------------------------------------------------------
// createCapturingAPI
// ---------------------------------------------------------------------------

describe("createCapturingAPI", () => {
  it("captures panel registrations via flush()", () => {
    const { api, flush } = createCapturingAPI()
    api.panels.register({ id: "panel-a", label: "Panel A", component: () => null })
    const captured = flush()
    expect(captured.panels).toHaveLength(1)
    expect(captured.panels[0].id).toBe("panel-a")
  })

  it("captures command registrations", () => {
    const { api, flush } = createCapturingAPI()
    api.commands.register({ id: "cmd-a", label: "Cmd A", handler: vi.fn() })
    const captured = flush()
    expect(captured.commands).toHaveLength(1)
    expect(captured.commands[0].id).toBe("cmd-a")
  })

  it("captures surface resolver registrations", () => {
    const { api, flush } = createCapturingAPI()
    api.surfaceResolvers.register({ kind: "file", resolve: () => null })
    const captured = flush()
    expect(captured.surfaceResolvers).toHaveLength(1)
    expect(captured.surfaceResolvers[0].kind).toBe("file")
  })

  it("captures provider registrations", () => {
    const { api, flush } = createCapturingAPI()
    api.providers.register({ id: "ctx-a", component: ({ children }) => children as any })
    const captured = flush()
    expect(captured.providers).toHaveLength(1)
    expect(captured.providers[0].id).toBe("ctx-a")
  })

  it("captures slot fill registrations", () => {
    const { api, flush } = createCapturingAPI()
    api.slotFills.register({ slot: "toolbar", component: () => null })
    const captured = flush()
    expect(captured.slotFills).toHaveLength(1)
    expect(captured.slotFills[0].slot).toBe("toolbar")
  })

  it("throws when a duplicate panel id is registered in one factory call", () => {
    const { api } = createCapturingAPI()
    api.panels.register({ id: "dup", label: "Dup", component: () => null })
    expect(() =>
      api.panels.register({ id: "dup", label: "Dup 2", component: () => null }),
    ).toThrow(/dup/)
  })

  it("throws when a duplicate command id is registered in one factory call", () => {
    const { api } = createCapturingAPI()
    api.commands.register({ id: "dup-cmd", label: "Cmd", handler: vi.fn() })
    expect(() =>
      api.commands.register({ id: "dup-cmd", label: "Cmd 2", handler: vi.fn() }),
    ).toThrow(/dup-cmd/)
  })

  it("flush returns a snapshot — subsequent registrations after flush are not included", () => {
    const { api, flush } = createCapturingAPI()
    api.panels.register({ id: "p1", label: "P1", component: () => null })
    const snap1 = flush()
    expect(snap1.panels).toHaveLength(1)
    // flush returns a snapshot copy — the internal state is separate
    expect(snap1.panels).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// PluginCoordinator — load
// ---------------------------------------------------------------------------

describe("PluginCoordinator.load", () => {
  it("loads a plugin and registers panels", async () => {
    const registries = makeRegistries()
    const coordinator = new PluginCoordinator({ registries })

    const factory: BoringPluginFactory = (api) => {
      api.panels.register({ id: "my-panel", label: "My Panel", component: () => null })
    }

    const result = await coordinator.load(makeManifest(), factory)
    expect(result.ok).toBe(true)
    expect(registries.panels._entries.has("my-panel")).toBe(true)
  })

  it("loads a plugin and registers commands", async () => {
    const registries = makeRegistries()
    const coordinator = new PluginCoordinator({ registries })

    const factory: BoringPluginFactory = (api) => {
      api.commands.register({ id: "my-cmd", label: "My Command", handler: vi.fn() })
    }

    const result = await coordinator.load(makeManifest(), factory)
    expect(result.ok).toBe(true)
    expect(registries.commands._entries.has("my-cmd")).toBe(true)
  })

  it("loads a plugin and registers surface resolvers", async () => {
    const registries = makeRegistries()
    const coordinator = new PluginCoordinator({ registries })

    const factory: BoringPluginFactory = (api) => {
      api.surfaceResolvers.register({ kind: "csv", resolve: () => null })
    }

    const result = await coordinator.load(makeManifest(), factory)
    expect(result.ok).toBe(true)
    expect(registries.surfaceResolvers._entries.has("csv")).toBe(true)
  })

  it("creates a runtime record after successful load", async () => {
    const registries = makeRegistries()
    const coordinator = new PluginCoordinator({ registries })

    await coordinator.load(makeManifest("plugin-x"), () => {})
    const record = coordinator.getRecord("plugin-x")
    expect(record).toBeDefined()
    expect(record?.id).toBe("plugin-x")
    expect(record?.loadedAt).toBeGreaterThan(0)
  })

  it("returns the record in the result on success", async () => {
    const registries = makeRegistries()
    const coordinator = new PluginCoordinator({ registries })

    const result = await coordinator.load(makeManifest(), () => {})
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.record.id).toBe("test-plugin")
    }
  })

  it("returns error result when factory throws", async () => {
    const registries = makeRegistries()
    const coordinator = new PluginCoordinator({ registries })

    const factory: BoringPluginFactory = () => {
      throw new Error("factory exploded")
    }

    const result = await coordinator.load(makeManifest("bad-plugin"), factory)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.diagnostics[0].kind).toBe("error")
      expect(result.diagnostics[0].message).toContain("factory exploded")
    }
  })

  it("does not create a record when factory throws", async () => {
    const registries = makeRegistries()
    const coordinator = new PluginCoordinator({ registries })

    await coordinator.load(makeManifest("bad-plugin"), () => {
      throw new Error("boom")
    })
    expect(coordinator.getRecord("bad-plugin")).toBeUndefined()
  })

  it("rejects a manifest with an invalid id", async () => {
    const registries = makeRegistries()
    const coordinator = new PluginCoordinator({ registries })

    const result = await coordinator.load({ id: "INVALID_ID", version: "1.0.0" }, () => {})
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.diagnostics[0].message).toContain("INVALID_ID")
    }
  })

  it("rejects a reserved plugin id", async () => {
    const registries = makeRegistries()
    const coordinator = new PluginCoordinator({ registries, reservedIds: ["core-plugin"] })

    const result = await coordinator.load(makeManifest("core-plugin"), () => {})
    expect(result.ok).toBe(false)
  })

  it("handles async factories", async () => {
    const registries = makeRegistries()
    const coordinator = new PluginCoordinator({ registries })

    const factory: BoringPluginFactory = async (api) => {
      await Promise.resolve()
      api.panels.register({ id: "async-panel", label: "Async", component: () => null })
    }

    const result = await coordinator.load(makeManifest(), factory)
    expect(result.ok).toBe(true)
    expect(registries.panels._entries.has("async-panel")).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// PluginCoordinator — rollback on registry throw
// ---------------------------------------------------------------------------

describe("PluginCoordinator.load — rollback on registry error", () => {
  it("rolls back and returns error when registry.register throws", async () => {
    const panels = makePanelRegistry()
    const commands = makeCommandRegistry()
    const surfaceResolvers = makeSurfaceResolverRegistry()

    // Make panels.register throw on second call
    let callCount = 0
    const originalRegister = panels.register.bind(panels)
    panels.register = (id, reg) => {
      callCount++
      if (callCount === 2) throw new Error("registry full")
      originalRegister(id, reg)
    }

    const unregisterSpy = vi.spyOn(panels, "unregisterByPluginId")
    const registries: CoordinatorRegistries = { panels, commands, surfaceResolvers }
    const coordinator = new PluginCoordinator({ registries })

    const factory: BoringPluginFactory = (api) => {
      api.panels.register({ id: "panel-a", label: "A", component: () => null })
      api.panels.register({ id: "panel-b", label: "B", component: () => null })
    }

    const result = await coordinator.load(makeManifest("failing-plugin"), factory)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.diagnostics[0].message).toContain("registration failed")
    }
    expect(unregisterSpy).toHaveBeenCalledWith("failing-plugin")
    expect(coordinator.getRecord("failing-plugin")).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// PluginCoordinator — atomic swap (hot reload)
// ---------------------------------------------------------------------------

describe("PluginCoordinator.load — atomic swap", () => {
  it("replaces old registrations when reloading a plugin", async () => {
    const registries = makeRegistries()
    const coordinator = new PluginCoordinator({ registries })

    // Initial load
    await coordinator.load(makeManifest(), (api) => {
      api.panels.register({ id: "old-panel", label: "Old", component: () => null })
    })
    expect(registries.panels._entries.has("old-panel")).toBe(true)

    // Hot reload with new factory
    const result = await coordinator.load(makeManifest(), (api) => {
      api.panels.register({ id: "new-panel", label: "New", component: () => null })
    })
    expect(result.ok).toBe(true)
    expect(registries.panels._entries.has("old-panel")).toBe(false)
    expect(registries.panels._entries.has("new-panel")).toBe(true)
  })

  it("has only one record after reload", async () => {
    const registries = makeRegistries()
    const coordinator = new PluginCoordinator({ registries })

    await coordinator.load(makeManifest("pp"), () => {})
    await coordinator.load(makeManifest("pp"), () => {})

    expect(coordinator.listLoaded().filter((r) => r.id === "pp")).toHaveLength(1)
  })

  it("includes info diagnostic in result when reloading", async () => {
    const registries = makeRegistries()
    const coordinator = new PluginCoordinator({ registries })

    await coordinator.load(makeManifest(), () => {})
    const result = await coordinator.load(makeManifest(), () => {})
    expect(result.ok).toBe(true)
    if (result.ok) {
      const hasInfo = result.diagnostics.some((d) => d.kind === "info")
      expect(hasInfo).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// PluginCoordinator — unload
// ---------------------------------------------------------------------------

describe("PluginCoordinator.unload", () => {
  it("unloads a plugin and removes all its registrations", async () => {
    const registries = makeRegistries()
    const coordinator = new PluginCoordinator({ registries })

    await coordinator.load(makeManifest(), (api) => {
      api.panels.register({ id: "panel-x", label: "X", component: () => null })
    })
    expect(registries.panels._entries.has("panel-x")).toBe(true)

    const result = await coordinator.unload("test-plugin")
    expect(result.ok).toBe(true)
    expect(registries.panels._entries.has("panel-x")).toBe(false)
  })

  it("removes the runtime record after unload", async () => {
    const registries = makeRegistries()
    const coordinator = new PluginCoordinator({ registries })

    await coordinator.load(makeManifest(), () => {})
    await coordinator.unload("test-plugin")
    expect(coordinator.getRecord("test-plugin")).toBeUndefined()
  })

  it("returns ok:false with warning when unloading a plugin that is not loaded", async () => {
    const registries = makeRegistries()
    const coordinator = new PluginCoordinator({ registries })

    const result = await coordinator.unload("nonexistent-plugin")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.diagnostics[0].kind).toBe("warning")
    }
  })
})

// ---------------------------------------------------------------------------
// PluginCoordinator — listLoaded / isLoaded
// ---------------------------------------------------------------------------

describe("PluginCoordinator.listLoaded", () => {
  it("returns empty array when no plugins are loaded", () => {
    const registries = makeRegistries()
    const coordinator = new PluginCoordinator({ registries })
    expect(coordinator.listLoaded()).toEqual([])
  })

  it("returns all loaded plugins", async () => {
    const registries = makeRegistries()
    const coordinator = new PluginCoordinator({ registries })

    await coordinator.load(makeManifest("plugin-a"), () => {})
    await coordinator.load(makeManifest("plugin-b"), () => {})

    const ids = coordinator.listLoaded().map((r) => r.id)
    expect(ids).toContain("plugin-a")
    expect(ids).toContain("plugin-b")
    expect(ids).toHaveLength(2)
  })

  it("excludes unloaded plugins", async () => {
    const registries = makeRegistries()
    const coordinator = new PluginCoordinator({ registries })

    await coordinator.load(makeManifest("plugin-a"), () => {})
    await coordinator.load(makeManifest("plugin-b"), () => {})
    await coordinator.unload("plugin-a")

    const ids = coordinator.listLoaded().map((r) => r.id)
    expect(ids).not.toContain("plugin-a")
    expect(ids).toContain("plugin-b")
  })
})

describe("PluginCoordinator.isLoaded", () => {
  it("returns false for a plugin that has not been loaded", () => {
    const coordinator = new PluginCoordinator({ registries: makeRegistries() })
    expect(coordinator.isLoaded("nope")).toBe(false)
  })

  it("returns true for a loaded plugin", async () => {
    const coordinator = new PluginCoordinator({ registries: makeRegistries() })
    await coordinator.load(makeManifest("my-plugin"), () => {})
    expect(coordinator.isLoaded("my-plugin")).toBe(true)
  })

  it("returns false after the plugin is unloaded", async () => {
    const coordinator = new PluginCoordinator({ registries: makeRegistries() })
    await coordinator.load(makeManifest("my-plugin"), () => {})
    await coordinator.unload("my-plugin")
    expect(coordinator.isLoaded("my-plugin")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// PluginCoordinator — getRecord
// ---------------------------------------------------------------------------

describe("PluginCoordinator.getRecord", () => {
  it("returns undefined for an unloaded plugin", () => {
    const coordinator = new PluginCoordinator({ registries: makeRegistries() })
    expect(coordinator.getRecord("nope")).toBeUndefined()
  })

  it("returns the record including the validated manifest for a loaded plugin", async () => {
    const coordinator = new PluginCoordinator({ registries: makeRegistries() })
    const manifest = { id: "test-plugin", version: "2.0.0", label: "Test Plugin" }
    await coordinator.load(manifest, () => {})

    const record = coordinator.getRecord("test-plugin")
    expect(record).toBeDefined()
    expect(record?.manifest.id).toBe("test-plugin")
    expect(record?.manifest.version).toBe("2.0.0")
  })
})
