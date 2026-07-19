import type { AgentCommandDeps } from "./agentCommandDeps.js"
import { loadAgentCommandDeps } from "./agentCommandDeps.js"
import type { AgentCommandRunOptions } from "./agentCommandTypes.js"
import { assertAgentDevCanLoadDeps, handleAgentDevCommand, isAgentDevSubcommand } from "./agentDevCommand.js"
import { safeHumanJsonValue, toAgentCliError } from "./agentCommandSafe.js"
import { parseAgentValidateArgv, runAgentValidateCommand } from "./agentValidateCommand.js"

export type {
  AgentCommandRunOptions,
  AgentDevTrustedToolCatalogAdapter,
  RunCliAgentDevOptions,
} from "./agentCommandTypes.js"

export async function handleAgentCommand(argv: string[], options: AgentCommandRunOptions): Promise<void> {
  let json = argv.includes("--json")
  let deps: AgentCommandDeps | undefined
  try {
    if (isAgentDevSubcommand(argv)) {
      assertAgentDevCanLoadDeps(argv)
      deps = await loadAgentCommandDeps()
      await handleAgentDevCommand({ argv, options, deps })
      return
    }

    const parsed = parseAgentValidateArgv(argv)
    json = parsed.json
    deps = await loadAgentCommandDeps()
    const result = await runAgentValidateCommand({ argv, deps })
    console.log(result.output)
  } catch (error) {
    const payload = toAgentCliError(error, deps)
    const humanField = payload.error.field === undefined ? "" : ` ${safeHumanJsonValue(payload.error.field)}`
    console.error(json ? JSON.stringify(payload) : `${payload.error.code}${humanField}: ${safeHumanJsonValue(payload.error.message)}`)
    process.exitCode = payload.error.code === "AUTHORED_AGENT_DEV_USAGE_INVALID" ? 2 : 1
  }
}
