import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"

const apiKey = process.env.COMPOSIO_API_KEY
if (!apiKey) throw new Error("COMPOSIO_API_KEY is required")
if (process.env.COMPOSIO_SPIKE_ACKNOWLEDGE_SYNTHETIC_USER_ONLY !== "1") {
  throw new Error("Set COMPOSIO_SPIKE_ACKNOWLEDGE_SYNTHETIC_USER_ONLY=1 only for this session-only synthetic-user probe")
}

const apiBase = "https://backend.composio.dev"
const apiOrigin = new URL(apiBase).origin
const allowedMcpOrigins = new Set(["https://backend.composio.dev"])
const userId = `boring-catalog-spike-${Date.now()}`
const sessionIds = []
const maxResponseBytes = 512 * 1024
const requestTimeoutMs = 15_000

function record(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {} }
function array(value) { return Array.isArray(value) ? value : [] }
function textJson(content) {
  for (const item of array(content)) {
    if (typeof item?.text !== "string") continue
    try { return JSON.parse(item.text) } catch {}
  }
  return undefined
}

function combinedSignal(signal) {
  const timeout = AbortSignal.timeout(requestTimeoutMs)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

async function boundedFetch(input, init = {}, allowedOrigins = new Set([apiOrigin])) {
  const requestedUrl = new URL(input instanceof Request ? input.url : String(input))
  if (!allowedOrigins.has(requestedUrl.origin)) throw new Error("Provider URL origin is not allowlisted")
  const response = await fetch(input, {
    ...init,
    redirect: "error",
    signal: combinedSignal(init.signal),
  })
  if (response.url && !allowedOrigins.has(new URL(response.url).origin)) throw new Error("Provider response origin changed")
  const declaredLength = Number(response.headers.get("content-length") ?? "0")
  if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) throw new Error("Provider response exceeded byte limit")
  if (!response.body) return new Response(undefined, { status: response.status, statusText: response.statusText, headers: response.headers })

  const chunks = []
  let total = 0
  const reader = response.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxResponseBytes) throw new Error("Provider response exceeded byte limit")
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
}

async function api(path, init = {}) {
  const response = await boundedFetch(`${apiBase}${path}`, {
    ...init,
    headers: { "content-type": "application/json", "x-api-key": apiKey, ...(init.headers ?? {}) },
  })
  const text = await response.text()
  let payload
  try { payload = text ? JSON.parse(text) : undefined } catch { payload = undefined }
  if (!response.ok) {
    const error = new Error(`Composio API ${init.method ?? "GET"} ${path.split("?")[0]} failed with ${response.status}`)
    error.status = response.status
    error.payloadCode = payload?.error?.code ?? payload?.code
    throw error
  }
  return payload
}

async function createSession(body) {
  const payload = await api("/api/v3.1/tool_router/session", { method: "POST", body: JSON.stringify(body) })
  const root = record(payload)
  const session = record(root.session ?? root.data ?? root)
  const id = session.id ?? session.session_id ?? root.id ?? root.session_id
  if (typeof id !== "string") throw new Error("Session response omitted id")
  sessionIds.push(id)
  const mcp = record(session.mcp)
  if (typeof mcp.url !== "string") throw new Error("Session response omitted MCP URL")
  return { id, url: mcp.url, headers: record(mcp.headers), config: record(session.config ?? root.config) }
}

async function deleteAndVerifySession(id) {
  const deleted = await boundedFetch(`${apiBase}/api/v3.1/tool_router/session/${encodeURIComponent(id)}`, {
    method: "DELETE", headers: { "x-api-key": apiKey },
  })
  if (!deleted.ok && deleted.status !== 404) throw new Error(`Session cleanup failed with ${deleted.status}`)
  const verified = await boundedFetch(`${apiBase}/api/v3.1/tool_router/session/${encodeURIComponent(id)}`, {
    headers: { "x-api-key": apiKey },
  })
  if (verified.status !== 404) throw new Error(`Deleted Session remained readable with ${verified.status}`)
}

const report = {
  observedAt: new Date().toISOString(),
  projectIsolationProved: false,
  sessionCreated: false,
  fullCatalogUnfiltered: false,
  reportedToolkitFilterCount: null,
  sandboxDisabled: false,
  metaToolControlRequired: false,
  sessionHeadersSufficient: false,
  sessionHeadersFailureStatus: null,
  rawApiKeyForwardedToMcp: false,
  observedMcpOrigin: null,
  searchWorked: false,
  searchWasGitHubScoped: false,
  searchResultCount: 0,
  schemaWorked: false,
  requestedSchemaCount: 0,
  schemaCount: 0,
  noAuthConnectionCorrectlySkipped: false,
  invalidAccountPinRejected: false,
  exactValidAccountPinProved: false,
  listedMetaTools: [],
  reportedWorkbenchEnabled: null,
  sandboxAliasIgnoredByRawApi: false,
  cleanupComplete: false,
  stopReason: null,
}

