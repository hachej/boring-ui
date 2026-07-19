import type { AgentCommandDeps, AgentValidateBundle } from "./agentCommandDeps.js"
import {
  AgentValidateCliError,
  safeHumanJsonValue,
  safeHumanValue,
} from "./agentCommandSafe.js"

export interface AgentValidateSuccessV1 {
  schemaVersion: 1
  ok: true
  agent: {
    agentTypeId: string
    version: string
    label?: string
    instructions: { present: true; byteLength: number }
    refs: {
      tools: string[]
      capabilities: string[]
      skills: string[]
      mcpServers: string[]
    }
  }
}

const AGENT_TYPE_ID_RE = /^[a-z][a-z0-9-]{0,62}$/

export function copyRefs(refs: readonly string[] | undefined): string[] {
  return refs === undefined ? [] : [...refs]
}

export function createAgentValidateSuccess(bundle: AgentValidateBundle): AgentValidateSuccessV1 {
  const { definition } = bundle
  if (!AGENT_TYPE_ID_RE.test(definition.definitionId)) {
    throw new AgentValidateCliError({
      code: "AUTHORED_AGENT_ID_INVALID",
      field: "definitionId",
      message: "definitionId must match ^[a-z][a-z0-9-]{0,62}$",
    })
  }

  const instructions = bundle.assets.find((asset) => asset.path === definition.instructionsRef)?.content
  if (instructions === undefined) {
    throw new AgentValidateCliError({
      code: "INTERNAL_ERROR",
      field: "instructionsRef",
      message: "compiled agent instructions asset is missing",
    })
  }

  return {
    schemaVersion: 1,
    ok: true,
    agent: {
      agentTypeId: definition.definitionId,
      version: definition.version,
      ...(definition.label === undefined ? {} : { label: definition.label }),
      instructions: {
        present: true,
        byteLength: new TextEncoder().encode(instructions).byteLength,
      },
      refs: {
        tools: copyRefs(definition.toolRefs),
        capabilities: copyRefs(definition.capabilityRequirements),
        skills: copyRefs(definition.skillRefs),
        mcpServers: copyRefs(definition.mcpServerRefs),
      },
    },
  }
}

function refsLine(label: string, refs: readonly string[]): string {
  return refs.length === 0 ? `    ${label}: 0` : `    ${label}: ${refs.length} (${refs.map(safeHumanValue).join(", ")})`
}

export function formatAgentValidateHuman(payload: AgentValidateSuccessV1): string {
  const lines = [
    "Authored agent directory is valid.",
    `  id: ${payload.agent.agentTypeId}`,
    `  version: ${safeHumanValue(payload.agent.version)}`,
  ]
  if (payload.agent.label !== undefined) lines.push(`  label: ${safeHumanJsonValue(payload.agent.label)}`)
  lines.push(
    `  instructions: ${payload.agent.instructions.byteLength} bytes`,
    "  declared refs:",
    refsLine("tools", payload.agent.refs.tools),
    refsLine("capabilities", payload.agent.refs.capabilities),
    refsLine("skills", payload.agent.refs.skills),
    refsLine("mcpServers", payload.agent.refs.mcpServers),
  )
  return lines.join("\n")
}

function unsupportedAgentValidateOption(token: string): AgentValidateCliError {
  return new AgentValidateCliError({
    code: "CONFIG_INVALID",
    field: token.startsWith("--json=") ? "--json" : token.split("=", 1)[0],
    message: "usage: boring-ui agent validate <dir> [--json]",
  })
}

export function parseAgentValidateArgv(argv: string[]): {
  directory: string
  json: boolean
} {
  const json = argv.includes("--json")
  const agentIndex = argv.indexOf("agent")
  if (agentIndex < 0) {
    throw new AgentValidateCliError({
      code: "CONFIG_INVALID",
      field: "command",
      message: "usage: boring-ui agent validate <dir>",
    })
  }

  for (const token of argv.slice(0, agentIndex)) {
    if (token === "--json") continue
    if (token.startsWith("-")) throw unsupportedAgentValidateOption(token)
  }

  const tokens = argv.slice(agentIndex + 1).filter((token) => token !== "--json")
  const subcommand = tokens[0]
  if (subcommand !== "validate") {
    throw new AgentValidateCliError({
      code: "CONFIG_INVALID",
      field: "command",
      message: "usage: boring-ui agent validate <dir>",
    })
  }

  let directory: string | undefined
  for (const token of tokens.slice(1)) {
    if (token.startsWith("-")) throw unsupportedAgentValidateOption(token)
    if (directory !== undefined) {
      throw new AgentValidateCliError({
        code: "CONFIG_INVALID",
        field: "arguments",
        message: "usage: boring-ui agent validate <dir>",
      })
    }
    directory = token
  }
  if (!directory) {
    throw new AgentValidateCliError({
      code: "CONFIG_INVALID",
      field: "directory",
      message: "usage: boring-ui agent validate <dir>",
    })
  }
  return { directory, json }
}

export async function runAgentValidateCommand(input: {
  argv: string[]
  deps: AgentCommandDeps
}): Promise<{ json: boolean; output: string }> {
  const parsed = parseAgentValidateArgv(input.argv)
  const payload = createAgentValidateSuccess(await input.deps.compileAgentDirectory(parsed.directory))
  return {
    json: parsed.json,
    output: parsed.json ? JSON.stringify(payload) : formatAgentValidateHuman(payload),
  }
}
