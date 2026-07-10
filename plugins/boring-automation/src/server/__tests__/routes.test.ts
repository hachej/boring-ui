import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import Fastify from "fastify"
import { describe, expect, it, vi } from "vitest"
import { BORING_AUTOMATION_ROUTE_PREFIX } from "../../shared"
import { FileAutomationStore } from "../fileStore"
import { automationRoutes } from "../routes"

function appWithStore(
  store = new FileAutomationStore(`${tmpdir()}/boring-automation-unused`),
  manualRunExecutor?: Parameters<typeof automationRoutes>[1]["manualRunExecutor"],
) {
  const app = Fastify()
  app.register(async (instance) => automationRoutes(instance, { store, manualRunExecutor }))
  return app
}

describe("automationRoutes", () => {
  it("creates, reads, patches, and lists automations without workspace request context", async () => {
    const temp = await TempStore.create()
    const app = appWithStore(temp.store)

    const created = await app.inject({
      method: "POST",
      url: `${BORING_AUTOMATION_ROUTE_PREFIX}/automations`,
      headers: { "x-boring-workspace-id": "ignored" },
      payload: {
        title: "Daily summary",
        cron: "0 9 * * *",
        timezone: "UTC",
        model: "model-a",
        prompt: "prompt",
      },
    })
    expect(created.statusCode).toBe(201)
    const automation = created.json().automation
    expect(automation).toMatchObject({ title: "Daily summary" })
    expect(automation).not.toHaveProperty("workspaceId")

    const detail = await app.inject({ method: "GET", url: `${BORING_AUTOMATION_ROUTE_PREFIX}/automations/${automation.id}` })
    expect(detail.statusCode).toBe(200)
    expect(detail.json().automation).toMatchObject({ id: automation.id, title: "Daily summary" })

    const promptDetail = await app.inject({ method: "GET", url: `${BORING_AUTOMATION_ROUTE_PREFIX}/automations/${automation.id}/prompt` })
    expect(promptDetail.statusCode).toBe(200)
    expect(promptDetail.json()).toMatchObject({ ok: true, prompt: "prompt" })

    const patched = await app.inject({
      method: "PATCH",
      url: `${BORING_AUTOMATION_ROUTE_PREFIX}/automations/${automation.id}`,
      payload: { enabled: false },
    })
    expect(patched.statusCode).toBe(200)
    expect(patched.json().automation.enabled).toBe(false)

    const list = await app.inject({ method: "GET", url: `${BORING_AUTOMATION_ROUTE_PREFIX}/automations` })
    expect(list.statusCode).toBe(200)
    expect(list.json().automations).toHaveLength(1)

    const deleted = await app.inject({ method: "DELETE", url: `${BORING_AUTOMATION_ROUTE_PREFIX}/automations/${automation.id}` })
    expect(deleted.statusCode).toBe(204)
    const missingAfterDelete = await app.inject({ method: "GET", url: `${BORING_AUTOMATION_ROUTE_PREFIX}/automations/${automation.id}` })
    expect(missingAfterDelete.statusCode).toBe(404)

    await app.close()
    await temp.cleanup()
  })

  it("updates prompts and exposes run history read-only", async () => {
    const temp = await TempStore.create()
    const app = appWithStore(temp.store)
    const created = await app.inject({
      method: "POST",
      url: `${BORING_AUTOMATION_ROUTE_PREFIX}/automations`,
      payload: { title: "Daily summary", cron: "0 9 * * *", timezone: "UTC", model: "model-a" },
    })
    const automation = created.json().automation

    const prompt = await app.inject({
      method: "PUT",
      url: `${BORING_AUTOMATION_ROUTE_PREFIX}/automations/${automation.id}/prompt`,
      payload: { prompt: "updated" },
    })
    expect(prompt.statusCode).toBe(200)
    await expect(temp.store.getPrompt(automation.id)).resolves.toBe("updated")

    const run = await temp.store.beginRun({
      automationId: automation.id,
      trigger: "manual",
      promptSnapshot: "updated",
      modelSnapshot: "model-a",
    })
    const runs = await app.inject({ method: "GET", url: `${BORING_AUTOMATION_ROUTE_PREFIX}/automations/${automation.id}/runs` })
    expect(runs.statusCode).toBe(200)
    expect(runs.json().runs).toEqual([expect.objectContaining({ id: run.id, automationId: automation.id, status: "queued" })])

    const createResponse = await app.inject({
      method: "POST",
      url: `${BORING_AUTOMATION_ROUTE_PREFIX}/automations/${automation.id}/runs`,
      payload: { automationId: automation.id },
    })
    expect(createResponse.statusCode).toBe(404)

    const patchResponse = await app.inject({
      method: "PATCH",
      url: `${BORING_AUTOMATION_ROUTE_PREFIX}/automations/${automation.id}/runs/${run.id}`,
      payload: { status: "failed" },
    })
    expect(patchResponse.statusCode).toBe(404)

    await app.close()
    await temp.cleanup()
  })

  it("runs through the injected executor without accepting caller-owned run fields", async () => {
    const temp = await TempStore.create()
    const automation = await temp.store.createAutomation({
      title: "Daily summary",
      cron: "0 9 * * *",
      timezone: "UTC",
      model: "test:gpt-5.5",
      prompt: "canonical",
    })
    const run = await temp.store.beginRun({
      automationId: automation.id,
      trigger: "manual",
      promptSnapshot: "canonical",
      modelSnapshot: "test:gpt-5.5",
    })
    await temp.store.updateRunLifecycle(run.id, { status: "succeeded", completedAt: new Date().toISOString() })
    const execute = vi.fn(async (_input: unknown) => (await temp.store.listRuns(automation.id))[0]!)
    const app = appWithStore(temp.store, { run: execute })

    const response = await app.inject({
      method: "POST",
      url: `${BORING_AUTOMATION_ROUTE_PREFIX}/automations/${automation.id}/run`,
      payload: { model: "forged:model", sessionId: "forged-session", promptSnapshot: "forged" },
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().run).toMatchObject({ automationId: automation.id, modelSnapshot: "test:gpt-5.5" })
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ automationId: automation.id, request: expect.any(Object) }))
    expect(execute.mock.calls[0]?.[0]).not.toHaveProperty("model")

    await app.close()
    await temp.cleanup()
  })

  it("fails closed when the manual executor is not composed", async () => {
    const temp = await TempStore.create()
    const automation = await temp.store.createAutomation({ title: "Daily", cron: "0 9 * * *", timezone: "UTC", model: "test:gpt-5.5" })
    const app = appWithStore(temp.store)

    const response = await app.inject({ method: "POST", url: `${BORING_AUTOMATION_ROUTE_PREFIX}/automations/${automation.id}/run` })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({ code: "BORING_AUTOMATION_RUN_EXECUTOR_UNAVAILABLE" })
    await app.close()
    await temp.cleanup()
  })

  it("maps validation and domain error codes to HTTP status", async () => {
    const temp = await TempStore.create()
    const app = appWithStore(temp.store)

    const invalid = await app.inject({ method: "POST", url: `${BORING_AUTOMATION_ROUTE_PREFIX}/automations`, payload: { title: "" } })
    expect(invalid.statusCode).toBe(400)
    expect(invalid.json()).toMatchObject({ ok: false, code: "BORING_AUTOMATION_INVALID_BODY" })

    const missing = await app.inject({ method: "GET", url: `${BORING_AUTOMATION_ROUTE_PREFIX}/automations/missing` })
    expect(missing.statusCode).toBe(404)
    expect(missing.json()).toMatchObject({ ok: false, code: "BORING_AUTOMATION_NOT_FOUND" })

    await app.close()
    await temp.cleanup()
  })
})

class TempStore {
  private constructor(
    readonly dir: string,
    readonly store: FileAutomationStore,
  ) {}

  static async create(): Promise<TempStore> {
    const dir = await mkdtemp(join(tmpdir(), "boring-automation-routes-"))
    return new TempStore(dir, new FileAutomationStore(dir))
  }

  async cleanup() {
    await rm(this.dir, { recursive: true, force: true })
  }
}
