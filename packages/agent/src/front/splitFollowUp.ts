import type { UIMessage } from 'ai'
import type { FileUIPart } from 'ai'

/**
 * Restructure messages after a server-side inline follow-up.
 *
 * When the server processes a follow-up in the same HTTP stream, both turns
 * land in a single AI SDK assistant message. The server inserts a
 * `data-followup-consumed` marker part between the two turns. This function
 * finds that marker, splits the assistant message at that boundary, and injects
 * the user's follow-up message between the two halves.
 *
 * Returned array:
 *   […before, asst-turn-1, user-follow-up, asst-turn-2, …after]
 *
 * Fallback (marker not found): appends the user message at the end — still
 * better than silently dropping it.
 */
export function splitFollowUp(
  msgs: UIMessage[],
  consumed: { text: string; files: FileUIPart[] },
  genId: () => string,
): UIMessage[] {
  const targetIdx = msgs.findIndex(
    (m) =>
      m.role === 'assistant' &&
      m.parts?.some((p) => {
        const part = p as { type?: string; id?: string }
        return part.type === 'data-followup-consumed' || part.id?.startsWith('turn-')
      }),
  )

  const userMsg: UIMessage = {
    id: genId(),
    role: 'user' as const,
    parts: [...consumed.files, { type: 'text' as const, text: consumed.text }],
  }

  if (targetIdx < 0) {
    return [...msgs, userMsg]
  }

  const target = msgs[targetIdx]
  const markerIdx =
    target.parts?.findIndex((p) => {
      const part = p as { type?: string; id?: string }
      return part.type === 'data-followup-consumed' || part.id?.startsWith('turn-')
    }) ?? -1
  const markerIsPart = markerIdx >= 0 && (target.parts?.[markerIdx] as { type?: string }).type === 'data-followup-consumed'
  const turn1Parts = markerIdx >= 0 ? (target.parts?.slice(0, markerIdx) ?? []) : (target.parts ?? [])
  const turn2Parts = markerIdx >= 0
    ? (target.parts?.slice(markerIsPart ? markerIdx + 1 : markerIdx) ?? [])
    : []

  const asst1: UIMessage = { ...target, parts: turn1Parts }
  const asst2: UIMessage = { ...target, id: genId(), parts: turn2Parts }

  return [...msgs.slice(0, targetIdx), asst1, userMsg, asst2, ...msgs.slice(targetIdx + 1)]
}
