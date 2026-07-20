import { ErrorCode } from '../../../shared/error-codes'

const MAX_TRANSACTIONS = 32
const STALE_TRANSACTION_MS = 5 * 60_000

export enum NativeFirstSendErrorKind {
  Ambiguous,
  TerminalUnknown,
  Definite,
}

interface Transaction<T> {
  idempotencyKey: string
  requestIdentity: string
  ambiguous: boolean
  adopted: boolean
  tombstoned: boolean
  terminalError?: Error
  inFlight?: Promise<T>
  settledReceipt?: T
  touchedAt: number
}

interface NativeFirstSendRequest<T> {
  (input: { idempotencyKey: string; retry: boolean; signal: AbortSignal }): Promise<T>
}

const transactions = new Map<string, Transaction<unknown>>()

export async function sendNativeFirst<T>(
  dataSource: string,
  localId: string,
  timeoutMs: number,
  requestIdentity: string,
  request: NativeFirstSendRequest<T>,
  classifyError: (error: unknown) => NativeFirstSendErrorKind,
): Promise<T> {
  const hasCapacity = cleanupTransactions()
  const key = `${dataSource}\n${localId}`
  let transaction = transactions.get(key) as Transaction<T> | undefined
  if (!transaction) {
    if (!hasCapacity) throw nativeFirstRequestConflictError()
    transaction = { idempotencyKey: nativeFirstPromptKey(), requestIdentity, ambiguous: false, adopted: false, tombstoned: false, touchedAt: Date.now() }
    transactions.set(key, transaction)
  }
  transaction.touchedAt = Date.now()
  if (transaction.terminalError) throw transaction.terminalError
  if (transaction.requestIdentity !== requestIdentity) throw nativeFirstRequestConflictError()
  if (transaction.inFlight) return transaction.inFlight
  if (transaction.tombstoned) throw nativeFirstRequestConflictError()
  if (transaction.settledReceipt !== undefined) return transaction.settledReceipt

  const run = async (): Promise<T> => {
    try {
      return await requestWithLifetime(timeoutMs, transaction!, request)
    } catch (error) {
      const firstErrorKind = classifyError(error)
      if (firstErrorKind === NativeFirstSendErrorKind.Definite) {
        transactions.delete(key)
        throw error
      }
      if (firstErrorKind === NativeFirstSendErrorKind.TerminalUnknown) {
        transaction!.terminalError = toError(error)
        throw transaction!.terminalError
      }
      transaction!.ambiguous = true
      try {
        return await requestWithLifetime(timeoutMs, transaction!, request)
      } catch (reconciliationError) {
        const reconciliationErrorKind = classifyError(reconciliationError)
        if (reconciliationErrorKind === NativeFirstSendErrorKind.Definite) {
          transactions.delete(key)
          throw reconciliationError
        }
        transaction!.terminalError = reconciliationErrorKind === NativeFirstSendErrorKind.TerminalUnknown
          ? toError(reconciliationError)
          : nativeFirstPromptUnknownError()
        throw transaction!.terminalError
      }
    }
  }
  const inFlight = run()
  transaction.inFlight = inFlight
  try {
    const receipt = await inFlight
    transaction.settledReceipt = receipt
    return receipt
  } finally {
    if (transaction.inFlight === inFlight) transaction.inFlight = undefined
    transaction.touchedAt = Date.now()
  }
}

export function completeNativeFirst(dataSource: string, localId: string, onAdopt?: () => void): boolean {
  const key = `${dataSource}\n${localId}`
  const transaction = transactions.get(key)
  if (!transaction || transaction.adopted || transaction.tombstoned) return false
  transaction.adopted = true
  try {
    onAdopt?.()
  } finally {
    transactions.delete(key)
  }
  return true
}

/**
 * Keeps an in-flight first send alive while its browser-local draft is being
 * deleted. Its eventual receipt can then be used to delete the one native
 * transcript it created, but it can never adopt the discarded draft.
 */
export function tombstoneNativeFirst<T>(dataSource: string, localId: string): Promise<T | undefined> {
  const transaction = transactions.get(`${dataSource}\n${localId}`) as Transaction<T> | undefined
  if (!transaction) return Promise.resolve(undefined)
  transaction.tombstoned = true
  transaction.touchedAt = Date.now()
  return transaction.inFlight ?? Promise.resolve(transaction.settledReceipt)
}

/** Clears a terminal or tombstoned first-send record once its discard settles. */
export function clearNativeFirst(dataSource: string, localId: string): void {
  transactions.delete(`${dataSource}\n${localId}`)
}

async function requestWithLifetime<T>(
  timeoutMs: number,
  transaction: Transaction<T>,
  request: NativeFirstSendRequest<T>,
): Promise<T> {
  const controller = new AbortController()
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await request({
      idempotencyKey: transaction.idempotencyKey,
      retry: transaction.ambiguous,
      signal: controller.signal,
    })
  } finally {
    globalThis.clearTimeout(timer)
  }
}

function cleanupTransactions(): boolean {
  const staleBefore = Date.now() - STALE_TRANSACTION_MS
  for (const [key, transaction] of transactions) {
    if (!transaction.inFlight && !transaction.terminalError && transaction.settledReceipt === undefined && transaction.touchedAt < staleBefore) transactions.delete(key)
  }
  while (transactions.size >= MAX_TRANSACTIONS) {
    const oldest = [...transactions.entries()]
      .filter(([, transaction]) => !transaction.inFlight && !transaction.terminalError && transaction.settledReceipt === undefined)
      .sort(([, a], [, b]) => a.touchedAt - b.touchedAt)[0]
    if (!oldest) break
    transactions.delete(oldest[0])
  }
  return transactions.size < MAX_TRANSACTIONS
}

export function nativeFirstRequestConflictError(): Error {
  return Object.assign(new Error('A different message is already starting this chat.'), { errorCode: ErrorCode.enum.SESSION_LOCKED })
}

function nativeFirstPromptUnknownError(): Error {
  return Object.assign(new Error('Native session start outcome is unknown after its one reconciliation retry.'), {
    errorCode: ErrorCode.enum.NATIVE_SESSION_START_OUTCOME_UNKNOWN,
  })
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function nativeFirstPromptKey(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `native-${Date.now()}-${Math.random().toString(36).slice(2)}`
}
