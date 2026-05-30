export function getEnv(name: string): string | undefined {
  return process.env[name]
}

export function getEnvSnapshot(): Record<string, string | undefined> {
  return { ...process.env }
}

/**
 * Set an env var only when it is currently unset, returning whether it was
 * applied. Lets providers seed a sensible default (e.g. the Vercel uv path) that
 * an explicit deploy-config value still overrides. Centralized here so the rest
 * of the codebase never touches `process.env` directly (grep-enforced invariant).
 */
export function setEnvDefault(name: string, value: string): boolean {
  if (process.env[name] !== undefined) return false
  process.env[name] = value
  return true
}

export function setEnvForTest(name: string, value: string | undefined): string | undefined {
  const previous = process.env[name]
  if (typeof value === 'string') {
    process.env[name] = value
  } else {
    delete process.env[name]
  }
  return previous
}

export function restoreEnvForTest(name: string, previous: string | undefined): void {
  if (typeof previous === 'string') {
    process.env[name] = previous
  } else {
    delete process.env[name]
  }
}
