"use client"

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type { DockviewPanelApi } from "dockview-react"
import {
  useFileList,
  useFileWrite,
  useCreateDir,
  useMoveFile,
  useDeleteFile,
  useFileSearch,
  useDataClient,
} from "../../../front/data"
import type { FileEntry } from "../../../front/data/types"
import type { FileTreeNode, FileTreeEditState } from "./FileTree"
import type { WorkspaceBridge } from "../../../front/bridge/types"
import { PanelChrome } from "../../../front/dock"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Input,
} from "../../../front/components/ui"
import { cn } from "../../../front/lib/utils"
import { toast } from "../../../front/toast"
import { events, userMeta } from "../../../front/events"

const FileTree = lazy(() =>
  import("./FileTree").then((m) => ({ default: m.FileTree })),
)

const CLIENT_FILTER_THRESHOLD = 5000

function buildTree(
  entries: FileEntry[],
  childrenByDir: Map<string, FileEntry[]>,
): FileTreeNode[] {
  const dirs: FileTreeNode[] = []
  const files: FileTreeNode[] = []
  for (const entry of entries) {
    if (entry.kind === "dir") {
      const children = childrenByDir.get(entry.path)
      dirs.push({
        ...entry,
        children: children ? buildTree(children, childrenByDir) : [],
      })
    } else {
      files.push({ ...entry })
    }
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name))
  files.sort((a, b) => a.name.localeCompare(b.name))
  return [...dirs, ...files]
}

function parentDir(path: string): string {
  const i = path.lastIndexOf("/")
  return i > 0 ? path.slice(0, i) : "."
}

type DraftEditing =
  | { kind: "create-file"; parentDir: string; path: string }
  | { kind: "create-folder"; parentDir: string; path: string }
  | { kind: "rename"; path: string; initialValue: string }
  | null

function injectDraftIntoTree(
  tree: FileTreeNode[],
  editing: DraftEditing,
  rootDir: string,
): FileTreeNode[] {
  if (!editing || editing.kind === "rename") return tree
  const draft: FileTreeNode = {
    name: "",
    path: editing.path,
    kind: editing.kind === "create-folder" ? "dir" : "file",
    isDraft: true,
  }
  const targetDir = editing.parentDir
  // Inserting at the root is easy: just prepend a draft row.
  if (targetDir === rootDir || targetDir === "." || targetDir === "") {
    return [draft, ...tree]
  }
  return tree.map((node) => {
    if (node.kind !== "dir") return node
    if (node.path === targetDir) {
      return { ...node, children: [draft, ...(node.children ?? [])] }
    }
    if (node.children?.length) {
      return {
        ...node,
        children: injectDraftIntoTree(node.children, editing, rootDir),
      }
    }
    return node
  })
}

/**
 * Copy `text` to the clipboard. Falls back to a hidden-textarea + execCommand
 * when `navigator.clipboard` is unavailable (non-secure contexts: plain http
 * served from a non-localhost IP, file://, etc.).
 */
export async function copyToClipboard(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Some browsers reject when not focused — fall through to legacy path.
    }
  }
  if (typeof document === "undefined") {
    throw new Error("Clipboard not available")
  }
  const ta = document.createElement("textarea")
  ta.value = text
  ta.setAttribute("readonly", "")
  ta.style.position = "fixed"
  ta.style.top = "-9999px"
  ta.style.left = "-9999px"
  ta.style.opacity = "0"
  document.body.appendChild(ta)
  let ok = false
  try {
    ta.focus()
    ta.select()
    ok = !!document.execCommand?.("copy")
  } finally {
    document.body.removeChild(ta)
  }
  if (!ok) throw new Error("Clipboard not available")
}

interface ContextMenuState {
  node: FileTreeNode
  x: number
  y: number
  isBackground?: boolean
}

/**
 * Names that almost no app wants visible in the workbench tree. These are
 * folders that bloat the tree (node_modules), tooling artifacts the user
 * shouldn't be reading (test-results, dist, .tsbuildinfo*), or VCS
 * machinery (.git). Apps can override via `ignoreNames` if they want
 * them visible.
 */
