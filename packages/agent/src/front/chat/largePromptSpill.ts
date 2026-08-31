import type { PromptInputFilePart } from '../primitives/prompt-input-context'
import type { PiComposerBeforeSubmitResult } from './session'
import { uploadFile, type UploadFileResult } from '../upload/uploadFile'

export const DEFAULT_LARGE_PROMPT_THRESHOLD_CHARS = 12_000

export interface LargePromptSpillContext {
  files: PromptInputFilePart[]
  sessionId: string
  source: 'composer' | 'suggestion' | 'auto-submit'
}

export interface PrepareLargePromptOptions {
  enabled?: boolean
  thresholdChars?: number
  apiBaseUrl?: string
  workspaceRequestId?: string | null
  fetch?: typeof globalThis.fetch
  onBeforeSubmit?: (
    draft: string,
    context: LargePromptSpillContext,
  ) => PiComposerBeforeSubmitResult | Promise<PiComposerBeforeSubmitResult>
  upload?: (file: File) => Promise<UploadFileResult>
}

export async function prepareLargePromptSubmission(
  draft: string,
  context: LargePromptSpillContext,
  options: PrepareLargePromptOptions = {},
): Promise<PiComposerBeforeSubmitResult> {
  const hostResult = await options.onBeforeSubmit?.(draft, context)
  if (hostResult !== undefined) return hostResult

  const thresholdChars = options.thresholdChars ?? DEFAULT_LARGE_PROMPT_THRESHOLD_CHARS
  if (options.enabled === false || thresholdChars < 1 || draft.length <= thresholdChars) return undefined

  const upload = options.upload ?? ((file: File) => uploadFile(file, {
    apiBaseUrl: options.apiBaseUrl,
    workspaceRequestId: options.workspaceRequestId,
    responseUrl: 'raw',
    fetch: options.fetch,
  }))
  const receipt = await upload(new File(
    [draft],
    `composer-input-${context.sessionId}.md`,
    { type: 'text/markdown' },
  ))

  return largePromptReference(receipt.path, draft.length)
}

export function largePromptReference(path: string, characters: number): PiComposerBeforeSubmitResult {
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
