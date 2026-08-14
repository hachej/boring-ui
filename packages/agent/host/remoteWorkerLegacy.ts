export {
  createLegacyRemoteWorkerSandbox as createRemoteWorkerSandbox,
  createLegacyRemoteWorkerWorkspace as createRemoteWorkerWorkspace,
  decodeLegacyRemoteWorkerBytes as decodeBytesFromWorker,
  encodeLegacyRemoteWorkerBytes as encodeBytesForWorker,
  LegacyRemoteWorkerClient as RemoteWorkerClient,
  LegacyRemoteWorkerClientError as RemoteWorkerClientError,
} from '@hachej/boring-sandbox/providers/remote-worker/legacy'
export type {
  LegacyRemoteWorkerClientOptions as RemoteWorkerClientOptions,
} from '@hachej/boring-sandbox/providers/remote-worker/legacy'
