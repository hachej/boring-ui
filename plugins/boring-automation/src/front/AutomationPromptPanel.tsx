"use client"

import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react"
import { FileText, RefreshCw, Save } from "lucide-react"
import { Button, EmptyState, Notice, Spinner, Textarea } from "@hachej/boring-ui-kit"
import { useViewportBreakpoint } from "@hachej/boring-workspace"
import type { PaneProps } from "@hachej/boring-workspace/plugin"
import type { Automation } from "../shared"
import { AutomationClientError } from "./client"
import { useAutomationClient } from "./AutomationRuntimeContext"

export interface AutomationPromptPanelParams {
  automationId?: string
}

function errorMessage(error: unknown): string {
  if (error instanceof AutomationClientError) return error.message
  if (error instanceof Error) return error.message
  return "Automation prompt request failed"
}

type StoredPromptDraft = { prompt: string; expectedUpdatedAt: string }

function draftKey(automationId: string): string {
  return `boring-automation:prompt-draft:${automationId}`
}

function readDraft(automationId: string): StoredPromptDraft | null {
  try {
    const value = sessionStorage.getItem(draftKey(automationId))
    if (!value) return null
    const parsed = JSON.parse(value) as Partial<StoredPromptDraft>
    return typeof parsed.prompt === "string" && typeof parsed.expectedUpdatedAt === "string"
      ? { prompt: parsed.prompt, expectedUpdatedAt: parsed.expectedUpdatedAt }
      : null
  } catch {
    return null
  }
}

function writeDraft(automationId: string, draft: StoredPromptDraft): void {
  try {
    sessionStorage.setItem(draftKey(automationId), JSON.stringify(draft))
  } catch {
    // Draft persistence is best effort; the open editor still retains its state.
  }
}

function clearDraft(automationId: string): void {
  try {
    sessionStorage.removeItem(draftKey(automationId))
  } catch {
    // Best effort.
  }
}

export function AutomationPromptPanel({ params }: PaneProps<AutomationPromptPanelParams>) {
  const client = useAutomationClient()
  const compactControls = !useViewportBreakpoint(640)
  const automationId = params?.automationId?.trim() ?? ""
  const [automation, setAutomation] = useState<Automation | null>(null)
  const [prompt, setPrompt] = useState("")
  const [savedPrompt, setSavedPrompt] = useState("")
  const [canonicalUpdatedAt, setCanonicalUpdatedAt] = useState("")
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!automationId) {
      setAutomation(null)
      setPrompt("")
      setSavedPrompt("")
      setCanonicalUpdatedAt("")
      setExpectedUpdatedAt("")
      setLoading(false)
      setError("Missing automation id.")
      return
    }
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    setSaved(false)
    void Promise.all([
      client.getAutomation(automationId, { signal: controller.signal }),
      client.getPromptSnapshot(automationId, { signal: controller.signal }),
    ]).then(([nextAutomation, snapshot]) => {
      if (controller.signal.aborted) return
      const draft = readDraft(automationId)
      setAutomation(nextAutomation)
      setPrompt(draft?.prompt ?? snapshot.prompt)
      setSavedPrompt(snapshot.prompt)
      setCanonicalUpdatedAt(snapshot.updatedAt)
      setExpectedUpdatedAt(draft?.expectedUpdatedAt ?? snapshot.updatedAt)
      setLoading(false)
    }).catch((loadError) => {
      if (controller.signal.aborted) return
      setError(errorMessage(loadError))
      setLoading(false)
    })
    return () => controller.abort()
  }, [automationId, client, reloadKey])

  async function savePrompt() {
    if (!automationId || !expectedUpdatedAt || saving || prompt === savedPrompt) return
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const updated = await client.updatePrompt(automationId, prompt, { expectedUpdatedAt })
      const nextAutomation = updated ?? await client.getAutomation(automationId)
      setAutomation(nextAutomation)
      setCanonicalUpdatedAt(nextAutomation.updatedAt)
      setExpectedUpdatedAt(nextAutomation.updatedAt)
      setSavedPrompt(prompt)
      clearDraft(automationId)
      setSaved(true)
    } catch (saveError) {
      setError(errorMessage(saveError))
    } finally {
      setSaving(false)
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void savePrompt()
  }

  function saveShortcut(event: KeyboardEvent<HTMLFormElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault()
      void savePrompt()
    }
  }

  if (loading) {
    return <div className="flex h-full min-h-0 items-center justify-center gap-2 bg-background text-sm text-muted-foreground"><Spinner className="size-4" /> Loading prompt…</div>
  }

  if (!automation) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center bg-background p-6">
        <EmptyState
          title="Could not open automation prompt"
          description={error ?? "Automation not found."}
          icon={<FileText className="size-8" aria-hidden="true" />}
          actions={automationId ? <Button type="button" onClick={() => setReloadKey((value) => value + 1)}>Retry</Button> : undefined}
        />
      </div>
    )
  }

  const dirty = prompt !== savedPrompt
  return (
    <form data-boring-workspace-part="automation-prompt-panel" className="flex h-full min-h-0 min-w-0 flex-col bg-background text-foreground" onSubmit={submit} onKeyDown={saveShortcut}>
      <header className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2" style={{ flex: "1 1 20rem" }}>
          <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0">
            <h2 className="truncate text-[13px] font-semibold">{automation.title}</h2>
            <p className="truncate text-[11px] text-muted-foreground">Prompt · {automation.model} · {automation.cron} {automation.timezone}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {dirty ? (
            <Button type="button" variant="ghost" size="sm" className="text-[13px]" style={{ minHeight: compactControls ? 32 : 44 }} onClick={() => {
              setPrompt(savedPrompt)
              setExpectedUpdatedAt(canonicalUpdatedAt)
              setError(null)
              setSaved(false)
              clearDraft(automationId)
            }} disabled={saving}>Discard draft</Button>
          ) : null}
          <Button type="button" variant="ghost" size="sm" className="text-[13px]" style={{ minHeight: compactControls ? 32 : 44 }} onClick={() => setReloadKey((value) => value + 1)} disabled={saving || dirty} title={dirty ? "Save or discard the draft before reloading" : "Reload canonical prompt"}>
            <RefreshCw className="size-3.5" aria-hidden="true" />
            Reload
          </Button>
          <Button type="submit" size="sm" className="text-[13px]" style={{ minHeight: compactControls ? 32 : 44 }} disabled={!dirty || saving}>
            <Save className="size-3.5" aria-hidden="true" />
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
        {error ? <Notice tone="destructive" role="alert" className="text-[13px]">{error}</Notice> : null}
        {saved ? <Notice tone="success" role="status" className="text-[13px]">Prompt saved.</Notice> : null}
        <Textarea
          aria-label={`${automation.title} prompt`}
          value={prompt}
          onChange={(event) => {
            const nextPrompt = event.target.value
            setPrompt(nextPrompt)
            setSaved(false)
            writeDraft(automationId, { prompt: nextPrompt, expectedUpdatedAt })
          }}
          spellCheck={false}
          className="min-h-0 flex-1 resize-none font-mono text-[13px] leading-5"
          disabled={saving}
        />
        <p className="text-[11px] text-muted-foreground">Markdown prompt · Save with Ctrl/⌘+S.</p>
      </div>
    </form>
  )
}
