import type { ComponentType } from "react"
import type { WorkspaceAttentionBlocker } from "../../provider"
import type { SurfaceShellApi } from "../artifact-surface/SurfaceShell"

export type OpenArtifactHandler = (path: string) => void

export interface WorkspaceChatPanelProps {
  sessionId: string
  onData?: (part: unknown) => void
  requestHeaders?: Record<string, string>
  onOpenArtifact?: OpenArtifactHandler
  className?: string
  /** Endpoint base for agent → visible-workbench UI commands. */
  bridgeEndpoint?: string | null
  /** Imperative handle getter for the visible workbench surface. */
  getSurface?: () => SurfaceShellApi | null
  /** Reads whether the visible workbench surface should be open. */
  isWorkbenchOpen?: () => boolean
  /** Opens the visible workbench surface before dispatching a command. */
  openWorkbench?: () => void
  /** Closes the visible workbench surface after an ephemeral command finishes. */
  closeWorkbench?: () => void
  /** Generic workspace blockers that should prevent submitting new chat turns. */
  composerBlockers?: WorkspaceAttentionBlocker[]
  /** Called when the user presses Stop in the composer. */
  onComposerStop?: () => void
  /** Called when the chat implementation wants to run an action exposed by a blocker. */
  onComposerBlockerAction?: (blocker: WorkspaceAttentionBlocker, action: "open" | "cancel") => void
  [key: string]: unknown
}

// The app shell owns the actual chat implementation. Workspace only needs a
// renderable component so it can inject workspace bridge props.
// biome-ignore lint/suspicious/noExplicitAny: accepts any app-shell chat panel implementation
export type WorkspaceChatPanelComponent = ComponentType<any>
