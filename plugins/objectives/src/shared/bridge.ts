import type { CreateObjectiveInput, Objective, ObjectiveStatus, UpdateObjectiveInput } from "./types"

export const OBJECTIVE_BRIDGE_OPS = {
  list: "objective.v1.list",
  get: "objective.v1.get",
  create: "objective.v1.create",
  update: "objective.v1.update",
} as const

export const OBJECTIVE_BRIDGE_CAPABILITIES = {
  list: "objectives:list",
  get: "objectives:get",
  create: "objectives:create",
  update: "objectives:update",
} as const

export type ObjectiveBridgeListInput = { status?: ObjectiveStatus }
export type ObjectiveBridgeListOutput = { objectives: Objective[] }

export type ObjectiveBridgeGetInput = { id: string }
export type ObjectiveBridgeGetOutput = { objective: Objective | null }

export type ObjectiveBridgeCreateInput = CreateObjectiveInput
export type ObjectiveBridgeCreateOutput = { objective: Objective }

export type ObjectiveBridgeUpdateInput = UpdateObjectiveInput
export type ObjectiveBridgeUpdateOutput = { objective: Objective }
