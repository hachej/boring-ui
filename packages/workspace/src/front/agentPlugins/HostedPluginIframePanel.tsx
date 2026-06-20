import { useEffect, useMemo, useRef, useState } from "react"
import type { PaneProps } from "../../shared/types/panel"
import { createHostedPluginNonce, connectHostedPluginIframe } from "./hostedPluginBridge"

export interface HostedPluginIframePanelParams {
  apiBaseUrl?: string
  workspaceId?: string
  pluginId: string
  panelId: string
  revision: number
}

function withWorkspaceId(url: string, workspaceId: string | undefined): string {
  if (!workspaceId) return url
  const sep = url.includes("?") ? "&" : "?"
  return `${url}${sep}workspaceId=${encodeURIComponent(workspaceId)}`
}

export function HostedPluginIframePanel({ params }: PaneProps<HostedPluginIframePanelParams>) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [srcdoc, setSrcdoc] = useState("")
  const [messages, setMessages] = useState<string[]>([])
  const nonce = useMemo(() => {
    try {
      return createHostedPluginNonce()
    } catch (error) {
      return error instanceof Error ? error.message : "Hosted iframe nonce generation failed"
    }
  }, [params.pluginId, params.panelId, params.revision])
  const nonceAvailable = /^[0-9a-f]{32}$/i.test(nonce)

  useEffect(() => {
    if (!nonceAvailable) {
      setMessages((prev) => [...prev, `error: ${nonce}`])
      return
    }
    let cancelled = false
    const base = params.apiBaseUrl?.replace(/\/$/, "") ?? ""
    const url = withWorkspaceId(`${base}/api/v1/agent-plugins/${encodeURIComponent(params.pluginId)}/iframe/${encodeURIComponent(params.panelId)}/document?nonce=${encodeURIComponent(nonce)}`, params.workspaceId)
    void fetch(url, { credentials: "include", cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
      .then((body: { srcdoc?: string }) => { if (!cancelled) setSrcdoc(body.srcdoc ?? "") })
      .catch((err) => { if (!cancelled) setMessages((prev) => [...prev, `error: ${err instanceof Error ? err.message : String(err)}`]) })
    return () => { cancelled = true }
  }, [nonce, nonceAvailable, params.apiBaseUrl, params.pluginId, params.panelId, params.workspaceId])

  useEffect(() => {
    if (!nonceAvailable) return
    const iframe = iframeRef.current
    if (!iframe || !srcdoc) return
    return connectHostedPluginIframe({
      iframe,
      nonce,
      onMessage: (message) => {
        if (message.type === "ready") return
        setMessages((prev) => [...prev.slice(-20), `${message.type}: ${message.message ?? ""}`])
      },
    })
  }, [nonce, nonceAvailable, srcdoc])

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <iframe
        ref={iframeRef}
        title={`${params.pluginId}:${params.panelId}`}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        srcDoc={srcdoc}
        style={{ border: 0, flex: 1, width: "100%" }}
      />
      {messages.length > 0 ? <pre data-testid="hosted-plugin-diagnostics" style={{ maxHeight: 96, overflow: "auto", margin: 0 }}>{messages.join("\n")}</pre> : null}
    </div>
  )
}
