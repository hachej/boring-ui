import { createElement, useEffect } from "react"
import { FolderTree } from "lucide-react"
import "./events"
import {
  definePlugin,
  type BoringFrontSetup,
} from "../../../shared/plugins/frontFactory"
import { emitUiEffect } from "../../../front/bridge"
import { useDataClient, useFileList } from "./data"
import { DataProvider } from "./data/DataProvider"
import { useCatalogRegistry } from "../../../front/registry"
import { FileTreePane, preloadFileTreeComponent } from "./file-tree/FileTreeView"
import { FilesystemFilePanelBinding } from "./filePanelBinding"
import { FilesystemAgentFileBridge } from "./agentFileBridge"
import { CodeEditorPane } from "./code-editor/CodeEditorPane"
import { MarkdownEditorPane } from "./markdown-editor/MarkdownEditorPane"
import { MediaViewerPane } from "./media-viewer/MediaViewerPane"
import { HtmlViewerPane } from "./html-viewer/HtmlViewerPane"
import { emptyFilePanelDef } from "./empty-file-panel/definition"
import { filesystemSurfaceResolver } from "./surfaceResolver"
import type {
  PluginProviderProps,
} from "../../../shared/plugins/types"
import {
  CODE_EDITOR_PANEL_ID,
  CSV_VIEWER_PANEL_ID,
  FILES_CATALOG_ID,
  FILES_LEFT_TAB_ID,
  FILESYSTEM_PLUGIN_ID,
  HTML_VIEWER_PANEL_ID,
  IMAGE_VIEWER_PANEL_ID,
  MARKDOWN_EDITOR_PANEL_ID,
  PDF_VIEWER_PANEL_ID,
} from "../shared/constants"
import { createFilesCatalog } from "./catalogs"

// Re-export shared file pane utilities for external use
export { useFilePane } from "./useFilePane"
export { FilePaneShell } from "./FilePaneShell"
export { ConflictBanner } from "./ConflictBanner"
export {
  emitFilesystemAgentFileChange,
  useAutoOpenAgentFiles,
  onFilesystemChanged,
} from "./agentFileBridge"
export type { UseFilePaneOptions, UseFilePaneReturn } from "./useFilePane"
export type { UseAutoOpenAgentFilesOptions } from "./agentFileBridge"

function FilesystemDataProvider({
  apiBaseUrl,
  authHeaders,
  onAuthError,
  apiTimeout,
  children,
}: PluginProviderProps) {
  return createElement(
    DataProvider,
    {
      apiBaseUrl,
      authHeaders,
      onAuthError,
      timeout: apiTimeout,
      children,
    },
  )
}

function FilesystemTreePreloadBinding() {
  useEffect(() => {
    preloadFileTreeComponent()
  }, [])
  useFileList(".")
  return null
}



function FilesystemCatalogBinding() {
  const client = useDataClient()
  const catalogRegistry = useCatalogRegistry()

  useEffect(() => {
    const existing = catalogRegistry.get(FILES_CATALOG_ID)
    if (existing && existing.pluginId !== FILESYSTEM_PLUGIN_ID) return

    const catalog = createFilesCatalog({
      client,
      onSelect: (path) => {
        emitUiEffect({ kind: "openFile", params: { path } })
      },
    })

    catalogRegistry.register(catalog, FILESYSTEM_PLUGIN_ID)

    return () => {
      if (catalogRegistry.get(FILES_CATALOG_ID)?.pluginId === FILESYSTEM_PLUGIN_ID) {
        catalogRegistry.unregister(FILES_CATALOG_ID)
      }
    }
  }, [catalogRegistry, client])

  return null
}

const filesystemFront: BoringFrontSetup = (api) => {
  api.registerProvider({
    id: "filesystem-data",
    component: FilesystemDataProvider,
  })
  api.registerBinding({
    id: "filesystem-tree-preload",
    component: FilesystemTreePreloadBinding,
  })
  api.registerLeftTab({
    id: FILES_LEFT_TAB_ID,
    title: "Files",
    panelId: FILES_LEFT_TAB_ID,
    component: FileTreePane,
    source: "builtin",
    icon: FolderTree,
  })
  api.registerPanel({
    id: emptyFilePanelDef.id,
    label: emptyFilePanelDef.title,
    component: emptyFilePanelDef.component,
    placement: emptyFilePanelDef.placement,
    source: emptyFilePanelDef.source,
  })
  api.registerPanel({
    id: CODE_EDITOR_PANEL_ID,
    label: "Code",
    component: CodeEditorPane,
    placement: "center",
    source: "builtin",
  })
  api.registerPanel({
    id: CSV_VIEWER_PANEL_ID,
    label: "CSV",
    // CSV currently uses the text editor shell; a tabular viewer can replace
    // this panel without changing the filesystem resolver contract.
    component: CodeEditorPane,
    placement: "center",
    source: "builtin",
  })
  api.registerPanel({
    id: MARKDOWN_EDITOR_PANEL_ID,
    label: "Markdown",
    component: MarkdownEditorPane,
    placement: "center",
    source: "builtin",
  })
  api.registerPanel({
    id: IMAGE_VIEWER_PANEL_ID,
    label: "Image",
    component: MediaViewerPane,
    placement: "center",
    source: "builtin",
  })
  api.registerPanel({
    id: PDF_VIEWER_PANEL_ID,
    label: "PDF",
    component: MediaViewerPane,
    placement: "center",
    source: "builtin",
  })
  api.registerPanel({
    id: HTML_VIEWER_PANEL_ID,
    label: "HTML",
    component: HtmlViewerPane,
    placement: "center",
    source: "builtin",
  })
  api.registerSurfaceResolver({
    id: filesystemSurfaceResolver.id,
    kind: "workspace.open.path",
    source: filesystemSurfaceResolver.source,
    resolve: filesystemSurfaceResolver.resolve,
  })
  api.registerBinding({
    id: "filesystem-catalog",
    component: FilesystemCatalogBinding,
  })
  api.registerBinding({
    id: "filesystem-file-panel",
    component: FilesystemFilePanelBinding,
  })
  api.registerBinding({
    id: "filesystem-agent-file-bridge",
    component: FilesystemAgentFileBridge,
  })
}

export default filesystemFront

export const filesystemPlugin = definePlugin({
  id: FILESYSTEM_PLUGIN_ID,
  label: "Filesystem",
  setup: filesystemFront,
})
