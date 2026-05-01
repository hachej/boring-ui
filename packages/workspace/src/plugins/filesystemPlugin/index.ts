import { createElement, useEffect } from "react"
import { FolderTree } from "lucide-react"
import { definePlugin } from "../../shared/plugins/definePlugin"
import { postUiCommand } from "../../front/bridge"
import { useDataClient } from "./data"
import { DataProvider } from "./data/DataProvider"
import { useCatalogRegistry } from "../../front/registry"
import { FileTreePane } from "./file-tree/FileTreeView"
import { FilesystemFilePanelBinding } from "./filePanelBinding"
import { FilesystemAgentFileBridge } from "./agentFileBridge"
import { CodeEditorPane } from "./code-editor/CodeEditorPane"
import { MarkdownEditorPane } from "./markdown-editor/MarkdownEditorPane"
import { emptyFilePanelDef } from "./empty-file-panel/definition"
import { filesystemSurfaceResolver } from "./surfaceResolver"
import type { Plugin, PluginProviderProps } from "../../shared/plugins/types"
import {
  CODE_EDITOR_PANEL_ID,
  CSV_VIEWER_PANEL_ID,
  FILES_CATALOG_ID,
  FILES_LEFT_TAB_ID,
  FILESYSTEM_PLUGIN_ID,
  MARKDOWN_EDITOR_PANEL_ID,
} from "./constants"
import { createFilesCatalog } from "./catalogs"

// Re-export shared file pane utilities for external use
export { useFilePane } from "./useFilePane"
export { FilePaneShell } from "./FilePaneShell"
export { ConflictBanner } from "./ConflictBanner"
export {
  emitFilesystemAgentFileChange,
  useAutoOpenAgentFiles,
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

const filesystemOutputs: Plugin["outputs"] = [
  {
    type: "provider",
    id: "filesystem-data",
    component: FilesystemDataProvider,
  },
  {
    type: "left-tab",
    id: FILES_LEFT_TAB_ID,
    title: "Files",
    component: FileTreePane,
    source: "builtin",
    icon: FolderTree,
  },
  {
    type: "panel",
    panel: emptyFilePanelDef,
  },
  {
    type: "panel",
    panel: {
      id: CODE_EDITOR_PANEL_ID,
      title: "Code",
      component: CodeEditorPane,
      placement: "center",
      source: "builtin",
    },
  },
  {
    type: "panel",
    panel: {
      id: CSV_VIEWER_PANEL_ID,
      title: "CSV",
      // CSV currently uses the text editor shell; a tabular viewer can replace
      // this panel without changing the filesystem resolver contract.
      component: CodeEditorPane,
      placement: "center",
      source: "builtin",
    },
  },
  {
    type: "panel",
    panel: {
      id: MARKDOWN_EDITOR_PANEL_ID,
      title: "Markdown",
      component: MarkdownEditorPane,
      placement: "center",
      source: "builtin",
    },
  },
  {
    type: "surface-resolver",
    resolver: filesystemSurfaceResolver,
  },
]

function FilesystemCatalogBinding() {
  const client = useDataClient()
  const catalogRegistry = useCatalogRegistry()

  useEffect(() => {
    const existing = catalogRegistry.get(FILES_CATALOG_ID)
    if (existing && existing.pluginId !== FILESYSTEM_PLUGIN_ID) return

    const catalog = createFilesCatalog({
      client,
      onSelect: (path) => {
        postUiCommand({ kind: "openFile", params: { path } })
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

export function createFilesystemPlugin(): Plugin {
  return definePlugin({
    id: FILESYSTEM_PLUGIN_ID,
    label: "Filesystem",
    outputs: filesystemOutputs,
    bindings: [
      FilesystemCatalogBinding,
      FilesystemFilePanelBinding,
      FilesystemAgentFileBridge,
    ],
  })
}

export const filesystemPlugin = createFilesystemPlugin()
