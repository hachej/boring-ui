import { WORKER_ERROR_CODES } from './error-codes'

export class ExecSemaphore {
  private active = 0

  constructor(private readonly limit: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      throw Object.assign(new Error('worker exec concurrency limit reached'), {
        statusCode: 429,
        code: WORKER_ERROR_CODES.EXEC_CONCURRENCY_LIMIT,
      })
    }
    this.active += 1
    try {
      return await fn()
    } finally {
      this.active -= 1
    }
  }
}

export function buildExecEnv(input: Record<string, string> | undefined): Record<string, string> {
  const safe: Record<string, string> = {
    PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    HOME: '/workspace',
    LANG: 'C.UTF-8',
  }
  if (!input) return safe
  for (const [key, value] of Object.entries(input)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    if (key.startsWith('BORING_WORKER_')) continue
    if (key.endsWith('_API_KEY') || key.endsWith('_TOKEN') || key.endsWith('_SECRET')) continue
    if (key === 'DATABASE_URL') continue
    safe[key] = String(value)
  }
  return safe
}
