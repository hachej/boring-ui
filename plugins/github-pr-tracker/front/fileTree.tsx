import React from "react"
import { ADD_TEXT, DEL_TEXT, addFill, delFill } from "./status"
import type { DiffFile } from "./types"
import { classes } from "./ui"

export type TreeSort = "churn" | "additions" | "deletions" | "alpha"

interface TreeNode {
  path: string
  label: string
  kind: "folder" | "file"
  additions: number
  deletions: number
  files: number
  churn: number
  children: TreeNode[]
  childMap: Map<string, TreeNode>
}

interface TreeRow extends Omit<TreeNode, "children" | "childMap"> {
  depth: number
}

function buildTree(files: DiffFile[]): TreeNode {
  const makeNode = (path: string, label: string, kind: "folder" | "file"): TreeNode => ({
    path, label, kind, additions: 0, deletions: 0, files: 0, churn: 0, children: [], childMap: new Map(),
  })
  const root = makeNode("", "root", "folder")
  for (const file of files) {
    const additions = Number(file.additions ?? 0)
    const deletions = Number(file.deletions ?? 0)
    const parts = file.path.split("/").filter(Boolean)
    let parent = root
    for (let index = 0; index < parts.length; index += 1) {
      const path = parts.slice(0, index + 1).join("/")
      const kind = index === parts.length - 1 ? "file" : "folder"
      let child = parent.childMap.get(path)
      if (!child) {
        child = makeNode(path, parts[index], kind)
        parent.childMap.set(path, child)
        parent.children.push(child)
      }
      child.additions += additions
      child.deletions += deletions
      child.files += 1
      child.churn = child.additions + child.deletions
      parent = child
    }
  }
  return root
}

function sortNodes(nodes: TreeNode[], sort: TreeSort): TreeNode[] {
  return nodes.slice().sort((a, b) => {
    if (sort === "alpha") {
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1
      return a.label.localeCompare(b.label)
    }
    if (sort === "additions") return b.additions - a.additions || b.churn - a.churn || a.label.localeCompare(b.label)
    if (sort === "deletions") return b.deletions - a.deletions || b.churn - a.churn || a.label.localeCompare(b.label)
    return b.churn - a.churn || a.label.localeCompare(b.label)
  })
}

function flattenTree(root: TreeNode, expanded: Record<string, boolean>, sort: TreeSort): TreeRow[] {
  const rows: TreeRow[] = []
  const visit = (node: TreeNode, depth: number) => {
    for (const child of sortNodes(node.children, sort)) {
      const { children, childMap, ...row } = child
      rows.push({ ...row, depth })
      if (child.kind === "folder" && expanded[child.path]) visit(child, depth + 1)
    }
  }
  visit(root, 0)
  return rows
}

/**
 * Files in the order the tree displays them (depth-first, current sort),
 * regardless of folder expansion. Keyboard prev/next follows this so moving
 * through files matches the visual top-to-bottom order.
 */
export function fileOrder(files: DiffFile[], sort: TreeSort): DiffFile[] {
  const byPath = new Map(files.map((file) => [file.path, file]))
  const ordered: DiffFile[] = []
  const visit = (node: TreeNode) => {
    for (const child of sortNodes(node.children, sort)) {
      if (child.kind === "file") {
        const file = byPath.get(child.path)
        if (file) ordered.push(file)
      } else {
        visit(child)
      }
    }
  }
  visit(buildTree(files))
  return ordered
}

export interface FileTreeProps {
  files: DiffFile[]
  sort: TreeSort
  selectedFilePath?: string
  expandedFolders: Record<string, boolean>
  onToggleFolder: (path: string) => void
  onSelectFile: (path: string) => void
}

export function FileTree({ files, sort, selectedFilePath, expandedFolders, onToggleFolder, onSelectFile }: FileTreeProps) {
  const rows = React.useMemo(
    () => flattenTree(buildTree(files), expandedFolders, sort),
    [files, expandedFolders, sort],
  )
  const maxChurn = Math.max(1, ...rows.map((row) => row.churn))

  if (rows.length === 0) {
    return <div className="p-6 text-center text-xs text-muted-foreground">No files in this scope</div>
  }

  return (
    <div className="py-1 text-xs">
      {rows.map((row) => {
        const expanded = Boolean(expandedFolders[row.path])
        const isSelected = row.path === selectedFilePath
        const isAncestor = !isSelected && row.kind === "folder" && Boolean(selectedFilePath?.startsWith(`${row.path}/`))
        const greenPct = (row.additions / maxChurn) * 100
        const redPct = (row.deletions / maxChurn) * 100
        return (
          <button
            key={row.path}
            type="button"
            data-file-row={row.kind === "file" ? row.path : undefined}
            className={classes(
              "flex w-full items-center gap-2 px-2 py-1 text-left transition-colors",
              isSelected ? "bg-primary/10 text-foreground" : "hover:bg-muted/50",
            )}
            onClick={() => (row.kind === "folder" ? onToggleFolder(row.path) : onSelectFile(row.path))}
            title={`${row.path}\n+${row.additions} −${row.deletions} · ${row.files} file${row.files === 1 ? "" : "s"}`}
          >
            <span className="flex min-w-0 flex-1 items-center gap-1" style={{ paddingLeft: row.depth * 12 }}>
              <span className={classes("w-3 shrink-0 text-center text-[9px]", row.kind === "folder" ? "text-muted-foreground" : "text-transparent")}>
                {row.kind === "folder" ? (expanded ? "▾" : "▸") : "·"}
              </span>
              <span className={classes(
                "truncate",
                row.kind === "folder" && "text-muted-foreground",
                (isSelected || isAncestor) && "font-medium text-foreground",
              )}>
                {row.label}
              </span>
            </span>
            <span className="flex w-[88px] shrink-0 items-center gap-1.5">
              <span className="h-[3px] flex-1 overflow-hidden rounded-full bg-muted">
                <span className="flex h-full w-full">
                  <span style={{ width: `${greenPct}%`, background: addFill(0.9), minWidth: row.additions > 0 ? 2 : 0 }} />
                  <span style={{ width: `${redPct}%`, background: delFill(0.85), minWidth: row.deletions > 0 ? 2 : 0 }} />
                </span>
              </span>
              <span className="w-7 shrink-0 text-right text-[10px] tabular-nums">
                <span className={ADD_TEXT}>{row.additions > 999 ? "1k+" : row.additions}</span>
              </span>
              <span className="w-7 shrink-0 text-right text-[10px] tabular-nums">
                <span className={DEL_TEXT}>{row.deletions > 999 ? "1k+" : row.deletions}</span>
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

export { buildTree, flattenTree }
