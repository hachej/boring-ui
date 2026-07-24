"use client"

import { createContext, useContext, type ReactNode } from "react"

export interface ComposerRecordingSnapshot {
  kind?: "short" | "live"
  phase: "idle" | "starting" | "recording" | "transcribing" | "error"
  startedAt?: number
  error?: string
}

export interface ComposerRecordingAdapter {
  getSnapshot(): ComposerRecordingSnapshot
  subscribe(listener: () => void): () => void
  startShort(): Promise<void>
  stopShort(): Promise<string | undefined>
  stopLive(): Promise<void>
}

const ComposerRecordingContext = createContext<ComposerRecordingAdapter | null>(null)

export function ComposerRecordingProvider({ adapter, children }: { adapter: ComposerRecordingAdapter; children: ReactNode }) {
  return <ComposerRecordingContext.Provider value={adapter}>{children}</ComposerRecordingContext.Provider>
}

export function useComposerRecordingAdapter(): ComposerRecordingAdapter | null {
  return useContext(ComposerRecordingContext)
}
