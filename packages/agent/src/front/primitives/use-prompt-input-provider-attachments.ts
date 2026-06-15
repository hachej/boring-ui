import { nanoid } from 'nanoid'
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { AttachmentEntry, AttachmentsContext } from './prompt-input-context'

export function usePromptInputProviderAttachments(
  onUploadFile?: (file: File) => Promise<{ url: string; path?: string }>,
): {
  attachments: AttachmentsContext
  registerFileInput: (ref: RefObject<HTMLInputElement | null>, open: () => void) => void
} {
  const [attachmentFiles, setAttachmentFiles] = useState<AttachmentEntry[]>([])
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  // oxlint-disable-next-line eslint(no-empty-function)
  const openRef = useRef<() => void>(() => {})

  const setFileUrl = useCallback((id: string, url: string, status: 'ready' | 'error', path?: string) => {
    setAttachmentFiles((prev) => prev.map((f) => {
      if (f.id !== id) return f
      if (f.url !== url && f.url.startsWith('blob:')) URL.revokeObjectURL(f.url)
      return { ...f, url, status, ...(path ? { path } : {}) }
    }))
  }, [])

  const add = useCallback((files: File[] | FileList) => {
    const incoming = [...files]
    if (incoming.length === 0) return

    const entries: AttachmentEntry[] = incoming.map((file) => ({
      filename: file.name,
      id: nanoid(),
      mediaType: file.type,
      type: 'file' as const,
      url: URL.createObjectURL(file),
      status: onUploadFile ? 'uploading' as const : 'ready' as const,
    }))

    setAttachmentFiles((prev) => [...prev, ...entries])

    if (onUploadFile) {
      for (const entry of entries) {
        const file = incoming[entries.indexOf(entry)]
        onUploadFile(file)
          .then(({ url, path }) => setFileUrl(entry.id, url, 'ready', path))
          .catch(() => setFileUrl(entry.id, entry.url, 'error'))
      }
    }
  }, [onUploadFile, setFileUrl])

  const remove = useCallback((id: string) => {
    setAttachmentFiles((prev) => {
      const found = prev.find((f) => f.id === id)
      if (found?.url.startsWith('blob:')) {
        URL.revokeObjectURL(found.url)
      }
      return prev.filter((f) => f.id !== id)
    })
  }, [])

  const clear = useCallback(() => {
    setAttachmentFiles((prev) => {
      for (const f of prev) {
        if (f.url.startsWith('blob:')) {
          URL.revokeObjectURL(f.url)
        }
      }
      return []
    })
  }, [])

  // Keep a ref to attachments for cleanup on unmount (avoids stale closure)
  const attachmentsRef = useRef(attachmentFiles)

  useEffect(() => {
    attachmentsRef.current = attachmentFiles
  }, [attachmentFiles])

  // Cleanup blob URLs on unmount to prevent memory leaks
  useEffect(
    () => () => {
      for (const f of attachmentsRef.current) {
        if (f.url) {
          URL.revokeObjectURL(f.url)
        }
      }
    },
    [],
  )

  const openFileDialog = useCallback(() => {
    openRef.current?.()
  }, [])

  const attachments = useMemo<AttachmentsContext>(
    () => ({
      add,
      clear,
      fileInputRef,
      files: attachmentFiles,
      openFileDialog,
      remove,
      setFileUrl,
    }),
    [attachmentFiles, add, remove, clear, openFileDialog, setFileUrl],
  )

  const registerFileInput = useCallback(
    (ref: RefObject<HTMLInputElement | null>, open: () => void) => {
      fileInputRef.current = ref.current
      openRef.current = open
    },
    [],
  )

  return { attachments, registerFileInput }
}
