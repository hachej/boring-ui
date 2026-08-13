import { timingSafeEqual } from 'node:crypto'

export {
  decodeLegacyRemoteWorkerBytes as decodeBytesFromWorker,
  encodeLegacyRemoteWorkerBytes as encodeBytesForWorker,
  LegacyRemoteWorkerClient as RemoteWorkerClient,
  LegacyRemoteWorkerClientError as RemoteWorkerClientError,
} from '@hachej/boring-sandbox/providers/remote-worker/legacy'
export type {
  LegacyRemoteWorkerClientOptions as RemoteWorkerClientOptions,
} from '@hachej/boring-sandbox/providers/remote-worker/legacy'

export function constantTimeTokenEqual(a: string, b: string): boolean {
  if (!a || !b) return false
  const aBytes = Buffer.from(a)
  const bBytes = Buffer.from(b)
  if (aBytes.length !== bBytes.length) return false
  return timingSafeEqual(aBytes, bBytes)
}
