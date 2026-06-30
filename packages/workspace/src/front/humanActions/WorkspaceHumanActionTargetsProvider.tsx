"use client"

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react"
import { Button } from "@hachej/boring-ui-kit"
import { cn } from "../lib/utils"
import { toast } from "../toast"

export type WorkspaceHumanActionTargetRef =
  | { type: "surface"; surfaceKind: string; target: string; label?: string }
  | { type: "panel"; component: string; instanceId?: string; label?: string }
  | { type: "file"; workspaceId?: string; path: string; label?: string }

export type WorkspaceHumanActionButton = {
  id: string
  label: string
  tone?: "default" | "positive" | "warning" | "danger"
  comment?: "none" | "optional" | "required"
}

export type WorkspaceHumanActionTargetAction = {
  id: string
  title: string
  body?: string
  target: WorkspaceHumanActionTargetRef
  actions: WorkspaceHumanActionButton[]
  pluginId?: string
  createdAt?: string
  onAction: (args: { action: WorkspaceHumanActionButton; comment?: string }) => void | Promise<void>
}

export interface WorkspaceHumanActionTargetsContextValue {
  registerTargetAction(action: WorkspaceHumanActionTargetAction): () => void
  getTargetActions(target: WorkspaceHumanActionTargetRef): WorkspaceHumanActionTargetAction[]
}

const noopContext: WorkspaceHumanActionTargetsContextValue = {
  registerTargetAction: () => () => undefined,
  getTargetActions: () => [],
}

const WorkspaceHumanActionTargetsContext = createContext<WorkspaceHumanActionTargetsContextValue | null>(null)

export function workspaceHumanActionTargetKey(target: WorkspaceHumanActionTargetRef): string {
  if (target.type === "surface") return `surface:${target.surfaceKind}:${target.target}`
  if (target.type === "panel") return `panel:${target.component}:${target.instanceId ?? ""}`
  return `file:${target.workspaceId ?? ""}:${target.path}`
}

function targetActionRegistryKey(action: WorkspaceHumanActionTargetAction): string {
  return `${workspaceHumanActionTargetKey(action.target)}:${action.pluginId ?? "plugin"}:${action.id}`
}

function workspaceHumanActionTargetsMatch(left: WorkspaceHumanActionTargetRef, right: WorkspaceHumanActionTargetRef): boolean {
  if (left.type !== right.type) return false
  if (left.type === "surface" && right.type === "surface") return left.surfaceKind === right.surfaceKind && left.target === right.target
  if (left.type === "panel" && right.type === "panel") return left.component === right.component && (left.instanceId ?? "") === (right.instanceId ?? "")
  if (left.type === "file" && right.type === "file") {
    if (left.path !== right.path) return false
    return !left.workspaceId || !right.workspaceId || left.workspaceId === right.workspaceId
  }
  return false
}

export function useWorkspaceHumanActionTargets(): WorkspaceHumanActionTargetsContextValue {
  return useContext(WorkspaceHumanActionTargetsContext) ?? noopContext
}

export function useWorkspaceHumanActionsForTarget(target: WorkspaceHumanActionTargetRef): WorkspaceHumanActionTargetAction[] {
  const context = useWorkspaceHumanActionTargets()
  const key = workspaceHumanActionTargetKey(target)
  return useMemo(() => context.getTargetActions(target), [context, key])
}

