import { definePlugin } from "../../shared/plugin/definePlugin"
import { definePanel } from "../../front/registry/types"
import { FileTreePane } from "./file-tree/FileTreeView"
import { CodeEditorPane } from "./code-editor/CodeEditorPane"
import { MarkdownEditorPane } from "../../panes/markdown-editor/MarkdownEditorPane"

export const filesystemPlugin = definePlugin({
  id: "filesystem",
  label: "Filesystem",
  panels: [
    definePanel({
      id: "files",
      title: "Files",
      component: FileTreePane,
      placement: "left-tab",
      source: "builtin",
    }),
    definePanel<{ path: string }>({
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
    }),
    definePanel<{ path: string }>({
      id: "markdown-editor",
      title: "Markdown",
      component: MarkdownEditorPane,
      placement: "center",
      filePatterns: ["**/*.md", "**/*.mdx"],
      source: "builtin",
    }),
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
