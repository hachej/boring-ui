const MAX_TRANSACTIONS = 32
const STALE_TRANSACTION_MS = 5 * 60_000

interface Transaction<T> {
  idempotencyKey: string
  ambiguous: boolean
  adopted: boolean
  inFlight?: Promise<T>
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
  request: NativeFirstSendRequest<T>,
  isAmbiguous: (error: unknown) => boolean,
): Promise<T> {
  cleanupTransactions()
  const key = `${dataSource}\n${localId}`
  let transaction = transactions.get(key) as Transaction<T> | undefined
  if (!transaction) {
    transaction = { idempotencyKey: nativeFirstPromptKey(), ambiguous: false, adopted: false, touchedAt: Date.now() }
    transactions.set(key, transaction)
  }
  transaction.touchedAt = Date.now()
  if (transaction.inFlight) return transaction.inFlight

  const run = async (): Promise<T> => {
    try {
      return await requestWithLifetime(timeoutMs, transaction!, request)
    } catch (error) {
      if (!isAmbiguous(error)) {
        transactions.delete(key)
        throw error
      }
      transaction!.ambiguous = true
      try {
        return await requestWithLifetime(timeoutMs, transaction!, request)
      } catch (reconciliationError) {
        if (!isAmbiguous(reconciliationError)) transactions.delete(key)
        throw reconciliationError
      }
    }
  }
  const inFlight = run()
  transaction.inFlight = inFlight
  try {
    return await inFlight
  } finally {
    if (transaction.inFlight === inFlight) transaction.inFlight = undefined
    transaction.touchedAt = Date.now()
  }
}

export function completeNativeFirst(dataSource: string, localId: string, onAdopt?: () => void): boolean {
  const key = `${dataSource}\n${localId}`
  const transaction = transactions.get(key)
  if (!transaction || transaction.adopted) return false
  transaction.adopted = true
  try {
    onAdopt?.()
  } finally {
    transactions.delete(key)
  }
  return true
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

function cleanupTransactions(): void {
  const staleBefore = Date.now() - STALE_TRANSACTION_MS
  for (const [key, transaction] of transactions) {
    if (!transaction.inFlight && transaction.touchedAt < staleBefore) transactions.delete(key)
  }
  while (transactions.size >= MAX_TRANSACTIONS) {
    const oldest = [...transactions.entries()]
      .filter(([, transaction]) => !transaction.inFlight)
      .sort(([, a], [, b]) => a.touchedAt - b.touchedAt)[0]
    if (!oldest) return
    transactions.delete(oldest[0])
  }
}

function nativeFirstPromptKey(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `native-${Date.now()}-${Math.random().toString(36).slice(2)}`
}
