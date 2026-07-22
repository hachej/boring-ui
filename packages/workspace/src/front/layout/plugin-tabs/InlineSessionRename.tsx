"use client"

import { useCallback, useEffect, useId, useRef, useState, type RefObject } from "react"

export function useInlineSessionRename({
  sessionId,
  title,
  available,
  menuOpen,
  onRename,
}: {
  sessionId: string
  title: string
  available: boolean
  /** The request waits for the controlled menu to finish closing before mounting. */
  menuOpen: boolean
  onRename?: (id: string, title: string) => void | Promise<unknown>
}) {
  const [editingTitle, setEditingTitle] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [renameRequested, setRenameRequested] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const savingRef = useRef(false)
  const cancelRequestedRef = useRef(false)
  const isEditing = editingTitle !== null

  useEffect(() => {
    if (isEditing) inputRef.current?.focus()
  }, [isEditing])

  useEffect(() => {
    if (!renameRequested || menuOpen) return
    cancelRequestedRef.current = false
    setEditingTitle(title)
    setError(null)
    setRenameRequested(false)
  }, [menuOpen, renameRequested, title])

  const cancelRename = useCallback(() => {
    cancelRequestedRef.current = true
    setEditingTitle(null)
    setError(null)
  }, [])

  useEffect(() => {
    if (!available && isEditing) cancelRename()
  }, [available, cancelRename, isEditing])

  const saveRename = useCallback(() => {
    if (!available || !onRename || editingTitle === null || savingRef.current || cancelRequestedRef.current) return
    const nextTitle = editingTitle.trim()
    if (!nextTitle) {
      setError("Session title is required")
      return
    }
    if (nextTitle === title) {
      setEditingTitle(null)
      setError(null)
      return
    }
    savingRef.current = true
    setSaving(true)
    setError(null)
    void Promise.resolve(onRename(sessionId, nextTitle))
      .then(() => setEditingTitle(null))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Rename failed"))
      .finally(() => {
        savingRef.current = false
        setSaving(false)
      })
  }, [available, editingTitle, onRename, sessionId, title])

  return {
    isEditing,
    requestRename: () => setRenameRequested(true),
    cancelRename,
    field: isEditing ? {
      inputRef,
      value: editingTitle ?? "",
      saving,
      error,
      onChange: (value: string) => {
        setEditingTitle(value)
        setError(null)
      },
      onSave: saveRename,
    } : null,
  }
}

export function InlineSessionRename({
  title,
  inputRef,
  value,
  saving,
  error,
  onChange,
  onSave,
  onCancel,
}: {
  title: string
  inputRef: RefObject<HTMLInputElement | null>
  value: string
  saving: boolean
  error: string | null
  onChange: (value: string) => void
  onSave: () => void
  onCancel: () => void
}) {
  const errorId = useId()

  return (
    <span className="min-w-0 flex-1">
      <input
        ref={inputRef}
        value={value}
        disabled={saving}
        onChange={(event) => onChange(event.currentTarget.value)}
        onClick={(event) => event.stopPropagation()}
        onBlur={onSave}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault()
            event.stopPropagation()
            onSave()
          } else if (event.key === "Escape") {
            event.preventDefault()
            event.stopPropagation()
            onCancel()
          }
        }}
        aria-label={`Rename ${title}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="h-6 w-full rounded border border-border bg-background px-1.5 text-[13px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-60"
      />
      {error ? <p id={errorId} role="alert" className="mt-1 text-xs text-destructive">{error}</p> : null}
    </span>
  )
}
