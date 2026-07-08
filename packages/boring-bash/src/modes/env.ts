export function getEnv(name: string): string | undefined {
  return process.env[name]
}

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
