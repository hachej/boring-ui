import type {
  BORING_FACTORY_RESOURCE_CONTRACT_VERSION,
  FACTORY_AGENT_TYPE_IDS,
} from './constants'

export type FactoryAgentTypeId = (typeof FACTORY_AGENT_TYPE_IDS)[number]

export interface BoringFactoryResourceManifestV1 {
  readonly contractVersion: typeof BORING_FACTORY_RESOURCE_CONTRACT_VERSION
  readonly files: Readonly<Record<string, string>>
}

export interface BoringFactoryResources {
  readonly resourceRoot: string
  readonly skillRoot: string
  readonly resourceDigest: `sha256:${string}`
  readonly manifest: BoringFactoryResourceManifestV1
  readonly agentSources: Readonly<Record<FactoryAgentTypeId, string>>
}
