"use client"

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import type { DockviewPanelApi } from "dockview-react"
import {
  useFileList,
  useFileWrite,
  useCreateDir,
  useMoveFile,
  useDeleteFile,
  useFileSearch,
  useDataClient,
  useGitUrlMetadata,
} from "../data"
import type { FileEntry } from "../data/types"
import type { FileTreeNode, FileTreeEditState } from "./FileTree"
import {
  buildTree,
  dirKey,
  injectDraftIntoTree,
  mergeEntries,
  parentDir,
  type DraftEditing,
} from "./treeModel"
import type { WorkspaceBridge } from "../../../../front/bridge/types"
import { PanelChrome } from "../../../../front/dock"
import {
  DEFAULT_TREE_IGNORE,
  filterIgnoredEntries,
  matchesAny,
  toFileSearchGlob,
} from "../search"
import {
  AlertDialog,
  AlertDialogAction,
  Button,
  ErrorState,
  Spinner,
  Skeleton,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Input,
} from "@hachej/boring-ui-kit"
import { cn } from "../../../../front/lib/utils"
import { toast } from "../../../../front/toast"
import { events, userMeta } from "../../../../front/events"
import { filesystemEvents } from "../../shared/events"
import type { PaneProps } from "../../../../shared/types/panel"
import type { LeftTabParams } from "../../../../shared/plugins/types"
import { copyToClipboard } from "./clipboard"

export { copyToClipboard } from "./clipboard"

const loadFileTreeComponent = () =>
  import("./FileTree").then((m) => ({ default: m.FileTree }))

export function preloadFileTreeComponent(): void {
  void loadFileTreeComponent()
}

const FileTree = lazy(loadFileTreeComponent)

interface ContextMenuState {
  node: FileTreeNode
  x: number
  y: number
  isBackground?: boolean
}

const CONTEXT_MENU_MARGIN = 8
const SETTLED_REMOTE_TREE_REFRESH_MS = 250

function clampContextMenuPosition(
  x: number,
  y: number,
  menuRect: Pick<DOMRect, "width" | "height">,
  viewportWidth: number,
  viewportHeight: number,
) {
  return {
    x: Math.max(
      CONTEXT_MENU_MARGIN,
      Math.min(x, viewportWidth - menuRect.width - CONTEXT_MENU_MARGIN),
    ),
    y: Math.max(
      CONTEXT_MENU_MARGIN,
      Math.min(y, viewportHeight - menuRect.height - CONTEXT_MENU_MARGIN),
    ),
  }
}

/**
 * The minimal slice of {@link WorkspaceBridge} the file tree actually uses:
 * click-to-open (`openFile`), initial selection (`getActiveFile`), and
 * reactive reveal (`select`, plus optional `subscribe`). Exported so the
 * intermediate hosts (WorkbenchLeftPane, LeftTabParams, FileTreePane) can
 * forward a surface-backed adapter that satisfies just this slice instead of
 * the full bridge.
 */
export type FileTreeBridge = Pick<WorkspaceBridge, "openFile" | "getActiveFile" | "select"> &
  Partial<Pick<WorkspaceBridge, "subscribe">>

export interface FileTreeViewProps {
  rootDir?: string
  /** Already-debounced query. Empty/undefined means no filter. */
  searchQuery?: string
  bridge?: FileTreeBridge
  revealFileTreeRequest?: { path: string; seq: number } | null
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

function normalizeRevealPath(path: string): string {
  const normalized = path.trim().replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "").replace(/\/+/g, "/")
  const withoutTrailingSlash = normalized.replace(/\/+$/, "")
  return withoutTrailingSlash || "."
}

function parentDirsForReveal(path: string): string[] {
  const parts = normalizeRevealPath(path).split("/").filter(Boolean)
  const dirs: string[] = []
  for (let i = 1; i < parts.length; i++) {
    dirs.push(parts.slice(0, i).join("/"))
  }
  return dirs
}