export function WorkspaceHumanActionTargetsProvider({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<WorkspaceHumanActionTargetAction[]>([])
  const registerTargetAction = useCallback((action: WorkspaceHumanActionTargetAction) => {
    const key = targetActionRegistryKey(action)
    setActions((current) => [...current.filter((item) => targetActionRegistryKey(item) !== key), action])
    return () => setActions((current) => current.filter((item) => targetActionRegistryKey(item) !== key))
  }, [])
  const getTargetActions = useCallback((target: WorkspaceHumanActionTargetRef) => actions.filter((action) => workspaceHumanActionTargetsMatch(action.target, target)), [actions])
  const value = useMemo<WorkspaceHumanActionTargetsContextValue>(() => ({ registerTargetAction, getTargetActions }), [registerTargetAction, getTargetActions])
  return <WorkspaceHumanActionTargetsContext.Provider value={value}>{children}</WorkspaceHumanActionTargetsContext.Provider>
}

function buttonClassName(tone: WorkspaceHumanActionButton["tone"]): string {
  if (tone === "positive") return "border-emerald-500/60 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300"
  if (tone === "warning") return "border-amber-500/60 text-amber-700 hover:bg-amber-500/10 dark:text-amber-300"
  if (tone === "danger") return "border-destructive/60 text-destructive hover:bg-destructive/10"
  return ""
}

export function WorkspaceHumanActionTargetButtons({ target, className }: { target: WorkspaceHumanActionTargetRef; className?: string }) {
  const actions = useWorkspaceHumanActionsForTarget(target)
  const [draft, setDraft] = useState<{ humanActionId: string; actionId: string; value: string } | null>(null)
  const submittingIdsRef = useRef(new Set<string>())
  const [submittingIds, setSubmittingIds] = useState<Set<string>>(() => new Set())
  const [error, setError] = useState<{ humanActionId: string; message: string } | null>(null)
  const beginSubmit = (humanActionId: string): boolean => {
    if (submittingIdsRef.current.has(humanActionId)) return false
    submittingIdsRef.current.add(humanActionId)
    setSubmittingIds(new Set(submittingIdsRef.current))
    return true
  }
  const finishSubmit = (humanActionId: string): void => {
    submittingIdsRef.current.delete(humanActionId)
    setSubmittingIds(new Set(submittingIdsRef.current))
  }
  const runAction = (humanAction: WorkspaceHumanActionTargetAction, action: WorkspaceHumanActionButton, comment?: string) => {
    if (!beginSubmit(humanAction.id)) return
    setError(null)
    void Promise.resolve()
      .then(() => humanAction.onAction({ action, ...(comment ? { comment } : {}) }))
      .catch(() => {
        const message = "Decision was not submitted. Try again or open the request from Inbox."
        setError({ humanActionId: humanAction.id, message })
        toast.error({ title: "Decision not submitted", description: message })
      })
      .finally(() => finishSubmit(humanAction.id))
  }
  if (actions.length === 0) return null
  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-2", className)} data-testid="workspace-human-action-target-buttons">
      {actions.map((humanAction) => {
        const selected = draft?.humanActionId === humanAction.id
          ? humanAction.actions.find((action) => action.id === draft.actionId)
          : null
        const selectedRequiresComment = selected?.comment === "required"
        const rowSubmitting = submittingIds.has(humanAction.id)
        const rowError = error?.humanActionId === humanAction.id ? error.message : null
        return (
          <div key={humanAction.id} className="flex min-w-0 items-center gap-1 rounded-md border border-border/60 bg-background/80 px-2 py-1 shadow-sm" title={humanAction.body ?? humanAction.title}>
            <span className="max-w-[14rem] truncate text-xs font-medium text-muted-foreground">{humanAction.title}</span>
            <div className="flex items-center gap-1">
              {humanAction.actions.map((action) => (
                <Button
                  key={action.id}
                  type="button"
                  size="sm"
                  variant="outline"
                  className={cn("h-7 px-2 text-xs", buttonClassName(action.tone))}
                  aria-label={`${humanAction.title}: ${action.label}`}
                  disabled={rowSubmitting}
                  onClick={() => {
                    if (rowSubmitting) return
                    if (action.comment === "required" || action.comment === "optional") {
                      setDraft({ humanActionId: humanAction.id, actionId: action.id, value: "" })
                      return
                    }
                    runAction(humanAction, action)
                  }}
                >
                  {action.label}
                </Button>
              ))}
            </div>
            {selected && draft ? (
              <form
                className="ml-2 flex items-center gap-1"
                onSubmit={(event) => {
                  event.preventDefault()
                  const comment = draft.value.trim()
                  if (selectedRequiresComment && !comment) return
                  setDraft(null)
                  runAction(humanAction, selected, comment || undefined)
                }}
              >
                <input
                  aria-label={`${selected.label} comment`}
                  className="h-7 w-44 rounded-md border border-border bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring"
                  value={draft.value}
                  placeholder={selectedRequiresComment ? "Comment required" : "Comment optional"}
                  onChange={(event) => setDraft({ ...draft, value: event.target.value })}
                />
                <Button type="submit" size="sm" className="h-7 px-2 text-xs" disabled={(selectedRequiresComment && !draft.value.trim()) || rowSubmitting}>Send</Button>
                <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setDraft(null)}>Cancel</Button>
              </form>
            ) : null}
            {rowError ? <span role="status" className="ml-2 text-xs text-destructive">{rowError}</span> : null}
          </div>
        )
      })}
    </div>
  )
}
