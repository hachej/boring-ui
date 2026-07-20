"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { CalendarClock, Plus, RefreshCw, X } from "lucide-react"
import { Button, Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, EmptyState, IconButton, Notice, Spinner, type NoticeTone } from "@hachej/boring-ui-kit"
import { useWorkspaceShellCapabilities } from "@hachej/boring-workspace/plugin"
import { BORING_AUTOMATION_PLUGIN_LABEL, type Automation, type AutomationRun } from "../shared"
import { AutomationCard } from "./AutomationCard"
import { AutomationForm, emptyAutomationDraft, toAutomationCreate, toAutomationPatch, type AutomationDraft } from "./AutomationForm"
import { AutomationClientError } from "./client"
import { useAutomationClient } from "./AutomationRuntimeContext"

interface AutomationDetailState {
  prompt: string
  promptLoading: boolean
  runs: AutomationRun[]
  runsLoading: boolean
}

interface SaveNoticeState {
  tone: NoticeTone
  message: string
}

type EditorState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; automationId: string }

function errorMessage(error: unknown): string {
  if (error instanceof AutomationClientError) return error.message
  if (error instanceof Error) return error.message
  return "Automation request failed"
}

function detailWithPatch(previous: AutomationDetailState | undefined, patch: Partial<AutomationDetailState>): AutomationDetailState {
  return {
    prompt: previous?.prompt ?? "",
    promptLoading: previous?.promptLoading ?? false,
    runs: previous?.runs ?? [],
    runsLoading: previous?.runsLoading ?? false,
    ...patch,
  }
}

function patchDetail(current: Record<string, AutomationDetailState>, automationId: string, patch: Partial<AutomationDetailState>) {
  return { ...current, [automationId]: detailWithPatch(current[automationId], patch) }
}

function bumpGeneration(generations: { current: Record<string, number> }, automationId: string): number {
  const generation = (generations.current[automationId] ?? 0) + 1
  generations.current[automationId] = generation
  return generation
}

function isCurrentGeneration(generations: { current: Record<string, number> }, automationId: string, generation: number, signal?: AbortSignal): boolean {
  return !signal?.aborted && generations.current[automationId] === generation
}

