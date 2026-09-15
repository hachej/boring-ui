import React, { useEffect } from "react"
import { createRoot } from "react-dom/client"
import { WorkspaceAgentFront } from "@hachej/boring-workspace/app/front"
import { definePlugin } from "@hachej/boring-workspace/plugin"
import { emitAgentData } from "@hachej/boring-workspace/events"
import "@hachej/boring-workspace/globals.css"
import "@hachej/boring-agent/front/styles.css"

const PREFIX = "/owners/alice/workspace"
const AUTHORIZATION = "Bearer pane-proof"

declare global {
  interface Window {
    paneMounts?: number
    emitProofChatDisplayEvent?: () => void
  }
}

function OwnerPane({ params }: { params?: { target?: string } }) {
  useEffect(() => {
    window.paneMounts = (window.paneMounts ?? 0) + 1
  }, [])
  return <section data-testid="owner-pane">Owner plugin pane: {params?.target}</section>
}

window.emitProofChatDisplayEvent = () => emitAgentData({
  type: "text-delta",
  delta: "display-only proof event",
  uiCommand: { kind: "openSurface", params: { kind: "owner.runtime", target: "granted:must-not-open" } },
})

const ownerPlugin = definePlugin({
  id: "owner-runtime-plugin",
  panels: [{ id: "owner-runtime-pane", label: "Owner runtime pane", component: OwnerPane }],
  surfaceResolvers: [{
    id: "owner-runtime-surface",
    kind: "owner.runtime",
    title: "Owner runtime surface",
    resolve: ({ target }) => target.startsWith("granted:")
      ? { id: `owner-runtime:${target}`, component: "owner-runtime-pane", params: { target } }
      : undefined,
  }],
})

createRoot(document.getElementById("root")!).render(
  <WorkspaceAgentFront
    workspaceId="default"
    agentTypeId="default"
    apiBaseUrl={PREFIX}
    bridgeEndpoint={PREFIX}
    requestHeaders={{ authorization: AUTHORIZATION }}
    plugins={[ownerPlugin]}
    sessions={[]}
    workspaceLayout="classic"
    persistenceEnabled={false}
    provisionWorkspace={false}
    externalPlugins={false}
    navEnabled={false}
    showThemeToggle={false}
  />,
)
