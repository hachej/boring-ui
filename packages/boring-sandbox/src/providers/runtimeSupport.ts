export interface ProviderLogger {
  debug(message: string, metadata?: Record<string, unknown>): void
  info(message: string, metadata?: Record<string, unknown>): void
  warn(message: string, metadata?: Record<string, unknown>): void
  error(message: string, metadata?: Record<string, unknown>): void
}

export function getEnv(name: string): string | undefined {
  return process.env[name]
}

export function getEnvSnapshot(): Record<string, string | undefined> {
  return { ...process.env }
}

export function setEnvDefault(name: string, value: string): boolean {
  if (process.env[name] !== undefined) return false
  process.env[name] = value
  return true
}

export function safeCapture(
  telemetry: { capture(event: { name: string; properties?: Record<string, unknown> }): void | Promise<void> },
  event: { name: string; properties?: Record<string, unknown> },
): void {
  try {
    void Promise.resolve(telemetry.capture(event)).catch(() => {})
  } catch {}
}

export function createLogger(prefix: string): ProviderLogger {
  const emit = (level: string, message: string, metadata?: Record<string, unknown>): void => {
    const suffix = metadata ? ` ${JSON.stringify(metadata)}` : ''
    process.stderr.write(`[${prefix}] ${level} ${message}${suffix}\n`)
  }

  return {
    debug(message, metadata) { emit('debug', message, metadata) },
    info(message, metadata) { emit('info', message, metadata) },
    warn(message, metadata) { emit('warn', message, metadata) },
    error(message, metadata) { emit('error', message, metadata) },
  }
}
