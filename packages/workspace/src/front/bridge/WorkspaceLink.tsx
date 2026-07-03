import type { MouseEvent, ReactElement, ReactNode } from "react"
import type { FilesystemId } from "../../shared/types/filesystem"
import type { UiCommand } from "./types"
import { postUiCommand } from "./uiCommandBus"

export type WorkspaceLinkTarget =
  | { kind: "openFile"; path: string; mode?: "view" | "edit" | "diff"; filesystem?: FilesystemId }
  | { kind: "openSurface"; surfaceKind: string; target: string; filesystem?: FilesystemId; meta?: Record<string, unknown> }
  | { kind: "openPanel"; id: string; component: string; title?: string; params?: Record<string, unknown> }
  | { kind: "expandToFile"; path: string }

export interface WorkspaceLinkProps {
  to: WorkspaceLinkTarget
  children: ReactNode
  className?: string
  title?: string
  href?: string
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void
}

export function workspaceLinkCommand(to: WorkspaceLinkTarget): UiCommand {
  switch (to.kind) {
    case "openFile":
      return { kind: "openFile", params: { path: to.path, ...(to.mode ? { mode: to.mode } : {}), ...(to.filesystem ? { filesystem: to.filesystem } : {}) } }
    case "openSurface":
      return { kind: "openSurface", params: { kind: to.surfaceKind, target: to.target, ...(to.filesystem ? { filesystem: to.filesystem } : {}), ...(to.meta ? { meta: to.meta } : {}) } }
    case "openPanel":
      return {
        kind: "openPanel",
        params: {
          id: to.id,
          component: to.component,
          ...(to.title ? { title: to.title } : {}),
          ...(to.params ? { params: to.params } : {}),
        },
      }
    case "expandToFile":
      return { kind: "expandToFile", params: { path: to.path } }
  }
}

export function workspaceLinkHref(to: WorkspaceLinkTarget): string {
  return `boring-workspace-command:${encodeURIComponent(JSON.stringify(workspaceLinkCommand(to)))}`
}

function shouldHandleClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
}

export function WorkspaceLink({ to, children, className, title, href, onClick }: WorkspaceLinkProps): ReactElement {
  return (
    <a
      href={href ?? workspaceLinkHref(to)}
      className={className}
      title={title}
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented || !shouldHandleClick(event)) return
        event.preventDefault()
        postUiCommand(workspaceLinkCommand(to))
      }}
    >
      {children}
    </a>
  )
}
