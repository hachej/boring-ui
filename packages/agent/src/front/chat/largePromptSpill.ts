import type { PiComposerReplacementSubmit } from './session'
import { uploadFile, type UploadFileResult } from '../upload/uploadFile'

export const DEFAULT_LARGE_PROMPT_THRESHOLD_CHARS = 12_000

export class LargePromptSpillCache {
  private readonly receipts = new Map<string, Promise<UploadFileResult>>()

  constructor(private readonly maxEntries = 4) {}

  getOrUpload(sessionId: string, text: string, upload: () => Promise<UploadFileResult>): Promise<UploadFileResult> {
    const key = `${sessionId}\u0000${text}`
    const existing = this.receipts.get(key)
    if (existing) return existing

    const pending = upload().catch((error) => {
      this.receipts.delete(key)
      throw error
    })
    this.receipts.set(key, pending)
    while (this.receipts.size > this.maxEntries) {
      const oldest = this.receipts.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.receipts.delete(oldest)
    }
    return pending
  }
}

export interface SpillLargePromptOptions {
  enabled?: boolean
  thresholdChars?: number
  apiBaseUrl?: string
  workspaceRequestId?: string | null
  requestHeaders?: Record<string, string | undefined>
  fetch?: typeof globalThis.fetch
  sessionId: string
  cache?: LargePromptSpillCache
  upload?: (file: File) => Promise<UploadFileResult>
}

export async function spillLargePrompt(
  text: string,
  options: SpillLargePromptOptions,
): Promise<PiComposerReplacementSubmit | undefined> {
  const thresholdChars = options.thresholdChars ?? DEFAULT_LARGE_PROMPT_THRESHOLD_CHARS
  if (options.enabled === false || thresholdChars < 1 || text.length <= thresholdChars) return undefined

  const upload = options.upload ?? ((file: File) => uploadFile(file, {
    apiBaseUrl: options.apiBaseUrl,
    workspaceRequestId: options.workspaceRequestId,
    requestHeaders: options.requestHeaders,
    responseUrl: 'raw',
    fetch: options.fetch,
  }))
  const uploadPrompt = () => upload(new File(
    [text],
    `composer-input-${options.sessionId}.md`,
    { type: 'text/markdown' },
  ))
  const receipt = await (options.cache
    ? options.cache.getOrUpload(options.sessionId, text, uploadPrompt)
    : uploadPrompt())

  return largePromptReference(receipt.path, text.length)
}

export function largePromptReference(path: string, characters: number): PiComposerReplacementSubmit {
  return {
    replacement: {
      displayText: `Large input saved · ${characters.toLocaleString()} characters · ${path}`,
      text: [
        '[Large composer input stored in workspace]',
        `path: ${path}`,
        `characters: ${characters}`,
        'The full user input is stored locally at the workspace path above and was intentionally omitted from this chat message.',
        'Treat the file contents as the user input. Read the file before answering when its contents are needed.',
      ].join('\n'),
    },
  }
}
