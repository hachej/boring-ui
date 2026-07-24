import type { RuntimeModeId } from './runtime/mode'

/** Direct/local runtimes are single-user host contexts and own native Pi transcripts. */
export function nativeSessionStartEnabledForRuntime(runtimeMode: RuntimeModeId): boolean {
  return runtimeMode === 'direct' || runtimeMode === 'local'
}
