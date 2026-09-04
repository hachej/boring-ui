"use client"

import { MessageSquare } from "lucide-react"
import { inboxDecisionBadgeStyle, type WorkspaceInboxItemViewModel } from "./inboxItemModel"
import type { AskUserAnswerValue } from "../../shared/types"

function formatAnswerValue(value: AskUserAnswerValue): string {
  if (Array.isArray(value)) return value.join(", ")
  if (typeof value === "boolean") return value ? "yes" : "no"
  if (value === null || value === undefined) return ""
  return String(value)
}

/**
 * What the owner was asked and what they decided. The decision alone is not a
 * record: the notes they wrote are the reasoning a later reader needs.
 */
export function AnsweredDetail({
  item,
  onOpenChat,
}: {
  item: WorkspaceInboxItemViewModel
  onOpenChat?: () => void
}) {
  const entries = Object.entries(item.answerValues ?? {}).filter(([, value]) => formatAnswerValue(value).length > 0)
  return (
    <div className="space-y-3 text-[12px]">
      {item.description ? (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">Asked</div>
          <p className="mt-1 max-w-prose leading-5 text-muted-foreground">{item.description}</p>
        </div>
      ) : null}
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">Answered</div>
        {item.decision ? (
          <span className="mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium" style={inboxDecisionBadgeStyle(item.decision)}>{item.decision}</span>
        ) : null}
        {entries.length > 0 ? (
          <dl className="mt-2 space-y-1.5">
            {entries.map(([name, value]) => (
              <div key={name} className="flex gap-2">
                <dt className="w-28 shrink-0 truncate text-muted-foreground">{name}</dt>
                <dd className="min-w-0 flex-1 whitespace-pre-wrap break-words text-foreground">{formatAnswerValue(value)}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="mt-1 text-muted-foreground">No notes were recorded with this decision.</p>
        )}
      </div>
      {item.sessionId && item.chatAvailable && onOpenChat ? (
        <button
          type="button"
          onClick={onOpenChat}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <MessageSquare className="size-3.5" strokeWidth={1.75} />
          Open the session that asked
        </button>
      ) : null}
    </div>
  )
}
