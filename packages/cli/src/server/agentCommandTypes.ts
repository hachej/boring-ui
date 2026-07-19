import type {
  AgentHarnessFactory,
  AuthoredAgentToolCatalog,
  RuntimeModeAdapter,
} from "@hachej/boring-agent/server"

export interface AgentDevTrustedToolCatalogAdapter {
  resolveToolCatalog(input: {
    directory: string
    agentTypeId: string
    declaredToolRefs: readonly string[]
  }): AuthoredAgentToolCatalog | undefined | Promise<AuthoredAgentToolCatalog | undefined>
}

export interface RunCliAgentDevOptions {
  trustedToolCatalogAdapter?: AgentDevTrustedToolCatalogAdapter
  harnessFactory?: AgentHarnessFactory
  runtimeModeAdapter?: RuntimeModeAdapter
  provisionWorkspace?: boolean
}

export interface AgentCommandRunOptions {
  argv?: string[]
  publicDir: string
  agentDev?: RunCliAgentDevOptions
}
