import type { PromptInputFilePart } from './primitives/prompt-input-context'
import { readFileAsText, resolveAttachmentUrls } from './chatAttachments'

export interface EnrichedSubmitPayload {
  serverMessage: string
  attachments: Awaited<ReturnType<typeof resolveAttachmentUrls>>
}

function escapeAttachmentAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export async function createEnrichedSubmitPayload({
  text,
  files,
  mentionedFiles,
}: {
  text: string
  files: PromptInputFilePart[]
  mentionedFiles: string[]
}): Promise<EnrichedSubmitPayload> {
  // Build the server-side enriched message (text attachments inlined for
  // pi, which is text-only). Importantly, the VISIBLE user bubble only
  // shows the raw `text` plus file chips — the enriched version is not
  // rendered in the UI, just sent to the server. Keep the model-facing
  // attachment note structured so reload/history code can strip it reliably.
  const attachmentSummaries: string[] = []
  for (const file of files ?? []) {
    const label = file.filename ?? 'attachment'
    const mime = file.mediaType ?? 'application/octet-stream'
    const workspacePath = file.path
    const attrs: Array<[string, string]> = [
      ['data-boring-agent', 'composer-file'],
      ['filename', label],
      ['mime', mime],
    ]
    if (workspacePath) attrs.push(['path', workspacePath])
    const attrText = attrs.map(([name, value]) => `${name}="${escapeAttachmentAttr(value)}"`).join(' ')
    const content = await readFileAsText(file)
    if (content !== null) {
      attachmentSummaries.push(`<attachment ${attrText}>\n\`\`\`\n${content}\n\`\`\`\n</attachment>`)
    } else {
      attachmentSummaries.push(`<attachment ${attrText} binary="true" />`)
    }
  }

  const mentionNote = mentionedFiles.length > 0
    ? `@files: ${mentionedFiles.join(', ')}`
    : null

  const serverMessage = [
    text.trim(),
    ...(attachmentSummaries.length > 0 ? [attachmentSummaries.join('\n\n')] : []),
    ...(mentionNote ? [mentionNote] : []),
  ].filter(Boolean).join('\n\n') || text

  return {
    serverMessage,
    attachments: await resolveAttachmentUrls(files),
  }
}
