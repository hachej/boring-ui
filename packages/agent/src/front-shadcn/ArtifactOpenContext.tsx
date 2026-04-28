"use client"

/**
 * Context that lets ChatPanel host apps (e.g. @boring/workspace) wire a
 * "open this file in my workbench" callback into the canonical agent
 * tool renderers. The renderers (read / write / edit) consume the
 * context to render the file path as a clickable button — without it,
 * the path is just text.
 *
 * Lives next to the renderers so we don't fork a "workspace-aware"
 * renderer set for every host. One renderer source, one optional
 * callback. Hosts that don't need the click behavior just don't
 * provide a value.
 */

import { createContext, useContext, type ReactNode } from "react"

export type OpenArtifactHandler = (path: string) => void

const ArtifactOpenContext = createContext<OpenArtifactHandler | null>(null)

export interface ArtifactOpenProviderProps {
  onOpenArtifact?: OpenArtifactHandler
  children: ReactNode
}

export function ArtifactOpenProvider({ onOpenArtifact, children }: ArtifactOpenProviderProps) {
  return (
    <ArtifactOpenContext.Provider value={onOpenArtifact ?? null}>
      {children}
    </ArtifactOpenContext.Provider>
  )
}

export function useOpenArtifact(): OpenArtifactHandler | null {
  return useContext(ArtifactOpenContext)
}
