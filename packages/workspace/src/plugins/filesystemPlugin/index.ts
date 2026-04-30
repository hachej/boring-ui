import { definePlugin } from "../../shared/plugins/definePlugin"
import { FileTreePane } from "./file-tree/FileTreeView"
import { CodeEditorPane } from "./code-editor/CodeEditorPane"
import { MarkdownEditorPane } from "./markdown-editor/MarkdownEditorPane"
import type { ExplorerRow } from "../../front/components/DataExplorer/types"
import type { Plugin } from "../../shared/plugins/types"
import {
  createFilesCatalog,
  FILESYSTEM_PLUGIN_ID,
  type FilesCatalogClient,
} from "./catalog"

// Re-export shared file pane utilities for external use
export { useFilePane } from "./useFilePane"
export { FilePaneShell } from "./FilePaneShell"
export { ConflictBanner } from "./ConflictBanner"
export type { UseFilePaneOptions, UseFilePaneReturn } from "./useFilePane"

const filesystemPanels: Plugin["panels"] = [
  {
    id: "files",
    title: "Files",
    component: FileTreePane,
    placement: "left-tab",
    source: "builtin",
  },
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

export interface CreateFilesystemPluginOptions {
  filesClient?: FilesCatalogClient
  onOpenFile?: (path: string, row: ExplorerRow) => void
}

export function createFilesystemPlugin({
  filesClient,
  onOpenFile,
}: CreateFilesystemPluginOptions = {}): Plugin {
  return definePlugin({
    id: FILESYSTEM_PLUGIN_ID,
    label: "Filesystem",
    panels: filesystemPanels,
    catalogs: filesClient
      ? [
          createFilesCatalog({
            client: filesClient,
            onSelect: onOpenFile,
          }),
        ]
      : undefined,
  })
}

export const filesystemPlugin = createFilesystemPlugin()
