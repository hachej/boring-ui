import type { WorkspaceAttentionSessionBadge } from "../../attention/WorkspaceAttentionProvider"
import { formatRelativeAge } from "../../lib/relativeTime"

/**
 * The badge half of a session row's trailing area: at most one of these ever
 * shows, and it always wins over the marker's quieter signals.
 */
export type SessionTrailingBadge =
  | { kind: "none" }
  | { kind: "attention"; badge: WorkspaceAttentionSessionBadge }
  | { kind: "working" }

/**
 * The marker half: provenance, pin, or the quiet age.
 *
 * Provenance and the PIN are the exceptions that outrank the badge — they
 * answer a different question from "this chat needs you" and legitimately
 * render beside it. The pin earned that after a measured failure: a chat that
 * was both waiting and pinned showed the attention badge and nothing else, so
 * pinning the top rows of the pane (which are the waiting ones) produced no
 * visible change anywhere and read as a dead menu item. A badge is a state the
 * SYSTEM reports; a pin is a state the USER set, and a system signal must never
 * silently swallow the user's own. Only the age still yields the slot.
 */
export type SessionTrailingMarker =
  | { kind: "none" }
  | { kind: "owner"; label: string }
  | { kind: "pin" }
  | { kind: "age"; label: string; title?: string }

export interface SessionTrailingSlot {
  badge: SessionTrailingBadge
  marker: SessionTrailingMarker
  /**
   * True when nothing occupies the slot, so the row must reserve room for the
   * hover actions instead — otherwise the title would run underneath them.
   */
  reserveActions: boolean
}

export interface SessionTrailingInput {
  attentionBadge?: WorkspaceAttentionSessionBadge
  /** The session is producing output right now. */
  working: boolean
  /**
   * The row is ACTUALLY painting the pulsing working dot in its leading slot.
   * This is the computed fact, not the `activeDot` prop: the row only paints
   * the dot when `activeDot && activeDotActive && working`, so keying off
   * `activeDot` alone made a working non-active row show neither dot nor
   * badge — the working state vanished.
   */
  workingDotShown: boolean
  ownerLabel?: string
  pinned: boolean
  updatedAt?: string | number
  now: number
}

/**
 * One ordered decision for the row's trailing area, instead of four predicates
 * computed in one order and re-tested in another. Pure, so the precedence is
 * unit-testable rather than inferred from nested ternaries.
 */
export function resolveSessionTrailingSlot(input: SessionTrailingInput): SessionTrailingSlot {
  const badge: SessionTrailingBadge = input.attentionBadge
    ? { kind: "attention", badge: input.attentionBadge }
    // A painted working dot already says "working"; a badge too would be the
    // same fact twice. If the dot is NOT painted, the badge is the only thing
    // carrying that state, so it must appear.
    : input.working && !input.workingDotShown ? { kind: "working" }
    : { kind: "none" }

  const marker: SessionTrailingMarker = ((): SessionTrailingMarker => {
    if (input.ownerLabel) return { kind: "owner", label: input.ownerLabel }
    if (input.pinned) return { kind: "pin" }
    // The age is the only marker quiet enough to yield to a badge. Note this
    // uses the SAME predicate the pin used to: gating the pin on raw `working`
    // while gating the age on the badge condition made a pinned, working,
    // dotted row show nothing at all.
    if (badge.kind !== "none") return { kind: "none" }
    const label = formatRelativeAge(input.updatedAt, input.now)
    if (!label) return { kind: "none" }
    const title = exactTimestamp(input.updatedAt)
    return { kind: "age", label, ...(title ? { title } : {}) }
  })()

  return { badge, marker, reserveActions: badge.kind === "none" && marker.kind === "none" }
}

/** Human-readable absolute timestamp for the age tooltip. */
function exactTimestamp(updatedAt: string | number | undefined): string | undefined {
  if (updatedAt === undefined) return undefined
  const value = typeof updatedAt === "number" ? updatedAt : Date.parse(updatedAt)
  if (!Number.isFinite(value)) return undefined
  return new Date(value).toLocaleString()
}
