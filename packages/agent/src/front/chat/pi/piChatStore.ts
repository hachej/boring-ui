import { piChatReducer, type PiChatReducerAction, type PiChatState } from './piChatReducer'

export type PiChatStoreListener = () => void

export interface PiChatStoreOptions {
  scheduleNotify?: (notify: () => void) => unknown
  cancelNotify?: (handle: unknown) => void
}

export interface PiChatStore {
  getState(): PiChatState
  dispatch(action: PiChatReducerAction, options?: { flush?: boolean }): void
  subscribe(listener: PiChatStoreListener): () => void
  dispose(): void
}

function defaultScheduleNotify(notify: () => void): unknown {
  if (typeof globalThis.requestAnimationFrame === 'function') return globalThis.requestAnimationFrame(() => notify())
  return globalThis.setTimeout(notify, 0)
}

function defaultCancelNotify(handle: unknown): void {
  if (typeof handle !== 'number') return
  if (typeof globalThis.cancelAnimationFrame === 'function') globalThis.cancelAnimationFrame(handle)
  globalThis.clearTimeout(handle)
}

export function createPiChatStore(initialState: PiChatState, options: PiChatStoreOptions = {}): PiChatStore {
  let state = initialState
  let disposed = false
  let scheduled: unknown
  const listeners = new Set<PiChatStoreListener>()
  const scheduleNotify = options.scheduleNotify ?? defaultScheduleNotify
  const cancelNotify = options.cancelNotify ?? defaultCancelNotify

  const notifyNow = () => {
    scheduled = undefined
    if (disposed) return
    for (const listener of listeners) listener()
  }

  const schedule = () => {
    if (scheduled !== undefined) return
    scheduled = scheduleNotify(notifyNow)
  }

  return {
    getState() {
      return state
    },
    dispatch(action, dispatchOptions) {
      if (disposed) return
      state = piChatReducer(state, action)
      if (dispatchOptions?.flush) {
        if (scheduled !== undefined) {
          cancelNotify(scheduled)
          scheduled = undefined
        }
        notifyNow()
        return
      }
      schedule()
    },
    subscribe(listener) {
      if (disposed) return () => {}
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose() {
      disposed = true
      listeners.clear()
      if (scheduled !== undefined) {
        cancelNotify(scheduled)
        scheduled = undefined
      }
    },
  }
}
