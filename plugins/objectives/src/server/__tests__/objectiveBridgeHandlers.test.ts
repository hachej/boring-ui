// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  createWorkspaceBridgeRegistry,
  WorkspaceBridgeErrorCode,
  type WorkspaceBridgeCallContext,
} from "@hachej/boring-workspace/server"
import { OBJECTIVE_BRIDGE_CAPABILITIES, OBJECTIVE_BRIDGE_OPS } from "../../shared"
import { createObjectiveBridgeHandlers } from "../objectiveBridgeHandlers"
import { FileObjectiveStore } from "../objectiveStore"

let dir: string
let store: FileObjectiveStore

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "objectives-bridge-"))
  store = new FileObjectiveStore(join(dir, "objectives.json"))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function browserContext(capabilities: string[]): WorkspaceBridgeCallContext {
  return {
    callerClass: "browser",
    workspaceId: "workspace-1",
    sessionId: "s1",
    capabilities,
    actor: { actorKind: "human", performedBy: { id: "user-1", label: "user:user-1" } },
  }
}

function registryFixture() {
  const registry = createWorkspaceBridgeRegistry()
  for (const entry of createObjectiveBridgeHandlers({ store })) {
    registry.registerHandler(entry.definition, entry.handler)
  }
  return registry
}

const createInput = {
  title: "Ship v2",
  objective: "Ship the v2 rewrite to production",
  metric: "weekly active users",
  baseline: 100,
  target: 500,
}

describe("objectives WorkspaceBridge handlers", () => {
  it("creates, gets, lists, and updates through objective.v1 ops", async () => {
    const registry = registryFixture()

    const created = await registry.call(
      { op: OBJECTIVE_BRIDGE_OPS.create, input: createInput },
      browserContext([OBJECTIVE_BRIDGE_CAPABILITIES.create]),
    )
    expect(created).toMatchObject({ ok: true, output: { objective: { title: "Ship v2", status: "active" } } })
    const objectiveId = (created as { ok: true; output: { objective: { id: string } } }).output.objective.id

    const got = await registry.call(
      { op: OBJECTIVE_BRIDGE_OPS.get, input: { id: objectiveId } },
      browserContext([OBJECTIVE_BRIDGE_CAPABILITIES.get]),
    )
    expect(got).toMatchObject({ ok: true, output: { objective: { id: objectiveId } } })

    const listed = await registry.call(
      { op: OBJECTIVE_BRIDGE_OPS.list, input: {} },
      browserContext([OBJECTIVE_BRIDGE_CAPABILITIES.list]),
    )
    expect(listed).toMatchObject({ ok: true, output: { objectives: [{ id: objectiveId }] } })

    const updated = await registry.call(
      { op: OBJECTIVE_BRIDGE_OPS.update, input: { id: objectiveId, current: 250, status: "achieved" } },
      browserContext([OBJECTIVE_BRIDGE_CAPABILITIES.update]),
    )
    expect(updated).toMatchObject({ ok: true, output: { objective: { id: objectiveId, current: 250, status: "achieved" } } })
  })

  it("rejects an update for an unknown objective id", async () => {
    const registry = registryFixture()
    const denied = await registry.call(
      { op: OBJECTIVE_BRIDGE_OPS.update, input: { id: "missing", current: 1 } },
      browserContext([OBJECTIVE_BRIDGE_CAPABILITIES.update]),
    )
    expect(denied).toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.InvalidRequest } })
  })

  it("rejects an invalid create input", async () => {
    const registry = registryFixture()
    const denied = await registry.call(
      { op: OBJECTIVE_BRIDGE_OPS.create, input: { title: "Missing fields" } },
      browserContext([OBJECTIVE_BRIDGE_CAPABILITIES.create]),
    )
    expect(denied).toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.InvalidRequest } })
  })

  it("denies a call without the required capability", async () => {
    const registry = registryFixture()
    const denied = await registry.call(
      { op: OBJECTIVE_BRIDGE_OPS.list, input: {} },
      browserContext([]),
    )
    expect(denied).toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.CapabilityDenied } })
  })

  it("filters list by status", async () => {
    const registry = registryFixture()
    await registry.call({ op: OBJECTIVE_BRIDGE_OPS.create, input: createInput }, browserContext([OBJECTIVE_BRIDGE_CAPABILITIES.create]))
    await registry.call(
      { op: OBJECTIVE_BRIDGE_OPS.create, input: { ...createInput, title: "Paused one", status: "paused" } },
      browserContext([OBJECTIVE_BRIDGE_CAPABILITIES.create]),
    )
    const listed = await registry.call(
      { op: OBJECTIVE_BRIDGE_OPS.list, input: { status: "paused" } },
      browserContext([OBJECTIVE_BRIDGE_CAPABILITIES.list]),
    )
    expect(listed).toMatchObject({ ok: true, output: { objectives: [{ title: "Paused one" }] } })
  })
})
