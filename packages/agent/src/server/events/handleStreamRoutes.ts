import { ErrorCode } from '../../shared/error-codes'
import {
  type EventStreamReadResult,
  type EventStreamStore,
  formatOffset,
  parseOffset,
} from './eventStreamStore'

const LONG_POLL_TIMEOUT_MS = 30_000
const SSE_HEARTBEAT_MS = 15_000

export const STREAM_NEXT_OFFSET = 'Stream-Next-Offset'
export const STREAM_UP_TO_DATE = 'Stream-Up-To-Date'
export const STREAM_CLOSED = 'Stream-Closed'
export const STREAM_CURSOR = 'Stream-Cursor'

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'cross-origin',
}

const SSE_OFFSET_FIELD = 'streamNextOffset'
const SSE_CURSOR_FIELD = 'streamCursor'
const SSE_CLOSED_FIELD = 'streamClosed'
const SSE_UP_TO_DATE_FIELD = 'upToDate'

const CURSOR_EPOCH_MS = 1728432000000
const CURSOR_INTERVAL_MS = 20_000

type LiveMode = 'long-poll' | 'sse'

export async function handleStreamHead(store: EventStreamStore, path: string): Promise<Response> {
  const meta = await store.getStreamMeta(path)
  if (!meta) {
    const error = streamErrorResponse(404, ErrorCode.enum.SESSION_NOT_FOUND, 'stream not found')
    return new Response(null, { status: error.status, headers: error.headers })
  }

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...SECURITY_HEADERS,
    [STREAM_NEXT_OFFSET]: meta.nextOffset,
    [STREAM_UP_TO_DATE]: 'true',
    'cache-control': 'no-store',
    etag: generateETag(path, '-1', meta.nextOffset, meta.closed),
  }
  if (meta.closed) headers[STREAM_CLOSED] = 'true'

  return new Response(null, { status: 200, headers })
}

export async function handleStreamRead(
  store: EventStreamStore,
  path: string,
  request: Request,
): Promise<Response> {
  const url = new URL(request.url)
  const offsetValues = url.searchParams.getAll('offset')
  const offsetParam = offsetValues[0] ?? '-1'
  const tailValues = url.searchParams.getAll('tail')
  const tailParam = tailValues[0]
  const liveRaw = url.searchParams.get('live')
  const cursor = url.searchParams.get('cursor') ?? undefined

  if (offsetValues.length > 1) {
    return invalidRequest('Duplicate offset parameters are not allowed.')
  }
  if (tailValues.length > 1) {
    return invalidRequest('Duplicate tail parameters are not allowed.')
  }
  if (tailParam !== undefined && !/^[1-9]\d*$/.test(tailParam)) {
    return invalidRequest('Tail must be an integer greater than or equal to 1.')
  }
  if (liveRaw !== null && offsetValues.length === 0) {
    return invalidRequest('Offset is required for live mode.')
  }
  if (liveRaw !== null && liveRaw !== 'long-poll' && liveRaw !== 'sse') {
    return invalidRequest('Invalid live mode. Use "long-poll" or "sse".')
  }
  if (offsetParam !== '-1' && offsetParam !== 'now' && !/^\d+_\d+$/.test(offsetParam)) {
    return invalidRequest('Invalid offset format.')
  }

  const meta = await store.getStreamMeta(path)
  if (!meta) return streamErrorResponse(404, ErrorCode.enum.SESSION_NOT_FOUND, 'stream not found')

  const live = liveRaw as LiveMode | null
  const readOffset =
    offsetParam === 'now' && live !== null
      ? meta.nextOffset
      : offsetParam === '-1' && tailParam !== undefined
        ? formatOffset(Number(maxBigInt(-1n, BigInt(parseOffset(meta.nextOffset)) - BigInt(tailParam))))
        : offsetParam

  if (live === 'sse') {
    return handleSseMode(store, path, readOffset, request.signal)
  }

  const result = await store.readEvents(path, { offset: readOffset })
  if (live === 'long-poll') {
    return handleLongPollMode(store, path, readOffset, readOffset, cursor, result, request.signal)
  }

  return handleCatchUpMode(request, path, readOffset, result)
}

function maxBigInt(left: bigint, right: bigint): bigint {
  return left > right ? left : right
}

function generateCursor(clientCursor?: string): string {
  const currentInterval = Math.floor((Date.now() - CURSOR_EPOCH_MS) / CURSOR_INTERVAL_MS)
  if (!clientCursor) return String(currentInterval)
  const clientInterval = parseInt(clientCursor, 10)
  if (!Number.isFinite(clientInterval) || clientInterval < currentInterval) return String(currentInterval)
  return String(clientInterval + Math.floor(Math.random() * 180) + 1)
}

