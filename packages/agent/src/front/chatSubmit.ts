import type { FileUIPart } from 'ai'
import { readFileAsText, resolveAttachmentUrls } from './chatAttachments'

export interface EnrichedSubmitPayload {
  serverMessage: string
  attachments: Awaited<ReturnType<typeof resolveAttachmentUrls>>
}

export async function createEnrichedSubmitPayload({
  text,
  files,
  mentionedFiles,
}: {
  text: string
  files: FileUIPart[]
  mentionedFiles: string[]
}): Promise<EnrichedSubmitPayload> {
  // Build the server-side enriched message (text attachments inlined for
  // pi, which is text-only). Importantly, the VISIBLE user bubble only
  // shows the raw `text` plus file chips — the enriched version is not
  // rendered in the UI, just sent to the server. This keeps
  // "[attached: foo.png …]" markers out of the message bubble.
  const attachmentSummaries: string[] = []
  for (const file of files ?? []) {
    const label = file.filename ?? 'attachment'
    const mime = file.mediaType ?? 'application/octet-stream'
    const content = await readFileAsText(file)
    if (content !== null) {
      attachmentSummaries.push(`[attached: ${label} (${mime})]\n\`\`\`\n${content}\n\`\`\``)
    } else {
      attachmentSummaries.push(`[attached: ${label} (${mime}, not inlined — binary)]`)
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
