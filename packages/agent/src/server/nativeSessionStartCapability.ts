import type { RuntimeModeId } from './runtime/mode'

/** Bare native transcripts are allowed only by an explicit local-host opt-in. */
export function nativeSessionStartEnabledForRuntime(
  runtimeMode: RuntimeModeId,
  trustedDirectLocalNativeSessions: boolean | undefined,
): boolean {
  return trustedDirectLocalNativeSessions === true
    && (runtimeMode === 'direct' || runtimeMode === 'local')
}
