import type { ToolReadinessRequirement } from '../../shared/tool'

export type ReadyState = 'provisioning' | 'ready' | 'degraded'
export type CapabilityState = 'not-started' | 'preparing' | 'ready' | 'failed'

export interface CapabilityReadinessDetail {
  state: CapabilityState
  requirement?: ToolReadinessRequirement
  startedAt?: string
  completedAt?: string
  errorCode?: string
  causeCode?: string
  retryable?: boolean
  message?: string
}

export interface AgentCapabilityReadiness {
  chat: CapabilityReadinessDetail
  workspace: CapabilityReadinessDetail
  runtimeDependencies: CapabilityReadinessDetail
}

export interface ReadyStatusEvent {
  state: ReadyState
  sandboxReady: boolean
  harnessReady: boolean
  capabilities: AgentCapabilityReadiness
  message?: string
  timestamp: string
}

export interface ReadinessSnapshot {
  sandboxReady: boolean
  harnessReady: boolean
  capabilities: AgentCapabilityReadiness
  degradedReason?: string
}

type StatusHandler = (event: ReadyStatusEvent) => void

function defaultCapabilities(sandboxReady: boolean, harnessReady: boolean): AgentCapabilityReadiness {
  return {
    chat: { state: harnessReady ? 'ready' : 'preparing' },
    workspace: { state: sandboxReady ? 'ready' : 'preparing' },
    runtimeDependencies: { state: 'ready' },
  }
}

export class ReadyStatusTracker {
  private _sandboxReady: boolean
  private _harnessReady: boolean
  private _degradedReason?: string
  private _capabilities: AgentCapabilityReadiness
  private subscribers = new Set<StatusHandler>()

  constructor(opts?: {
    sandboxReady?: boolean
    harnessReady?: boolean
    capabilities?: Partial<AgentCapabilityReadiness>
  }) {
    this._sandboxReady = opts?.sandboxReady ?? false
    this._harnessReady = opts?.harnessReady ?? false
    this._capabilities = {
      ...defaultCapabilities(this._sandboxReady, this._harnessReady),
      ...(opts?.capabilities ?? {}),
    }
  }

  get state(): ReadyState {
    if (this._degradedReason) return 'degraded'
    return this._sandboxReady && this._harnessReady ? 'ready' : 'provisioning'
  }

  isReady(): boolean {
    return this.state === 'ready'
  }

  getReadiness(): ReadinessSnapshot {
    return {
      sandboxReady: this._sandboxReady,
      harnessReady: this._harnessReady,
      capabilities: this.getCapabilities(),
      degradedReason: this._degradedReason,
    }
  }

  getCapabilities(): AgentCapabilityReadiness {
    return {
      chat: { ...this._capabilities.chat },
      workspace: { ...this._capabilities.workspace },
      runtimeDependencies: { ...this._capabilities.runtimeDependencies },
    }
  }

  updateCapability(
    name: keyof AgentCapabilityReadiness,
    detail: CapabilityReadinessDetail,
  ): void {
    this._capabilities = {
      ...this._capabilities,
      [name]: { ...detail },
    }
    this.emit()
  }

  updateRuntimeDependencies(detail: CapabilityReadinessDetail): void {
    this.updateCapability('runtimeDependencies', detail)
  }

  markSandboxReady(): void {
    if (this._sandboxReady) return
    this._sandboxReady = true
    if (this._capabilities.workspace.state === 'preparing') {
      this._capabilities.workspace = { state: 'ready' }
    }
    this.emit()
  }

  markHarnessReady(): void {
    if (this._harnessReady) return
    this._harnessReady = true
    if (this._capabilities.chat.state === 'preparing') {
      this._capabilities.chat = { state: 'ready' }
    }
    this.emit()
  }

  markDegraded(reason: string): void {
    this._degradedReason = reason
    this.emit()
  }

  clearDegraded(): void {
    if (!this._degradedReason) return
    this._degradedReason = undefined
    this.emit()
  }

  subscribe(handler: StatusHandler): () => void {
    this.subscribers.add(handler)
    handler(this.snapshot())
    return () => { this.subscribers.delete(handler) }
  }

  private emit(): void {
    const event = this.snapshot()
    for (const h of this.subscribers) h(event)
  }

  private snapshot(): ReadyStatusEvent {
    return {
      state: this.state,
      sandboxReady: this._sandboxReady,
      harnessReady: this._harnessReady,
      capabilities: this.getCapabilities(),
      message: this._degradedReason,
      timestamp: new Date().toISOString(),
    }
  }
}
