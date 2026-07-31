"use client"

import { useEffect, useRef, useState } from "react"
import { surfaceSessionActionError } from "../../sessionActionErrors"

const MAX_TITLE_LENGTH = 200

export function useInlineSessionRename({
  sessionId,
  title,
  available,
  onRename,
}: {
  sessionId: string
  title: string
  available: boolean
  onRename?: (id: string, title: string) => void | Promise<unknown>
}) {
  const [value, setValue] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (value !== null) inputRef.current?.focus()
  }, [value])
  useEffect(() => {
    if (!available) setValue(null)
  }, [available])

  const cancel = () => {
    setValue(null)
    setError(null)
  }
  const save = () => {
    const next = value?.trim() ?? ""
    if (!next) {
      setError("Session title is required")
      return
    }
    if (next.length > MAX_TITLE_LENGTH) {
      setError(`Session title must be ${MAX_TITLE_LENGTH} characters or fewer`)
      return
    }
    if (next === title) {
      cancel()
      return
    }
    if (!onRename || saving) return
    setSaving(true)
    void Promise.resolve(onRename(sessionId, next))
      .then(cancel)
      .catch((reason) => {
        surfaceSessionActionError("rename chat", reason)
        setError(reason instanceof Error ? reason.message : "Rename failed")
      })
      .finally(() => setSaving(false))
  }

  return {
    editing: value !== null,
    begin: () => {
      if (!available) return
      setValue(title)
      setError(null)
    },
    cancel,
    field: value === null ? null : { inputRef, value, error, saving, setValue, save },
  }
}

export function InlineSessionRename({
  field,
  onCancel,
}: {
  field: NonNullable<ReturnType<typeof useInlineSessionRename>["field"]>
  onCancel: () => void
}) {
  return (
    <span className="min-w-0 flex-1">
      <input
        ref={field.inputRef}
        value={field.value}
        disabled={field.saving}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => field.setValue(event.currentTarget.value)}
        onBlur={field.save}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault()
            field.save()
          }
          if (event.key === "Escape") {
            event.preventDefault()
            onCancel()
          }
        }}
        aria-label="Rename session"
        aria-invalid={field.error ? true : undefined}
        className="h-6 w-full rounded border border-border bg-background px-1.5 text-[13px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      />
      {field.error ? <p role="alert" className="mt-1 text-xs text-destructive">{field.error}</p> : null}
    </span>
  )
}
