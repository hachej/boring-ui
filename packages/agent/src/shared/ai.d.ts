declare module 'ai' {
  export interface UIMessage {
    role: 'system' | 'user' | 'assistant' | 'tool'
    content?: unknown
    parts?: unknown[]
  }

  export interface UIMessageChunk {
    type: string
  }
}
