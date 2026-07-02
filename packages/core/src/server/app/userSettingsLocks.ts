const userSettingsWriteQueues = new Map<string, Promise<void>>()

function userSettingsWriteKey(userId: string, appId: string): string {
  return `${appId}\0${userId}`
}

export async function withUserSettingsWriteLock<T>(
  userId: string,
  appId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = userSettingsWriteKey(userId, appId)
  const previous = userSettingsWriteQueues.get(key) ?? Promise.resolve()
  const run = previous.catch(() => undefined).then(fn)
  const settled = run.then(() => undefined, () => undefined)
  userSettingsWriteQueues.set(key, settled)
  try {
    return await run
  } finally {
    if (userSettingsWriteQueues.get(key) === settled) userSettingsWriteQueues.delete(key)
  }
}
