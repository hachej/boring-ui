import { WorkspacePluginClientRequestError, type WorkspacePluginClient } from "@hachej/boring-workspace"
import {
  WORKSPACE_CHAT_PROMPT_ACCEPTED_EVENT,
  type WorkspaceChatPromptAcceptedDetail,
  type WorkspaceShellSessionRef,
} from "@hachej/boring-workspace/plugin"
import { emitWorkspaceTaskProvenanceChanged } from "@hachej/boring-workspace"

const STORAGE_KEY = "boring-tasks:pending-chat-bindings:v1"
interface BindingAttemptState {
  attempt: number
  inFlight: boolean
  timer?: ReturnType<typeof setTimeout>
}

const attemptStates = new Map<string, BindingAttemptState>()
const listeners = new Map<string, { prompt: EventListener; status: EventListener }>()
const MAX_BIND_ATTEMPTS = 6
const CHAT_SESSION_STATUS_EVENT = "boring:chat-session-status"

function retryableBindingError(error: unknown): boolean {
  return !(error instanceof WorkspacePluginClientRequestError)
    || error.status === 408
    || error.status === 429
    || error.status >= 500
}

export interface PendingTaskChatBinding extends WorkspaceShellSessionRef {
  workspaceId: string
  adapterId: string
  taskId: string
}

function bindingKey(binding: PendingTaskChatBinding): string {
  return [binding.workspaceId, binding.adapterId, binding.taskId, binding.agentTypeId, binding.sessionId].join("\u0000")
}

function readPending(): PendingTaskChatBinding[] {
  if (typeof window === "undefined") return []
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? "[]") as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is PendingTaskChatBinding => {
      if (!item || typeof item !== "object") return false
      const value = item as Partial<PendingTaskChatBinding>
      return [value.workspaceId, value.adapterId, value.taskId, value.agentTypeId, value.sessionId]
        .every((part) => typeof part === "string" && part.length > 0)
    })
  } catch {
    return []
  }
}

function writePending(bindings: readonly PendingTaskChatBinding[]): void {
  try { window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(bindings)) } catch { /* Best-effort tab recovery. */ }
}

function stopWatching(key: string): void {
  const listener = listeners.get(key)
  if (!listener) return
  window.removeEventListener(WORKSPACE_CHAT_PROMPT_ACCEPTED_EVENT, listener.prompt)
  window.removeEventListener(CHAT_SESSION_STATUS_EVENT, listener.status)
  listeners.delete(key)
}

function removePending(binding: PendingTaskChatBinding): void {
  const key = bindingKey(binding)
  writePending(readPending().filter((candidate) => bindingKey(candidate) !== key))
  stopWatching(key)
  const attemptState = attemptStates.get(key)
  if (attemptState?.timer) clearTimeout(attemptState.timer)
  attemptStates.delete(key)
}

async function bind(binding: PendingTaskChatBinding, client: Pick<WorkspacePluginClient, "postJson">): Promise<void> {
  const key = bindingKey(binding)
  if (!readPending().some((candidate) => bindingKey(candidate) === key)) return
  const state = attemptStates.get(key) ?? { attempt: 0, inFlight: false }
  if (state.inFlight || state.timer) return
  state.inFlight = true
  attemptStates.set(key, state)
  try {
    await client.postJson("/api/boring-tasks/sessions/link", {
      adapterId: binding.adapterId,
      taskId: binding.taskId,
      agentTypeId: binding.agentTypeId,
      sessionId: binding.sessionId,
    })
    removePending(binding)
    emitWorkspaceTaskProvenanceChanged()
  } catch (error) {
    state.inFlight = false
    if (!retryableBindingError(error)) {
      removePending(binding)
      console.error("Failed to bind submitted task chat", error)
      return
    }
    if (state.attempt + 1 >= MAX_BIND_ATTEMPTS) {
      attemptStates.delete(key)
      console.error("Task chat binding is still pending after transient failures", error)
      return
    }
    const delay = Math.min(1_000 * 2 ** state.attempt, 30_000)
    state.attempt += 1
    state.timer = setTimeout(() => {
      state.timer = undefined
      void bind(binding, client)
    }, delay)
    if (state.attempt === 1) console.error("Failed to bind submitted task chat; retrying", error)
  }
}

function watch(binding: PendingTaskChatBinding, client: Pick<WorkspacePluginClient, "postJson">): void {
  const key = bindingKey(binding)
  if (listeners.has(key)) return
  const accept = () => {
    stopWatching(key)
    void bind(binding, client)
  }
  const prompt: EventListener = (event) => {
    const detail = (event as CustomEvent<WorkspaceChatPromptAcceptedDetail>).detail
    if (detail?.agentTypeId === binding.agentTypeId && detail.sessionId === binding.sessionId) accept()
  }
  const status: EventListener = (event) => {
    const detail = (event as CustomEvent<{ agentTypeId?: unknown; sessionId?: unknown; working?: unknown }>).detail
    if (detail?.working === true && detail.agentTypeId === binding.agentTypeId && detail.sessionId === binding.sessionId) accept()
  }
  listeners.set(key, { prompt, status })
  window.addEventListener(WORKSPACE_CHAT_PROMPT_ACCEPTED_EVENT, prompt)
  window.addEventListener(CHAT_SESSION_STATUS_EVENT, status)
}

export function registerPendingTaskChatBinding(
  binding: PendingTaskChatBinding,
  client: Pick<WorkspacePluginClient, "postJson">,
): () => void {
  const key = bindingKey(binding)
  writePending([...readPending().filter((candidate) => bindingKey(candidate) !== key), binding])
  watch(binding, client)
  return () => removePending(binding)
}

export function resumePendingTaskChatBindings(client: Pick<WorkspacePluginClient, "workspaceId" | "agentTypeId" | "getJson" | "postJson">): void {
  const workspaceId = client.workspaceId ?? "workspace"
  for (const binding of readPending()) {
    if (binding.workspaceId !== workspaceId || binding.agentTypeId !== client.agentTypeId) continue
    watch(binding, client)
    void client.getJson<{ summary?: { turnCount?: number } }>(
      `/api/v1/agents/${encodeURIComponent(binding.agentTypeId)}/sessions/${encodeURIComponent(binding.sessionId)}/state`,
    ).then((snapshot) => {
      if ((snapshot.summary?.turnCount ?? 0) <= 0) return
      stopWatching(bindingKey(binding))
      void bind(binding, client)
    }).catch(() => undefined)
  }
}
