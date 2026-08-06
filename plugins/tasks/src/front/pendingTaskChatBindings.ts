import type { WorkspacePluginClient } from "@hachej/boring-workspace"
import {
  WORKSPACE_CHAT_PROMPT_ACCEPTED_EVENT,
  type WorkspaceChatPromptAcceptedDetail,
  type WorkspaceShellSessionRef,
} from "@hachej/boring-workspace/plugin"
import { emitWorkspaceTaskProvenanceChanged } from "@hachej/boring-workspace"
import { emitTaskSessionLinkReceipt } from "./taskSessionLinkStream"

const STORAGE_KEY = "boring-tasks:pending-chat-bindings:v1"
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>()
const bindingAttempts = new Set<string>()
const listeners = new Map<string, EventListener>()

export interface PendingTaskChatBinding extends WorkspaceShellSessionRef {
  workspaceId: string
  adapterId: string
  taskId: string
}

function bindingKey(binding: PendingTaskChatBinding): string {
  return `${binding.workspaceId}\u0000${binding.agentTypeId}\u0000${binding.sessionId}`
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

function removePending(binding: PendingTaskChatBinding): void {
  const key = bindingKey(binding)
  writePending(readPending().filter((candidate) => bindingKey(candidate) !== key))
  const listener = listeners.get(key)
  if (listener) window.removeEventListener(WORKSPACE_CHAT_PROMPT_ACCEPTED_EVENT, listener)
  listeners.delete(key)
  const timer = retryTimers.get(key)
  if (timer) clearTimeout(timer)
  retryTimers.delete(key)
  bindingAttempts.delete(key)
}

async function bind(binding: PendingTaskChatBinding, client: Pick<WorkspacePluginClient, "postJson">, attempt = 0): Promise<void> {
  const key = bindingKey(binding)
  if (bindingAttempts.has(key)) return
  bindingAttempts.add(key)
  try {
    const receipt = await client.postJson<{ links?: unknown }>("/api/boring-tasks/sessions/link", {
      adapterId: binding.adapterId,
      taskId: binding.taskId,
      agentTypeId: binding.agentTypeId,
      sessionId: binding.sessionId,
    })
    emitTaskSessionLinkReceipt({ workspaceId: binding.workspaceId, adapterId: binding.adapterId, taskId: binding.taskId, links: receipt.links })
    removePending(binding)
    emitWorkspaceTaskProvenanceChanged()
  } catch (error) {
    bindingAttempts.delete(key)
    const delay = Math.min(1_000 * 2 ** attempt, 30_000)
    retryTimers.set(key, setTimeout(() => { void bind(binding, client, attempt + 1) }, delay))
    if (attempt === 0) console.error("Failed to bind submitted task chat; retrying", error)
  }
}

function watch(binding: PendingTaskChatBinding, client: Pick<WorkspacePluginClient, "postJson">): void {
  const key = bindingKey(binding)
  if (listeners.has(key)) return
  const listener: EventListener = (event) => {
    const detail = (event as CustomEvent<WorkspaceChatPromptAcceptedDetail>).detail
    if (detail?.agentTypeId !== binding.agentTypeId || detail.sessionId !== binding.sessionId) return
    const registered = listeners.get(key)
    if (registered) window.removeEventListener(WORKSPACE_CHAT_PROMPT_ACCEPTED_EVENT, registered)
    listeners.delete(key)
    void bind(binding, client)
  }
  listeners.set(key, listener)
  window.addEventListener(WORKSPACE_CHAT_PROMPT_ACCEPTED_EVENT, listener)
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
      if ((snapshot.summary?.turnCount ?? 0) > 0) void bind(binding, client)
    }).catch(() => undefined)
  }
}
