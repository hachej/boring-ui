import { definePlugin } from "../../shared/plugins/definePlugin"
import { FileTreePane } from "./file-tree/FileTreeView"
import { CodeEditorPane } from "./code-editor/CodeEditorPane"
import { MarkdownEditorPane } from "./markdown-editor/MarkdownEditorPane"

// Re-export shared file pane utilities for external use
export { useFilePane } from "./useFilePane"
export { FilePaneShell } from "./FilePaneShell"
export { ConflictBanner } from "./ConflictBanner"
export type { UseFilePaneOptions, UseFilePaneReturn } from "./useFilePane"

export const filesystemPlugin = definePlugin({
  id: "filesystem",
  label: "Filesystem",
  panels: [
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
  ],
  catalogs: [
    {
      id: "files",
      label: "Files",
      adapter: {
        async search() {
          return { items: [], total: 0, hasMore: false }
        },
      },
      onSelect: () => {},
    },
  ],
})
