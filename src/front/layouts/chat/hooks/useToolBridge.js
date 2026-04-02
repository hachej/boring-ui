import { useEffect, useRef } from 'react'
import {
  PI_LIST_TABS_BRIDGE,
  PI_OPEN_FILE_BRIDGE,
  PI_OPEN_PANEL_BRIDGE,
} from '../../../shared/providers/pi/uiBridge'
import { bridgeToolResultToArtifact, bridgeOpenPanelToArtifact } from '../utils/toolArtifactBridge'

/**
 * Bridge key names on the window object.
 *
 * These replace the older PI_OPEN_FILE_BRIDGE and PI_OPEN_PANEL_BRIDGE
 * constants from `providers/pi/uiBridge.js`. The new shell routes everything
 * through the artifact controller instead of opening Dockview panels directly.
 */
export const SURFACE_OPEN_FILE_BRIDGE = '__SURFACE_OPEN_FILE__'
export const SURFACE_OPEN_PANEL_BRIDGE = '__SURFACE_OPEN_PANEL__'

function getArtifactFilePath(artifact) {
  if (!artifact || typeof artifact !== 'object') return ''
  return String(artifact.params?.path || artifact.canonicalKey || '').trim()
}

/**
 * useToolBridge — Sets up window-level bridge functions that PI agent tools call
 * to open files and panels in the Surface.
 *
 * When a tool calls `window.__SURFACE_OPEN_FILE__(path)`, the bridge creates a
 * SurfaceArtifact via `bridgeToolResultToArtifact` and opens it through the
 * artifact controller. This replaces the old `PI_OPEN_FILE_BRIDGE` that opened
 * files directly in Dockview editor panels.
 *
 * @param {object} options
 * @param {function} options.openArtifact - The artifact controller's `open` function
 * @param {string} [options.activeSessionId] - Current session ID for provenance
 * @param {Map<string, object>} [options.artifacts] - Open workbench artifacts
 * @param {string | null} [options.activeArtifactId] - Active artifact id
 */
export function useToolBridge({
  openArtifact,
  activeSessionId = null,
  artifacts = null,
  activeArtifactId = null,
}) {
  const openArtifactRef = useRef(openArtifact)
  const sessionIdRef = useRef(activeSessionId)
  const artifactsRef = useRef(artifacts)
  const activeArtifactIdRef = useRef(activeArtifactId)

  // Keep refs current without re-registering bridge functions
  useEffect(() => {
    openArtifactRef.current = openArtifact
    sessionIdRef.current = activeSessionId
    artifactsRef.current = artifacts
    activeArtifactIdRef.current = activeArtifactId
  }, [openArtifact, activeSessionId, artifacts, activeArtifactId])

  useEffect(() => {
    /**
     * Open a file as a code artifact in the Surface.
     * Called by the `open_file` tool in defaultTools.js.
     */
    const openFile = (path) => {
      if (!path || typeof path !== 'string') return
      const trimmedPath = path.trim()
      if (!trimmedPath) return

      const { shouldOpen, artifact } = bridgeToolResultToArtifact(
        'open_file',
        { path: trimmedPath },
        {},
        sessionIdRef.current,
      )

      if (shouldOpen && artifact && typeof openArtifactRef.current === 'function') {
        openArtifactRef.current(artifact)
      }
    }

    /**
     * Open an arbitrary panel as an artifact in the Surface.
     * Accepts { type, params } where type maps to an artifact kind.
     */
    const openPanel = (payload) => {
      if (!payload || typeof payload !== 'object') return

      const { shouldOpen, artifact } = bridgeOpenPanelToArtifact(
        payload,
        sessionIdRef.current,
      )

      if (shouldOpen && artifact && typeof openArtifactRef.current === 'function') {
        openArtifactRef.current(artifact)
      }
    }

    /**
     * Report open code artifacts using the legacy PI tab bridge shape.
     */
    const listTabs = () => {
      const artifactsMap = artifactsRef.current
      const activeId = activeArtifactIdRef.current
      const tabs = []
      let activeFile = ''

      if (artifactsMap instanceof Map) {
        artifactsMap.forEach((artifact, artifactId) => {
          const path = getArtifactFilePath(artifact)
          const isCodeArtifact = artifact?.kind === 'code' || artifact?.rendererKey === 'code'
          if (!path || !isCodeArtifact) return
          tabs.push(path)
          if (artifactId === activeId) {
            activeFile = path
          }
        })
      }

      return { tabs, activeFile }
    }

    window[SURFACE_OPEN_FILE_BRIDGE] = openFile
    window[SURFACE_OPEN_PANEL_BRIDGE] = openPanel
    window[PI_OPEN_FILE_BRIDGE] = openFile
    window[PI_OPEN_PANEL_BRIDGE] = openPanel
    window[PI_LIST_TABS_BRIDGE] = listTabs

    return () => {
      if (window[SURFACE_OPEN_FILE_BRIDGE] === openFile) {
        delete window[SURFACE_OPEN_FILE_BRIDGE]
      }
      if (window[SURFACE_OPEN_PANEL_BRIDGE] === openPanel) {
        delete window[SURFACE_OPEN_PANEL_BRIDGE]
      }
      if (window[PI_OPEN_FILE_BRIDGE] === openFile) {
        delete window[PI_OPEN_FILE_BRIDGE]
      }
      if (window[PI_OPEN_PANEL_BRIDGE] === openPanel) {
        delete window[PI_OPEN_PANEL_BRIDGE]
      }
      if (window[PI_LIST_TABS_BRIDGE] === listTabs) {
        delete window[PI_LIST_TABS_BRIDGE]
      }
    }
  }, []) // Empty deps — refs handle value updates
}
