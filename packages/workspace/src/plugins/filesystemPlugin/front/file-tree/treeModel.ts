import type { FileEntry } from '../data/types'
import type { FileTreeNode } from './FileTree'

export function buildTree(
  entries: FileEntry[],
  childrenByDir: Map<string, FileEntry[]>,
): FileTreeNode[] {
  const dirs: FileTreeNode[] = []
  const files: FileTreeNode[] = []
  for (const entry of entries) {
    if (entry.kind === 'dir') {
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

export function parentDir(path: string): string {
  const i = path.lastIndexOf('/')
  return i > 0 ? path.slice(0, i) : '.'
}

export function dirKey(dir: string): string {
  return dir && dir !== '' ? dir : '.'
}

export function mergeEntries(
  base: FileEntry[] | undefined,
  optimistic: FileEntry[] | undefined,
): FileEntry[] | undefined {
  if (!optimistic?.length) return base
  const byPath = new Map<string, FileEntry>()
  for (const entry of base ?? []) byPath.set(entry.path, entry)
  for (const entry of optimistic) byPath.set(entry.path, entry)
  return Array.from(byPath.values())
}

export type DraftEditing =
  | { kind: 'create-file'; parentDir: string; path: string }
  | { kind: 'create-folder'; parentDir: string; path: string }
  | { kind: 'rename'; path: string; initialValue: string }
  | null

export function injectDraftIntoTree(
  tree: FileTreeNode[],
  editing: DraftEditing,
  rootDir: string,
): FileTreeNode[] {
  if (!editing || editing.kind === 'rename') return tree
  const draft: FileTreeNode = {
    name: '',
    path: editing.path,
    kind: editing.kind === 'create-folder' ? 'dir' : 'file',
    isDraft: true,
  }
  const targetDir = editing.parentDir
  // Inserting at the root is easy: just prepend a draft row.
  if (targetDir === rootDir || targetDir === '.' || targetDir === '') {
    return [draft, ...tree]
  }
  return tree.map((node) => {
    if (node.kind !== 'dir') return node
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
