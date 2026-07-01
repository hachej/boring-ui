import { ASK_USER_PLUGIN_ID, ASK_USER_SURFACE_KIND } from "./constants"
import type { AskUserFormSchema, AskUserQuestion, AskUserQuestionStatus, AskUserTargetHumanAction } from "./types"

export type HumanActionKind = "question" | "approval" | "review" | "choice" | "ack"

export type HumanActionScope =
  | { type: "session"; sessionId: string }
  | { type: "workspace" }
  | { type: "external"; sourceId: string }

export type HumanActionPublicStatus = "ready" | "resolved" | "cancelled" | "abandoned"

export type HumanActionResponse =
  | { mode: "form"; schema?: AskUserFormSchema; submitLabel?: string }
  | { mode: "approval"; approveLabel?: string; rejectLabel?: string; requireCommentOnReject?: boolean }
  | { mode: "choice"; choices: Array<{ id: string; label: string; description?: string }> }
  | { mode: "review"; actions: Array<{ id: string; label: string; destructive?: boolean; comment?: "none" | "optional" | "required" }> }
  | { mode: "ack"; label?: string }

export type HumanActionView = {
  actionId: string
  workspaceId: string
  scope: HumanActionScope
  ownerPrincipalId: string
  status: HumanActionPublicStatus
  kind: HumanActionKind
  title: string
  body?: string
  context?: string
  priority?: number
  blocking: boolean
  createdAt: string
  updatedAt: string
  expiresAt?: string
  artifact?: {
    surfaceKind: string
    target?: string
    label?: string
  }
  response: HumanActionResponse
}

export type AskUserPendingHumanActionHint = {
  questionId: string
  sessionId: string
  status?: AskUserQuestionStatus
}

export type HumanActionInboxSourceMetadata =
  | { type: "plugin"; id: string; label: string }
  | { type: "external-hook"; id: string; label: string }
  | { type: "review"; id: string; label: string }
  | { type: "generic"; id?: string; label: string }

export type HumanActionInboxArtifactMetadata =
  | { type: "surface"; id?: string; label?: string; surfaceKind: string; target?: string; params?: Record<string, unknown> }
  | { type: "panel"; id?: string; label?: string; panelComponentId: string; params?: Record<string, unknown> }

export type HumanActionInboxMetadata = {
  kind: "question" | "review" | "approval" | "notice"
  sourceLabel: string
  source?: HumanActionInboxSourceMetadata
  artifacts?: HumanActionInboxArtifactMetadata[]
  createdAt?: string
  updatedAt?: string
  priority?: number
}

export type HumanActionSessionBadge = {
  kind: string
  label: string
  tone?: "attention" | "danger" | "neutral" | "warning"
  priority?: number
}

export type HumanActionBlockerProjection = {
  id: string
  reason: string
  surfaceKind?: string
  target?: string
  label: string
  sessionId?: string
  sessionBadge?: HumanActionSessionBadge
  inbox?: HumanActionInboxMetadata
  actions?: Array<{ id: string; label: string }>
}

function questionStatusToHumanActionStatus(status: AskUserQuestionStatus): HumanActionPublicStatus {
  if (status === "answered") return "resolved"
  if (status === "cancelled") return "cancelled"
  if (status === "abandoned") return "abandoned"
  return "ready"
}

function humanActionKind(action: AskUserTargetHumanAction | undefined): HumanActionKind {
  if (!action) return "question"
  if (action.kind === "approval") return "approval"
  if (action.kind === "review") return "review"
  if (action.kind === "choice") return "choice"
  return "ack"
}

function artifactLabel(target: AskUserTargetHumanAction["target"], fallback?: string): string {
  if (target.label) return target.label
  if (target.type === "file") return target.path
  if (target.type === "surface") return target.target
  return fallback ?? target.component
}

function targetArtifact(target: AskUserTargetHumanAction["target"], label?: string, id?: string): HumanActionInboxArtifactMetadata {
  if (target.type === "file") return { type: "surface", ...(id ? { id } : {}), label: label ?? artifactLabel(target), surfaceKind: "workspace.open.path", target: target.path }
  if (target.type === "surface") return { type: "surface", ...(id ? { id } : {}), label: label ?? artifactLabel(target), surfaceKind: target.surfaceKind, target: target.target }
  return { type: "panel", ...(id ? { id } : {}), label: label ?? artifactLabel(target), panelComponentId: target.component, ...(target.instanceId ? { params: { instanceId: target.instanceId } } : {}) }
}

