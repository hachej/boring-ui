import { useEffect, useState } from 'react'

export function useAttachmentNotice(timeoutMs = 4000) {
  const [attachmentNotice, setAttachmentNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!attachmentNotice) return
    const timer = setTimeout(() => setAttachmentNotice(null), timeoutMs)
    return () => clearTimeout(timer)
  }, [attachmentNotice, timeoutMs])

  return { attachmentNotice, setAttachmentNotice }
}