function generateETag(path: string, startOffset: string, endOffset: string, closed: boolean): string {
  const pathEncoded = Buffer.from(path).toString('base64')
  const closedSuffix = closed ? ':c' : ''
  return `"${pathEncoded}:${startOffset}:${endOffset}${closedSuffix}"`
}

function encodeSseData(payload: string): string {
  return `${payload.split(/\r\n|\r|\n/).map((line) => `data:${line}`).join('\n')}\n\n`
}

function eventData(result: EventStreamReadResult): unknown[] {
  return result.events.map((event) => event.data)
}

function invalidRequest(message: string): Response {
  return streamErrorResponse(400, ErrorCode.enum.BRIDGE_COMMAND_INVALID, message)
}

function streamErrorResponse(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: {
      'content-type': 'application/json',
      ...SECURITY_HEADERS,
    },
  })
}

function handleCatchUpMode(
  request: Request,
  path: string,
  offsetParam: string,
  result: EventStreamReadResult,
): Response {
  const isClosed = result.closed && result.upToDate
  const etag = offsetParam === 'now' ? undefined : generateETag(path, offsetParam, result.nextOffset, isClosed)
  const conditional = etag ? checkConditional(request, etag) : null
  if (conditional) return conditional

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    [STREAM_NEXT_OFFSET]: result.nextOffset,
    'cache-control': 'no-store',
    ...SECURITY_HEADERS,
  }
  if (etag) headers.etag = etag
  if (result.upToDate) headers[STREAM_UP_TO_DATE] = 'true'
  if (isClosed) headers[STREAM_CLOSED] = 'true'

  return new Response(JSON.stringify(eventData(result)), { status: 200, headers })
}

async function handleLongPollMode(
  store: EventStreamStore,
  path: string,
  readOffset: string,
  requestOffset: string,
  clientCursor: string | undefined,
  result: EventStreamReadResult,
  signal: AbortSignal,
): Promise<Response> {
  if (result.events.length > 0) {
    return longPollDataResponse(result, path, requestOffset, clientCursor)
  }
  if (result.closed && result.upToDate) {
    return longPollEmptyResponse(result.nextOffset, clientCursor, true)
  }

  const waitResult = await waitForStreamData(store, path, signal, async () => {
    const reread = await store.readEvents(path, { offset: readOffset })
    return reread.events.length > 0 || (reread.closed && reread.upToDate)
  })

  if (waitResult === 'aborted') return new Response(null, { status: 499, headers: SECURITY_HEADERS })
  if (waitResult === 'timeout') {
    const closed = (await store.getStreamMeta(path))?.closed ?? false
    return longPollEmptyResponse(result.nextOffset, clientCursor, closed)
  }

  const freshResult = await store.readEvents(path, { offset: readOffset })
  if (freshResult.events.length > 0) {
    return longPollDataResponse(freshResult, path, requestOffset, clientCursor)
  }
  const closed = (await store.getStreamMeta(path))?.closed ?? false
  return longPollEmptyResponse(result.nextOffset, clientCursor, closed)
}

function longPollDataResponse(
  result: EventStreamReadResult,
  path: string,
  offsetParam: string,
  clientCursor: string | undefined,
): Response {
  const isClosed = result.closed && result.upToDate
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    ...SECURITY_HEADERS,
    [STREAM_NEXT_OFFSET]: result.nextOffset,
    [STREAM_CURSOR]: generateCursor(clientCursor),
  }
  if (result.upToDate) headers[STREAM_UP_TO_DATE] = 'true'
  if (isClosed) headers[STREAM_CLOSED] = 'true'
  if (offsetParam !== 'now') headers.etag = generateETag(path, offsetParam, result.nextOffset, isClosed)
  return new Response(JSON.stringify(eventData(result)), { status: 200, headers })
}

function longPollEmptyResponse(nextOffset: string, clientCursor: string | undefined, closed: boolean): Response {
  const headers: Record<string, string> = {
    'cache-control': 'no-store',
    ...SECURITY_HEADERS,
    [STREAM_NEXT_OFFSET]: nextOffset,
    [STREAM_UP_TO_DATE]: 'true',
    [STREAM_CURSOR]: generateCursor(clientCursor),
  }
  if (closed) headers[STREAM_CLOSED] = 'true'
  return new Response(null, { status: 204, headers })
}

