import type { UIMessage } from 'ai'
import type { FileUIPart } from 'ai'

export interface FollowUpSplitIds {
  userId: string
  assistantId: string
}

export interface FollowUpDraft {
  text: string
  files: FileUIPart[]
}

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
  consumed: FollowUpDraft,
  genId: () => string,
): UIMessage[] {
  let targetIdx = msgs.findIndex(
    (m) =>
      m.role === 'assistant' &&
      m.parts?.some((p) => {
        const part = p as { type?: string; id?: string }
        return part.type === 'data-followup-consumed' || part.id?.startsWith('turn-')
      }),
  )

  // Some AI SDK state paths call onData(data-followup-consumed) but do not
  // retain data parts or stream part ids in messages[].parts. In that case,
  // the only durable fact the UI has is "a follow-up was consumed" plus the
  // current assistant message. Use the last assistant as the split target;
  // below we choose the safest available boundary.
  if (targetIdx < 0) {
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i]?.role === 'assistant') {
        targetIdx = i
        break
      }
    }
  }

  const displayTextFromMarker = msgs
    .flatMap((m) => m.parts ?? [])
    .map((p) => (p as { type?: string; data?: { text?: unknown } }))
    .find((p) => p.type === 'data-followup-consumed' && typeof p.data?.text === 'string')
    ?.data?.text as string | undefined

  const userMsg: UIMessage = {
    id: genId(),
    role: 'user' as const,
    parts: [...consumed.files, { type: 'text' as const, text: displayTextFromMarker ?? consumed.text }],
  }

  if (targetIdx < 0) {
    return [...msgs, userMsg]
  }

  const target = msgs[targetIdx]
  const parts = target.parts ?? []
  let markerIdx = parts.findIndex((p) => {
    const part = p as { type?: string; id?: string }
    return part.type === 'data-followup-consumed' || part.id?.startsWith('turn-')
  })
  let markerIsPart = markerIdx >= 0 && (parts[markerIdx] as { type?: string }).type === 'data-followup-consumed'

  if (markerIdx < 0) {
    const textPartIndexes = parts
      .map((p, index) => ((p as { type?: string }).type === 'text' ? index : -1))
      .filter((index) => index >= 0)
    if (textPartIndexes.length > 1) {
      // Follow-up turns usually become a new text part. If AI SDK dropped the
      // marker/id metadata, split before the last text part so the queued user
      // turn is still printed in the correct place.
      markerIdx = textPartIndexes[textPartIndexes.length - 1]
      markerIsPart = false
    } else {
      // Last-resort fallback: print the queued user turn before the assistant
      // message rather than losing it entirely. This may not split assistant
      // prose perfectly, but it preserves the human-visible conversation turn.
      return [...msgs.slice(0, targetIdx), userMsg, target, ...msgs.slice(targetIdx + 1)]
    }
  }

  const turn1Parts = markerIdx >= 0 ? parts.slice(0, markerIdx) : parts
  const turn2Parts = markerIdx >= 0
    ? parts.slice(markerIsPart ? markerIdx + 1 : markerIdx)
    : []

  const asst1: UIMessage = { ...target, parts: turn1Parts }
  const asst2: UIMessage = { ...target, id: genId(), parts: turn2Parts }

  return [...msgs.slice(0, targetIdx), asst1, userMsg, asst2, ...msgs.slice(targetIdx + 1)]
}

/**
 * Build the live display shape while an inline follow-up is still streaming.
 *
 * AI SDK reliably calls onData(data-followup-consumed), but depending on its
 * internal message-state handling that data part may not be retained in
 * messages[].parts. The server therefore also namespaces follow-up text ids as
 * turn-1:*. This helper waits for that namespaced part before moving the queued
 * user bubble into history, and falls back to the pending draft if the consumed
 * ref was lost/never populated.
 */
export function splitFollowUpForDisplay(
  msgs: UIMessage[],
  consumed: FollowUpDraft | null | undefined,
  pending: FollowUpDraft | null | undefined,
  ids: FollowUpSplitIds | null | undefined,
): UIMessage[] {
  const draft = consumed ?? pending
  if (!draft || !ids) return msgs
  const hasFollowUpBoundary = msgs.some((m) =>
    m.role === 'assistant' && (
      m.parts?.some((p) => (p as { id?: string; type?: string }).id?.startsWith('turn-') || (p as { type?: string }).type === 'data-followup-consumed') ||
      (m.parts?.filter((p) => (p as { type?: string }).type === 'text').length ?? 0) > 1
    ),
  )
  if (!hasFollowUpBoundary) return msgs
  let n = 0
  return splitFollowUp(msgs, draft, () => (n++ === 0 ? ids.userId : ids.assistantId))
}
