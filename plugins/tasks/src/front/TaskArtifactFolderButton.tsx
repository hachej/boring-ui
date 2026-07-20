import { useState, type MouseEvent } from "react"
import { FolderOpen } from "lucide-react"
import type { WorkspacePluginClient } from "@hachej/boring-workspace"
import type { WorkspaceShellCapabilities } from "@hachej/boring-workspace/plugin"
import type { BoringTaskCard } from "../shared"

interface ArtifactFolderResponse {
  ok: true
  path: string
  exists: boolean
}

function revealPath(shell: WorkspaceShellCapabilities, path: string): void {
  const result = shell.revealWorkspacePath(path)
  if (!result.success && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("boring-workspace:reveal-workspace-path", { detail: { path } }))
  }
}

export function TaskArtifactFolderButton({
  task,
  shell,
  pluginClient,
  variant = "icon",
  onAction,
}: {
  task: BoringTaskCard
  shell: WorkspaceShellCapabilities
  pluginClient: Pick<WorkspacePluginClient, "postJson">
  variant?: "icon" | "menu-item"
  onAction?: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const openFolder = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onAction?.()
    setBusy(true)
    setError(null)
    const identity = { adapterId: task.adapterId, taskId: task.id, number: task.number }
    try {
      const status = await pluginClient.postJson<ArtifactFolderResponse>("/api/boring-tasks/artifact-folder/status", identity)
      if (status.exists) {
        revealPath(shell, status.path)
        return
      }
      if (!window.confirm(`Create task folder at “${status.path}”?`)) return
      const created = await pluginClient.postJson<ArtifactFolderResponse>("/api/boring-tasks/artifact-folder/create", identity)
      revealPath(shell, created.path)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open task folder.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        draggable={false}
        onClick={(event) => void openFolder(event)}
        disabled={busy}
        className={variant === "menu-item"
          ? "flex w-full items-center gap-2 whitespace-nowrap rounded-lg px-2 py-1.5 text-left text-popover-foreground hover:bg-muted disabled:cursor-wait disabled:opacity-40"
          : "grid size-7 place-items-center rounded-lg text-muted-foreground opacity-80 outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-wait disabled:opacity-40 group-hover:opacity-100"}
        aria-label={`Open artifact folder for ${task.number}`}
        title={error ?? "Open task folder"}
      >
        <FolderOpen className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
        {variant === "menu-item" ? <span>Task folder</span> : null}
      </button>
      {error ? <span role="status" className="sr-only">{error}</span> : null}
    </>
  )
}
