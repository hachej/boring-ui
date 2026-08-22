"use client"

import { createPortal } from "react-dom"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { IconButton, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@hachej/boring-ui-kit"
import { RefreshCwIcon, UploadIcon } from "lucide-react"
import type { FileTreeBridge } from "../../../../front/bridge/types"
import { cn } from "../../../../front/lib/utils"
import type { FilesystemCatalogCapabilities } from "../data/types"
import type { FilesystemId } from "../../../../shared/types/filesystem"
import type { PaneProps } from "../../../../shared/types/panel"
import type { FileTreeRevealRequest, LeftTabParams } from "../../../../shared/plugins/types"
import { FileTreeView, type FileTreeViewHandle } from "./FileTreeView"

export interface FileTreeRootConfig {
  filesystem: FilesystemId
  label: string
  rootDir?: string
  access?: "readonly" | "readwrite"
  capabilities?: FilesystemCatalogCapabilities
}

export interface FileTreePaneParams extends LeftTabParams {
  rootDir?: string
  searchQuery?: string
  query?: string
  bridge?: unknown
  filesystem?: FilesystemId
  access?: "readonly" | "readwrite"
  roots?: FileTreeRootConfig[]
  revealFileTreeRequest?: FileTreeRevealRequest | null
}

export interface FileTreePaneProps extends Partial<PaneProps<FileTreePaneParams>> {
  rootDir?: string
  searchQuery?: string
  bridge?: FileTreeBridge
  filesystem?: FilesystemId
  access?: "readonly" | "readwrite"
  roots?: FileTreeRootConfig[]
  className?: string
}

/**
 * Default Files panel. Search is owned by the shell's unified catalog;
 * `searchQuery` remains available for controlled embedding and tests.
 */
export function FileTreePane({
  params,
  rootDir = ".",
  searchQuery: controlledSearchQuery,
  bridge,
  filesystem = "user",
  access = "readwrite",
  roots,
  className,
}: FileTreePaneProps) {
  const effectiveRootDir = params?.rootDir ?? rootDir
  const effectiveBridge = (params?.bridge as FileTreeBridge | undefined) ?? bridge
  const effectiveFilesystem = params?.filesystem ?? filesystem
  const effectiveAccess = params?.access ?? access
  const effectiveRoots = params?.roots ?? roots
  const authoritativeRevealRequest = params?.revealFileTreeRequest ?? null
  const [bridgeRevealRequest, setBridgeRevealRequest] = useState<FileTreeRevealRequest | null>(null)
  const bridgeRevealSeqRef = useRef(0)
  useEffect(() => {
    if (authoritativeRevealRequest) setBridgeRevealRequest(null)
  }, [authoritativeRevealRequest])
  const effectiveRevealRequest = authoritativeRevealRequest ?? bridgeRevealRequest
  const externalSearchQuery =
    params?.searchQuery ?? params?.query ?? controlledSearchQuery
  const rootOptions = useMemo<FileTreeRootConfig[]>(() => {
    if (effectiveRoots?.length) return effectiveRoots
    return [{
      filesystem: effectiveFilesystem,
      label: effectiveFilesystem === "user" ? "Workspace" : effectiveFilesystem,
      rootDir: effectiveFilesystem === "user" ? effectiveRootDir : "/",
      access: effectiveAccess,
      capabilities: {
        read: true,
        list: true,
        search: true,
        write: effectiveAccess !== "readonly",
        upload: effectiveAccess !== "readonly",
        delete: effectiveAccess !== "readonly",
        move: effectiveAccess !== "readonly",
        mkdir: effectiveAccess !== "readonly",
      },
    }]
  }, [effectiveAccess, effectiveFilesystem, effectiveRootDir, effectiveRoots])
  const [selectedFilesystem, setSelectedFilesystem] = useState<FilesystemId>(() => (
    rootOptions.some((root) => root.filesystem === effectiveFilesystem)
      ? effectiveFilesystem
      : rootOptions[0]?.filesystem ?? "user"
  ))
  useEffect(() => {
    setSelectedFilesystem((current) => {
      if (rootOptions.some((root) => root.filesystem === current)) return current
      return rootOptions.some((root) => root.filesystem === effectiveFilesystem)
        ? effectiveFilesystem
        : rootOptions[0]?.filesystem ?? "user"
    })
  }, [effectiveFilesystem, rootOptions])
  const handledRevealRequestRef = useRef<string | null>(null)
  useEffect(() => {
    const requestedFilesystem = effectiveRevealRequest?.filesystem
    if (!requestedFilesystem) return
    const requestKey = `${effectiveRevealRequest.seq}:${requestedFilesystem}:${effectiveRevealRequest.path}`
    if (handledRevealRequestRef.current === requestKey) return
    if (!rootOptions.some((root) => root.filesystem === requestedFilesystem)) return
    handledRevealRequestRef.current = requestKey
    setSelectedFilesystem(requestedFilesystem)
  }, [effectiveRevealRequest, rootOptions])
  const handledActiveResourceRef = useRef<string | null>(null)
  useEffect(() => {
    const activeResource = effectiveBridge?.getActiveFileResource?.()
    if (!activeResource) return
    const resourceKey = `${activeResource.filesystem}:${activeResource.path}`
    if (handledActiveResourceRef.current === resourceKey) return
    if (!rootOptions.some((root) => root.filesystem === activeResource.filesystem)) return
    handledActiveResourceRef.current = resourceKey
    setSelectedFilesystem(activeResource.filesystem)
  }, [effectiveBridge, rootOptions])
  useEffect(() => {
    if (!effectiveBridge?.subscribe) return
    const selectConfiguredFilesystem = (nextFilesystem: FilesystemId | undefined) => {
      if (nextFilesystem && rootOptions.some((root) => root.filesystem === nextFilesystem)) {
        setSelectedFilesystem(nextFilesystem)
      }
    }
    const unsubscribeOpened = effectiveBridge.subscribe("file:opened", ({ filesystem: openedFilesystem }) => {
      selectConfiguredFilesystem(openedFilesystem)
    })
    const unsubscribeExpanded = effectiveBridge.subscribe("tree:expand", ({ path, filesystem: revealedFilesystem }) => {
      selectConfiguredFilesystem(revealedFilesystem)
      // SurfaceShell sends an authoritative prop request alongside its bridge
      // event. The pane owns root synchronization, but must not retain a second
      // reveal. Bridge-only callers get a temporary one-shot prop instead.
      if (authoritativeRevealRequest) return
      setBridgeRevealRequest({
        path,
        ...(revealedFilesystem ? { filesystem: revealedFilesystem } : {}),
        seq: ++bridgeRevealSeqRef.current,
      })
    })
    return () => {
      unsubscribeOpened()
      unsubscribeExpanded()
    }
  }, [authoritativeRevealRequest, effectiveBridge, rootOptions])
  const activeRoot = rootOptions.find((root) => root.filesystem === selectedFilesystem) ?? rootOptions[0]
  const activeFilesystem = activeRoot?.filesystem ?? "user"
  const activeRootDir = activeRoot?.rootDir ?? (activeFilesystem === "user" ? effectiveRootDir : "/")
  const activeAccess = activeRoot?.access ?? effectiveAccess
  const activeCapabilities = activeRoot?.capabilities
  const activeRevealRequest = !effectiveRevealRequest?.filesystem || effectiveRevealRequest.filesystem === activeFilesystem
    ? effectiveRevealRequest
    : null
  const handleRevealRequestHandled = useCallback((request: FileTreeRevealRequest) => {
    setBridgeRevealRequest((current) => current?.seq === request.seq ? null : current)
  }, [])

  // `FileTreeView` remounts (via the `key` below) whenever the active root
  // changes, so this ref always targets whichever root is currently
  // selected in the dropdown — the refresh button never needs to know
  // which root it's pointed at.
  const treeRef = useRef<FileTreeViewHandle>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true)
    try {
      await treeRef.current?.refetch()
    } finally {
      setIsRefreshing(false)
    }
  }, [])
  const refreshButton = (
    <IconButton
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label="Refresh files"
      disabled={isRefreshing}
      onClick={() => void handleRefresh()}
      className="shrink-0 text-muted-foreground hover:text-foreground"
    >
      <RefreshCwIcon className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} strokeWidth={2} />
    </IconButton>
  )
  const canUploadActiveRoot = activeFilesystem === "user"
    && activeAccess !== "readonly"
    && activeCapabilities?.upload === true
  const uploadButton = canUploadActiveRoot ? (
    <IconButton
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label="Upload files"
      onClick={() => treeRef.current?.openUpload()}
      className="shrink-0 text-muted-foreground hover:text-foreground"
    >
      <UploadIcon className="h-3.5 w-3.5" strokeWidth={2} />
    </IconButton>
  ) : null
  const fileActions = (
    <div className="flex items-center gap-0.5">
      {uploadButton}
      {refreshButton}
    </div>
  )

  const effectiveSearchQuery = externalSearchQuery || undefined

  // Single-root hosts put refresh in the shell's existing header
    // action slot when one is available, avoiding a toolbar row whose only
    // content is one icon. Standalone hosts without that slot retain the local
    // fallback. Multi-root hosts keep refresh beside the root selector so the
    // action's active-filesystem scope remains visually explicit. The shell's
    // search box continues to drive `effectiveSearchQuery` for either shape.
    if (rootOptions.length <= 1) {
      const chromeActionsElement = params?.chromeActionsElement
      return (
        <div className="flex h-full min-h-0 flex-col">
          {chromeActionsElement
            ? createPortal(fileActions, chromeActionsElement)
            : (
                <div className="flex shrink-0 items-center justify-end px-1 pt-1">
                  {fileActions}
                </div>
              )}
          <div className="min-h-0 flex-1">
            <FileTreeView
              ref={treeRef}
              key={`${activeFilesystem}:${activeRootDir}`}
              rootDir={activeRootDir}
              searchQuery={effectiveSearchQuery}
              bridge={effectiveBridge}
              subscribeToTreeExpand={false}
              filesystem={activeFilesystem}
              access={activeAccess}
              capabilities={activeCapabilities}
              revealFileTreeRequest={activeRevealRequest}
              onRevealRequestHandled={handleRevealRequestHandled}
              className={cn("px-1 [&_[role=treeitem]]:!indent-0", className)}
            />
          </div>
        </div>
      )
    }
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center gap-1 px-1 pt-1">
          <Select
            value={activeFilesystem}
            onValueChange={(value) => setSelectedFilesystem(value as FilesystemId)}
          >
            <SelectTrigger
              size="sm"
              className="h-7 w-full text-xs"
              aria-label="File root"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {rootOptions.map((root) => (
                <SelectItem key={root.filesystem} value={root.filesystem} className="text-xs">
                  {root.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {fileActions}
        </div>
        <div className="min-h-0 flex-1">
          <FileTreeView
            ref={treeRef}
            key={`${activeFilesystem}:${activeRootDir}`}
            rootDir={activeRootDir}
            searchQuery={effectiveSearchQuery}
            bridge={effectiveBridge}
            subscribeToTreeExpand={false}
            filesystem={activeFilesystem}
            access={activeAccess}
            capabilities={activeCapabilities}
            revealFileTreeRequest={activeRevealRequest}
            onRevealRequestHandled={handleRevealRequestHandled}
            className={cn("px-1 pt-1 [&_[role=treeitem]]:!indent-0", className)}
          />
        </div>
      </div>
    )
}
