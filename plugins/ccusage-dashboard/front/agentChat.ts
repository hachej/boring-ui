async function readResponseError(response: Response): Promise<string> {
  const text = await response.text().catch(() => "")
  if (!text) return `agent request failed (${response.status})`
  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown }; message?: unknown }
    return String(typeof parsed.error?.message === "string" ? parsed.error.message : typeof parsed.message === "string" ? parsed.message : text)
  } catch {
    return text.slice(0, 200)
  }
}

export async function sendCcusageAgentChat(agentTypeId: string, message: string, workspaceId?: string): Promise<void> {
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (workspaceId) headers["x-boring-workspace-id"] = workspaceId
  const sessionsPath = `/api/v1/agents/${encodeURIComponent(agentTypeId)}/sessions`
  const createRequestId = `ccusage-dashboard-create-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  const sessionResponse = await fetch(sessionsPath, { method: "POST", credentials: "include", headers, body: JSON.stringify({ requestId: createRequestId, title: "ccusage dashboard refresh" }) })
  if (!sessionResponse.ok) throw new Error(await readResponseError(sessionResponse))
  const session = await sessionResponse.json().catch(() => null) as { sessionId?: unknown } | null
  const sessionId = typeof session?.sessionId === "string" ? session.sessionId : undefined
  if (!sessionId) throw new Error("agent session creation did not return a session id")
  const clientNonce = `ccusage-dashboard-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  const promptResponse = await fetch(`${sessionsPath}/${encodeURIComponent(sessionId)}/prompt`, {
    method: "POST",
    credentials: "include",
    headers,
    body: JSON.stringify({ requestId: clientNonce, content: message, clientNonce }),
  })
  if (!promptResponse.ok) throw new Error(await readResponseError(promptResponse))
  await promptResponse.text().catch(() => undefined)
}
