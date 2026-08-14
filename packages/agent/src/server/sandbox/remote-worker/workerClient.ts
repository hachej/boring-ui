import { timingSafeEqual } from 'node:crypto'

export {
  decodeBytesFromWorker,
  encodeBytesForWorker,
  RemoteWorkerClient,
  RemoteWorkerClientError,
} from '../../../../host/remoteWorkerLegacy'
export type {
  RemoteWorkerClientOptions,
} from '../../../../host/remoteWorkerLegacy'

export function constantTimeTokenEqual(a: string, b: string): boolean {
  if (!a || !b) return false
  const aBytes = Buffer.from(a)
  const bBytes = Buffer.from(b)
  if (aBytes.length !== bBytes.length) return false
  return timingSafeEqual(aBytes, bBytes)
}
