"use client"

import { createContext, useCallback, useContext, useMemo, useRef } from "react"
import { Tree, type NodeRendererProps, type TreeApi } from "react-arborist"
import { FolderIcon, FolderOpenIcon, ChevronRightIcon } from "lucide-react"
import { getFileIcon } from "../registry/getFileIcon"
import { cn } from "../lib/utils"

export interface FileTreeNode {
  name: string
  kind: "file" | "dir"
  path: string
  children?: FileTreeNode[]
}

export interface FileTreeProps {
  files: FileTreeNode[]
  selectedPath?: string | null
  searchQuery?: string
  height?: number
  onSelect?: (path: string) => void
  onExpand?: (path: string) => void
  onCollapse?: (path: string) => void
  onContextMenu?: (event: React.MouseEvent, node: FileTreeNode) => void
  onDragDrop?: (sourcePath: string, targetDirPath: string) => void
  className?: string
}

type ContextMenuHandler = ((e: React.MouseEvent, node: FileTreeNode) => void) | undefined

const TreeHandlersCtx = createContext<{ onContextMenu: ContextMenuHandler }>({
  onContextMenu: undefined,
})

function Node({ node, style, dragHandle }: NodeRendererProps<FileTreeNode>) {
  const { onContextMenu } = useContext(TreeHandlersCtx)
  const data = node.data
  const isDir = data.kind === "dir"
  const Icon = isDir
    ? node.isOpen
      ? FolderOpenIcon
      : FolderIcon
    : getFileIcon(data.name)

  return (
    <div
      ref={dragHandle}
      style={style}
      className={cn(
        "group flex items-center gap-2 px-2 py-0.5 cursor-pointer text-[13px] select-none rounded-md",
        "hover:bg-muted/70",
        node.isSelected && "bg-muted text-foreground",
        node.willReceiveDrop && "bg-muted outline outline-1 outline-border",
      )}
      onClick={(e) => {
        e.stopPropagation()
        if (isDir) {
          node.toggle()
        } else {
          node.select()
          node.activate()
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onContextMenu?.(e, data)
      }}
    >
      {isDir && (
        <ChevronRightIcon
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
            node.isOpen && "rotate-90",
          )}
        />
      )}
      {!isDir && <span className="w-3.5 shrink-0" />}
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="truncate">{data.name}</span>
    </div>
  )
}

export function FileTree({
  files,
  selectedPath,
  searchQuery,
  height = 400,
  onSelect,
  onExpand,
  onCollapse,
  onContextMenu,
  onDragDrop,
  className,
}: FileTreeProps) {
  const treeRef = useRef<TreeApi<FileTreeNode> | null>(null)

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

  const handlers = useMemo(() => ({ onContextMenu }), [onContextMenu])

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

  return (
    <TreeHandlersCtx.Provider value={handlers}>
      <div className={cn("file-tree", className)}>
        <Tree<FileTreeNode>
          ref={treeRef}
          data={files}
          idAccessor="path"
          childrenAccessor="children"
          openByDefault={false}
          width="100%"
          height={height}
          rowHeight={26}
          indent={18}
          selection={selection}
          searchTerm={searchQuery ?? ""}
          searchMatch={searchMatch}
          onActivate={handleActivate}
          onToggle={handleToggle}
          onMove={handleMove}
          disableDrop={disableDrop}
          disableEdit={true}
        >
          {Node}
        </Tree>
      </div>
    </TreeHandlersCtx.Provider>
  )
}
