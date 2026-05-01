import type { ComponentType } from "react"

export type OpenArtifactHandler = (path: string) => void

export interface WorkspaceChatPanelProps {
  sessionId: string
  onData?: (part: unknown) => void
  requestHeaders?: Record<string, string>
  onOpenArtifact?: OpenArtifactHandler
  className?: string
  [key: string]: unknown
}

// The app shell owns the actual chat implementation. Workspace only needs a
// renderable component so it can inject workspace bridge props.
// biome-ignore lint/suspicious/noExplicitAny: accepts any app-shell chat panel implementation
export type WorkspaceChatPanelComponent = ComponentType<any>
