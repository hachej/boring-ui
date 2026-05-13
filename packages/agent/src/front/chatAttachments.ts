import type { FileUIPart } from 'ai'
import { convertBlobUrlToDataUrl } from './primitives/prompt-input'

const INLINE_TEXT_MIME_PREFIXES = ['text/', 'application/json', 'application/xml', 'application/yaml']

export async function resolveAttachmentUrls(files: FileUIPart[] | undefined) {
  if (!files) return []
  return Promise.all(files.map(async (file) => ({
    filename: file.filename,
    mediaType: file.mediaType,
    url: file.url.startsWith('blob:')
      ? (await convertBlobUrlToDataUrl(file.url)) ?? file.url
      : file.url,
  })))
}

/** Best-effort fetch of a FileUIPart's bytes as UTF-8 text. */
export async function readFileAsText(file: FileUIPart): Promise<string | null> {
  const looksText =
    INLINE_TEXT_MIME_PREFIXES.some((p) => file.mediaType?.startsWith(p)) ||
    /\.(md|txt|csv|json|yaml|yml|ts|tsx|js|jsx|py|rb|rs|go|sh|bash|css|html|sql|log)$/i.test(file.filename ?? '')
  if (!looksText) return null
  try {
    const res = await fetch(file.url)
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}
