"use client"

import { createContext, useContext, type ComponentType, type ReactNode } from "react"

export interface ComposerRecordingSnapshot {
  kind?: "short" | "live"
  phase: "idle" | "starting" | "recording" | "transcribing" | "error"
  startedAt?: number
  error?: string
}

export function shouldShowRecordingAccessory(snapshot: ComposerRecordingSnapshot, hasAccessory: boolean): boolean {
  return hasAccessory
    && snapshot.kind === "live"
    && (snapshot.phase === "starting" || snapshot.phase === "recording" || snapshot.phase === "transcribing")
}

export function appendTranscriptToDraft(draft: string, transcript: string): string {
  const separator = draft.length > 0 && !/\s$/u.test(draft) ? " " : ""
  return `${draft}${separator}${transcript}`
}

export interface ComposerRecordingAdapter {
  getSnapshot(): ComposerRecordingSnapshot
  subscribe(listener: () => void): () => void
  startShort(): Promise<void>
  stopShort(): Promise<string | undefined>
  stopLive(): Promise<void>
  RecordingAccessory?: ComponentType
}

const ComposerRecordingContext = createContext<ComposerRecordingAdapter | null>(null)

export function ComposerRecordingProvider({ adapter, children }: { adapter: ComposerRecordingAdapter; children: ReactNode }) {
  return <ComposerRecordingContext.Provider value={adapter}>{children}</ComposerRecordingContext.Provider>
}

export function useComposerRecordingAdapter(): ComposerRecordingAdapter | null {
  return useContext(ComposerRecordingContext)
}
