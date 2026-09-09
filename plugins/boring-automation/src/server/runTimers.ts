import type { AutomationStore } from "./store"

const RUN_HEARTBEAT_INTERVAL_MS = 30_000
const RUN_DURATION_CAP_STOP_GRACE_MS = 5_000

export type DurationCapStopOutcome =
  | { confirmed: true }
  | { confirmed: false; reason: "session id was unavailable" | "session stop was rejected" | "session stop timed out" | "session stop was not confirmed" }

export class AutomationRunDurationCapExceededError extends Error {
  constructor(durationCapMs: number, readonly stopCompletion: Promise<DurationCapStopOutcome>) {
    super(`Automation run exceeded its ${durationCapMs}ms duration cap`)
    this.name = "AutomationRunDurationCapExceededError"
  }
}

export async function runWithDurationCap<T>(
  options: {
    durationCapMs: number
    sessionId: () => string | null
    stop: (sessionId: string) => Promise<boolean>
  },
  run: () => Promise<T>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const sessionId = options.sessionId()
      const stopCompletion = sessionId
        ? settleSessionStop(options.stop(sessionId), RUN_DURATION_CAP_STOP_GRACE_MS)
        : Promise.resolve({ confirmed: false as const, reason: "session id was unavailable" as const })
      reject(new AutomationRunDurationCapExceededError(options.durationCapMs, stopCompletion))
    }, options.durationCapMs)
    timer.unref?.()
  })
  try {
    return await Promise.race([run(), timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export async function settleSessionStop(stop: Promise<boolean>, graceMs: number): Promise<DurationCapStopOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const grace = new Promise<DurationCapStopOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ confirmed: false, reason: "session stop timed out" }), graceMs)
    timer.unref?.()
  })
  try {
    return await Promise.race([
      stop.then(
        (confirmed): DurationCapStopOutcome => confirmed ? { confirmed: true } : { confirmed: false, reason: "session stop was not confirmed" },
        (): DurationCapStopOutcome => ({ confirmed: false, reason: "session stop was rejected" }),
      ),
      grace,
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export function durationCapErrorMessage(error: AutomationRunDurationCapExceededError, stop: DurationCapStopOutcome): string {
  return stop.confirmed ? error.message : `${error.message}; ${stop.reason}; preserving occupied outcome`
}

export function startRunHeartbeat(store: AutomationStore, runId: string): () => Promise<void> {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let inFlight: Promise<void> = Promise.resolve()
  const schedule = () => {
    if (stopped) return
    timer = setTimeout(() => {
      inFlight = store.heartbeatRun(runId)
        .then((renewed) => {
          if (renewed) schedule()
          else stopped = true
        })
        .catch(() => schedule())
    }, RUN_HEARTBEAT_INTERVAL_MS)
    timer.unref?.()
  }
  schedule()
  return async () => {
    stopped = true
    if (timer !== undefined) clearTimeout(timer)
    await inFlight
  }
}
