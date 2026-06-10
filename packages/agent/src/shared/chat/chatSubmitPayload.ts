export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high'

export interface ChatModelSelection {
  provider: string
  id: string
}

export interface ChatAttachmentPayload {
  filename?: string
  mediaType?: string
  url: string
}

export interface ChatSubmitPayload {
  message: string
  displayMessage?: string
  clientNonce: string
  model?: ChatModelSelection
  thinkingLevel?: ThinkingLevel
  attachments?: ChatAttachmentPayload[]
}
