import { MailOpen } from "lucide-react"
import type { PanelConfig } from "@hachej/boring-workspace"
import { InboxDetailPanel } from "./InboxDetailPanel"
import { WORKSPACE_INBOX_DETAIL_PANEL_ID, WORKSPACE_INBOX_PREVIEW_PANEL_ID } from "./inboxItemModel"

export const inboxPreviewPanel: PanelConfig<{ itemId?: string; blockerId?: string }> = {
  id: WORKSPACE_INBOX_PREVIEW_PANEL_ID,
  title: "Inbox Preview",
  placement: "center",
  source: "builtin",
  icon: MailOpen,
  component: InboxDetailPanel,
}

export const inboxDetailPanel: PanelConfig<{ itemId?: string; blockerId?: string }> = {
  id: WORKSPACE_INBOX_DETAIL_PANEL_ID,
  title: "Inbox Detail",
  placement: "center",
  source: "builtin",
  icon: MailOpen,
  component: InboxDetailPanel,
}
