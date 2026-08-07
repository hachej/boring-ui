import { randomUUID } from "node:crypto"
import { LiveTranscriptError } from "./errors"

export type CaptureKind = "live" | "composer"
export type PreparationStatus =
  | { preparationId: string; state: "warming" }
  | { preparationId: string; state: "ready" }
  | { preparationId: string; state: "failed"; error: string }

export interface Lease { id: string }
export interface LifecycleClient {
  acquire(requestId: string): Promise<Lease>
  heartbeat(id: string): Promise<void>
  release(id: string): Promise<void>
}
interface Preparation {
  id: string
  kind: CaptureKind
  state: "warming" | "ready" | "failed"
  lease?: Lease
  error?: string
  expiry?: ReturnType<typeof setTimeout>
}

export class ComputeLifecycleClient implements LifecycleClient {
  constructor(private readonly baseUrl: string, private readonly token: string) {}

  async acquire(requestId: string): Promise<Lease> {
    return await this.post<Lease>("/leases/acquire", { requestId }, 12 * 60_000)
  }
  async heartbeat(id: string): Promise<void> { await this.post("/leases/heartbeat", { leaseId: id }, 15_000) }
  async release(id: string): Promise<void> { await this.post("/leases/release", { leaseId: id }, 60_000) }

  private async post<T = unknown>(path: string, body: unknown, timeoutMs: number): Promise<T> {
    let response: Response
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch {
      throw new LiveTranscriptError("live_transcript_upstream_failed", "Transcription GPU lifecycle service is unavailable.", 503)
    }
    if (!response.ok) throw new LiveTranscriptError("live_transcript_upstream_failed", "Transcription GPU could not become ready.", 503)
    return await response.json() as T
  }
}

/** Coordinates browser warming preparations with one active capture lease. */
export class ComputeLifecycleCoordinator {
  private readonly preparations = new Map<string, Preparation>()
  private active: Lease | undefined
  private activeChecker: (() => boolean) | undefined
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined
  private monitorTimer: ReturnType<typeof setInterval> | undefined

  constructor(private readonly client?: LifecycleClient) {}

  setActiveChecker(checker: () => boolean): void { this.activeChecker = checker }
  get enabled(): boolean { return Boolean(this.client) }

  prepare(kind: CaptureKind): PreparationStatus {
    if (!this.client) return { preparationId: "disabled", state: "ready" }
    const preparation: Preparation = { id: randomUUID(), kind, state: "warming" }
    preparation.expiry = setTimeout(() => { void this.cancel(preparation.id) }, 15 * 60_000)
    this.preparations.set(preparation.id, preparation)
    void this.client.acquire(preparation.id).then((lease) => {
      if (!this.preparations.has(preparation.id)) return void this.client?.release(lease.id).catch(() => undefined)
      preparation.lease = lease
      preparation.state = "ready"
      if (preparation.expiry) clearTimeout(preparation.expiry)
      preparation.expiry = setTimeout(() => { void this.cancel(preparation.id) }, 2 * 60_000)
    }).catch((error) => {
      preparation.state = "failed"
      preparation.error = error instanceof Error ? error.message : "Transcription GPU failed to start."
      if (preparation.expiry) clearTimeout(preparation.expiry)
      preparation.expiry = setTimeout(() => { this.preparations.delete(preparation.id) }, 2 * 60_000)
    })
    return this.publicStatus(preparation)
  }

  status(id: string): PreparationStatus {
    if (!this.client && id === "disabled") return { preparationId: id, state: "ready" }
    const preparation = this.preparations.get(id)
    if (!preparation) throw new LiveTranscriptError("live_transcript_not_active", "GPU preparation was not found.", 404)
    return this.publicStatus(preparation)
  }

  take(id: string, kind: CaptureKind): Lease | undefined {
    if (!this.client && id === "disabled") return undefined
    const preparation = this.preparations.get(id)
    if (!preparation || preparation.kind !== kind || preparation.state !== "ready" || !preparation.lease) {
      throw new LiveTranscriptError("live_transcript_upstream_failed", "Transcription GPU is not ready.", 409)
    }
    this.preparations.delete(id)
    if (preparation.expiry) clearTimeout(preparation.expiry)
    return preparation.lease
  }

  adopt(lease: Lease | undefined): void {
    if (!lease || !this.client) return
    if (this.active) throw new LiveTranscriptError("live_transcript_already_active", "Transcription compute is already leased.", 409)
    this.active = lease
    this.heartbeatTimer = setInterval(() => { void this.client?.heartbeat(lease.id).catch(() => undefined) }, 30_000)
    this.monitorTimer = setInterval(() => {
      if (!this.activeChecker?.()) void this.releaseActive()
    }, 2_000)
  }

  async release(lease: Lease | undefined): Promise<void> {
    if (lease) await this.client?.release(lease.id).catch(() => undefined)
  }

  async cancel(id: string): Promise<void> {
    const preparation = this.preparations.get(id)
    if (!preparation) return
    this.preparations.delete(id)
    if (preparation.expiry) clearTimeout(preparation.expiry)
    if (preparation.lease) await this.client?.release(preparation.lease.id).catch(() => undefined)
  }

  async close(): Promise<void> {
    await Promise.all([...this.preparations.keys()].map(async (id) => this.cancel(id)))
    await this.releaseActive()
  }

  private async releaseActive(): Promise<void> {
    const lease = this.active
    if (!lease) return
    this.active = undefined
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    if (this.monitorTimer) clearInterval(this.monitorTimer)
    this.heartbeatTimer = undefined
    this.monitorTimer = undefined
    await this.client?.release(lease.id).catch(() => undefined)
  }

  private publicStatus(preparation: Preparation): PreparationStatus {
    if (preparation.state === "failed") return { preparationId: preparation.id, state: "failed", error: preparation.error ?? "Transcription GPU failed to start." }
    return { preparationId: preparation.id, state: preparation.state }
  }
}

export function validateLifecycleUrl(raw: string): string {
  let url: URL
  try { url = new URL(raw) } catch { throw new LiveTranscriptError("live_transcript_local_only", "Lifecycle URL is invalid.", 500) }
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/v1" || url.search || url.username || url.password) {
    throw new LiveTranscriptError("live_transcript_local_only", "Lifecycle service must use the exact loopback /v1 authority.", 500)
  }
  return url.toString().replace(/\/$/, "")
}