export const DEFAULT_TREE_IGNORE: ReadonlyArray<string | RegExp> = [
  "node_modules",
  ".git",
  "dist",
  "test-results",
  /^\.tsbuildinfo/,
  ".vite",
  ".turbo",
  ".next",
  ".cache",
]

function matchesAny(name: string, patterns: ReadonlyArray<string | RegExp>): boolean {
  for (const p of patterns) {
    if (typeof p === "string" ? p === name : p.test(name)) return true
  }
  return false
}

export interface FileTreeViewProps {
  rootDir?: string
  /** Already-debounced query. Empty/undefined means no filter. */
  searchQuery?: string
  bridge?: Pick<WorkspaceBridge, "openFile" | "getActiveFile" | "select">
  /**
   * Names (or regex patterns) to hide from the tree. Defaults to
   * `DEFAULT_TREE_IGNORE` (node_modules, .git, dist, …). Pass `[]` to
   * show everything; pass your own array to override entirely. Patterns
   * match on file/folder NAME, not the full path.
   */
  ignoreNames?: ReadonlyArray<string | RegExp>
  /** Forwarded to the inner <FileTree>. */
  className?: string
}

/**
 * File tree with the full workbench actions: tracks container height,
 * routes selects through `bridge.openFile`, and provides a right-click
 * context menu (new file/folder, rename, delete, copy path) plus a
 * delete-confirmation dialog.
 *
 * The chrome (PanelChrome, search input) is the consumer's responsibility.
 * `FileTreePane` (below) is the default chromed wrapper for hosts that just
 * want a "Files" panel; `WorkbenchLeftPane` uses this primitive directly to
 * share its search input with the Data tab.
 */
