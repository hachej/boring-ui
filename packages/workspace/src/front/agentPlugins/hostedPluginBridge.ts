const HOSTED_PLUGIN_DIAGNOSTIC_MAX_CHARS = 2000
const HOSTED_PLUGIN_DIAGNOSTIC_MAX_MESSAGES = 200

function boundedDiagnostic(value: string): string {
  return value.length > HOSTED_PLUGIN_DIAGNOSTIC_MAX_CHARS
    ? `${value.slice(0, HOSTED_PLUGIN_DIAGNOSTIC_MAX_CHARS)}…`
    : value
}

export interface HostedPluginBridgeMessage {
  type: "ready" | "log" | "error"
  message?: string
}

export function createHostedPluginNonce(): string {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("Hosted iframe plugins require crypto.getRandomValues for nonce generation")
  }
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

export function connectHostedPluginIframe(args: {
  iframe: HTMLIFrameElement
  nonce: string
  onMessage: (message: HostedPluginBridgeMessage) => void
}): () => void {
  const channel = new MessageChannel()
  let transferred = false
  let diagnosticMessages = 0
  const onPortMessage = (event: MessageEvent) => {
    const data = event.data as Partial<HostedPluginBridgeMessage> | undefined
    if (!data || (data.type !== "ready" && data.type !== "log" && data.type !== "error")) return
    if (data.type !== "ready" && diagnosticMessages++ >= HOSTED_PLUGIN_DIAGNOSTIC_MAX_MESSAGES) return
    args.onMessage({
      type: data.type,
      ...(typeof data.message === "string" ? { message: boundedDiagnostic(data.message) } : {}),
    })
  }
  channel.port1.addEventListener("message", onPortMessage)
  channel.port1.start()
  const onWindowMessage = (event: MessageEvent) => {
    if (transferred) return
    if (event.source !== args.iframe.contentWindow) return
    const data = event.data as { type?: string; nonce?: string } | undefined
    if (data?.type !== "boring.hosted-plugin.ready-for-connect" || data.nonce !== args.nonce) return
    transferred = true
    args.iframe.contentWindow?.postMessage({ type: "boring.hosted-plugin.connect", nonce: args.nonce }, "*", [channel.port2])
  }
  window.addEventListener("message", onWindowMessage)
  return () => {
    window.removeEventListener("message", onWindowMessage)
    channel.port1.removeEventListener("message", onPortMessage)
    channel.port1.close()
  }
}
