"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react"
import { Tree, type NodeRendererProps, type TreeApi } from "react-arborist"
import {
  FolderIcon,
  FolderOpenIcon,
  ChevronRightIcon,
  Loader2Icon,
} from "lucide-react"
import { getFileIcon } from "../../../../front/registry/getFileIcon"
import { EmptyState, Input } from "@hachej/boring-ui-kit"
import { cn } from "../../../../front/lib/utils"
import { getFileTreeDndManager } from "./dndManager"

export interface FileTreeNode {
  name: string
  kind: "file" | "dir"
  path: string
  children?: FileTreeNode[]
  /**
   * Internal: marks a placeholder row used for inline new-file/new-folder
   * input. Consumers (FileTreeView) inject this when the user starts a
   * create action; FileTree renders an <input> instead of a name.
   */
  isDraft?: boolean
}

export interface FileTreeEditState {
  /** Path of the row currently being edited (rename target or draft path). */
  path: string
  /** When true, treat blank/Esc as cancel-without-error (new-file/folder flow). */
  isDraft: boolean
  /** Pre-filled value (for rename). */
  initialValue?: string
}

export interface FileTreeProps {
  files: FileTreeNode[]
  selectedPath?: string | null
  searchQuery?: string
  height?: number
  /** Path of the row whose name should render as an <input>. */
  editing?: FileTreeEditState | null
  /** Path that should be scrolled into view, opening parent folders if needed. */
  revealPath?: string | null
  /** Paths currently being mutated — render a small spinner on those rows. */
  pendingPaths?: ReadonlySet<string>
  onSelect?: (path: string) => void
  onExpand?: (path: string) => void
  onCollapse?: (path: string) => void
  onContextMenu?: (event: React.MouseEvent, node: FileTreeNode) => void
  onDragDrop?: (sourcePath: string, targetDirPath: string) => void
  /** Called after a reveal request has opened parents and scheduled scrolling. */
  onRevealHandled?: (path: string) => void
  /** Called when the user presses Enter on an inline-edit input. */
  onSubmitEdit?: (path: string, value: string) => void
  /** Called when the user presses Esc or blurs without submitting. */
  onCancelEdit?: () => void
  className?: string
}

type ContextMenuHandler = ((e: React.MouseEvent, node: FileTreeNode) => void) | undefined

interface TreeHandlersCtxValue {
  onContextMenu: ContextMenuHandler
  editing: FileTreeEditState | null
  pendingPaths: ReadonlySet<string>
  onSubmitEdit?: (path: string, value: string) => void
  onCancelEdit?: () => void
}

const EMPTY_SET: ReadonlySet<string> = new Set()

const TreeHandlersCtx = createContext<TreeHandlersCtxValue>({
  onContextMenu: undefined,
  editing: null,
  pendingPaths: EMPTY_SET,
  onSubmitEdit: undefined,
  onCancelEdit: undefined,
})

function InlineEditInput({
  initialValue,
  onSubmit,
  onCancel,
  isDraft,
}: {
  initialValue: string
  onSubmit: (value: string) => void
  onCancel: () => void
  isDraft: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const submittedRef = useRef(false)

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.focus()
    // For renames pre-select the basename only (without extension), like
    // most IDEs do — quick typing replaces the name without nuking the ext.
    if (!isDraft && initialValue.includes(".")) {
      const dot = initialValue.lastIndexOf(".")
      el.setSelectionRange(0, dot)
    } else {
      el.select()
    }
  }, [initialValue, isDraft])

  const submit = () => {
    if (submittedRef.current) return
    submittedRef.current = true
    const value = inputRef.current?.value.trim() ?? ""
    if (!value || value === initialValue) onCancel()
    else onSubmit(value)
  }

  return (
    <Input
      ref={inputRef}
      type="text"
      defaultValue={initialValue}
      data-testid="file-tree-edit-input"
      aria-label={isDraft ? "Name" : "Rename"}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // Keep react-arborist tree keyboard handlers from stealing focus
        // while typing in the inline name input.
        e.stopPropagation()
        if (e.key === "Enter") {
          e.preventDefault()
          submit()
        } else if (e.key === "Escape") {
          e.preventDefault()
          submittedRef.current = true
          onCancel()
        }
      }}
      onBlur={submit}
      className="h-5 min-w-0 flex-1 rounded-sm border-[color:var(--accent)]/60 px-1 text-[13px] leading-[1.2] focus-visible:ring-[color:var(--accent)]"
    />
  )
}

/**
 * Drop any node without a usable string `path` before handing data to react-arborist
 * (which uses `idAccessor="path"` and THROWS "Data must contain an 'id' property …" if a
 * node's id resolves to a non-string). A pathless node is unidentifiable/unopenable anyway,
 * so dropping it is correct — and it stops one malformed backend listing entry from
 * crashing the whole file panel. Recurses into children. Returns the same array reference
 * when nothing needed removing (cheap no-op for the common clean case).
 */
