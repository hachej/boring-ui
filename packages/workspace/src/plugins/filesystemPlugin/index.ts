import { useEffect } from "react"
import { FolderTree } from "lucide-react"
import { definePlugin } from "../../shared/plugins/definePlugin"
import { postUiCommand } from "../../front/bridge"
import { useDataClient } from "../../front/data"
import { useCatalogRegistry } from "../../front/registry"
import { FileTreePane } from "./file-tree/FileTreeView"
import { CodeEditorPane } from "./code-editor/CodeEditorPane"
import { MarkdownEditorPane } from "./markdown-editor/MarkdownEditorPane"
import type { Plugin } from "../../shared/plugins/types"
import {
  createFilesCatalog,
  FILES_CATALOG_ID,
  FILESYSTEM_PLUGIN_ID,
} from "./catalog"

// Re-export shared file pane utilities for external use
export { useFilePane } from "./useFilePane"
export { FilePaneShell } from "./FilePaneShell"
export { ConflictBanner } from "./ConflictBanner"
export type { UseFilePaneOptions, UseFilePaneReturn } from "./useFilePane"

const filesystemOutputs: Plugin["outputs"] = [
  {
    type: "left-tab",
    id: "files",
    title: "Files",
    component: FileTreePane,
    source: "builtin",
    icon: FolderTree,
  },
]

const filesystemPanels: Plugin["panels"] = [
  {
    id: "code-editor",
    title: "Code",
    component: CodeEditorPane,
    placement: "center",
    filePatterns: [
      "**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx",
      "**/*.py", "**/*.rs", "**/*.go",
      "**/*.json", "**/*.yml", "**/*.yaml",
      "**/*.toml", "**/*.css", "**/*.html", "**/*.svg",
      "**/*.sh", "**/*.sql", "**/*.graphql",
    ],
    source: "builtin",
  },
  {
    id: "markdown-editor",
    title: "Markdown",
    component: MarkdownEditorPane,
    placement: "center",
    filePatterns: ["**/*.md", "**/*.mdx"],
    source: "builtin",
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
    panels: filesystemPanels,
    bindings: [FilesystemCatalogBinding],
  })
}

export const filesystemPlugin = createFilesystemPlugin()
