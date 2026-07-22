"use client"

import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react"
import { FileText, RefreshCw, Save } from "lucide-react"
import { Button, EmptyState, Notice, Spinner, Textarea } from "@hachej/boring-ui-kit"
import type { PaneProps } from "@hachej/boring-workspace/plugin"
import { useAutomationClient } from "./AutomationRuntimeContext"

export interface AutomationPromptPanelParams {
  automationId?: string
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Automation prompt request failed"
}

export function AutomationPromptPanel({ params }: PaneProps<AutomationPromptPanelParams>) {
  const client = useAutomationClient()
  const automationId = params?.automationId?.trim() ?? ""
  const [prompt, setPrompt] = useState("")
  const [savedPrompt, setSavedPrompt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!automationId) {
      setLoading(false)
      setError("Missing automation id.")
      return
    }

    const controller = new AbortController()
    setLoading(true)
    setError(null)
    setSaved(false)
    void client.getPrompt(automationId, { signal: controller.signal }).then((value) => {
      if (controller.signal.aborted) return
      setPrompt(value)
      setSavedPrompt(value)
    }).catch((loadError) => {
      if (!controller.signal.aborted) setError(errorMessage(loadError))
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [automationId, client, reloadKey])

  async function savePrompt() {
    if (!automationId || savedPrompt === null || saving || prompt === savedPrompt) return
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      await client.updatePrompt(automationId, prompt)
      setSavedPrompt(prompt)
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

  if (loading && savedPrompt === null) {
    return <div className="flex h-full items-center justify-center gap-2 bg-background text-sm text-muted-foreground"><Spinner className="size-4" /> Loading prompt…</div>
  }

  if (savedPrompt === null) {
    return (
      <div className="flex h-full items-center justify-center bg-background p-6">
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
        <div className="flex min-w-0 items-center gap-2">
          <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <h2 className="truncate text-[13px] font-semibold">Automation prompt</h2>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {dirty ? <Button type="button" variant="ghost" size="sm" className="min-h-11 text-[13px] sm:min-h-8" disabled={saving} onClick={() => setPrompt(savedPrompt)}>Reset</Button> : null}
          <Button type="button" variant="ghost" size="sm" className="min-h-11 text-[13px] sm:min-h-8" disabled={loading || saving || dirty} onClick={() => setReloadKey((value) => value + 1)}>
            <RefreshCw className="size-3.5" aria-hidden="true" /> Reload
          </Button>
          <Button type="submit" size="sm" className="min-h-11 text-[13px] sm:min-h-8" disabled={!dirty || saving}>
            <Save className="size-3.5" aria-hidden="true" /> {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
        {error ? <Notice tone="destructive" role="alert" className="text-[13px]">{error}</Notice> : null}
        {saved ? <Notice tone="success" role="status" className="text-[13px]">Prompt saved.</Notice> : null}
        <Textarea
          aria-label="Automation prompt"
          value={prompt}
          onChange={(event) => { setPrompt(event.target.value); setSaved(false) }}
          spellCheck={false}
          className="min-h-0 flex-1 resize-none font-mono text-[13px] leading-5"
          disabled={loading || saving}
        />
        <p className="text-[11px] text-muted-foreground">Markdown prompt · Save with Ctrl/⌘+S.</p>
      </div>
    </form>
  )
}
