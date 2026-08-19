"use client"

import { createContext, useContext, type ReactNode } from "react"
import type { FileTreeRootConfig } from "./FileTreePane"

const FileTreeRootsContext = createContext<readonly FileTreeRootConfig[] | undefined>(undefined)

export interface FileTreeRootsProviderProps {
  roots?: readonly FileTreeRootConfig[]
  children: ReactNode
}

/** Supplies optional filesystem root configuration to the built-in Files source. */
export function FileTreeRootsProvider({ roots, children }: FileTreeRootsProviderProps) {
  return (
    <FileTreeRootsContext.Provider value={roots}>
      {children}
    </FileTreeRootsContext.Provider>
  )
}

export function useFileTreeRoots(): readonly FileTreeRootConfig[] | undefined {
  return useContext(FileTreeRootsContext)
}