export function sanitizeFileTree(nodes: FileTreeNode[]): FileTreeNode[] {
  let changed = false
  const cleaned: FileTreeNode[] = []
  for (const node of nodes) {
    if (typeof node?.path !== "string" || node.path.length === 0) {
      changed = true
      if (typeof console !== "undefined") {
        console.warn("[filesystem] dropped a file-tree node with no path", node)
      }
      continue
    }
    if (node.children && node.children.length > 0) {
      const cleanedChildren = sanitizeFileTree(node.children)
      if (cleanedChildren !== node.children) {
        changed = true
        cleaned.push({ ...node, children: cleanedChildren })
        continue
      }
    }
    cleaned.push(node)
  }
  return changed ? cleaned : nodes
}

function countVisibleNodes(
  nodes: FileTreeNode[],
  searchQuery: string | undefined,
): number {
  if (!searchQuery?.trim()) return nodes.length

  const term = searchQuery.trim().toLowerCase()
  const countMatches = (entries: FileTreeNode[]): number => {
    let count = 0
    for (const entry of entries) {
      const selfMatches = entry.name.toLowerCase().includes(term)
      const childCount = entry.children?.length ? countMatches(entry.children) : 0
      if (selfMatches || childCount > 0) {
        count += 1
      }
    }
    return count
  }

  return countMatches(nodes)
}

function Node({ node, style, dragHandle }: NodeRendererProps<FileTreeNode>) {
  const { onContextMenu, editing, pendingPaths, onSubmitEdit, onCancelEdit } =
    useContext(TreeHandlersCtx)
  const data = node.data
  const isDir = data.kind === "dir"
  const isEditingHere = editing?.path === data.path
  const isPending = pendingPaths.has(data.path)
  const Icon = isDir
    ? node.isOpen
      ? FolderOpenIcon
      : FolderIcon
    : getFileIcon(data.name || "untitled")

  return (
    <div
      ref={dragHandle}
      style={style}
      className={cn(
        "group relative mx-1 flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[13px] leading-[1.4] cursor-pointer select-none text-foreground",
        "transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
        !isEditingHere && "hover:bg-foreground/[0.04]",
        node.isSelected &&
          !isEditingHere &&
          "bg-[oklch(from_var(--accent)_l_c_h/0.10)] text-foreground font-medium",
        node.willReceiveDrop &&
          "bg-foreground/5 outline outline-1 outline-border",
      )}
      onClick={(e) => {
        if (isEditingHere) return
        e.stopPropagation()
        if (isDir) {
          node.toggle()
        } else {
          node.select()
          node.activate()
        }
      }}
      onContextMenu={(e) => {
        if (isEditingHere || data.isDraft) return
        e.preventDefault()
        e.stopPropagation()
        onContextMenu?.(e, data)
      }}
    >
      {isDir ? (
        <ChevronRightIcon
          className={cn(
            "h-3 w-3 shrink-0 text-muted-foreground/70 transition-transform duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
            node.isOpen && "rotate-90",
          )}
          strokeWidth={2}
        />
      ) : (
        <span className="w-3 shrink-0" />
      )}
      <Icon
        className={cn(
          "h-4 w-4 shrink-0",
          node.isSelected
            ? "text-[color:var(--accent)]"
            : "text-muted-foreground/80",
        )}
        strokeWidth={1.5}
      />
      {isEditingHere ? (
        <InlineEditInput
          initialValue={editing?.initialValue ?? data.name ?? ""}
          isDraft={!!editing?.isDraft}
          onSubmit={(value) => onSubmitEdit?.(data.path, value)}
          onCancel={() => onCancelEdit?.()}
        />
      ) : (
        <span
          className={cn(
            "truncate",
            isPending && "text-muted-foreground italic",
          )}
        >
          {data.name}
        </span>
      )}
      {isPending && !isEditingHere && (
        <Loader2Icon
          data-testid="file-tree-pending-spinner"
          aria-label="Pending"
          className="ml-auto h-3 w-3 shrink-0 animate-spin text-muted-foreground/70"
          strokeWidth={2}
        />
      )}
    </div>
  )
}

