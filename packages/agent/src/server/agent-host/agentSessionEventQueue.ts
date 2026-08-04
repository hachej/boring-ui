import type { AgentSessionEvent } from '../../shared/index'

/** Minimal closeable async queue used by one live Agent session connection. */
export class AgentSessionEventQueue implements AsyncIterable<AgentSessionEvent> {
  private readonly pending: AgentSessionEvent[] = []
  private readonly waiters: Array<(result: IteratorResult<AgentSessionEvent>) => void> = []
  private ended = false

  push(event: AgentSessionEvent): void {
    if (this.ended) return
    const waiter = this.waiters.shift()
    if (waiter) waiter({ done: false, value: event })
    else this.pending.push(event)
  }

  close(): void {
    if (this.ended) return
    this.ended = true
    for (const waiter of this.waiters.splice(0)) waiter({ done: true, value: undefined })
  }

  [Symbol.asyncIterator](): AsyncIterator<AgentSessionEvent> {
    return {
      next: async () => {
        const event = this.pending.shift()
        if (event) return { done: false, value: event }
        if (this.ended) return { done: true, value: undefined }
        return await new Promise<IteratorResult<AgentSessionEvent>>((resolve) => this.waiters.push(resolve))
      },
      return: async () => {
        this.close()
        return { done: true, value: undefined }
      },
    }
  }
}
