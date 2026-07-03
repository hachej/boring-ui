"use client"

import { createElement } from "react"
import { Inbox } from "lucide-react"
import { definePlugin } from "../../../plugin"
import { useWorkspaceAttention } from "../../../front/attention"
import { useWorkspaceContext } from "../../../front/provider/WorkspaceProvider"
import { isInboxAttentionBlocker } from "./attentionBlockerAdapter"
import { InboxOverlay } from "./InboxOverlay"
import type { BoringFrontAppLeftOverlayProps } from "../../../shared/plugins/frontFactory"

function InboxCountBadge() {
  const { blockers } = useWorkspaceAttention()
  const count = blockers.filter(isInboxAttentionBlocker).length
  if (count === 0) return null
  const label = count > 99 ? "99+" : String(count)
  return createElement(
    "span",
    {
      "data-boring-workspace-part": "app-left-inbox-count",
      "aria-label": `${count} inbox item${count === 1 ? "" : "s"}`,
      className: "inline-flex min-w-5 items-center justify-center rounded-full bg-[color:var(--accent)] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white shadow-sm",
    },
    label,
  )
}

function InboxAppLeftOverlay({ onClose, headerInsetStart, headerInsetEnd }: BoringFrontAppLeftOverlayProps) {
  const { workspaceId } = useWorkspaceContext()
  return createElement(InboxOverlay, {
    onClose,
    headerInsetStart,
    headerInsetEnd,
    pinStorageKey: `boring-workspace:inbox-pins:${workspaceId ?? "workspace"}`,
  })
}

export const workspaceInboxPlugin = definePlugin({
  id: "workspace-inbox",
  label: "Inbox",
  appLeftActions: [{
    id: "inbox",
    label: "Inbox",
    icon: Inbox,
    trailing: InboxCountBadge,
    overlay: InboxAppLeftOverlay,
    order: 10,
  }],
})