export function FileTree({
  files,
  selectedPath,
  searchQuery,
  height = 400,
  editing,
  revealPath,
  pendingPaths,
  onSelect,
  onExpand,
  onCollapse,
  onContextMenu,
  onSubmitEdit,
  onCancelEdit,
  onRevealHandled,
  onDragDrop,
  className,
}: FileTreeProps) {
  const treeRef = useRef<TreeApi<FileTreeNode> | null>(null)
  // Guard react-arborist (idAccessor="path") against a listing entry with no path —
  // one such node would otherwise throw and crash the whole file panel.
  const safeFiles = useMemo(() => sanitizeFileTree(files), [files])

  useEffect(() => {
    if (!editing?.isDraft) return
    const frame = requestAnimationFrame(() => {
      void treeRef.current?.scrollTo(editing.path)
    })
    return () => cancelAnimationFrame(frame)
  }, [editing?.isDraft, editing?.path])

  useEffect(() => {
    if (!revealPath) return
    let scrollFrame = 0
    const openFrame = requestAnimationFrame(() => {
      const tree = treeRef.current
      if (!tree) return
      tree.openParents(revealPath)
      const node = tree.get(revealPath)
      if (!node) return
      if (node.isInternal) node.open()
      scrollFrame = requestAnimationFrame(() => {
        void treeRef.current?.scrollTo(revealPath)
        onRevealHandled?.(revealPath)
      })
    })
    return () => {
      cancelAnimationFrame(openFrame)
      cancelAnimationFrame(scrollFrame)
    }
  }, [files, onRevealHandled, revealPath])

  const selection = useMemo(
    () => (selectedPath ? selectedPath : undefined),
    [selectedPath],
  )

  const handleActivate = useCallback(
    (node: { data: FileTreeNode }) => {
      if (node.data.kind === "file") {
        onSelect?.(node.data.path)
      }
    },
    [onSelect],
  )

  const handleToggle = useCallback(
    (id: string) => {
      const node = treeRef.current?.get(id)
      if (!node) return
      if (node.isOpen) {
        onExpand?.(node.data.path)
      } else {
        onCollapse?.(node.data.path)
      }
    },
    [onExpand, onCollapse],
  )

  const handleMove = useCallback(
    (args: {
      dragIds: string[]
      parentId: string | null
      index: number
      dragNodes: { data: FileTreeNode }[]
      parentNode: { data: FileTreeNode; isRoot?: boolean } | null
    }) => {
      if (!onDragDrop) return
      const isRoot = !args.parentNode || args.parentNode.isRoot
      const targetPath = isRoot ? "." : args.parentNode!.data.path
      if (!isRoot && args.parentNode!.data.kind !== "dir") return

      for (const dragNode of args.dragNodes) {
        const sourcePath = dragNode.data.path
        if (targetPath === sourcePath) return
        if (targetPath !== "." && targetPath.startsWith(sourcePath + "/")) return
        onDragDrop(sourcePath, targetPath)
      }
    },
    [onDragDrop],
  )

  const disableDrop = useCallback(
    (args: {
      parentNode: { data: FileTreeNode; isRoot?: boolean } | null
      dragNodes: { data: FileTreeNode }[]
    }) => {
      if (!args.parentNode || args.parentNode.isRoot) return false
      if (args.parentNode.data.kind !== "dir") return true
      for (const dn of args.dragNodes) {
        if (args.parentNode.data.path === dn.data.path) return true
        if (args.parentNode.data.path.startsWith(dn.data.path + "/")) return true
      }
      return false
    },
    [],
  )

  const searchMatch = useCallback(
    (node: { data: FileTreeNode }, term: string) => {
      return node.data.name.toLowerCase().includes(term.toLowerCase())
    },
    [],
  )

  const handlers = useMemo(
    () => ({
      onContextMenu,
      editing: editing ?? null,
      pendingPaths: pendingPaths ?? EMPTY_SET,
      onSubmitEdit,
      onCancelEdit,
    }),
    [onContextMenu, editing, pendingPaths, onSubmitEdit, onCancelEdit],
  )

  const visibleNodeCount = useMemo(
    () => countVisibleNodes(files, searchQuery),
    [files, searchQuery],
  )

  if (files.length === 0) {
    return (
      <div
        className={cn(
          "flex h-full items-center justify-center text-sm text-muted-foreground",
          className,
        )}
      >
        No files
      </div>
    )
  }

  if (visibleNodeCount === 0) {
    return (
      <div className={cn("flex h-full items-center justify-center p-6", className)}>
        <EmptyState
          className="min-h-0 border-0"
          title="No matching files"
          description={searchQuery?.trim()
            ? `No files match “${searchQuery.trim()}”.`
            : "No files match the current filter."}
        />
      </div>
    )
  }

  return (
    <TreeHandlersCtx.Provider value={handlers}>
      <div data-boring-workspace-part="file-tree" className={cn("file-tree", className)}>
        <Tree<FileTreeNode>
          ref={treeRef}
          data={safeFiles}
          idAccessor="path"
          childrenAccessor="children"
          openByDefault={false}
          width="100%"
          height={height}
          rowHeight={26}
          indent={14}
          selection={selection}
          searchTerm={searchQuery ?? ""}
          searchMatch={searchMatch}
          onActivate={handleActivate}
          onToggle={handleToggle}
          onMove={handleMove}
          disableDrop={disableDrop}
          disableEdit={true}
          dndManager={getFileTreeDndManager()}
        >
          {Node}
        </Tree>
      </div>
    </TreeHandlersCtx.Provider>
  )
}