let client
let phase = "initialization"
let primaryError
const cleanupErrors = []
try {
  phase = "sandbox alias probe"
  const aliasSession = await createSession({
    user_id: userId,
    mcp: true,
    sandbox: { enable: false },
  })
  report.sandboxAliasIgnoredByRawApi = record(aliasSession.config.workbench).enable !== false
  if (!report.sandboxAliasIgnoredByRawApi) throw new Error("Raw API unexpectedly normalized the sandbox alias")

  phase = "full-catalog Session creation"
  const session = await createSession({
    user_id: userId,
    mcp: true,
    manage_connections: { enable: true, enable_wait_for_connections: false },
    workbench: { enable: false },
  })
  report.sessionCreated = true
  const toolkitConfig = record(session.config.toolkits)
  const enabledToolkits = array(toolkitConfig.enabled ?? toolkitConfig.enable)
  report.reportedToolkitFilterCount = enabledToolkits.length
  report.fullCatalogUnfiltered = report.reportedToolkitFilterCount === 0
  if (!report.fullCatalogUnfiltered) throw new Error("Session unexpectedly reported a toolkit filter")
  report.reportedWorkbenchEnabled = record(session.config.workbench).enable ?? null
  if (report.reportedWorkbenchEnabled !== false) throw new Error("Session did not report workbench disabled")

  const parsedUrl = new URL(session.url)
  report.observedMcpOrigin = parsedUrl.origin
  if (parsedUrl.protocol !== "https:" || parsedUrl.username || parsedUrl.password || !allowedMcpOrigins.has(parsedUrl.origin)) {
    throw new Error("Composio MCP URL failed the reviewed origin policy")
  }

  client = new Client({ name: "boring-composio-capability-spike", version: "0.0.0" })
  phase = "Session-header-only MCP authentication probe"
  try {
    const headersOnlyTransport = new StreamableHTTPClientTransport(parsedUrl, {
      requestInit: { headers: session.headers },
      fetch: (input, init) => boundedFetch(input, init, allowedMcpOrigins),
    })
    await client.connect(headersOnlyTransport)
    report.sessionHeadersSufficient = true
  } catch (error) {
    report.sessionHeadersFailureStatus = Number.isInteger(error?.code) ? error.code : null
    if (report.sessionHeadersFailureStatus !== 401) throw new Error("Session-header-only MCP probe failed without the expected 401")
    await client.close().catch(() => undefined)
    client = new Client({ name: "boring-composio-capability-spike", version: "0.0.0" })
    const apiKeyTransport = new StreamableHTTPClientTransport(parsedUrl, {
      requestInit: { headers: { ...session.headers, "x-api-key": apiKey } },
      fetch: (input, init) => boundedFetch(input, init, allowedMcpOrigins),
    })
    await client.connect(apiKeyTransport)
    report.rawApiKeyForwardedToMcp = true
  }
  phase = "MCP tool-list probe"
  const listed = await client.listTools()
  if (listed.tools.length > 16) throw new Error("MCP meta-tool list exceeded the spike bound")
  const names = listed.tools.map((tool) => tool.name)
  report.listedMetaTools = names.filter((name) => name.startsWith("COMPOSIO_")).sort()
  const required = [
    "COMPOSIO_SEARCH_TOOLS",
    "COMPOSIO_GET_TOOL_SCHEMAS",
    "COMPOSIO_MANAGE_CONNECTIONS",
    "COMPOSIO_MULTI_EXECUTE_TOOL",
  ]
  if (!required.every((name) => names.includes(name))) throw new Error("Required Composio meta tools were absent")
  report.sandboxDisabled = !names.includes("COMPOSIO_REMOTE_WORKBENCH") && !names.includes("COMPOSIO_REMOTE_BASH_TOOL")
  if (!report.sandboxDisabled) throw new Error("Sandbox tools remained enabled")
  report.metaToolControlRequired = names.includes("COMPOSIO_MULTI_EXECUTE_TOOL")

  let disabledSandboxRejected = false
  try {
    const disabledResult = await client.callTool({ name: "COMPOSIO_REMOTE_BASH_TOOL", arguments: { command: "true" } })
    disabledSandboxRejected = disabledResult?.isError === true
  } catch { disabledSandboxRejected = true }
  if (!disabledSandboxRejected) throw new Error("Disabled sandbox call did not reject")

  phase = "full-catalog search probe"
  const search = await client.callTool({
    name: "COMPOSIO_SEARCH_TOOLS",
    arguments: { queries: ["Find tools for reading GitHub issues"], session: session.id },
  })
  if (search?.isError) throw new Error("Full-catalog search returned an MCP error")
  const searchPayload = record(textJson(search.content))
  const searchData = record(searchPayload.data ?? searchPayload)
  const results = array(searchData.results)
  if (results.length === 0 || results.length > 10) throw new Error("Search result count was outside the spike bound")
  const slugs = []
  const toolkits = new Set()
  for (const item of results) {
    for (const toolkit of array(item?.toolkits)) if (typeof toolkit === "string") toolkits.add(toolkit.toLowerCase())
    for (const slug of [...array(item?.primary_tool_slugs), ...array(item?.related_tool_slugs)]) {
      if (typeof slug === "string" && !slug.startsWith("COMPOSIO_") && !slugs.includes(slug)) slugs.push(slug)
    }
  }
  if (slugs.length > 50) throw new Error("Search tool-slug count exceeded the spike bound")
  report.searchResultCount = results.length
  report.searchWasGitHubScoped = toolkits.has("github") && slugs.some((slug) => slug.startsWith("GITHUB_"))
  report.searchWorked = slugs.length > 0 && report.searchWasGitHubScoped
  if (!report.searchWorked) throw new Error("Search did not return GitHub app-native tools")

  const requestedSlugs = slugs.slice(0, 2)
  report.requestedSchemaCount = requestedSlugs.length
  if (requestedSlugs.length !== 2) throw new Error("Search did not provide two bounded schema candidates")
  phase = "schema probe"
  const schema = await client.callTool({
    name: "COMPOSIO_GET_TOOL_SCHEMAS",
    arguments: { tool_slugs: requestedSlugs, session_id: session.id },
  })
  if (schema?.isError) throw new Error("Schema retrieval returned an MCP error")
  const schemaPayload = record(textJson(schema.content))
  const schemaData = record(schemaPayload.data ?? schemaPayload)
  const schemas = record(schemaData.tool_schemas ?? schemaPayload.tool_schemas)
  report.schemaCount = Object.keys(schemas).length
  report.schemaWorked = requestedSlugs.every((slug) => record(schemas)[slug] && typeof record(schemas)[slug] === "object")
  if (!report.schemaWorked || report.schemaCount !== requestedSlugs.length) throw new Error("Schema retrieval did not return every requested schema")

  phase = "no-auth connection probe"
  let noAuthLinkUnexpectedlyCreated = false
  try {
    await api(`/api/v3.1/tool_router/session/${encodeURIComponent(session.id)}/link`, {
      method: "POST", body: JSON.stringify({ toolkit: "hackernews" }),
    })
    noAuthLinkUnexpectedlyCreated = true
  } catch (error) {
    report.noAuthConnectionCorrectlySkipped = error?.status === 400 && error?.payloadCode === 4326
    if (!report.noAuthConnectionCorrectlySkipped) throw error
  }
  if (noAuthLinkUnexpectedlyCreated || !report.noAuthConnectionCorrectlySkipped) {
    throw new Error("No-auth toolkit unexpectedly created a connection link")
  }

  phase = "invalid account-pin probe"
  try {
    await createSession({
      user_id: userId,
      mcp: true,
      connected_accounts: { github: ["ca_intentionally_invalid_boring_spike"] },
      workbench: { enable: false },
    })
  } catch (error) {
    report.invalidAccountPinRejected = error?.status >= 400 && error?.status < 500
  }
  if (!report.invalidAccountPinRejected) throw new Error("Invalid connected account pin was not rejected")

  report.stopReason = "A dedicated Composio project and exact valid-account execution pinning with a disposable owned account are still required."
} catch (error) {
  const status = Number.isInteger(error?.status) ? ` status=${error.status}` : ""
  const code = Number.isInteger(error?.code) ? ` code=${error.code}` : ""
  const providerCode = Number.isInteger(error?.payloadCode) ? ` providerCode=${error.payloadCode}` : ""
  primaryError = new Error(`Composio capability spike failed during ${phase}.${status}${code}${providerCode}`)
} finally {
  if (client) await client.close().catch(() => undefined)
  for (const id of sessionIds.reverse()) {
    try {
      await deleteAndVerifySession(id)
    } catch {
      cleanupErrors.push(true)
    }
  }
  report.cleanupComplete = cleanupErrors.length === 0
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

if (cleanupErrors.length > 0) throw new Error(`Composio capability spike cleanup failed for ${cleanupErrors.length} Session(s)`)
if (primaryError) throw primaryError
