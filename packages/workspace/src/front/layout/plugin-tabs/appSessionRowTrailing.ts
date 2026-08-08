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
 * The marker half: provenance, pin, or the quiet age. Ordered by how much the
 * operator needs it, and yielded entirely once a badge claims the row.
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
  /** The row shows a working dot in its leading slot, so no working badge. */
  activeDot: boolean
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
    // A working dot in the leading slot already says "working"; a badge too
    // would be the same fact twice.
    : input.working && !input.activeDot ? { kind: "working" }
    : { kind: "none" }

  const marker: SessionTrailingMarker = ((): SessionTrailingMarker => {
    if (input.ownerLabel) return { kind: "owner", label: input.ownerLabel }
    // Everything below is quiet enough to yield to a badge. Note this uses the
    // SAME predicate as the age below: gating the pin on raw `working` while
    // gating the age on the badge condition made a pinned, working, dotted row
    // show nothing at all.
    if (badge.kind !== "none") return { kind: "none" }
    if (input.pinned) return { kind: "pin" }
    const label = formatRelativeAge(input.updatedAt, input.now)
    if (!label) return { kind: "none" }
    return { kind: "age", label, ...(exactTimestamp(input.updatedAt) ? { title: exactTimestamp(input.updatedAt) } : {}) }
  })()

  return { badge, marker, reserveActions: badge.kind === "none" && marker.kind === "none" }
}

/** Human-readable absolute timestamp for the age tooltip. */
export function exactTimestamp(updatedAt: string | number | undefined): string | undefined {
  if (updatedAt === undefined) return undefined
  const value = typeof updatedAt === "number" ? updatedAt : Date.parse(updatedAt)
  if (!Number.isFinite(value)) return undefined
  return new Date(value).toLocaleString()
}