export function AutomationPanel({ onClose }: { onClose?: () => void }) {
  const client = useAutomationClient()
  const shell = useWorkspaceShellCapabilities()
  const [automations, setAutomations] = useState<Automation[]>([])
  const [details, setDetails] = useState<Record<string, AutomationDetailState>>({})
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editor, setEditor] = useState<EditorState>({ mode: "closed" })
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [runningNowIds, setRunningNowIds] = useState<Set<string>>(() => new Set())
  const [routeError, setRouteError] = useState<string | null>(null)
  const [shellError, setShellError] = useState<string | null>(null)
  const [saveNotice, setSaveNotice] = useState<SaveNoticeState | null>(null)
  const promptRequestGeneration = useRef<Record<string, number>>({})
  const runRequestGeneration = useRef<Record<string, number>>({})

  const selectedAutomation = useMemo(
    () => editor.mode === "edit" ? automations.find((automation) => automation.id === editor.automationId) ?? null : null,
    [automations, editor],
  )

  const loadAutomations = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setRouteError(null)
    try {
      const next = await client.listAutomations({ signal })
      setAutomations(next)
    } catch (error) {
      if (signal?.aborted) return
      setRouteError(errorMessage(error))
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [client])

  const loadPrompt = useCallback(async (automationId: string, signal?: AbortSignal) => {
    const generation = bumpGeneration(promptRequestGeneration, automationId)
    setDetails((current) => patchDetail(current, automationId, { promptLoading: true }))
    try {
      const prompt = await client.getPrompt(automationId, { signal })
      if (!isCurrentGeneration(promptRequestGeneration, automationId, generation, signal)) return
      setDetails((current) => patchDetail(current, automationId, { prompt, promptLoading: false }))
    } catch (error) {
      if (!isCurrentGeneration(promptRequestGeneration, automationId, generation, signal)) return
      setRouteError(errorMessage(error))
      setDetails((current) => patchDetail(current, automationId, { promptLoading: false }))
    }
  }, [client])

  const loadRuns = useCallback(async (automationId: string, signal?: AbortSignal) => {
    const generation = bumpGeneration(runRequestGeneration, automationId)
    setDetails((current) => patchDetail(current, automationId, { runsLoading: true }))
    try {
      const runs = await client.listRuns(automationId, { signal })
      if (!isCurrentGeneration(runRequestGeneration, automationId, generation, signal)) return
      setDetails((current) => patchDetail(current, automationId, { runs, runsLoading: false }))
    } catch (error) {
      if (!isCurrentGeneration(runRequestGeneration, automationId, generation, signal)) return
      setRouteError(errorMessage(error))
      setDetails((current) => patchDetail(current, automationId, { runsLoading: false }))
    }
  }, [client])

  useEffect(() => {
    const controller = new AbortController()
    void loadAutomations(controller.signal)
    return () => controller.abort()
  }, [loadAutomations])

  const openCreate = useCallback(() => {
    setEditor({ mode: "create" })
    setSaveNotice(null)
    setShellError(null)
  }, [])

  const openEdit = useCallback((automation: Automation) => {
    setEditor({ mode: "edit", automationId: automation.id })
    setSaveNotice(null)
    setShellError(null)
    void loadPrompt(automation.id)
  }, [loadPrompt])

  const toggleExpanded = useCallback((automation: Automation) => {
    const willExpand = expandedId !== automation.id
    setExpandedId(willExpand ? automation.id : null)
    setShellError(null)
    if (willExpand) void loadRuns(automation.id)
  }, [expandedId, loadRuns])

  async function refreshAutomationAndPrompt(automationId: string) {
    const generation = bumpGeneration(promptRequestGeneration, automationId)
    setDetails((current) => patchDetail(current, automationId, { promptLoading: true }))
    const [automation, prompt] = await Promise.all([
      client.getAutomation(automationId),
      client.getPrompt(automationId),
    ])
    if (!isCurrentGeneration(promptRequestGeneration, automationId, generation)) return
    setAutomations((current) => current.map((item) => item.id === automation.id ? automation : item))
    setDetails((current) => patchDetail(current, automation.id, { prompt, promptLoading: false }))
  }

  async function saveDraft(draft: AutomationDraft) {
    setSaving(true)
    setRouteError(null)
    setSaveNotice(null)
    try {
      if (editor.mode === "create") {
        const created = await client.createAutomation(toAutomationCreate(draft))
        bumpGeneration(promptRequestGeneration, created.id)
        setAutomations((current) => [created, ...current])
        setDetails((current) => patchDetail(current, created.id, { prompt: draft.prompt, promptLoading: false, runs: [], runsLoading: false }))
        setExpandedId(created.id)
        setEditor({ mode: "closed" })
        setSaveNotice({ tone: "success", message: "Automation created." })
        return
      }
      if (editor.mode === "edit") {
        const automationId = editor.automationId
        bumpGeneration(promptRequestGeneration, automationId)
        await client.updatePrompt(automationId, draft.prompt)
        setDetails((current) => patchDetail(current, automationId, { prompt: draft.prompt, promptLoading: false }))

        try {
          const updated = await client.updateAutomation(automationId, toAutomationPatch(draft))
          setAutomations((current) => current.map((automation) => automation.id === updated.id ? updated : automation))
          setEditor({ mode: "closed" })
          setSaveNotice({ tone: "success", message: "Automation saved." })
        } catch (metadataError) {
          try {
            await refreshAutomationAndPrompt(automationId)
            setSaveNotice({ tone: "warning", message: `Prompt saved, but automation metadata was not saved: ${errorMessage(metadataError)}. Refreshed latest server state.` })
          } catch (refreshError) {
            setSaveNotice({ tone: "warning", message: `Prompt saved, but automation metadata was not saved: ${errorMessage(metadataError)}. Refresh failed: ${errorMessage(refreshError)}` })
          }
        }
      }
    } catch (error) {
      setRouteError(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  async function deleteAutomation(id: string) {
    setRouteError(null)
    try {
      await client.deleteAutomation(id)
      setAutomations((current) => current.filter((automation) => automation.id !== id))
      setDetails((current) => {
        const next = { ...current }
        delete next[id]
        return next
      })
      if (expandedId === id) setExpandedId(null)
      if (editor.mode === "edit" && editor.automationId === id) setEditor({ mode: "closed" })
      setDeleteId(null)
      setSaveNotice({ tone: "success", message: "Automation deleted." })
    } catch (error) {
      setRouteError(errorMessage(error))
    }
  }

  async function runNow(automation: Automation) {
    if (runningNowIds.has(automation.id)) return
    setRunningNowIds((current) => new Set(current).add(automation.id))
    setRouteError(null)
    setSaveNotice(null)
    setExpandedId(automation.id)
    try {
      const run = await client.runNow(automation.id)
      setDetails((current) => patchDetail(current, automation.id, {
        runs: [run, ...(current[automation.id]?.runs ?? []).filter((item) => item.id !== run.id)],
        runsLoading: false,
      }))
      setSaveNotice({ tone: "success", message: run.sessionId ? "Automation finished. Open its session from run history." : "Automation finished." })
    } catch (error) {
      setRouteError(errorMessage(error))
      await loadRuns(automation.id)
    } finally {
      setRunningNowIds((current) => {
        const next = new Set(current)
        next.delete(automation.id)
        return next
      })
    }
  }

  function openRun(run: AutomationRun) {
    if (!run.sessionId) return
    const result = shell.openDetachedChat(run.sessionId, { title: run.modelSnapshot || "Automation run", composingEnabled: true })
    setShellError(result.success ? null : result.message)
  }

  const editorPrompt = selectedAutomation ? details[selectedAutomation.id]?.prompt ?? "" : emptyAutomationDraft().prompt
  const editorLoading = editor.mode === "edit" && selectedAutomation ? details[selectedAutomation.id]?.promptLoading === true : false

  return (
    <div data-boring-workspace-part="automation-panel" className="flex h-full min-h-0 flex-col bg-background text-sm text-foreground">
      <header className="flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border/60 px-3 py-3 sm:px-4">
        <div className="min-w-0" style={{ flex: "1 1 24rem" }}>
          <div className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-lg bg-[color:oklch(from_var(--accent)_l_c_h/0.14)] text-[color:var(--accent)]">
              <CalendarClock className="size-4" aria-hidden="true" />
            </span>
            <h2 className="truncate text-sm font-semibold tracking-tight">{BORING_AUTOMATION_PLUGIN_LABEL}</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Local scheduled prompts with Markdown prompt files and Pi session history.</p>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2" style={{ flex: "1 1 16rem" }}>
          <Button className="min-h-11" type="button" variant="ghost" size="sm" onClick={() => void loadAutomations()} disabled={loading || editor.mode !== "closed"}>
            <RefreshCw className="size-4" aria-hidden="true" />
            Refresh
          </Button>
          <Button className="min-h-11" type="button" size="sm" onClick={openCreate}>
            <Plus className="size-4" aria-hidden="true" />
            New
          </Button>
          {onClose ? <IconButton style={{ height: 44, minHeight: 44, minWidth: 44, width: 44 }} type="button" variant="ghost" size="icon-xs" onClick={onClose} aria-label="Close automations" title="Close"><X className="size-4" /></IconButton> : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto bg-[color:oklch(from_var(--background)_calc(l-0.012)_c_h)]">
        <div className="mx-auto w-full max-w-6xl p-3 sm:p-4">
          {routeError ? <Notice tone="destructive" className="mb-3" role="alert">{routeError}</Notice> : null}
          {shellError ? <Notice tone="destructive" className="mb-3" role="alert">{shellError}</Notice> : null}
          {saveNotice ? <Notice tone={saveNotice.tone} className="mb-3" role="status">{saveNotice.message}</Notice> : null}
          <section className="min-w-0 overflow-hidden rounded-xl border border-border/70 bg-card/60" aria-label="Automation list">
            {loading ? (
              <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground"><Spinner className="size-4" /> Loading automations…</div>
            ) : automations.length === 0 ? (
              <EmptyState
                title="No automations yet"
                description="Create a focused scheduled prompt with cron, timezone, model, and canonical Markdown."
                icon={<CalendarClock className="size-8" aria-hidden="true" />}
                actions={<Button type="button" onClick={openCreate}>Create automation</Button>}
                className="min-h-64"
              />
            ) : (
              <div>
                {automations.map((automation) => {
                  const detail = details[automation.id]
                  return (
                    <AutomationCard
                      key={automation.id}
                      automation={automation}
                      expanded={expandedId === automation.id}
                      deleting={deleteId === automation.id}
                      runs={detail?.runs ?? []}
                      runsLoading={detail?.runsLoading === true}
                      runningNow={runningNowIds.has(automation.id)}
                      onToggle={() => toggleExpanded(automation)}
                      onEdit={() => openEdit(automation)}
                      onRunNow={() => void runNow(automation)}
                      onDeleteRequest={() => setDeleteId(automation.id)}
                      onDeleteCancel={() => setDeleteId(null)}
                      onDeleteConfirm={() => void deleteAutomation(automation.id)}
                      onOpenRun={openRun}
                    />
                  )
                })}
              </div>
            )}
          </section>

          <Dialog open={editor.mode !== "closed"} onOpenChange={(open) => { if (!open && !saving) setEditor({ mode: "closed" }) }}>
            <DialogContent
              showCloseButton={false}
              onEscapeKeyDown={(event) => { if (saving) event.preventDefault() }}
              onPointerDownOutside={(event) => { if (saving) event.preventDefault() }}
              className="max-w-xl overflow-y-auto p-4 sm:p-6"
              style={{
                maxHeight: "calc(100dvh - 1rem)",
                overscrollBehavior: "contain",
                width: "min(calc(100vw - 1rem), 36rem)",
              }}
            >
              <DialogHeader className="pr-12">
                <DialogTitle>{editor.mode === "create" ? "New automation" : "Edit automation"}</DialogTitle>
                <DialogDescription>Schedule a prompt with its model and effort.</DialogDescription>
              </DialogHeader>
              <div aria-label="Automation editor">
            {editor.mode === "closed" ? (
              <div className="flex min-h-80 items-center justify-center px-4 text-center text-sm text-muted-foreground">
                <div>
                  <div className="font-medium text-foreground">Select an automation to edit</div>
                  <p className="mt-1 max-w-xs">Cards expand for read-only run history. The editor saves metadata and Markdown through separate public routes.</p>
                </div>
              </div>
            ) : editor.mode === "create" ? (
              <AutomationForm mode="create" prompt="" saving={saving} onCancel={() => setEditor({ mode: "closed" })} onSubmit={(draft) => void saveDraft(draft)} />
            ) : selectedAutomation ? (
              editorLoading ? (
                <div className="flex min-h-80 items-center justify-center gap-2 text-muted-foreground"><Spinner className="size-4" /> Loading prompt…</div>
              ) : (
                <AutomationForm automation={selectedAutomation} mode="edit" prompt={editorPrompt} saving={saving} onCancel={() => setEditor({ mode: "closed" })} onSubmit={(draft) => void saveDraft(draft)} />
              )
            ) : (
              <Notice tone="destructive">Automation not found.</Notice>
            )}
              </div>
              <DialogClose asChild>
                <IconButton className="absolute right-2 top-2" style={{ height: 44, minHeight: 44, minWidth: 44, width: 44 }} type="button" variant="ghost" size="icon-sm" aria-label="Close automation editor" title="Close" disabled={saving}>
                  <X className="size-4" aria-hidden="true" />
                </IconButton>
              </DialogClose>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </div>
  )
}