export function FileTreeView({
  rootDir = ".",
  searchQuery,
  bridge,
  ignoreNames = DEFAULT_TREE_IGNORE,
  className,
}: FileTreeViewProps) {
  const dataClient = useDataClient()
  const { data: rawFileList, error, isLoading } = useFileList(rootDir)
  // Filter out junk folders (node_modules, dist, …) before they hit
  // buildTree. Cheap O(n) at the top level; nested children are already
  // filtered by the agent backend or by their own buildTree recursion
  // since the same `ignoreNames` is applied via the closure below.
  const fileList = useMemo(
    () =>
      ignoreNames.length === 0
        ? rawFileList
        : rawFileList?.filter((e) => !matchesAny(e.name, ignoreNames)),
    [rawFileList, ignoreNames],
  )
  const { mutateAsync: writeFile } = useFileWrite()
  const { mutateAsync: createDir } = useCreateDir()
  const { mutateAsync: moveFile } = useMoveFile()
  const { mutateAsync: deleteFile } = useDeleteFile()

  const [expandedChildren, setExpandedChildren] = useState<
    Map<string, FileEntry[]>
  >(new Map())

  const containerRef = useRef<HTMLDivElement>(null)
  const [treeHeight, setTreeHeight] = useState(400)

  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<FileTreeNode | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(
    bridge?.getActiveFile?.() ?? null,
  )

  // Inline edit state. `path` identifies which row renders an <input>; for
  // drafts (new file/folder), `parentDir` says where to place the result, and
  // `path` is a synthetic id so the row can be located in the tree.
  type EditingState =
    | { kind: "rename"; path: string; initialValue: string }
    | { kind: "create-file"; parentDir: string; path: string }
    | { kind: "create-folder"; parentDir: string; path: string }
    | null
  const [editing, setEditing] = useState<EditingState>(null)
  const draftSeqRef = useRef(0)

  const totalFileCount =
    (fileList?.length ?? 0) +
    Array.from(expandedChildren.values()).reduce((s, v) => s + v.length, 0)
  const useServerSearch =
    totalFileCount >= CLIENT_FILTER_THRESHOLD && (searchQuery?.length ?? 0) > 0
  const { data: searchResults } = useFileSearch(
    useServerSearch ? (searchQuery ?? "") : "",
    50,
  )

  useEffect(() => {
    if (!ctxMenu) return
    function onPointerDown(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setCtxMenu(null)
      }
    }
    document.addEventListener("pointerdown", onPointerDown)
    return () => document.removeEventListener("pointerdown", onPointerDown)
  }, [ctxMenu])

  useEffect(() => {
    setSelectedPath(bridge?.getActiveFile?.() ?? null)
    if (!bridge?.select) return
    return bridge.select((state) => state.activeFile, (path) => {
      setSelectedPath(path)
    })
  }, [bridge])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setTreeHeight(Math.floor(entry.contentRect.height))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const serverSearchTree: FileTreeNode[] | undefined =
    useServerSearch && searchResults
      ? searchResults.map((path) => ({
          name: path.split("/").pop() ?? path,
          kind: "file" as const,
          path,
        }))
      : undefined

  const baseTreeData =
    serverSearchTree ?? buildTree(fileList ?? [], expandedChildren)

  // Inject a draft row into the tree so the inline <input> renders at the
  // right depth. For server-search results we don't bother — drafts only
  // appear in the regular browse view.
  const treeData = injectDraftIntoTree(baseTreeData, editing, rootDir)

  const handleSelect = useCallback(
    (path: string) => {
      setSelectedPath(path)
      bridge?.openFile(path, { mode: "edit" })
    },
    [bridge],
  )

  const handleExpand = useCallback(
    async (dirPath: string) => {
      try {
        const children = await dataClient.getTree(dirPath)
        const filtered =
          ignoreNames.length === 0
            ? children
            : children.filter((c) => !matchesAny(c.name, ignoreNames))
        setExpandedChildren((prev) => new Map(prev).set(dirPath, filtered))
      } catch {
        // Network error — directory stays empty, user can retry
      }
    },
    [dataClient, ignoreNames],
  )

  /**
   * Refresh the local cache for specific directories without collapsing
   * everything else. Each affected dir is re-fetched in parallel; dirs that
   * weren't expanded are skipped (top-level changes are picked up by
   * `useFileList`'s react-query invalidation).
   */
  const refreshDirs = useCallback(
    async (dirs: string[]) => {
      const unique = Array.from(new Set(dirs)).filter(
        (d) => d && d !== rootDir && d !== ".",
      )
      if (unique.length === 0) return
      const results = await Promise.all(
        unique.map(async (dir) => {
          try {
            const children = await dataClient.getTree(dir)
            const filtered =
              ignoreNames.length === 0
                ? children
                : children.filter((c) => !matchesAny(c.name, ignoreNames))
            return [dir, filtered] as const
          } catch {
            return null
          }
        }),
      )
      setExpandedChildren((prev) => {
        const next = new Map(prev)
        for (const result of results) {
          if (!result) continue
          const [dir, children] = result
          // Only update if this dir was actually expanded — re-fetching a
          // collapsed dir would silently re-add it to the cache.
          if (next.has(dir)) next.set(dir, children)
        }
        return next
      })
    },
    [dataClient, rootDir, ignoreNames],
  )

  // Paths currently being mutated (move/rename/delete/create). Renders a
  // pending spinner on the affected rows. Set during the await; cleared in
  // finally (success and failure).
  const [pendingPaths, setPendingPaths] = useState<Set<string>>(new Set())

  const markPending = useCallback((path: string) => {
    setPendingPaths((prev) => {
      const next = new Set(prev)
      next.add(path)
      return next
    })
  }, [])

  const clearPending = useCallback((path: string) => {
    setPendingPaths((prev) => {
      if (!prev.has(path)) return prev
      const next = new Set(prev)
      next.delete(path)
      return next
    })
  }, [])

  const handleContextMenu = useCallback(
    (event: React.MouseEvent, node: FileTreeNode) => {
      setCtxMenu({ node, x: event.clientX, y: event.clientY })
    },
    [],
  )

  const handleBackgroundContextMenu = useCallback(
    (event: React.MouseEvent) => {
      const target = event.target as HTMLElement
      if (target.closest("[role=treeitem]") || target.closest("[data-path]"))
        return
      event.preventDefault()
      setCtxMenu({
        node: { name: rootDir, kind: "dir", path: rootDir },
        x: event.clientX,
        y: event.clientY,
        isBackground: true,
      })
    },
    [rootDir],
  )

  const handleDragDrop = useCallback(
    async (sourcePath: string, targetDirPath: string) => {
      const fileName = sourcePath.split("/").pop() ?? sourcePath
      const effectiveDir = targetDirPath === "." ? rootDir : targetDirPath
      const newPath =
        effectiveDir === "." ? fileName : `${effectiveDir}/${fileName}`
      if (newPath === sourcePath) return
      markPending(sourcePath)
      try {
        await moveFile({ from: sourcePath, to: newPath })
        await refreshDirs([parentDir(sourcePath), parentDir(newPath)])
        toast.success({ title: "Moved", description: `${sourcePath} → ${newPath}` })
      } catch (err) {
        toast.error({
          title: "Move failed",
          description: err instanceof Error ? err.message : String(err),
        })
      } finally {
        clearPending(sourcePath)
      }
    },
    [moveFile, refreshDirs, rootDir, markPending, clearPending],
  )

  function ctxAction(fn: () => void | Promise<void>) {
    return () => {
      setCtxMenu(null)
      void (async () => {
        try {
          await fn()
        } catch (err) {
          toast.error({
            title: "Action failed",
            description: err instanceof Error ? err.message : String(err),
          })
        }
      })()
    }
  }

  const startCreate = (kind: "create-file" | "create-folder") => {
    const node = ctxMenu?.node
    setCtxMenu(null)
    const dir =
      node?.kind === "dir" ? node.path : node ? parentDir(node.path) : rootDir
    const draftPath = `__draft__:${++draftSeqRef.current}`
    setEditing({ kind, parentDir: dir, path: draftPath })
  }

  const handleNewFile = () => startCreate("create-file")
  const handleNewFolder = () => startCreate("create-folder")

  const handleRename = () => {
    const node = ctxMenu?.node
    setCtxMenu(null)
    if (!node) return
    setEditing({ kind: "rename", path: node.path, initialValue: node.name })
  }

  const handleSubmitEdit = useCallback(
    async (_path: string, value: string) => {
      const current = editing
      setEditing(null)
      if (!current) return
      const trimmed = value.trim()
      if (!trimmed) return
      const trackPath =
        current.kind === "rename"
          ? current.path
          : `${current.parentDir}/${trimmed}`
      markPending(trackPath)
      try {
        if (current.kind === "rename") {
          if (trimmed === current.initialValue) return
          const parts = current.path.split("/")
          parts[parts.length - 1] = trimmed
          const to = parts.join("/")
          await moveFile({ from: current.path, to })
          await refreshDirs([parentDir(current.path)])
          toast.success({ title: "Renamed", description: `${current.path} → ${to}` })
        } else {
          const dir = current.parentDir
          const newPath = dir === "." || dir === "" ? trimmed : `${dir}/${trimmed}`
          if (current.kind === "create-file") {
            await writeFile({ path: newPath, content: "" })
            // useFileWrite stays silent (it can't tell create from edit);
            // the call site knows this was a creation, so emit here.
            // useCreateDir already emits its own file:created event.
            events.emit("file:created", {
              ...userMeta(),
              path: newPath,
              kind: "file",
            })
            toast.success({ title: "File created", description: newPath })
          } else {
            await createDir({ path: newPath })
            toast.success({ title: "Folder created", description: newPath })
          }
          await refreshDirs([dir])
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        toast.error({
          title:
            current.kind === "rename"
              ? "Rename failed"
              : current.kind === "create-file"
              ? "Create file failed"
              : "Create folder failed",
          description: msg,
        })
      } finally {
        clearPending(trackPath)
      }
    },
    [editing, moveFile, writeFile, createDir, refreshDirs, markPending, clearPending],
  )

  const handleCancelEdit = useCallback(() => {
    setEditing(null)
  }, [])

  const handleCopyPath = ctxAction(async () => {
    if (!ctxMenu?.node) return
    await copyToClipboard(ctxMenu.node.path)
    toast.success({ title: "Path copied", description: ctxMenu.node.path })
  })

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return
    const target = deleteTarget
    setDeleteTarget(null)
    markPending(target.path)
    try {
      await deleteFile({ path: target.path })
      await refreshDirs([parentDir(target.path)])
      toast.success({ title: "Deleted", description: target.path })
    } catch (err) {
      toast.error({
        title: "Delete failed",
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      clearPending(target.path)
    }
  }, [deleteTarget, deleteFile, refreshDirs, markPending, clearPending])

  const effectiveQuery =
    !useServerSearch && (searchQuery?.length ?? 0) > 0 ? searchQuery : undefined

  return (
    <div className="flex h-full min-h-0 flex-col">
      {error && (
        <div className="px-3 py-2 text-xs text-destructive">
          Failed to load files: {error.message}
        </div>
      )}

      <div
        ref={containerRef}
        className="min-h-0 flex-1 overflow-hidden"
        onContextMenu={handleBackgroundContextMenu}
      >
        {isLoading ? (
          <div className="space-y-1 p-2" data-testid="tree-skeleton">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="h-5 animate-pulse rounded bg-muted"
                style={{ width: `${60 + ((i * 13) % 30)}%` }}
              />
            ))}
          </div>
        ) : (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-muted-foreground">
                <span className="animate-pulse">Loading...</span>
              </div>
            }
          >
            <FileTree
              files={treeData}
              selectedPath={selectedPath}
              searchQuery={effectiveQuery}
              editing={
                editing
                  ? ({
                      path: editing.path,
                      isDraft: editing.kind !== "rename",
                      initialValue:
                        editing.kind === "rename"
                          ? editing.initialValue
                          : undefined,
                    } satisfies FileTreeEditState)
                  : null
              }
              pendingPaths={pendingPaths}
              onSelect={handleSelect}
              onExpand={handleExpand}
              onContextMenu={handleContextMenu}
              onSubmitEdit={handleSubmitEdit}
              onCancelEdit={handleCancelEdit}
              onDragDrop={handleDragDrop}
              height={treeHeight}
              className={cn(className)}
            />
          </Suspense>
        )}
      </div>

      {ctxMenu && (
        <div
          ref={menuRef}
          role="menu"
          className="fixed z-50 min-w-[10rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
            onClick={handleNewFile}
          >
            New file
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
            onClick={handleNewFolder}
          >
            New folder
          </button>
          {!ctxMenu.isBackground && (
            <>
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                onClick={handleRename}
              >
                Rename
              </button>
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10"
                onClick={() => {
                  setDeleteTarget(ctxMenu.node)
                  setCtxMenu(null)
                }}
              >
                Delete
              </button>
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                onClick={handleCopyPath}
              >
                Copy path
              </button>
            </>
          )}
        </div>
      )}

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export interface FileTreePaneProps {
  rootDir?: string
  panelApi?: DockviewPanelApi
  bridge?: WorkspaceBridge
  className?: string
}

/**
 * Default "Files" panel: `PanelChrome` + always-visible search input wired to
 * `<FileTreeView>`. Drop into a dockview registry as-is, or compose
 * `FileTreeView` directly when you want different chrome/search UX.
 */
export function FileTreePane({
  rootDir = ".",
  panelApi,
  bridge,
  className,
}: FileTreePaneProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedQuery(searchQuery), 200)
    return () => clearTimeout(debounceRef.current)
  }, [searchQuery])

  return (
    <PanelChrome title="Files" panelApi={panelApi}>
      <div className="flex h-full flex-col">
        <div className="border-b border-border px-2 py-1.5">
          <Input
            placeholder="Search files..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-7 text-xs"
            aria-label="Search files"
          />
        </div>
        <div className="min-h-0 flex-1">
          <FileTreeView
            rootDir={rootDir}
            searchQuery={debouncedQuery || undefined}
            bridge={bridge}
            className={className}
          />
        </div>
      </div>
    </PanelChrome>
  )
}
