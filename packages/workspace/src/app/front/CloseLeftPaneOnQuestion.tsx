import { useEffect, useRef } from "react"
import { useWorkspaceAttention, workspaceAttentionSessionBadgeForBlocker } from "../../front/attention"

/**
 * When a plugin marks a session as waiting on a question, close the
 * workbench's default-open left pane so the question isn't hidden behind it.
 * Fires only on the transition into "waiting" so re-opening the pane while a
 * question is pending isn't fought. Renders inside WorkspaceProvider (needs
 * the attention context).
 */
export function CloseLeftPaneOnQuestion({ onQuestionOpen }: { onQuestionOpen: () => void }) {
  const { blockers } = useWorkspaceAttention()
  const waiting = blockers.some((blocker) => (
    blocker.reason === "waiting_for_user_input"
    || workspaceAttentionSessionBadgeForBlocker(blocker)?.kind === "question"
  ))
  const prevWaitingRef = useRef(false)
  useEffect(() => {
    if (waiting && !prevWaitingRef.current) onQuestionOpen()
    prevWaitingRef.current = waiting
  }, [waiting, onQuestionOpen])
  return null
}