function basename(path: string): string {
  const i = path.lastIndexOf("/")
  return i >= 0 ? path.slice(i + 1) : path
}

function hideEntries(
  entries: FileEntry[] | undefined,
  hiddenPaths: ReadonlySet<string>,
): FileEntry[] | undefined {
  if (!entries || hiddenPaths.size === 0) return entries
  return entries.filter((entry) => !hiddenPaths.has(entry.path))
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
  revealFileTreeRequest,
  ignoreNames = DEFAULT_TREE_IGNORE,
  className,
}: FileTreeViewProps) {
  const dataClient = useDataClient()
  const { data: rawFileList, error, isLoading } = useFileList(rootDir)
  const [optimisticEntries, setOptimisticEntries] = useState<
    Map<string, FileEntry[]>
  >(new Map())
  const [hiddenEntryPaths, setHiddenEntryPaths] = useState<Set<string>>(new Set())
  const rootDirKey = dirKey(rootDir)
  const rawFileListWithOptimistic = useMemo(
    () => hideEntries(mergeEntries(rawFileList, optimisticEntries.get(rootDirKey)), hiddenEntryPaths),
    [rawFileList, optimisticEntries, rootDirKey, hiddenEntryPaths],
  )
  // Filter out junk folders (node_modules, dist, …) before they hit
  // buildTree. Cheap O(n) at the top level; nested children are already
  // filtered by the agent backend or by their own buildTree recursion
  // since the same `ignoreNames` is applied via the closure below.
  const fileList = useMemo(
    () => filterIgnoredEntries(rawFileListWithOptimistic, ignoreNames),
    [rawFileListWithOptimistic, ignoreNames],
  )
  const { mutateAsync: writeFile } = useFileWrite()
  const { mutateAsync: createDir } = useCreateDir()
  const { mutateAsync: moveFile } = useMoveFile()
  const { mutateAsync: deleteFile } = useDeleteFile()

  const [expandedChildren, setExpandedChildren] = useState<
    Map<string, FileEntry[]>
  >(new Map())
  const expandedChildrenWithOptimistic = useMemo(() => {
    if (optimisticEntries.size === 0 && hiddenEntryPaths.size === 0) return expandedChildren
    const next = new Map<string, FileEntry[]>()
    for (const [dir, entries] of expandedChildren) {
      next.set(dir, hideEntries(entries, hiddenEntryPaths) ?? entries)
    }
    for (const [dir, entries] of optimisticEntries) {
      if (dir === rootDirKey) continue
      const merged = hideEntries(mergeEntries(next.get(dir), entries), hiddenEntryPaths)
      if (merged) next.set(dir, merged)
    }
    return next
  }, [expandedChildren, optimisticEntries, rootDirKey, hiddenEntryPaths])

  const containerRef = useRef<HTMLDivElement>(null)
  const [treeHeight, setTreeHeight] = useState(400)

  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null)
  const gitUrlPath = ctxMenu && !ctxMenu.isBackground && ctxMenu.node.kind === "file"
    ? ctxMenu.node.path
    : null
  const { data: gitUrlMetadata } = useGitUrlMetadata(gitUrlPath)
  const [deleteTarget, setDeleteTarget] = useState<FileTreeNode | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(
    bridge?.getActiveFile?.() ?? null,
  )

  // Inline edit state. `path` identifies which row renders an <input>; for
  // drafts (new file/folder), `parentDir` says where to place the result, and
  // `path` is a synthetic id so the row can be located in the tree.
  const [editing, setEditing] = useState<DraftEditing>(null)
  const [revealPath, setRevealPath] = useState<string | null>(null)
  const revealSeqRef = useRef(0)
  const explicitRevealSeqRef = useRef(0)
  const draftSeqRef = useRef(0)

  const useServerSearch = (searchQuery?.trim().length ?? 0) > 0
  const { data: searchResults } = useFileSearch(
    useServerSearch ? toFileSearchGlob(searchQuery ?? "") : "",
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

  useLayoutEffect(() => {
    if (!ctxMenu || !menuRef.current) return
    const { x, y } = clampContextMenuPosition(
      ctxMenu.x,
      ctxMenu.y,
      menuRef.current.getBoundingClientRect(),
      window.innerWidth,
      window.innerHeight,
    )
    if (x === ctxMenu.x && y === ctxMenu.y) return
    setCtxMenu((prev) => {
      if (!prev) return prev
      if (prev.x === x && prev.y === y) return prev
      return { ...prev, x, y }
    })
  }, [ctxMenu])

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
    serverSearchTree ?? buildTree(fileList ?? [], expandedChildrenWithOptimistic)

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
    async (dirs: string[], options?: { force?: boolean }) => {
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
          if (options?.force || next.has(dir)) next.set(dir, children)
        }
        return next
      })
    },
    [dataClient, rootDir, ignoreNames],
  )

  // Expanded subfolders cache their children in local state (not react-query),
  // so `useFileList`'s invalidation only refreshes the root level. Mirror the
  // expanded dir set into a ref and re-fetch the affected dir when an
  // agent/remote change lands inside it — otherwise a file the agent writes
  // into an open folder stays hidden until the user collapses + re-expands it.
  // `user`-caused changes already refresh locally at their call sites.
  const expandedDirsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    expandedDirsRef.current = new Set(expandedChildren.keys())
  }, [expandedChildren])

  useEffect(() => {
    const settledTimers = new Set<ReturnType<typeof setTimeout>>()
    const affected = (paths: string[]): string[] =>
      Array.from(new Set(paths.map(parentDir))).filter((dir) => expandedDirsRef.current.has(dir))
    const refreshNowAndAfterSettle = (dirs: string[]) => {
      if (!dirs.length) return
      void refreshDirs(dirs)
      const timer = setTimeout(() => {
        settledTimers.delete(timer)
        void refreshDirs(dirs)
      }, SETTLED_REMOTE_TREE_REFRESH_MS)
      settledTimers.add(timer)
    }
    const offCreated = events.on(filesystemEvents.created, (e) => {
      if (e.cause === "user") return
      refreshNowAndAfterSettle(affected([e.path]))
    })
    const offDeleted = events.on(filesystemEvents.deleted, (e) => {
      if (e.cause === "user") return
      refreshNowAndAfterSettle(affected([e.path]))
    })
    const offMoved = events.on(filesystemEvents.moved, (e) => {
      if (e.cause === "user") return
      refreshNowAndAfterSettle(affected([e.from, e.to]))
    })
    return () => {
      offCreated()
      offDeleted()
      offMoved()
      for (const timer of settledTimers) clearTimeout(timer)
      settledTimers.clear()
    }
  }, [refreshDirs])

  const revealTreePath = useCallback(
    async (path: string | null, options?: { refreshTargetDir?: boolean }) => {
      if (!path) return
      const normalizedPath = normalizeRevealPath(path)
      const revealSeq = ++revealSeqRef.current
      setSelectedPath(normalizedPath)
      const dirsToRefresh = options?.refreshTargetDir
        ? [...parentDirsForReveal(normalizedPath), normalizedPath]
        : parentDirsForReveal(normalizedPath)
      await refreshDirs([...new Set(dirsToRefresh)], { force: true })
      if (revealSeqRef.current !== revealSeq) return
      setRevealPath(normalizedPath)
    },
    [refreshDirs],
  )

  const handleRevealHandled = useCallback((path: string) => {
    setRevealPath((current) => current === path ? null : current)
  }, [])

  const revealExplicitTreePath = useCallback(
    async (path: string) => {
      const seq = ++explicitRevealSeqRef.current
      try {
        await revealTreePath(path, { refreshTargetDir: true })
      } finally {
        if (explicitRevealSeqRef.current === seq) explicitRevealSeqRef.current = 0
      }
    },
    [revealTreePath],
  )

  useEffect(() => {
    if (!revealFileTreeRequest) return
    void revealExplicitTreePath(revealFileTreeRequest.path)
  }, [revealFileTreeRequest, revealExplicitTreePath])

  useEffect(() => {
    const activeFile = bridge?.getActiveFile?.() ?? null
    if (activeFile && explicitRevealSeqRef.current === 0) void revealTreePath(activeFile)
    const unsubscribers: Array<() => void> = []
    if (bridge?.select) {
      unsubscribers.push(
        bridge.select((state) => state.activeFile, (path) => {
          if (path) {
            if (explicitRevealSeqRef.current === 0) void revealTreePath(path)
          } else {
            setSelectedPath(null)
          }
        }),
      )
    }
    if (bridge?.subscribe) {
      unsubscribers.push(
        bridge.subscribe("tree:expand", ({ path }) => {
          void revealExplicitTreePath(path)
        }),
      )
    }
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe()
    }
  }, [bridge, revealExplicitTreePath, revealTreePath])

  const addOptimisticEntry = useCallback((dir: string, entry: FileEntry) => {
    setOptimisticEntries((prev) => {
      const key = dirKey(dir)
      const next = new Map(prev)
      const entries = mergeEntries(next.get(key), [entry]) ?? [entry]
      next.set(key, entries)
      return next
    })
  }, [])

  const removeOptimisticEntry = useCallback((dir: string, path: string) => {
    setOptimisticEntries((prev) => {
      const key = dirKey(dir)
      const entries = prev.get(key)
      if (!entries?.length) return prev
      const remaining = entries.filter((entry) => entry.path !== path)
      const next = new Map(prev)
      if (remaining.length > 0) next.set(key, remaining)
      else next.delete(key)
      return next
    })
  }, [])

  const hideEntry = useCallback((path: string) => {
    setHiddenEntryPaths((prev) => {
      if (prev.has(path)) return prev
      const next = new Set(prev)
      next.add(path)
      return next
    })
  }, [])

  const unhideEntry = useCallback((path: string) => {
    setHiddenEntryPaths((prev) => {
      if (!prev.has(path)) return prev
      const next = new Set(prev)
      next.delete(path)
      return next
    })
  }, [])

  useEffect(() => {
    const shouldPatchDir = (dir: string) => dir === rootDirKey || expandedDirsRef.current.has(dir)
    const offCreated = events.on(filesystemEvents.created, (e) => {
      unhideEntry(e.path)
      if (e.cause === "user") return
      const dir = parentDir(e.path)
      if (shouldPatchDir(dir)) {
        addOptimisticEntry(dir, { name: basename(e.path), kind: e.kind, path: e.path })
      }
    })
    const offDeleted = events.on(filesystemEvents.deleted, (e) => {
      if (e.cause === "user") return
      hideEntry(e.path)
      removeOptimisticEntry(parentDir(e.path), e.path)
    })
    const offMoved = events.on(filesystemEvents.moved, (e) => {
      if (e.cause === "user") return
      hideEntry(e.from)
      unhideEntry(e.to)
      removeOptimisticEntry(parentDir(e.from), e.from)
    })
    return () => {
      offCreated()
      offDeleted()
      offMoved()
    }
  }, [addOptimisticEntry, hideEntry, removeOptimisticEntry, rootDirKey, unhideEntry])

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
      const dir = current.kind === "rename" ? parentDir(current.path) : current.parentDir
      const newPath = current.kind === "rename"
        ? current.path
        : dir === "." || dir === ""
          ? trimmed
          : `${dir}/${trimmed}`
      const trackPath = current.kind === "rename" ? current.path : newPath
      markPending(trackPath)
      let addedOptimisticPath: string | null = null
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
          const optimisticEntry = {
            name: trimmed,
            kind: current.kind === "create-file" ? "file" as const : "dir" as const,
            path: newPath,
          }
          addOptimisticEntry(dir, optimisticEntry)
          addedOptimisticPath = newPath
          if (current.kind === "create-file") {
            await writeFile({ path: newPath, content: "" })
            // useFileWrite emits changed (it can't tell create from edit);
            // the call site knows this was a creation, so emit here.
            // useCreateDir already emits its own filesystem create event.
            events.emit(filesystemEvents.created, {
              ...userMeta(),
              path: newPath,
              kind: "file",
            })
            handleSelect(newPath)
            toast.success({ title: "File created", description: newPath })
          } else {
            await createDir({ path: newPath })
            toast.success({ title: "Folder created", description: newPath })
          }
          await refreshDirs([dir], { force: true })
          setRevealPath(newPath)
        }
      } catch (err) {
        if (addedOptimisticPath) removeOptimisticEntry(dir, addedOptimisticPath)
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
    [
      editing,
      moveFile,
      writeFile,
      createDir,
      refreshDirs,
      markPending,
      clearPending,
      addOptimisticEntry,
      removeOptimisticEntry,
      handleSelect,
    ],
  )

  const handleCancelEdit = useCallback(() => {
    setEditing(null)
  }, [])

  const handleCopyPath = ctxAction(async () => {
    if (!ctxMenu?.node) return
    await copyToClipboard(ctxMenu.node.path)
    toast.success({ title: "Path copied", description: ctxMenu.node.path })
  })

  const handleCopyGitUrl = ctxAction(async () => {
    if (!gitUrlMetadata?.enabled || !gitUrlMetadata.url) {
      throw new Error(gitUrlMetadata?.reason ?? "Git URL unavailable")
    }
    await copyToClipboard(gitUrlMetadata.url)
    toast.success({ title: "Git URL copied", description: gitUrlMetadata.url })
  })

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return
    const target = deleteTarget
    setDeleteTarget(null)
    markPending(target.path)
    try {
      await deleteFile({ path: target.path })
      removeOptimisticEntry(parentDir(target.path), target.path)
      if (target.kind === "dir") {
        setExpandedChildren((prev) => {
          const next = new Map(prev)
          for (const dir of next.keys()) {
            if (dir === target.path || dir.startsWith(`${target.path}/`)) {
              next.delete(dir)
            }
          }
          return next
        })
      }
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
  }, [
    deleteTarget,
    deleteFile,
    refreshDirs,
    markPending,
    clearPending,
    removeOptimisticEntry,
  ])

  const effectiveQuery =
    !useServerSearch && (searchQuery?.length ?? 0) > 0 ? searchQuery : undefined

  return (
    <div className="flex h-full min-h-0 flex-col">
      {error && (
        <ErrorState
          className="m-2 rounded-md p-3"
          title="Failed to load files"
          description={error.message}
        />
      )}

      <div
        ref={containerRef}
        className="min-h-0 flex-1 overflow-hidden"
        onContextMenu={handleBackgroundContextMenu}
      >
        {isLoading ? (
          <div className="space-y-1 p-2" data-testid="tree-skeleton">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton
                key={i}
                className="h-5"
                style={{ width: `${60 + ((i * 13) % 30)}%` }}
              />
            ))}
          </div>
        ) : (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                <Spinner className="size-3.5" />
                <span>Loading...</span>
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
              revealPath={revealPath}
              onRevealHandled={handleRevealHandled}
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

      {ctxMenu && createPortal(
        <div
          ref={menuRef}
          role="menu"
          className="fixed z-50 min-w-[10rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          <Button type="button" role="menuitem" variant="ghost" size="sm" className="w-full justify-start" onClick={handleNewFile}>
            New file
          </Button>
          <Button type="button" role="menuitem" variant="ghost" size="sm" className="w-full justify-start" onClick={handleNewFolder}>
            New folder
          </Button>
          {!ctxMenu.isBackground && (
            <>
              <Button type="button" role="menuitem" variant="ghost" size="sm" className="w-full justify-start" onClick={handleRename}>
                Rename
              </Button>
              <Button
                type="button"
                role="menuitem"
                variant="ghost"
                size="sm"
                className="w-full justify-start text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => {
                  setDeleteTarget(ctxMenu.node)
                  setCtxMenu(null)
                }}
              >
                Delete
              </Button>
              <Button type="button" role="menuitem" variant="ghost" size="sm" className="w-full justify-start" onClick={handleCopyPath}>
                Copy path
              </Button>
              {gitUrlMetadata?.enabled ? (
                <Button type="button" role="menuitem" variant="ghost" size="sm" className="w-full justify-start" onClick={handleCopyGitUrl}>
                  Copy Git URL
                </Button>
              ) : gitUrlMetadata?.reason ? (
                <div className="px-2 py-1 text-xs text-muted-foreground" aria-live="polite">
                  {gitUrlMetadata.reason}
                </div>
              ) : null}
            </>
          )}
        </div>,
        // Portal to <body>: the menu is position:fixed, but the dockview panel
        // ancestor is transformed (its own containing block) and PanelChrome is
        // overflow-hidden, which clipped the menu at the panel's bottom edge.
        // Rendering at the body root makes "fixed" truly viewport-relative.
        document.body,
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

export { clampContextMenuPosition }

export interface FileTreePaneParams extends LeftTabParams {
  rootDir?: string
  searchQuery?: string
  query?: string
  bridge?: unknown
  chromeless?: boolean
  revealFileTreeRequest?: { path: string; seq: number } | null
}

export interface FileTreePaneProps extends Partial<PaneProps<FileTreePaneParams>> {
  rootDir?: string
  searchQuery?: string
  panelApi?: DockviewPanelApi
  bridge?: FileTreeBridge
  chromeless?: boolean
  className?: string
}

/**
 * Default "Files" panel: `PanelChrome` + always-visible search input wired to
 * `<FileTreeView>`. Drop into a dockview registry as-is, or compose
 * `FileTreeView` directly when you want different chrome/search UX.
 */
export function FileTreePane({
  params,
  rootDir = ".",
  searchQuery: controlledSearchQuery,
  panelApi,
  bridge,
  api,
  chromeless = false,
  className,
}: FileTreePaneProps) {
  const effectiveRootDir = params?.rootDir ?? rootDir
  const effectiveBridge = (params?.bridge as FileTreeBridge | undefined) ?? bridge
  const effectiveChromeless = params?.chromeless ?? chromeless
  const effectiveRevealRequest = params?.revealFileTreeRequest ?? null
  const externalSearchQuery =
    params?.searchQuery ?? params?.query ?? controlledSearchQuery
  const effectivePanelApi = panelApi ?? api
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedQuery(searchQuery), 200)
    return () => clearTimeout(debounceRef.current)
  }, [searchQuery])

  const effectiveSearchQuery =
    externalSearchQuery !== undefined
      ? externalSearchQuery || undefined
      : debouncedQuery || undefined

  if (effectiveChromeless) {
    return (
      <FileTreeView
        rootDir={effectiveRootDir}
        searchQuery={effectiveSearchQuery}
        bridge={effectiveBridge}
        revealFileTreeRequest={effectiveRevealRequest}
        className={cn("px-1 pt-1 [&_[role=treeitem]]:!indent-0", className)}
      />
    )
  }

  return (
    <PanelChrome title="Files" panelApi={effectivePanelApi}>
      <div className="flex h-full flex-col">
        <div className="border-b border-border px-2 py-1.5">
          <Input
            placeholder="Search files..."
            value={externalSearchQuery ?? searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-7 text-xs"
            aria-label="Search files"
          />
        </div>
        <div className="min-h-0 flex-1">
          <FileTreeView
            rootDir={effectiveRootDir}
            searchQuery={effectiveSearchQuery}
            bridge={effectiveBridge}
            revealFileTreeRequest={effectiveRevealRequest}
            className={className}
          />
        </div>
      </div>
    </PanelChrome>
  )
}
