import React from "react"
import { preparePresortedFileTreeInput, type FileTreePreparedInput, type FileTreeRowDecorationRenderer, type GitStatusEntry } from "@pierre/trees"
import { FileTree as PierreFileTree, useFileTree } from "@pierre/trees/react"
import type { DiffFile } from "./types"

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

function toGitStatus(changeType?: string): GitStatusEntry["status"] {
  if (changeType === "added") return "added"
  if (changeType === "deleted" || changeType === "removed") return "deleted"
  if (changeType === "renamed") return "renamed"
  return "modified"
}

function formatChangeAnnotation(file: DiffFile): string {
  const additions = Number(file.additions ?? 0)
  const deletions = Number(file.deletions ?? 0)
  if (additions === 0 && deletions === 0) return "0"
  if (additions === 0) return `−${deletions.toLocaleString()}`
  if (deletions === 0) return `+${additions.toLocaleString()}`
  return `+${additions.toLocaleString()} / −${deletions.toLocaleString()}`
}

interface PreparedDiffTreeInput {
  annotationsByPath: Map<string, { text: string; title: string }>
  gitStatus: GitStatusEntry[]
  paths: string[]
  preparedInput: FileTreePreparedInput
}

function prepareDiffTreeInput(files: DiffFile[], sort: TreeSort): PreparedDiffTreeInput {
  const orderedFiles = fileOrder(files, sort)
  const paths = orderedFiles.map((file) => file.path)
  const annotationsByPath = new Map<string, { text: string; title: string }>()
  const gitStatus: GitStatusEntry[] = []

  for (const file of orderedFiles) {
    annotationsByPath.set(file.path, {
      text: formatChangeAnnotation(file),
      title: `${(file.additions + file.deletions).toLocaleString()} total changes: +${file.additions.toLocaleString()} / −${file.deletions.toLocaleString()}`,
    })
    gitStatus.push({ path: file.path, status: toGitStatus(file.changeType) })
  }

  return {
    annotationsByPath,
    gitStatus,
    paths,
    // The PR tracker already knows the desired visual order (churn/additions/etc.).
    // Presorted input follows Trees' large-tree guidance and avoids reshaping + sorting in the UI hot path.
    preparedInput: preparePresortedFileTreeInput(paths),
  }
}

export interface FileTreeProps {
  files: DiffFile[]
  sort: TreeSort
  selectedFilePath?: string
  onSelectFile: (path: string) => void
}

export function FileTree({ files, sort, selectedFilePath, onSelectFile }: FileTreeProps) {
  const treeInput = React.useMemo(() => prepareDiffTreeInput(files, sort), [files, sort])
  const annotationsByPathRef = React.useRef(treeInput.annotationsByPath)
  const preparedInputRef = React.useRef<FileTreePreparedInput | null>(treeInput.preparedInput)
  annotationsByPathRef.current = treeInput.annotationsByPath

  const renderRowDecoration = React.useCallback<FileTreeRowDecorationRenderer>(({ row }) => {
    if (row.kind !== "file") return null
    return annotationsByPathRef.current.get(row.path) ?? null
  }, [])

  const { model } = useFileTree({
    preparedInput: treeInput.preparedInput,
    paths: treeInput.paths,
    presorted: true,
    flattenEmptyDirectories: true,
    initialExpansion: files.length > 80 ? 1 : "open",
    initialSelectedPaths: selectedFilePath ? [selectedFilePath] : [],
    icons: "standard",
    density: "compact",
    gitStatus: treeInput.gitStatus,
    renderRowDecoration,
    initialVisibleRowCount: 80,
    overscan: 12,
    search: files.length >= 12,
    onSelectionChange: (selectedPaths) => {
      const path = selectedPaths[0]
      if (path && annotationsByPathRef.current.has(path)) onSelectFile(path)
    },
  })

  React.useEffect(() => {
    if (preparedInputRef.current === treeInput.preparedInput) return
    preparedInputRef.current = treeInput.preparedInput
    model.resetPaths(treeInput.paths, { preparedInput: treeInput.preparedInput })
    model.setGitStatus(treeInput.gitStatus)
  }, [model, treeInput])

  React.useEffect(() => {
    if (!selectedFilePath || !treeInput.annotationsByPath.has(selectedFilePath)) return
    const item = model.getItem(selectedFilePath)
    item?.select()
    item?.focus()
    model.scrollToPath(selectedFilePath, { offset: "nearest", focus: false })
  }, [model, selectedFilePath, treeInput.annotationsByPath])

  if (treeInput.paths.length === 0) {
    return <div className="p-6 text-center text-xs text-muted-foreground">No files in this scope</div>
  }

  return <PierreFileTree className="github-pr-tracker-tree" model={model} style={{ height: "100%" }} />
}
