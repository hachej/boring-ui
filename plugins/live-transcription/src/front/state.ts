import type { LiveTranscriptState } from "../shared"

export interface BrowserLiveTranscriptState {
  liveSessionId?: string
  transcriptPath?: string
  state?: LiveTranscriptState
  recordingKind?: "short" | "live"
  phase?: "idle" | "starting" | "recording" | "transcribing" | "error"
  startedAt?: number
  error?: string
}

let snapshot: BrowserLiveTranscriptState = {}
const listeners = new Set<() => void>()

export const liveTranscriptBrowserState = {
  getSnapshot: () => snapshot,
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  set(next: BrowserLiveTranscriptState): void {
    snapshot = next
    for (const listener of [...listeners]) listener()
  },
  clear(id?: string): void {
    if (id && snapshot.liveSessionId !== id) return
    this.set({})
  },
}