function artifactKey(artifact: HumanActionInboxArtifactMetadata): string {
  if (artifact.type === "panel") return `panel:${artifact.panelComponentId}:${JSON.stringify(artifact.params ?? {})}`
  return `surface:${artifact.surfaceKind}:${artifact.target ?? ""}`
}

function actionArtifacts(action: AskUserTargetHumanAction | undefined, questionId: string): HumanActionInboxArtifactMetadata[] {
  if (!action) return [{ type: "surface", id: "question", surfaceKind: ASK_USER_SURFACE_KIND, target: questionId, label: "Questions" }]
  const artifacts: HumanActionInboxArtifactMetadata[] = [targetArtifact(action.target, undefined, "target")]
  for (const artifact of action.artifacts ?? []) artifacts.push(targetArtifact(artifact.target, artifact.label, artifact.id))
  const seen = new Set<string>()
  return artifacts.filter((artifact) => {
    const key = artifactKey(artifact)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function primaryArtifact(action: AskUserTargetHumanAction | undefined, questionId: string): HumanActionView["artifact"] {
  const artifact = actionArtifacts(action, questionId)[0]
  if (!artifact || artifact.type !== "surface") return undefined
  return { surfaceKind: artifact.surfaceKind, target: artifact.target, label: artifact.label }
}

export function askUserQuestionToHumanActionView(
  question: AskUserQuestion,
  options: { workspaceId?: string; priority?: number } = {},
): HumanActionView {
  const targetAction = question.humanAction
  return {
    actionId: question.questionId,
    workspaceId: options.workspaceId ?? "default",
    scope: { type: "session", sessionId: question.sessionId },
    ownerPrincipalId: question.ownerPrincipalId,
    status: questionStatusToHumanActionStatus(question.status),
    kind: humanActionKind(targetAction),
    title: targetAction?.title ?? question.title ?? "Answer the question in Questions to continue",
    body: targetAction?.body,
    context: question.context,
    priority: options.priority ?? 10,
    blocking: true,
    createdAt: question.createdAt,
    updatedAt: question.updatedAt,
    artifact: primaryArtifact(targetAction, question.questionId),
    response: targetAction?.kind === "review"
      ? { mode: "review", actions: targetAction.actions }
      : { mode: "form", schema: question.schema, submitLabel: question.schema?.submitLabel },
  }
}

export function askUserHumanActionToBlockerProjection(args: {
  hint: AskUserPendingHumanActionHint
  question?: AskUserQuestion | null
  isActiveHint?: boolean
}): HumanActionBlockerProjection | null {
  const { hint, question, isActiveHint = false } = args
  if (hint.status && hint.status !== "ready") return null

  const action = question ? askUserQuestionToHumanActionView(question) : null
  const artifacts = actionArtifacts(question?.humanAction, hint.questionId)
  const displayKind = action?.kind === "review" || action?.kind === "approval" ? action.kind : "question"
  const openLabel = displayKind === "review" ? "Open review target" : displayKind === "approval" ? "Open approval target" : "Open Questions"
  const actions = question
    ? [{ id: "open", label: openLabel }, { id: "cancel", label: displayKind === "question" ? "Cancel question" : "Cancel request" }]
    : isActiveHint
      ? [{ id: "open", label: openLabel }]
      : undefined

  return {
    id: `${ASK_USER_PLUGIN_ID}:${hint.sessionId}:${hint.questionId}`,
    reason: displayKind === "question" ? "ask-user.question" : `ask-user.${displayKind}`,
    surfaceKind: action?.artifact?.surfaceKind ?? ASK_USER_SURFACE_KIND,
    target: action?.artifact?.target ?? hint.questionId,
    label: action?.title ?? "Answer the question in Questions to continue",
    sessionId: hint.sessionId,
    sessionBadge: { kind: displayKind, label: displayKind, tone: "attention", priority: 10 },
    inbox: {
      kind: displayKind,
      sourceLabel: displayKind,
      source: { type: "plugin", id: ASK_USER_PLUGIN_ID, label: displayKind },
      artifacts,
      createdAt: action?.createdAt,
      updatedAt: action?.updatedAt ?? action?.createdAt,
      priority: action?.priority ?? 10,
    },
    actions,
  }
}
