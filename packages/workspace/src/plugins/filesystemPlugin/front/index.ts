import { createElement, lazy, Suspense, useEffect } from "react"
import { FolderTree } from "lucide-react"
import "./events"
import {
  definePlugin,
  type BoringFrontSetup,
} from "../../../shared/plugins/frontFactory"
import { postUiCommand } from "../../../front/bridge"
import { useDataClient, useFileList } from "./data"
import { DataProvider } from "./data/DataProvider"
import { FilesystemRootsBinding } from "./FilesystemRootsBinding"
import { useCatalogRegistry } from "../../../front/registry"
import type { FileTreePaneParams } from "./file-tree/FileTreePane"
import { useFileTreeRoots } from "./file-tree/FileTreeRootsProvider"
import type { WorkspaceSourceProps } from "../../../shared/types/panel"
import { FilesystemFilePanelBinding } from "./filePanelBinding"
import { FilesystemAgentFileBridge } from "./agentFileBridge"
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

const LazyFileTreePane = lazy(() => import("./file-tree/FileTreePane").then((module) => ({ default: module.FileTreePane })))
const LazyCodeEditorPane = lazy(() => import("./code-editor/CodeEditorPane").then((module) => ({ default: module.CodeEditorPane })))
const LazyMarkdownEditorPane = lazy(() => import("./markdown-editor/MarkdownEditorPane").then((module) => ({ default: module.MarkdownEditorPane })))
const LazyMediaViewerPane = lazy(() => import("./media-viewer/MediaViewerPane").then((module) => ({ default: module.MediaViewerPane })))
const LazyHtmlViewerPane = lazy(() => import("./html-viewer/HtmlViewerPane").then((module) => ({ default: module.HtmlViewerPane })))

function panelFallback(label: string) {
  return createElement("div", { className: "flex h-full items-center justify-center text-sm text-muted-foreground" }, `Loading ${label}…`)
}

function lazyPane(component: typeof LazyCodeEditorPane, label: string) {
  return function LazyFilesystemPane(props: Parameters<typeof component>[0]) {
    return createElement(Suspense, { fallback: panelFallback(label) }, createElement(component, props))
  }
}

const CodeEditorPane = lazyPane(LazyCodeEditorPane, "editor")
const MarkdownEditorPane = lazyPane(LazyMarkdownEditorPane, "Markdown")
const MediaViewerPane = lazyPane(LazyMediaViewerPane, "media")
const HtmlViewerPane = lazyPane(LazyHtmlViewerPane, "HTML")

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
  authScopeKey,
  onAuthError,
  apiTimeout,
  children,
}: PluginProviderProps) {
  const headersKey = JSON.stringify(Object.entries(authHeaders ?? {}).sort(([left], [right]) => left.localeCompare(right)))
  return createElement(
    DataProvider,
    {
      apiBaseUrl,
      authHeaders,
      onAuthError,
      timeout: apiTimeout,
      children: createElement(FilesystemRootsBinding, {
        requestKey: `${apiBaseUrl}\n${headersKey}\n${authScopeKey ?? ""}`,
        children,
      }),
    },
  )
}

function FilesystemTreePreloadBinding() {
  // Warm only the cheap directory data. The tree implementation itself stays
  // behind the Files surface boundary so chat-first paint never downloads it.
  useFileList(".")
  return null
}

export function FilesystemFileTreeSource(props: WorkspaceSourceProps<FileTreePaneParams>) {
  const roots = useFileTreeRoots()
  return createElement(
    Suspense,
    { fallback: panelFallback("files") },
    createElement(LazyFileTreePane, {
      ...props,
      params: {
        ...props.params,
        roots: roots ? [...roots] : undefined,
      },
    }),
  )
}

function FilesystemCatalogBinding() {
  const client = useDataClient()
  const catalogRegistry = useCatalogRegistry()

  useEffect(() => {
    const existing = catalogRegistry.get(FILES_CATALOG_ID)
    if (existing && existing.pluginId !== FILESYSTEM_PLUGIN_ID) return

    const catalog = createFilesCatalog({
      client,
      onSelect: ({ filesystem, path }) => {
        postUiCommand({ kind: "openFile", params: { filesystem, path } })
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
  api.registerWorkspaceSource({
    id: FILES_LEFT_TAB_ID,
    label: "Files",
    component: FilesystemFileTreeSource,
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
