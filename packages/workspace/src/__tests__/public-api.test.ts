import { describe, it, expect } from "vitest"
import * as api from "../index"

describe("@boring/workspace public API", () => {
  describe("layout shells", () => {
    it("exports Tier 1, Tier 2, and Tier 3 layout entries", () => {
      expect(api.IdeLayout).toBeDefined()
      expect(api.ChatLayout).toBeDefined()
      expect(api.TopBar).toBeDefined()
      expect(api.ResponsiveDockviewShell).toBeDefined()
      expect(api.DockviewShell).toBeDefined()
    })

    it("exports layout builders", () => {
      expect(api.buildIdeLayout).toBeDefined()
      expect(api.buildChatLayout).toBeDefined()
    })
  })

  describe("standalone components", () => {
    it("exports FileTree, CodeEditor, MarkdownEditor, DataCatalog", () => {
      expect(api.FileTree).toBeDefined()
      expect(api.CodeEditor).toBeDefined()
      expect(api.MarkdownEditor).toBeDefined()
      expect(api.DataCatalog).toBeDefined()
    })

    it("exports SessionList", () => {
      expect(api.SessionList).toBeDefined()
    })

    it("exports WorkspaceLoadingState", () => {
      expect(api.WorkspaceLoadingState).toBeDefined()
    })
  })

  describe("plugins", () => {
    it("exports data catalog plugin factories", () => {
      expect(api.createDataCatalogPlugin).toBeDefined()
      expect(api.createDataCatalogOutputs).toBeDefined()
      expect(api.appendDataCatalogOutputs).toBeDefined()
      expect(api.openDataCatalogVisualization).toBeDefined()
      expect(api.useDataCatalogQuery).toBeDefined()
      expect(api.useDataCatalogVisualizationState).toBeDefined()
      expect(api.DATA_CATALOG_PLUGIN_ID).toBe("data-catalog")
    })

    it("does not export the retired static data factory", () => {
      expect("makeStaticDataPlugin" in api).toBe(false)
    })
  })

  describe("dockview panes", () => {
    it("exports all pane wrappers", () => {
      expect(api.FileTreePane).toBeDefined()
      expect(api.CodeEditorPane).toBeDefined()
      expect(api.MarkdownEditorPane).toBeDefined()
      expect(api.DataCatalogPane).toBeDefined()
      expect(api.EmptyPane).toBeDefined()
      expect(api.ArtifactSurfacePane).toBeDefined()
    })
  })

  describe("registry", () => {
    it("exports PanelRegistry, CommandRegistry, CatalogRegistry, and bootstrap", () => {
      expect(api.PanelRegistry).toBeDefined()
      expect(api.CommandRegistry).toBeDefined()
      expect(api.CatalogRegistry).toBeDefined()
      expect(api.bootstrap).toBeDefined()
    })

    it("exports registry hooks and provider", () => {
      expect(api.RegistryProvider).toBeDefined()
      expect(api.useRegistry).toBeDefined()
      expect(api.useCommandRegistry).toBeDefined()
      expect(api.useCatalogRegistry).toBeDefined()
      expect(api.useCatalogs).toBeDefined()
    })

    it("exports getFileIcon utility", () => {
      expect(api.getFileIcon).toBeDefined()
    })
  })

  describe("bridge", () => {
    it("exports useWorkspaceBridge", () => {
      expect(api.useWorkspaceBridge).toBeDefined()
    })

    it("exports bridge creation functions", () => {
      expect(api.createBridge).toBeDefined()
      expect(api.createBridgeClient).toBeDefined()
    })
  })

  describe("dock runtime", () => {
    it("exports useDockviewApi", () => {
      expect(api.useDockviewApi).toBeDefined()
    })
  })

  describe("hooks", () => {
    it("exports useEditorLifecycle", () => {
      expect(api.useEditorLifecycle).toBeDefined()
    })

    it("exports useArtifactPanels and useArtifactRouting", () => {
      expect(api.useArtifactPanels).toBeDefined()
      expect(api.useArtifactRouting).toBeDefined()
    })

    it("exports responsive hooks", () => {
      expect(api.useViewportBreakpoint).toBeDefined()
      expect(api.useResponsiveSidebarCollapse).toBeDefined()
    })
  })

  describe("provider", () => {
    it("exports WorkspaceProvider", () => {
      expect(api.WorkspaceProvider).toBeDefined()
    })

    it("exports ThemeProvider", () => {
      expect(api.ThemeProvider).toBeDefined()
    })
  })

  describe("filesystem data APIs", () => {
    it("does not export filesystem data APIs from the package root", () => {
      expect("DataProvider" in api).toBe(false)
      expect("useDataClient" in api).toBe(false)
      expect("useFileContent" in api).toBe(false)
      expect("useFileData" in api).toBe(false)
      expect("FetchClient" in api).toBe(false)
    })
  })

  describe("theme", () => {
    it("exports useTheme", () => {
      expect(api.useTheme).toBeDefined()
    })

    it("exports createShadcnTheme", () => {
      expect(api.createShadcnTheme).toBeDefined()
    })
  })

  describe("store selectors (store is NOT exported)", () => {
    it("exports atomic selector hooks", () => {
      expect(api.useActiveFile).toBeDefined()
      expect(api.useActivePanel).toBeDefined()
      expect(api.useSidebarState).toBeDefined()
      expect(api.useOpenPanels).toBeDefined()
      expect(api.useDirtyFiles).toBeDefined()
      expect(api.useThemePreference).toBeDefined()
      expect(api.useHydrationComplete).toBeDefined()
    })

    it("exports createWorkspaceStore for setup", () => {
      expect(api.createWorkspaceStore).toBeDefined()
    })

    it("does NOT export useWorkspaceStore", () => {
      expect("useWorkspaceStore" in api).toBe(false)
    })

    it("does NOT export WorkspaceStoreState as a value", () => {
      expect("WorkspaceStoreState" in api).toBe(false)
    })
  })

  describe("no deep imports needed", () => {
    it("all symbols importable from top-level", () => {
      const exportedNames = Object.keys(api)
      expect(exportedNames.length).toBeGreaterThan(50)
    })
  })
})
