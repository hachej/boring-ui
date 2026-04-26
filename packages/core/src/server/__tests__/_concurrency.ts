export type ConcurrentOutcome<T> =
  | { status: 'fulfilled'; value: T }
  | { status: 'rejected'; reason: unknown }

export interface RunConcurrentOptions {
  barrier?: number
}

export async function runConcurrent<T>(
  tasks: Array<() => Promise<T>>,
  options: RunConcurrentOptions = {},
): Promise<Array<ConcurrentOutcome<T>>> {
  const barrierSize = options.barrier ?? tasks.length
  if (barrierSize < 1) {
    throw new Error('runConcurrent barrier must be >= 1')
  }
  if (barrierSize > tasks.length) {
    throw new Error('runConcurrent barrier cannot exceed task count')
  }

  let waiting = 0
  let releaseBarrier: (() => void) | null = null
  const barrier = new Promise<void>((resolve) => {
    releaseBarrier = resolve
  })

  const runners = tasks.map(async (task) => {
    waiting += 1
    if (waiting === barrierSize && releaseBarrier) {
      releaseBarrier()
    }

    await barrier

    try {
      const value = await task()
      return { status: 'fulfilled', value } as const
    } catch (reason) {
      return { status: 'rejected', reason } as const
    }
  })

  return Promise.all(runners)
}
