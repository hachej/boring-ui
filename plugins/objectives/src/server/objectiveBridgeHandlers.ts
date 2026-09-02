import {
  WorkspaceBridgeErrorCode,
  createWorkspaceBridgeError,
  defineTrustedDomainBridgeHandler,
  type TrustedDomainBridgeHandlerRegistration,
  type WorkspaceBridgeHandler,
  type WorkspaceBridgeHandlerContribution,
} from "@hachej/boring-workspace/server"
import {
  OBJECTIVES_PLUGIN_ID,
  OBJECTIVE_BRIDGE_CAPABILITIES,
  OBJECTIVE_BRIDGE_OPS,
  validateCreateObjectiveInput,
  validateGetObjectiveInput,
  validateListObjectivesInput,
  validateUpdateObjectiveInput,
  type ObjectiveBridgeCreateInput,
  type ObjectiveBridgeCreateOutput,
  type ObjectiveBridgeGetInput,
  type ObjectiveBridgeGetOutput,
  type ObjectiveBridgeListInput,
  type ObjectiveBridgeListOutput,
  type ObjectiveBridgeUpdateInput,
  type ObjectiveBridgeUpdateOutput,
} from "../shared"
import { ObjectiveStoreError, type ObjectiveStore } from "./objectiveStore"

export interface ObjectiveBridgeHandlersOptions {
  store: ObjectiveStore
}

const MAX_OBJECTIVE_BYTES = 32 * 1024
const MAX_LIST_BYTES = 512 * 1024
const READ_TIMEOUT_MS = 10_000
const MUTATION_TIMEOUT_MS = 15_000

export function createObjectiveBridgeHandlers(
  options: ObjectiveBridgeHandlersOptions,
): WorkspaceBridgeHandlerContribution[] {
  return [
    contribution(defineTrustedDomainBridgeHandler<ObjectiveBridgeListInput, ObjectiveBridgeListOutput>({
      op: OBJECTIVE_BRIDGE_OPS.list,
      version: 1,
      owner: OBJECTIVES_PLUGIN_ID,
      callerClassesAllowed: ["browser", "runtime", "server"],
      requiredCapabilities: [OBJECTIVE_BRIDGE_CAPABILITIES.list],
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      timeoutMs: READ_TIMEOUT_MS,
      maxInputBytes: 1024,
      maxOutputBytes: MAX_LIST_BYTES,
      idempotencyPolicy: "none",
      handler: listHandler(options),
    })),
    contribution(defineTrustedDomainBridgeHandler<ObjectiveBridgeGetInput, ObjectiveBridgeGetOutput>({
      op: OBJECTIVE_BRIDGE_OPS.get,
      version: 1,
      owner: OBJECTIVES_PLUGIN_ID,
      callerClassesAllowed: ["browser", "runtime", "server"],
      requiredCapabilities: [OBJECTIVE_BRIDGE_CAPABILITIES.get],
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      timeoutMs: READ_TIMEOUT_MS,
      maxInputBytes: 1024,
      maxOutputBytes: MAX_OBJECTIVE_BYTES,
      idempotencyPolicy: "none",
      handler: getHandler(options),
    })),
    // create/update are mutations. The shipped pane only ever calls
    // list/get (ObjectivePane.tsx); there is no browser UI that creates or
    // edits an Objective. Core's browser bridge policy grants each
    // workspace member every declared capability, so a capability name
    // alone is not a role boundary — restricting the caller class is what
    // actually keeps these agent/server-domain mutations off the browser.
    contribution(defineTrustedDomainBridgeHandler<ObjectiveBridgeCreateInput, ObjectiveBridgeCreateOutput>({
      op: OBJECTIVE_BRIDGE_OPS.create,
      version: 1,
      owner: OBJECTIVES_PLUGIN_ID,
      callerClassesAllowed: ["runtime", "server"],
      requiredCapabilities: [OBJECTIVE_BRIDGE_CAPABILITIES.create],
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      timeoutMs: MUTATION_TIMEOUT_MS,
      maxInputBytes: MAX_OBJECTIVE_BYTES,
      maxOutputBytes: MAX_OBJECTIVE_BYTES,
      idempotencyPolicy: "none",
      handler: createHandler(options),
    })),
    contribution(defineTrustedDomainBridgeHandler<ObjectiveBridgeUpdateInput, ObjectiveBridgeUpdateOutput>({
      op: OBJECTIVE_BRIDGE_OPS.update,
      version: 1,
      owner: OBJECTIVES_PLUGIN_ID,
      callerClassesAllowed: ["runtime", "server"],
      requiredCapabilities: [OBJECTIVE_BRIDGE_CAPABILITIES.update],
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      timeoutMs: MUTATION_TIMEOUT_MS,
      maxInputBytes: MAX_OBJECTIVE_BYTES,
      maxOutputBytes: MAX_OBJECTIVE_BYTES,
      idempotencyPolicy: "none",
      handler: updateHandler(options),
    })),
  ]
}

function contribution<TInput, TOutput>(
  entry: TrustedDomainBridgeHandlerRegistration<TInput, TOutput>,
): WorkspaceBridgeHandlerContribution {
  return {
    definition: entry.definition,
    handler: entry.handler as WorkspaceBridgeHandler,
  }
}

function listHandler({ store }: ObjectiveBridgeHandlersOptions) {
  return async ({ input }: { input: ObjectiveBridgeListInput }): Promise<ObjectiveBridgeListOutput> => {
    const parsed = validateListObjectivesInput(input ?? {})
    if (!parsed.success) throw invalid(firstIssue(parsed.error))
    try {
      return { objectives: await store.list(parsed.data.status) }
    } catch (error) {
      throw mapObjectiveError(error)
    }
  }
}

function getHandler({ store }: ObjectiveBridgeHandlersOptions) {
  return async ({ input }: { input: ObjectiveBridgeGetInput }): Promise<ObjectiveBridgeGetOutput> => {
    const parsed = validateGetObjectiveInput(input)
    if (!parsed.success) throw invalid(firstIssue(parsed.error))
    try {
      return { objective: await store.get(parsed.data.id) }
    } catch (error) {
      throw mapObjectiveError(error)
    }
  }
}

function createHandler({ store }: ObjectiveBridgeHandlersOptions) {
  return async ({ input }: { input: ObjectiveBridgeCreateInput }): Promise<ObjectiveBridgeCreateOutput> => {
    const parsed = validateCreateObjectiveInput(input)
    if (!parsed.success) throw invalid(firstIssue(parsed.error))
    try {
      return { objective: await store.create(parsed.data) }
    } catch (error) {
      throw mapObjectiveError(error)
    }
  }
}

function updateHandler({ store }: ObjectiveBridgeHandlersOptions) {
  return async ({ input }: { input: ObjectiveBridgeUpdateInput }): Promise<ObjectiveBridgeUpdateOutput> => {
    const parsed = validateUpdateObjectiveInput(input)
    if (!parsed.success) throw invalid(firstIssue(parsed.error))
    try {
      return { objective: await store.update(parsed.data) }
    } catch (error) {
      throw mapObjectiveError(error)
    }
  }
}

function firstIssue(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message ?? "invalid input"
}

function mapObjectiveError(error: unknown): never {
  if (error instanceof ObjectiveStoreError) {
    throw createWorkspaceBridgeError(WorkspaceBridgeErrorCode.InvalidRequest, error.message, { objectiveCode: error.code })
  }
  throw error
}

function invalid(message: string): never {
  throw createWorkspaceBridgeError(WorkspaceBridgeErrorCode.InvalidRequest, message)
}
