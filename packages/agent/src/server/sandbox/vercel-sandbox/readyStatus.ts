export type ReadyState = 'provisioning' | 'ready' | 'degraded'

export interface ReadyStatusEvent {
  state: ReadyState
  sandboxReady: boolean
  harnessReady: boolean
  message?: string
  timestamp: string
}

export interface ReadinessSnapshot {
  sandboxReady: boolean
  harnessReady: boolean
  degradedReason?: string
}

type StatusHandler = (event: ReadyStatusEvent) => void

export class ReadyStatusTracker {
  private _sandboxReady: boolean
  private _harnessReady: boolean
  private _degradedReason?: string
  private subscribers = new Set<StatusHandler>()

  constructor(opts?: { sandboxReady?: boolean; harnessReady?: boolean }) {
    this._sandboxReady = opts?.sandboxReady ?? false
    this._harnessReady = opts?.harnessReady ?? false
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
      degradedReason: this._degradedReason,
    }
  }

  markSandboxReady(): void {
    if (this._sandboxReady) return
    this._sandboxReady = true
    this.emit()
  }

  markHarnessReady(): void {
    if (this._harnessReady) return
    this._harnessReady = true
    this.emit()
  }

  markDegraded(reason: string): void {
    this._degradedReason = reason
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
      message: this._degradedReason,
      timestamp: new Date().toISOString(),
    }
  }
}
