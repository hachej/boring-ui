import { test as base, type Page, type TestInfo } from "@playwright/test"
import { mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ARTIFACTS_DIR = path.resolve(__dirname, "..", "e2e-artifacts")
function shouldKeepArtifacts(): boolean {
  return process.env.BORING_E2E_KEEP === "1"
}

interface ConsoleEntry {
  timestamp: string
  level: string
  text: string
  url?: string
  lineNumber?: number
}

interface NetworkEntry {
  timestamp: string
  method: string
  url: string
  status: number | null
  durationMs: number | null
  requestBytes: number | null
  responseBytes: number | null
}

interface TimelineEvent {
  timestamp: string
  event: string
  detail?: string
}

export interface LoggingFixture {
  mark(event: string, detail?: string): void
}

interface LoggingState {
  console: ConsoleEntry[]
  network: NetworkEntry[]
  timeline: TimelineEvent[]
  pendingRequests: Map<string, { startTime: number; method: string; url: string }>
}

function now(): string {
  return new Date().toISOString()
}

function redactHeaders(url: string): string {
  try {
    const u = new URL(url)
    if (u.searchParams.has("token")) {
      u.searchParams.set("token", "[REDACTED]")
    }
    return u.toString()
  } catch {
    return url
  }
}

function sanitizeTestName(title: string): string {
  return title.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100)
}

function setupConsoleCapture(page: Page, state: LoggingState): void {
  page.on("console", (msg) => {
    state.console.push({
      timestamp: now(),
      level: msg.type(),
      text: msg.text(),
      url: msg.location()?.url,
      lineNumber: msg.location()?.lineNumber,
    })
  })

  page.on("pageerror", (error) => {
    state.console.push({
      timestamp: now(),
      level: "page-error",
      text: `${error.name}: ${error.message}\n${error.stack ?? ""}`,
    })
  })
}

function setupNetworkCapture(page: Page, state: LoggingState): void {
  page.on("request", (request) => {
    const id = `${request.method()}:${request.url()}:${Date.now()}`
    state.pendingRequests.set(id, {
      startTime: Date.now(),
      method: request.method(),
      url: request.url(),
    })

    request.response().then((response) => {
      const pending = state.pendingRequests.get(id)
      state.pendingRequests.delete(id)
      state.network.push({
        timestamp: now(),
        method: pending?.method ?? request.method(),
        url: redactHeaders(pending?.url ?? request.url()),
        status: response?.status() ?? null,
        durationMs: pending ? Date.now() - pending.startTime : null,
        requestBytes: request.postDataBuffer()?.byteLength ?? null,
        responseBytes: null,
      })
    }).catch(() => {
      const pending = state.pendingRequests.get(id)
      state.pendingRequests.delete(id)
      state.network.push({
        timestamp: now(),
        method: pending?.method ?? request.method(),
        url: redactHeaders(pending?.url ?? request.url()),
        status: null,
        durationMs: pending ? Date.now() - pending.startTime : null,
        requestBytes: null,
        responseBytes: null,
      })
    })
  })
}

function formatConsoleLog(entries: ConsoleEntry[]): string {
  return entries
    .map((e) => {
      const loc = e.url ? ` (${e.url}:${e.lineNumber ?? "?"})` : ""
      return `[${e.timestamp}] [${e.level}]${loc} ${e.text}`
    })
    .join("\n")
}

function formatNetworkLog(entries: NetworkEntry[]): string {
  return entries
    .map((e) => {
      const status = e.status !== null ? String(e.status) : "ERR"
      const duration = e.durationMs !== null ? `${e.durationMs}ms` : "?"
      return `[${e.timestamp}] ${e.method} ${e.url} → ${status} (${duration})`
    })
    .join("\n")
}

async function writeArtifacts(
  testInfo: TestInfo,
  state: LoggingState,
  page: Page,
  failed: boolean,
): Promise<void> {
  const testName = sanitizeTestName(testInfo.title)
  const artifactDir = path.join(ARTIFACTS_DIR, testName)
  await mkdir(artifactDir, { recursive: true })

  const consoleLog = formatConsoleLog(state.console)
  const networkLog = formatNetworkLog(state.network)
  const timelineJson = JSON.stringify(state.timeline, null, 2)

  await writeFile(path.join(artifactDir, "browser-console.log"), consoleLog || "(empty)\n")
  await writeFile(path.join(artifactDir, "network.log"), networkLog || "(empty)\n")
  await writeFile(path.join(artifactDir, "timeline.json"), timelineJson)

  await testInfo.attach("browser-console.log", {
    body: Buffer.from(consoleLog || "(empty)\n", "utf8"),
    contentType: "text/plain",
  })
  await testInfo.attach("network.log", {
    body: Buffer.from(networkLog || "(empty)\n", "utf8"),
    contentType: "text/plain",
  })
  await testInfo.attach("timeline.json", {
    body: Buffer.from(timelineJson, "utf8"),
    contentType: "application/json",
  })

  if (failed) {
    try {
      const html = await page.content()
      await writeFile(path.join(artifactDir, "dom.html"), html)
      await testInfo.attach("dom.html", {
        body: Buffer.from(html, "utf8"),
        contentType: "text/html",
      })
    } catch {
      // Page may already be closed
    }

    console.error(`[e2e-logging] Artifacts written to: ${artifactDir}`)
  }

  if (!failed && !shouldKeepArtifacts()) {
    await rm(artifactDir, { recursive: true, force: true }).catch(() => {})
  }
}

export interface LoggingHarnessFixtures {
  logging: LoggingFixture
}

export const test = base.extend<LoggingHarnessFixtures>({
  logging: [async ({ page }, use, testInfo) => {
    const state: LoggingState = {
      console: [],
      network: [],
      timeline: [],
      pendingRequests: new Map(),
    }

    state.timeline.push({ timestamp: now(), event: "test.start", detail: testInfo.title })
    setupConsoleCapture(page, state)
    setupNetworkCapture(page, state)

    const fixture: LoggingFixture = {
      mark(event: string, detail?: string) {
        state.timeline.push({ timestamp: now(), event, detail })
      },
    }

    await use(fixture)

    const failed = testInfo.status !== testInfo.expectedStatus
    state.timeline.push({
      timestamp: now(),
      event: "test.end",
      detail: `status=${testInfo.status}`,
    })

    await writeArtifacts(testInfo, state, page, failed)
  }, { auto: true }],
})

export { expect } from "@playwright/test"
