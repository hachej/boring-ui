import type { DragDropManager } from "dnd-core"
import { createDragDropManager } from "dnd-core"
import { HTML5Backend } from "react-dnd-html5-backend"

const DND_MANAGER_KEY = Symbol.for("@hachej/boring-workspace/file-tree-dnd-manager")

type DndGlobal = typeof globalThis & {
  [DND_MANAGER_KEY]?: DragDropManager
}

/**
 * react-arborist mounts a react-dnd HTML5 backend for every tree by default.
 * That can trip react-dnd's global HTML5 backend guard when multiple file-tree
 * panes, React roots, or Vite HMR remnants overlap briefly. Keep one manager for
 * all workspace file trees in this JS realm and hand it to arborist.
 */
export function getFileTreeDndManager(): DragDropManager {
  const root = globalThis as DndGlobal
  root[DND_MANAGER_KEY] ??= createDragDropManager(
    HTML5Backend,
    typeof window === "undefined" ? undefined : window,
  )
  return root[DND_MANAGER_KEY]
}
