import {
  SandboxInstance,
  VolumeInstance,
  getVolume,
  type SandboxCreateConfiguration,
  type SandboxLifecycle,
  type SandboxSpec,
  type VolumeCreateConfiguration,
  type VolumeSpec,
} from '@blaxel/core'

export type BlaxelProcessStatus =
  | 'failed'
  | 'killed'
  | 'stopped'
  | 'running'
  | 'completed'

export interface BlaxelProcessResult {
  command: string
  exitCode: number
  name: string
  pid: string
  status: BlaxelProcessStatus
  stderr: string
  stdout: string
  workingDir: string
}

export interface BlaxelDirectory {
  files: Array<{
    lastModified: string
    name: string
    path: string
    size?: number
  }>
  subdirectories: Array<{ name: string; path: string }>
}

export interface BlaxelWatchEvent {
  op: 'CREATE' | 'WRITE' | 'REMOVE' | 'RENAME' | 'CHMOD'
  path: string
  name: string
}

export interface BlaxelRemoteSandbox {
  readonly name: string
  readonly externalId?: string
  readonly status?: string
  readonly spec: SandboxSpec
  readonly fs: {
    mkdir(path: string, permissions?: string): Promise<unknown>
    write(path: string, content: string): Promise<unknown>
    writeBinary(path: string, content: Uint8Array): Promise<unknown>
    read(path: string): Promise<string>
    readBinary(path: string): Promise<Blob>
    rm(path: string, recursive?: boolean): Promise<unknown>
    ls(path: string): Promise<BlaxelDirectory>
    watch(
      path: string,
      callback: (event: BlaxelWatchEvent) => void | Promise<void>,
      options: {
        withContent: boolean
        onError?: (error: Error) => void
      },
    ): { close(): void }
  }
  readonly process: {
    exec(request: {
      command: string
      env?: Record<string, string>
      keepAlive?: boolean
      name?: string
      timeout?: number
      waitForCompletion?: boolean
      workingDir?: string
    }): Promise<BlaxelProcessResult>
    get(identifier: string): Promise<BlaxelProcessResult>
    kill(identifier: string): Promise<unknown>
  }
}

export interface BlaxelRemoteVolume {
  readonly name: string
  readonly spec: VolumeSpec
}

export interface BlaxelClient {
  getSandbox(name: string): Promise<BlaxelRemoteSandbox>
  createSandbox(config: SandboxCreateConfiguration): Promise<BlaxelRemoteSandbox>
  getVolume(name: string): Promise<BlaxelRemoteVolume>
  createVolume(config: VolumeCreateConfiguration): Promise<BlaxelRemoteVolume>
  getVolumeAttachment(name: string): Promise<string | undefined>
}

function toSandbox(instance: SandboxInstance): BlaxelRemoteSandbox {
  return {
    name: instance.metadata.name,
    externalId: instance.metadata.externalId,
    status: instance.status,
    spec: instance.spec,
    fs: instance.fs,
    process: instance.process,
  }
}

function toVolume(instance: VolumeInstance): BlaxelRemoteVolume {
  return {
    name: instance.name,
    spec: instance.spec,
  }
}

export function createBlaxelClient(): BlaxelClient {
  return {
    async getSandbox(name) {
      return toSandbox(await SandboxInstance.get(name))
    },
    async createSandbox(config) {
      return toSandbox(await SandboxInstance.createIfNotExists(config))
    },
    async getVolume(name) {
      return toVolume(await VolumeInstance.get(name))
    },
    async createVolume(config) {
      return toVolume(await VolumeInstance.createIfNotExists(config))
    },
    async getVolumeAttachment(name) {
      const response = await getVolume({ path: { volumeName: name } })
      if (response.error) throw response.error
      return response.data?.state?.attachedTo
    },
  }
}

export type { SandboxCreateConfiguration, SandboxLifecycle, VolumeCreateConfiguration }
