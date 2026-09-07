import { join } from "node:path"
import { defineServerPlugin, type WorkspaceServerPlugin } from "@hachej/boring-workspace/server"
import { OBJECTIVES_PLUGIN_ID } from "../shared/constants"
import { ObjectiveError, OBJECTIVE_ERROR_CODES } from "../shared/error-codes"
import { FileObjectiveStore, type ObjectiveStore } from "./objectiveStore"
import { createObjectiveBridgeHandlers } from "./objectiveBridgeHandlers"
import { createObjectiveTools } from "./objectiveTools"

export type ObjectivesServerPluginOptions = {
  workspaceRoot?: string
  store?: ObjectiveStore
}

export function createObjectivesServerPlugin(options: ObjectivesServerPluginOptions): WorkspaceServerPlugin {
  const store = options.store ?? createDefaultStore(options.workspaceRoot)
  return defineServerPlugin({
    id: OBJECTIVES_PLUGIN_ID,
    label: "Objectives",
    systemPrompt: [
      "Objective is the durable thin planning primitive: { title, objective (statement), metric, baseline, target, current, status, constraints, evidenceRefs, outcome? }.",
      "Never call this primitive 'goal', 'investigation', or 'action' — the ratified kernel noun is Objective.",
      "Use create_objective to record a new objective, update_objective to move current/status/outcome as evidence comes in, and list_objectives/get_objective to check on it.",
      "Open the Objective surface for the user with exec_ui openSurface using kind 'objective' and target = the objective id.",
    ].join("\n"),
    agentTools: createObjectiveTools({ store }),
    workspaceBridgeHandlers: createObjectiveBridgeHandlers({ store }),
  })
}

function createDefaultStore(workspaceRoot: string | undefined): ObjectiveStore {
  if (!workspaceRoot) {
    throw new ObjectiveError(
      OBJECTIVE_ERROR_CODES.CONFIG_INVALID,
      "createObjectivesServerPlugin requires workspaceRoot when store is not provided",
    )
  }
  return new FileObjectiveStore(join(workspaceRoot, ".boring", "objectives.json"), { workspaceRoot })
}
