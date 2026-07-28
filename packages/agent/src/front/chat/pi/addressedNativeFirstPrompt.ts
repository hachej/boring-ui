import type { SessionSummary } from '../../../shared/session'
import type { PromptPayload, PromptReceipt } from '../../../shared/chat'
import { PromptReceiptSchema } from '../../../shared/chat'
import {
  type NativeFirstSendErrorKind,
  sendNativeFirst,
} from './nativeFirstSendTransactions'

export interface AddressedNativeFirstPromptResult {
  receipt: PromptReceipt
  session: SessionSummary
}

export interface AddressedNativeFirstPromptOptions {
  dataSource: string
  localId: string
  timeoutMs: number
  apiBaseUrl: string
  agentTypeId: string
  payload: PromptPayload
  requestHeaders: () => Promise<Record<string, string>>
  connectSession: (sessionId: string) => Promise<void>
  commandPayload: (payload: PromptPayload) => unknown
  fetchJson: (url: string, init: RequestInit, signal: AbortSignal) => Promise<unknown>
  classifyError: (error: unknown) => NativeFirstSendErrorKind
}

/**
 * Creates one addressed native session, connects its replayable event stream,
 * then sends the first prompt. The transaction owns the stable create key so
 * an ambiguous response can reconcile without producing a second transcript.
 */
export async function sendAddressedNativeFirstPrompt(
  options: AddressedNativeFirstPromptOptions,
): Promise<AddressedNativeFirstPromptResult> {
  return sendNativeFirst(
    options.dataSource,
    options.localId,
    options.timeoutMs,
    addressedNativeFirstPromptIdentity(options.payload),
    async ({ idempotencyKey, signal }) => {
      const headers = await raceAbort(signal, options.requestHeaders)
      const created = await options.fetchJson(
        `${options.apiBaseUrl}/api/v1/agents/${encodeURIComponent(options.agentTypeId)}/sessions`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId: idempotencyKey }),
        },
        signal,
      )
      const sessionId = addressedCreatedSessionId(created)
      await options.connectSession(sessionId)
      const receipt = await options.fetchJson(
        `${options.apiBaseUrl}/api/v1/agents/${encodeURIComponent(options.agentTypeId)}/sessions/${encodeURIComponent(sessionId)}/prompt`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(options.commandPayload(options.payload)),
        },
        signal,
      )
      let parsed: PromptReceipt
      try {
        parsed = PromptReceiptSchema.parse(receipt)
      } catch {
        throw new NativeFirstPromptInvalidReceiptError()
      }
      const now = new Date().toISOString()
      return {
        receipt: parsed,
        session: {
          id: sessionId,
          title: 'Untitled',
          createdAt: now,
          updatedAt: now,
          turnCount: 0,
        },
      }
    },
    options.classifyError,
  )
}

export class NativeFirstPromptInvalidReceiptError extends Error {
  constructor() {
    super('Native session start returned an invalid receipt.')
    this.name = 'NativeFirstPromptInvalidReceiptError'
  }
}

export function addressedNativeFirstPromptIdentity(payload: PromptPayload): string {
  return JSON.stringify([
    payload.message,
    payload.displayMessage ?? null,
    payload.clientNonce,
    payload.model?.provider ?? null,
    payload.model?.id ?? null,
    payload.thinkingLevel ?? null,
    (payload.attachments ?? []).map((attachment) => [
      attachment.filename ?? null,
      attachment.mediaType ?? null,
      attachment.url,
      attachment.path ?? null,
    ]),
  ])
}

function addressedCreatedSessionId(value: unknown): string {
  if (typeof value !== 'object' || value === null) throw new NativeFirstPromptInvalidReceiptError()
  const sessionId = (value as { sessionId?: unknown }).sessionId
  if (typeof sessionId !== 'string' || !sessionId) throw new NativeFirstPromptInvalidReceiptError()
  return sessionId
}

function raceAbort<T>(signal: AbortSignal, request: () => Promise<T>): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError('Request aborted.'))
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError('Request aborted.'))
    signal.addEventListener('abort', onAbort, { once: true })
    void request().then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

function abortError(message: string): DOMException {
  return new DOMException(message, 'AbortError')
}
