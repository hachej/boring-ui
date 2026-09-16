export interface OneChatStartupServices {
  readonly registry: { close(): Promise<void> }
  readonly runtime?: { close(): Promise<void> }
  readonly vite?: { close(): Promise<void> }
  readonly runtimeModeAdapter: { dispose?(): Promise<void> }
}

/** Close every service in dependency order, without letting one failure orphan the rest. */
export async function closeOneChatStartupServices(
  services: OneChatStartupServices,
): Promise<void> {
  let firstError: unknown
  for (const close of [
    () => services.vite?.close() ?? Promise.resolve(),
    () => services.runtime?.close() ?? Promise.resolve(),
    () => services.registry.close(),
    () => services.runtimeModeAdapter.dispose?.() ?? Promise.resolve(),
  ]) {
    try {
      await close()
    } catch (error) {
      firstError ??= error
    }
  }
  if (firstError !== undefined) throw firstError
}
