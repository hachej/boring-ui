import type {
  AuthoredAgentToolCatalog,
  MaterializedAgentSourceV1,
} from "@hachej/boring-agent/server"

export interface AgentValidateBundle {
  definition: {
    definitionId: string
    version: string
    label?: string
    instructionsRef: string
    capabilityRequirements?: readonly string[]
    toolRefs?: readonly string[]
    skillRefs?: readonly string[]
    mcpServerRefs?: readonly string[]
  }
  assets: readonly { path: string; content: string }[]
}

export interface AgentCommandDeps {
  AgentDefinitionValidationError: new (...args: never[]) => Error & {
    validationCode: string
    field: string
  }
  AgentDirectoryCompilerError: new (...args: never[]) => Error & {
    compilerCode: string
    field: string
  }
  AuthoredAgentMaterializationError: new (...args: never[]) => Error & {
    code: string
    field?: string
  }
  compileAgentDirectory: (directory: string) => Promise<AgentValidateBundle>
  materializeAgentDirectory: (input: {
    directory: string
    expectedAgentTypeId?: string
    toolCatalog?: AuthoredAgentToolCatalog
  }) => Promise<MaterializedAgentSourceV1>
  createMaterializedAgentDevApp: typeof import("@hachej/boring-workspace/app/server")["createMaterializedAgentDevApp"]
}

export async function loadAgentCommandDeps(): Promise<AgentCommandDeps> {
  const [server, shared, workspaceAppServer] = await Promise.all([
    import("@hachej/boring-agent/server"),
    import("@hachej/boring-agent/shared"),
    import("@hachej/boring-workspace/app/server"),
  ])
  return {
    AgentDefinitionValidationError: shared.AgentDefinitionValidationError as AgentCommandDeps["AgentDefinitionValidationError"],
    AgentDirectoryCompilerError: server.AgentDirectoryCompilerError as AgentCommandDeps["AgentDirectoryCompilerError"],
    AuthoredAgentMaterializationError: server.AuthoredAgentMaterializationError as AgentCommandDeps["AuthoredAgentMaterializationError"],
    compileAgentDirectory: server.compileAgentDirectory as AgentCommandDeps["compileAgentDirectory"],
    materializeAgentDirectory: server.materializeAgentDirectory as AgentCommandDeps["materializeAgentDirectory"],
    createMaterializedAgentDevApp: workspaceAppServer.createMaterializedAgentDevApp,
  }
}
