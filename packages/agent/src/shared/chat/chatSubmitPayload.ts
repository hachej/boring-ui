export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high'

export interface ChatModelSelection {
  provider: string
  id: string
}

export interface ChatAttachmentPayload {
  filename?: string
  mediaType?: string
  url: string
  /** Workspace-relative path when the browser upload endpoint persisted the attachment. */
  path?: string
}

export interface ChatSubmitPayload {
  message: string
  displayMessage?: string
  clientNonce: string
  model?: ChatModelSelection
  thinkingLevel?: ThinkingLevel
  attachments?: ChatAttachmentPayload[]
}
