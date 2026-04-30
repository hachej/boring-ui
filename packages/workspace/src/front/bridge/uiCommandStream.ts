/**
 * Drains agent → frontend UI commands posted via /api/v1/ui/commands and
 * dispatches them to the workbench surface.
 *
 * Two transports:
 * - SSE (default) — long-lived `EventSource` against
 *   `/api/v1/ui/commands/next` (no `?poll=true`). Server pushes commands
 *   as they arrive; latency is bounded by network RTT, not by a polling
 *   interval. The wire protocol is documented in
 *   `packages/agent/src/server/http/routes/ui.ts`.
 * - Polling (fallback) — `setTimeout` loop hitting the same endpoint with
 *   `?poll=true`. Used automatically when `EventSource` is missing
 *   (some test runners, some restrictive networks) or when the SSE
 *   connection has failed too many times in a row. Also handy in tests
 *   where the fake-timer integration is simpler than mocking EventSource.
 *
 * The dispatcher is kept in a separate module (`uiCommandDispatcher.ts`)
 * so it can be exercised in isolation.
 */
import { dispatchUiCommand, type DispatchContext, type UiCommand } from "./uiCommandDispatcher"

export type { DispatchContext, UiCommand } from "./uiCommandDispatcher"
export { dispatchUiCommand } from "./uiCommandDispatcher"

export interface StreamOptions {
  /** Endpoint base — usually "" for same-origin (vite proxy forwards). */
  endpoint?: string
  /** Dispatch context — surface getter, workbench-open getter, opener. */
  ctx: DispatchContext
  /** Query params appended to SSE/poll URLs, e.g. workspace scoping. */
  query?: Record<string, string | number | boolean | null | undefined>
  /**
   * Inject EventSource for tests. Defaults to `globalThis.EventSource`.
   * Pass `null` to force the polling fallback unconditionally (useful when
   * a test runner defines a broken stub).
   */
  eventSourceCtor?: typeof EventSource | null
  /** Inject fetch for the polling fallback. Defaults to global fetch. */
  fetcher?: typeof fetch
  /** Polling cadence when on the fallback path. */
  pollIntervalMs?: number
  /** Backoff between SSE reconnect attempts (linear). */
  reconnectDelayMs?: number
  /** Max reconnect attempts before giving up and falling back to polling. */
  maxReconnects?: number
}

const DEFAULT_POLL_INTERVAL_MS = 1500
const DEFAULT_RECONNECT_DELAY_MS = 1000
const DEFAULT_MAX_RECONNECTS = 5

function appendQuery(url: string, query?: StreamOptions["query"]): string {
  if (!query) return url
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined) continue
    params.set(key, String(value))
  }
  const suffix = params.toString()
  if (!suffix) return url
  return `${url}${url.includes("?") ? "&" : "?"}${suffix}`
}

/**
 * Open the bridge command channel. Returns a cleanup function that closes
 * any active EventSource AND stops any pending poll. Safe to call from
 * useEffect.
 *
 * Strategy:
 * 1. If EventSource is available, open it and listen for `command` events.
 * 2. On error, reconnect up to `maxReconnects` times with linear backoff.
 * 3. If EventSource is unavailable OR reconnects exhausted, fall back to
 *    polling. The fallback is sticky for the lifetime of this call —
 *    we don't try to upgrade back to SSE because the most likely cause
 *    of repeated SSE failure (proxy stripping event-stream) won't fix
 *    itself in-session.
 */
export function startUiCommandStream(opts: StreamOptions): () => void {
  const endpoint = opts.endpoint ?? ""
  const ctx = opts.ctx
  const query = opts.query
  const ESCtor =
    opts.eventSourceCtor === null
      ? null
      : opts.eventSourceCtor ?? (typeof EventSource !== "undefined" ? EventSource : null)
  const fetcher = opts.fetcher ?? (typeof fetch !== "undefined" ? fetch : null)
  const reconnectDelayMs = opts.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS
  const maxReconnects = opts.maxReconnects ?? DEFAULT_MAX_RECONNECTS
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS

  let cancelled = false
  let es: EventSource | null = null
  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let pollAbort: AbortController | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectAttempt = 0
  let onPollFallback = false

  function safeDispatch(raw: unknown): void {
    if (raw && typeof raw === "object" && typeof (raw as UiCommand).kind === "string") {
      dispatchUiCommand(raw as UiCommand, ctx)
    }
  }

  function startPollingFallback(): void {
    if (cancelled || onPollFallback || !fetcher) return
    onPollFallback = true
    const tick = async (): Promise<void> => {
      if (cancelled) return
      pollAbort = new AbortController()
      try {
        const res = await fetcher(appendQuery(`${endpoint}/api/v1/ui/commands/next?poll=true`, query), {
          signal: pollAbort.signal,
        })
        if (cancelled) return
        if (res.ok) {
          const body = (await res.json()) as unknown
          if (Array.isArray(body)) for (const cmd of body) safeDispatch(cmd)
        }
      } catch {
        /* Network blip — try again on next tick. */
      } finally {
        pollAbort = null
      }
      if (!cancelled) pollTimer = setTimeout(tick, pollIntervalMs)
    }
    void tick()
  }

  function openSse(): void {
    if (cancelled) return
    if (!ESCtor) {
      startPollingFallback()
      return
    }
    es = new ESCtor(appendQuery(`${endpoint}/api/v1/ui/commands/next`, query))
    es.addEventListener("command", (ev) => {
      const data = (ev as MessageEvent).data
      if (typeof data !== "string" || data.length === 0) return
      try {
        safeDispatch(JSON.parse(data))
      } catch {
        /* Malformed JSON — drop. */
      }
    })
    es.addEventListener("init", () => {
      // Fresh connection — reset backoff so a future hiccup gets the
      // full reconnect budget again instead of inheriting old attempts.
      reconnectAttempt = 0
    })
    es.addEventListener("error", () => {
      if (cancelled) return
      es?.close()
      es = null
      reconnectAttempt += 1
      if (reconnectAttempt > maxReconnects) {
        startPollingFallback()
        return
      }
      reconnectTimer = setTimeout(openSse, reconnectDelayMs * reconnectAttempt)
    })
  }

  openSse()

  return () => {
    cancelled = true
    if (es) {
      es.close()
      es = null
    }
    if (pollTimer) {
      clearTimeout(pollTimer)
      pollTimer = null
    }
    if (pollAbort) {
      pollAbort.abort()
      pollAbort = null
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }
}
