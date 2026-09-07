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
import { OBJECTIVE_BRIDGE_CAPABILITIES, OBJECTIVE_BRIDGE_OPS, OBJECTIVE_ERROR_CODES } from "../../shared"
import { createObjectiveBridgeHandlers } from "../objectiveBridgeHandlers"
import { FileObjectiveStore, ObjectiveStoreError, type ObjectiveStore } from "../objectiveStore"

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

function serverContext(capabilities: string[]): WorkspaceBridgeCallContext {
  return {
    callerClass: "server",
    workspaceId: "workspace-1",
    sessionId: "s1",
    capabilities,
    actor: { actorKind: "human", performedBy: { id: "user-1", label: "user:user-1" } },
  }
}

function registryFixture(objectiveStore: ObjectiveStore = store) {
  const registry = createWorkspaceBridgeRegistry()
  for (const entry of createObjectiveBridgeHandlers({ store: objectiveStore })) {
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
      serverContext([OBJECTIVE_BRIDGE_CAPABILITIES.create]),
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
      serverContext([OBJECTIVE_BRIDGE_CAPABILITIES.update]),
    )
    expect(updated).toMatchObject({ ok: true, output: { objective: { id: objectiveId, current: 250, status: "achieved" } } })
  })

  it("rejects an update for an unknown objective id", async () => {
    const registry = registryFixture()
    const denied = await registry.call(
      { op: OBJECTIVE_BRIDGE_OPS.update, input: { id: "missing", current: 1 } },
      serverContext([OBJECTIVE_BRIDGE_CAPABILITIES.update]),
    )
    expect(denied).toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.InvalidRequest } })
  })

  it("keeps Objective storage codes plugin-owned while mapping them to WorkspaceBridge's generic failure", async () => {
    const failingStore = {
      list: async () => {
        throw new ObjectiveStoreError(OBJECTIVE_ERROR_CODES.STORE_IO, "objective storage unavailable", {
          cause: Object.assign(new Error("EIO: raw host diagnostic"), { code: "EIO" }),
        })
      },
    } as unknown as ObjectiveStore
    const denied = await registryFixture(failingStore).call(
      { op: OBJECTIVE_BRIDGE_OPS.list, input: {} },
      browserContext([OBJECTIVE_BRIDGE_CAPABILITIES.list]),
    )

    expect(denied).toMatchObject({
      ok: false,
      error: { code: WorkspaceBridgeErrorCode.HandlerFailed, message: "objective storage unavailable" },
    })
    expect(JSON.stringify(denied)).not.toContain("raw host diagnostic")
    expect(JSON.stringify(denied)).not.toContain(OBJECTIVE_ERROR_CODES.STORE_IO)
  })

  it("rejects an invalid create input", async () => {
    const registry = registryFixture()
    const denied = await registry.call(
      { op: OBJECTIVE_BRIDGE_OPS.create, input: { title: "Missing fields" } },
      serverContext([OBJECTIVE_BRIDGE_CAPABILITIES.create]),
    )
    expect(denied).toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.InvalidRequest } })
  })

  it("rejects a create input whose serialized size exceeds the aggregate cap", async () => {
    const registry = registryFixture()
    const denied = await registry.call(
      { op: OBJECTIVE_BRIDGE_OPS.create, input: { ...createInput, constraints: Array.from({ length: 50 }, (_, i) => `constraint ${i}`.padEnd(500, "x")) } },
      serverContext([OBJECTIVE_BRIDGE_CAPABILITIES.create]),
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

  it("denies browser callers from create and update — mutations stay agent/server-domain", async () => {
    const registry = registryFixture()
    const deniedCreate = await registry.call(
      { op: OBJECTIVE_BRIDGE_OPS.create, input: createInput },
      browserContext([OBJECTIVE_BRIDGE_CAPABILITIES.create]),
    )
    expect(deniedCreate).toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.CallerNotAllowed } })

    const deniedUpdate = await registry.call(
      { op: OBJECTIVE_BRIDGE_OPS.update, input: { id: "whatever", current: 1 } },
      browserContext([OBJECTIVE_BRIDGE_CAPABILITIES.update]),
    )
    expect(deniedUpdate).toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.CallerNotAllowed } })
  })

  it("allows browser callers to list and get — the pane's only ops", async () => {
    const registry = registryFixture()
    const created = await registry.call(
      { op: OBJECTIVE_BRIDGE_OPS.create, input: createInput },
      serverContext([OBJECTIVE_BRIDGE_CAPABILITIES.create]),
    )
    const objectiveId = (created as { ok: true; output: { objective: { id: string } } }).output.objective.id

    const listed = await registry.call(
      { op: OBJECTIVE_BRIDGE_OPS.list, input: {} },
      browserContext([OBJECTIVE_BRIDGE_CAPABILITIES.list]),
    )
    expect(listed).toMatchObject({ ok: true })

    const got = await registry.call(
      { op: OBJECTIVE_BRIDGE_OPS.get, input: { id: objectiveId } },
      browserContext([OBJECTIVE_BRIDGE_CAPABILITIES.get]),
    )
    expect(got).toMatchObject({ ok: true, output: { objective: { id: objectiveId } } })
  })

  it("filters list by status", async () => {
    const registry = registryFixture()
    await registry.call({ op: OBJECTIVE_BRIDGE_OPS.create, input: createInput }, serverContext([OBJECTIVE_BRIDGE_CAPABILITIES.create]))
    await registry.call(
      { op: OBJECTIVE_BRIDGE_OPS.create, input: { ...createInput, title: "Paused one", status: "paused" } },
      serverContext([OBJECTIVE_BRIDGE_CAPABILITIES.create]),
    )
    const listed = await registry.call(
      { op: OBJECTIVE_BRIDGE_OPS.list, input: { status: "paused" } },
      browserContext([OBJECTIVE_BRIDGE_CAPABILITIES.list]),
    )
    expect(listed).toMatchObject({ ok: true, output: { objectives: [{ title: "Paused one" }] } })
  })

  it("paginates list output below the bridge envelope", async () => {
    const registry = registryFixture()
    for (let index = 0; index < 21; index += 1) {
      await store.create({ ...createInput, title: `Objective ${index}` })
    }

    const first = await registry.call(
      { op: OBJECTIVE_BRIDGE_OPS.list, input: { limit: 20 } },
      browserContext([OBJECTIVE_BRIDGE_CAPABILITIES.list]),
    )
    expect(first).toMatchObject({ ok: true, output: { objectives: expect.any(Array), nextCursor: "20" } })
    expect((first as { ok: true; output: { objectives: unknown[] } }).output.objectives).toHaveLength(20)

    const second = await registry.call(
      { op: OBJECTIVE_BRIDGE_OPS.list, input: { limit: 20, cursor: "20" } },
      browserContext([OBJECTIVE_BRIDGE_CAPABILITIES.list]),
    )
    expect(second).toMatchObject({ ok: true, output: { objectives: [expect.any(Object)] } })
    expect((second as { ok: true; output: { nextCursor?: string } }).output.nextCursor).toBeUndefined()
  })

  it("dedupes a retried create by clientRequestId", async () => {
    const registry = registryFixture()
    const first = await registry.call(
      { op: OBJECTIVE_BRIDGE_OPS.create, input: { ...createInput, clientRequestId: "retry-1" } },
      serverContext([OBJECTIVE_BRIDGE_CAPABILITIES.create]),
    )
    const second = await registry.call(
      { op: OBJECTIVE_BRIDGE_OPS.create, input: { ...createInput, clientRequestId: "retry-1" } },
      serverContext([OBJECTIVE_BRIDGE_CAPABILITIES.create]),
    )
    const firstId = (first as { ok: true; output: { objective: { id: string } } }).output.objective.id
    const secondId = (second as { ok: true; output: { objective: { id: string } } }).output.objective.id
    expect(secondId).toBe(firstId)

    const listed = await registry.call({ op: OBJECTIVE_BRIDGE_OPS.list, input: {} }, browserContext([OBJECTIVE_BRIDGE_CAPABILITIES.list]))
    expect((listed as { ok: true; output: { objectives: unknown[] } }).output.objectives).toHaveLength(1)
  })
})
