import type { PiChatPanelProps } from "@hachej/boring-agent/front"
import type { ComponentType } from "react"
import type { WorkspaceAttentionBlocker } from "../../provider"
import type { SurfaceShellApi } from "../artifact-surface/SurfaceShell"

export type OpenArtifactHandler = (path: string) => void

export interface WorkspaceChatPanelProps extends PiChatPanelProps<WorkspaceAttentionBlocker> {
  sessionId: string
  /** Endpoint base for agent → visible-workbench UI commands. */
  bridgeEndpoint?: string | null
  /** Imperative handle getter for the visible workbench surface. */
  getSurface?: () => SurfaceShellApi | null
  /** Reads whether the visible workbench surface should be open. */
  isWorkbenchOpen?: () => boolean
  /** Opens the visible workbench surface before dispatching a command. */
  openWorkbench?: () => void
  /** Opens the visible workbench sources/file-tree pane before dispatching a reveal. */
  openWorkbenchSources?: () => void
  /** Closes the visible workbench surface after an ephemeral command finishes. */
  closeWorkbench?: () => void
}

// The app shell owns the actual chat implementation. Workspace only needs a
// renderable component so it can inject workspace bridge props.
// biome-ignore lint/suspicious/noExplicitAny: accepts any app-shell chat panel implementation
export type WorkspaceChatPanelComponent = ComponentType<any>
