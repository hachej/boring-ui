/**
 * UI State service — in-memory storage for workspace panel layout/state.
 * Mirrors Python's modules/ui_state/service.py.
 *
 * In-memory only (same as Python). Data lost on restart.
 */
import { randomUUID } from 'node:crypto'

export interface UiStateSnapshot extends Record<string, unknown> {
  client_id: string
  active_panel_id?: string | null
  open_panels: Record<string, unknown>[]
  project_root?: string | null
  meta?: Record<string, unknown>
  captured_at_ms?: number | null
  updated_at?: string
}

export interface UiCommandPayload extends Record<string, unknown> {
  kind: string
  panel_id?: string
  component?: string
  title?: string
  params?: Record<string, unknown>
  prefer_existing?: boolean
  meta?: Record<string, unknown>
}

export interface UiQueuedCommand {
  id: string
  client_id: string
  command: UiCommandPayload
  queued_at: string
}

interface UiWorkspaceStore {
  states: Map<string, UiStateSnapshot>
  commands: Map<string, UiQueuedCommand[]>
}

const stores = new Map<string, UiWorkspaceStore>()

function nowIso(): string {
  return new Date().toISOString()
}

function normalizeClientId(value: unknown): string {
  return String(value || '').trim()
}

function getWorkspaceStore(workspaceKey: string): UiWorkspaceStore {
  let store = stores.get(workspaceKey)
  if (!store) {
    store = {
      states: new Map(),
      commands: new Map(),
    }
    stores.set(workspaceKey, store)
  }
  return store
}

export function upsertState(workspaceKey: string, snapshot: UiStateSnapshot): UiStateSnapshot {
  const clientId = normalizeClientId(snapshot.client_id)
  if (!clientId) {
    throw new Error('client_id is required')
  }

  const stored: UiStateSnapshot = {
    ...snapshot,
    client_id: clientId,
    updated_at: nowIso(),
  }

  const store = getWorkspaceStore(workspaceKey)
  store.states.set(clientId, stored)
  return stored
}

export function resolveClientId(workspaceKey: string, clientId?: string | null): string | null {
  const normalized = normalizeClientId(clientId)
  const store = getWorkspaceStore(workspaceKey)
  if (normalized) {
    return store.states.has(normalized) ? normalized : null
  }
  if (store.states.size === 0) return null

  let latest: UiStateSnapshot | null = null
  for (const state of store.states.values()) {
    if (!latest || String(state.updated_at || '') > String(latest.updated_at || '')) {
      latest = state
    }
  }
  return latest?.client_id || null
}

export function getState(workspaceKey: string, clientId: string): UiStateSnapshot | null {
  return getWorkspaceStore(workspaceKey).states.get(normalizeClientId(clientId)) ?? null
}

export function getLatestState(workspaceKey: string): UiStateSnapshot | null {
  const clientId = resolveClientId(workspaceKey)
  if (!clientId) return null
  return getState(workspaceKey, clientId)
}

export function listStates(workspaceKey: string): UiStateSnapshot[] {
  return Array.from(getWorkspaceStore(workspaceKey).states.values())
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
}

export function deleteState(workspaceKey: string, clientId: string): boolean {
  const normalized = normalizeClientId(clientId)
  if (!normalized) return false
  const store = getWorkspaceStore(workspaceKey)
  store.commands.delete(normalized)
  return store.states.delete(normalized)
}

export function clearStates(workspaceKey: string): number {
  const count = getWorkspaceStore(workspaceKey).states.size
  stores.delete(workspaceKey)
  return count
}

export function listOpenPanels(
  workspaceKey: string,
  clientId?: string | null,
): {
  client_id: string
  active_panel_id: string | null
  open_panels: Record<string, unknown>[]
  count: number
  updated_at?: string
  active_panel: string | null
  panes: Record<string, unknown>[]
} | null {
  const resolved = resolveClientId(workspaceKey, clientId)
  if (!resolved) return null
  const state = getState(workspaceKey, resolved)
  if (!state) return null
  const panels = Array.isArray(state.open_panels) ? state.open_panels : []
  const activePanelId = typeof state.active_panel_id === 'string' ? state.active_panel_id : null
  return {
    client_id: resolved,
    active_panel_id: activePanelId,
    open_panels: panels,
    count: panels.length,
    updated_at: state.updated_at,
    active_panel: activePanelId,
    panes: panels,
  }
}

export function enqueueCommand(
  workspaceKey: string,
  command: UiCommandPayload,
  clientId?: string | null,
): UiQueuedCommand | null {
  const resolved = resolveClientId(workspaceKey, clientId)
  if (!resolved) return null

  const queued: UiQueuedCommand = {
    id: `cmd-${randomUUID()}`,
    client_id: resolved,
    command,
    queued_at: nowIso(),
  }

  const store = getWorkspaceStore(workspaceKey)
  const queue = store.commands.get(resolved) ?? []
  queue.push(queued)
  store.commands.set(resolved, queue)
  return queued
}

export function popNextCommand(workspaceKey: string, clientId: string): UiQueuedCommand | null {
  const normalized = normalizeClientId(clientId)
  if (!normalized) return null

  const store = getWorkspaceStore(workspaceKey)
  const queue = store.commands.get(normalized)
  if (!queue || queue.length === 0) return null

  const next = queue.shift() ?? null
  if (queue.length === 0) {
    store.commands.delete(normalized)
  } else {
    store.commands.set(normalized, queue)
  }
  return next
}

// Legacy aliases retained while the rest of the TS stack converges on the
// Python-compatible naming surface.
export const saveState = upsertState
export const pollNextCommand = popNextCommand
export const getPanes = (
  workspaceKey: string,
  clientId?: string | null,
): Record<string, unknown>[] => listOpenPanels(workspaceKey, clientId)?.open_panels ?? []
