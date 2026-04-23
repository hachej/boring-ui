"use client"

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"
import { PanelChrome } from "../dock"
import {
  useFileList,
  useFileWrite,
  useCreateDir,
  useMoveFile,
  useDeleteFile,
  useFileSearch,
  useDataClient,
} from "../data"
import type { FileEntry } from "../data/types"
import type { FileTreeNode } from "../components/FileTree"
import type { DockviewPanelApi } from "dockview-react"
import type { WorkspaceBridge } from "../bridge/types"
import { Input } from "../components/ui"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/ui"

const FileTree = lazy(() =>
  import("../components/FileTree").then((m) => ({ default: m.FileTree })),
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
      const node: FileTreeNode = {
        ...entry,
        children: children ? buildTree(children, childrenByDir) : [],
      }
      dirs.push(node)
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

interface ContextMenuState {
  node: FileTreeNode
  x: number
  y: number
  isBackground?: boolean
}

export interface FileTreePaneProps {
  rootDir?: string
  panelApi?: DockviewPanelApi
  bridge?: WorkspaceBridge
  className?: string
}

export function FileTreePane({
  rootDir = ".",
  panelApi,
  bridge,
  className,
}: FileTreePaneProps) {
  const dataClient = useDataClient()
  const { data: fileList, isLoading, error } = useFileList(rootDir)
  const { mutateAsync: writeFile } = useFileWrite()
  const { mutateAsync: createDir } = useCreateDir()
  const { mutateAsync: moveFile } = useMoveFile()
  const { mutateAsync: deleteFile } = useDeleteFile()

  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const [expandedChildren, setExpandedChildren] = useState<
    Map<string, FileEntry[]>
  >(new Map())

  const treeContainerRef = useRef<HTMLDivElement>(null)
  const [treeHeight, setTreeHeight] = useState(400)

  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<FileTreeNode | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const totalFileCount =
    (fileList?.length ?? 0) +
    Array.from(expandedChildren.values()).reduce((s, v) => s + v.length, 0)
  const useServerSearch =
    totalFileCount >= CLIENT_FILTER_THRESHOLD && searchQuery.length > 0
  const { data: searchResults } = useFileSearch(
    useServerSearch ? searchQuery : "",
    50,
  )

  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedQuery(searchQuery), 200)
    return () => clearTimeout(debounceRef.current)
  }, [searchQuery])

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
    if (actionError) {
      const t = setTimeout(() => setActionError(null), 5000)
      return () => clearTimeout(t)
    }
  }, [actionError])

  useEffect(() => {
    const el = treeContainerRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setTreeHeight(Math.floor(entry.contentRect.height))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const serverSearchTree: FileTreeNode[] | undefined = useServerSearch && searchResults
    ? searchResults.map((path) => ({
        name: path.split("/").pop() ?? path,
        kind: "file" as const,
        path,
      }))
    : undefined

  const treeData = serverSearchTree ?? buildTree(fileList ?? [], expandedChildren)

  const handleSelect = useCallback(
    (path: string) => {
      bridge?.openFile(path, { mode: "edit" })
    },
    [bridge],
  )

  const handleExpand = useCallback(
    async (dirPath: string) => {
      try {
        const children = await dataClient.getTree(dirPath)
        setExpandedChildren((prev) => new Map(prev).set(dirPath, children))
      } catch {
        // Network error — directory stays empty, user can retry
      }
    },
    [dataClient],
  )

  const invalidateExpanded = useCallback(() => {
    setExpandedChildren(new Map())
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
      if (target.closest("[role=treeitem]") || target.closest("[data-path]")) return
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
      try {
        await moveFile({ from: sourcePath, to: newPath })
        invalidateExpanded()
      } catch (err) {
        setActionError(
          `Move failed: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    },
    [moveFile, invalidateExpanded, rootDir],
  )

  function ctxAction(fn: () => void | Promise<void>) {
    return () => {
      const captured = ctxMenu
      setCtxMenu(null)
      void (async () => {
        try {
          await fn()
        } catch (err) {
          setActionError(
            err instanceof Error ? err.message : String(err),
          )
        }
      })()
    }
  }

  const handleNewFile = ctxAction(async () => {
    const node = ctxMenu?.node
    const dir = node?.kind === "dir" ? node.path : node ? parentDir(node.path) : rootDir
    const name = window.prompt("File name:")
    if (!name) return
    const path = dir === "." ? name : `${dir}/${name}`
    await writeFile({ path, content: "" })
    invalidateExpanded()
  })

  const handleNewFolder = ctxAction(async () => {
    const node = ctxMenu?.node
    const dir = node?.kind === "dir" ? node.path : node ? parentDir(node.path) : rootDir
    const name = window.prompt("Folder name:")
    if (!name) return
    const path = dir === "." ? name : `${dir}/${name}`
    await createDir({ path })
    invalidateExpanded()
  })

  const handleRename = ctxAction(async () => {
    if (!ctxMenu?.node) return
    const newName = window.prompt("New name:", ctxMenu.node.name)
    if (!newName || newName === ctxMenu.node.name) return
    const parts = ctxMenu.node.path.split("/")
    parts[parts.length - 1] = newName
    await moveFile({ from: ctxMenu.node.path, to: parts.join("/") })
    invalidateExpanded()
  })

  const handleCopyPath = ctxAction(async () => {
    if (!ctxMenu?.node) return
    await navigator.clipboard.writeText(ctxMenu.node.path)
  })

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return
    try {
      await deleteFile({ path: deleteTarget.path })
      invalidateExpanded()
    } catch (err) {
      setActionError(
        `Delete failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
    setDeleteTarget(null)
  }, [deleteTarget, deleteFile, invalidateExpanded])

  const effectiveQuery =
    !useServerSearch && debouncedQuery.length > 0 ? debouncedQuery : undefined

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

        {error && (
          <div className="px-3 py-2 text-xs text-destructive">
            Failed to load files: {error.message}
          </div>
        )}

        {actionError && (
          <div className="px-3 py-1.5 text-xs text-destructive" role="alert">
            {actionError}
          </div>
        )}

        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <span className="animate-pulse">Loading...</span>
            </div>
          }
        >
          <div ref={treeContainerRef} className="flex-1 overflow-hidden" onContextMenu={handleBackgroundContextMenu}>
            {isLoading ? (
              <div className="space-y-1 p-2" data-testid="tree-skeleton">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-5 animate-pulse rounded bg-muted"
                    style={{ width: `${60 + Math.random() * 30}%` }}
                  />
                ))}
              </div>
            ) : (
              <FileTree
                files={treeData}
                searchQuery={effectiveQuery}
                onSelect={handleSelect}
                onExpand={handleExpand}
                onContextMenu={handleContextMenu}
                onDragDrop={handleDragDrop}
                height={treeHeight}
                className={className}
              />
            )}
          </div>
        </Suspense>

        {ctxMenu && (
          <div
            ref={menuRef}
            role="menu"
            className="fixed z-50 min-w-[10rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
          >
            <button type="button" role="menuitem" className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent" onClick={handleNewFile}>
              New file
            </button>
            <button type="button" role="menuitem" className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent" onClick={handleNewFolder}>
              New folder
            </button>
            {!ctxMenu.isBackground && (
              <>
                <button type="button" role="menuitem" className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent" onClick={handleRename}>
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
                <button type="button" role="menuitem" className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent" onClick={handleCopyPath}>
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
    </PanelChrome>
  )
}
