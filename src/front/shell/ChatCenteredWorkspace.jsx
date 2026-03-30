import React, { useState, useCallback } from 'react'
import ChatStage from './ChatStage'
import NavRail from './NavRail'
import BrowseDrawer from './BrowseDrawer'
import SurfaceShell from './SurfaceShell'
import { useSessionState } from './useSessionState'
import { useArtifactController } from './useArtifactController'
import { ChatMetricsProvider } from './useChatMetrics'
import { useReducedMotion } from './useReducedMotion'
import './shell.css'

/**
 * ChatCenteredWorkspace - The new shell entry point for the chat-centered layout.
 *
 * Replaces the Dockview tree when the `chatCenteredShell` feature flag is on.
 * This is a pure React layout: nav rail + browse drawer + chat stage + surface.
 *
 * Layout structure (CSS grid/flex, NO Dockview):
 *
 *  +--------+--------------+------------------+
 *  |NavRail | BrowseDrawer |                  |
 *  | 48px   | (optional)   |   ChatStage      |
 *  |        |              |   (center)       |
 *  |        |              |                  |
 *  +--------+--------------+------------------+
 *                           +------------------+
 *                           | SurfaceShell     |
 *                           | (hidden default) |
 *                           +------------------+
 */
export default function ChatCenteredWorkspace() {
  const reducedMotion = useReducedMotion()
  const {
    activeSessionId,
    sessions,
    switchSession,
    createNewSession,
  } = useSessionState()

  const {
    surfaceOpen,
    activeArtifactId,
    artifacts,
    orderedIds,
    open: openArtifact,
    focus: focusArtifact,
    close: closeArtifact,
  } = useArtifactController()

  // Nav rail + browse drawer state
  const [activeDestination, setActiveDestination] = useState(null)
  const [surfaceCollapsed, setSurfaceCollapsed] = useState(false)
  const [surfaceWidth, setSurfaceWidth] = useState(620)

  // Chat state (will be wired to useChat / transport in later phases)
  const [chatMessages] = useState([])
  const [chatInput, setChatInput] = useState('')
  const [chatStatus] = useState('ready')

  const handleDestinationChange = useCallback((destination) => {
    setActiveDestination(destination)
  }, [])

  const handleNewChat = useCallback(() => {
    createNewSession()
    setActiveDestination(null)
  }, [createNewSession])

  const handleSwitchSession = useCallback((sessionId) => {
    switchSession(sessionId)
  }, [switchSession])

  const handleSurfaceClose = useCallback(() => {
    setSurfaceCollapsed(true)
  }, [])

  const handleSurfaceCollapse = useCallback(() => {
    setSurfaceCollapsed((prev) => !prev)
  }, [])

  const handleSurfaceResize = useCallback((width) => {
    setSurfaceWidth(width)
  }, [])

  const drawerOpen = activeDestination !== null
  const drawerMode = activeDestination === 'workspace' ? 'workspace' : 'sessions'

  // Build artifacts list from Map for Surface
  const artifactsList = orderedIds.map((id) => artifacts.get(id)).filter(Boolean)

  return (
    <ChatMetricsProvider>
      <div
        className={[
          'chat-centered-workspace',
          reducedMotion && 'reduced-motion',
        ].filter(Boolean).join(' ')}
        data-testid="chat-centered-workspace"
      >
        <NavRail
          activeDestination={activeDestination}
          onDestinationChange={handleDestinationChange}
          onNewChat={handleNewChat}
        />

        <BrowseDrawer
          open={drawerOpen}
          mode={drawerMode}
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSwitchSession={handleSwitchSession}
          onClose={() => setActiveDestination(null)}
        />

        <main className="ccw-stage-area" role="main">
          <ChatStage
            messages={chatMessages}
            input={chatInput}
            onInputChange={setChatInput}
            onSubmit={() => {}}
            onStop={() => {}}
            status={chatStatus}
            disabled={false}
          />
        </main>

        <SurfaceShell
          open={surfaceOpen && !surfaceCollapsed}
          collapsed={surfaceCollapsed && surfaceOpen}
          width={surfaceWidth}
          artifacts={artifactsList}
          activeArtifactId={activeArtifactId}
          onClose={handleSurfaceClose}
          onCollapse={handleSurfaceCollapse}
          onResize={handleSurfaceResize}
          onSelectArtifact={focusArtifact}
          onCloseArtifact={closeArtifact}
        />
      </div>
    </ChatMetricsProvider>
  )
}