function waitForStreamData(
  store: EventStreamStore,
  path: string,
  signal: AbortSignal,
  recheck?: () => Promise<boolean>,
): Promise<'data' | 'timeout' | 'aborted'> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve('aborted')
      return
    }

    let settled = false
    const settle = (result: 'data' | 'timeout' | 'aborted') => {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }

    const unsubscribe = store.subscribe(path, () => settle('data'))
    const timer = setTimeout(() => settle('timeout'), LONG_POLL_TIMEOUT_MS)
    if (recheck) {
      void recheck().then((hasData) => {
        if (hasData) settle('data')
      }).catch(() => {})
    }
    const onAbort = () => settle('aborted')
    signal.addEventListener('abort', onAbort, { once: true })

    function cleanup(): void {
      unsubscribe()
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
    }
  })
}

function handleSseMode(
  store: EventStreamStore,
  path: string,
  offsetParam: string,
  signal: AbortSignal,
): Response {
  const encoder = new TextEncoder()
  let isConnected = true
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined
  let resolveCapacity: (() => void) | undefined

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      signal.addEventListener('abort', () => {
        isConnected = false
        resolveCapacity?.()
        resolveCapacity = undefined
        cleanup()
        try {
          controller.close()
        } catch {
          // Already closed.
        }
      }, { once: true })

      heartbeatTimer = setInterval(() => {
        if (!isConnected) return
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'))
        } catch {
          isConnected = false
          cleanup()
        }
      }, SSE_HEARTBEAT_MS)

      runSseLoop(
        store,
        path,
        offsetParam,
        controller,
        encoder,
        signal,
        () => isConnected,
        () => {
          if (controller.desiredSize === null || controller.desiredSize > 0) return Promise.resolve()
          return new Promise<void>((resolve) => {
            resolveCapacity = resolve
          })
        },
      ).then(
        () => {
          cleanup()
          try {
            controller.close()
          } catch {
            // Already closed.
          }
        },
        (error) => {
          cleanup()
          try {
            controller.error(error)
          } catch {
            // Already closed.
          }
        },
      )
    },
    pull() {
      resolveCapacity?.()
      resolveCapacity = undefined
    },
    cancel() {
      isConnected = false
      resolveCapacity?.()
      resolveCapacity = undefined
      cleanup()
    },
  })

  function cleanup(): void {
    if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer)
    heartbeatTimer = undefined
  }

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      ...SECURITY_HEADERS,
    },
  })
}

async function runSseLoop(
  store: EventStreamStore,
  path: string,
  offsetParam: string,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  signal: AbortSignal,
  isConnected: () => boolean,
  waitForCapacity: () => Promise<void>,
): Promise<void> {
  let currentOffset = offsetParam

  while (isConnected()) {
    await waitForCapacity()
    if (!isConnected()) return
    const result = await store.readEvents(path, { offset: currentOffset })

    if (result.events.length > 0) {
      const dataPayload = JSON.stringify(eventData(result))
      try {
        controller.enqueue(encoder.encode(`event: data\n${encodeSseData(dataPayload)}`))
      } catch {
        return
      }
    }

    const clientAtTail = result.upToDate
    const streamClosed = result.closed && clientAtTail
    const controlData: Record<string, string | boolean> = {
      [SSE_OFFSET_FIELD]: result.nextOffset,
    }
    if (streamClosed) {
      controlData[SSE_CLOSED_FIELD] = true
    } else {
      controlData[SSE_CURSOR_FIELD] = generateCursor()
      if (clientAtTail) controlData[SSE_UP_TO_DATE_FIELD] = true
    }

    try {
      controller.enqueue(encoder.encode(`event: control\n${encodeSseData(JSON.stringify(controlData))}`))
    } catch {
      return
    }

    currentOffset = result.nextOffset
    if (streamClosed) return
    if (!clientAtTail) continue

    const waitResult = await waitForStreamData(store, path, signal, async () => {
      const reread = await store.readEvents(path, { offset: currentOffset })
      return reread.events.length > 0 || (reread.closed && reread.upToDate)
    })
    if (waitResult === 'aborted') return
    if (waitResult === 'timeout') {
      const keepAlive: Record<string, string | boolean> = {
        [SSE_OFFSET_FIELD]: currentOffset,
        [SSE_CURSOR_FIELD]: generateCursor(),
        [SSE_UP_TO_DATE_FIELD]: true,
      }
      try {
        controller.enqueue(encoder.encode(`event: control\n${encodeSseData(JSON.stringify(keepAlive))}`))
      } catch {
        return
      }
    }
  }
}

function checkConditional(request: Request, etag: string): Response | null {
  const ifNoneMatch = request.headers.get('if-none-match')
  if (ifNoneMatch === etag) {
    return new Response(null, { status: 304, headers: { etag, ...SECURITY_HEADERS } })
  }
  return null
}
