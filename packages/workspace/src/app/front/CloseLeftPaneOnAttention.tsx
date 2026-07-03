import { useEffect, useRef } from "react"
import { useWorkspaceAttention } from "../../front/attention"

/**
 * Close the workbench's default-open left pane when a plugin says one of its
 * attention blockers needs the main content area. Fires only on the transition
 * into that state so re-opening the pane while the blocker is pending is not
 * fought. Renders inside WorkspaceProvider (needs the attention context).
 */
export function CloseLeftPaneOnAttention({ activeSessionId, onAttentionOpen }: { activeSessionId?: string | null; onAttentionOpen: () => void }) {
  const { blockers } = useWorkspaceAttention()
  const waiting = blockers.some((blocker) => {
    if (blocker.sessionId && activeSessionId && blocker.sessionId !== activeSessionId) return false
    return blocker.focus?.closeWorkbenchLeftPane === true
  })
  const prevWaitingRef = useRef(false)
  useEffect(() => {
    if (waiting && !prevWaitingRef.current) onAttentionOpen()
    prevWaitingRef.current = waiting
  }, [waiting, onAttentionOpen])
  return null
}
