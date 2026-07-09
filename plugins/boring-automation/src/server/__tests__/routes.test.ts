import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import Fastify from "fastify"
import { describe, expect, it } from "vitest"
import { BORING_AUTOMATION_ROUTE_PREFIX } from "../../shared"
import { automationRoutes, workspaceCtxFromRequest } from "../routes"
import { FileAutomationStore } from "../fileStore"

function appWithStore(store = new FileAutomationStore(`${tmpdir()}/boring-automation-unused`)) {
  const app = Fastify()
  app.register(async (instance) => automationRoutes(instance, { store }))
  return app
}

describe("workspaceCtxFromRequest", () => {
  it("prefers decorated workspace context, then header, then default", () => {
    expect(workspaceCtxFromRequest({ headers: {}, workspaceContext: { workspaceId: "decorated" } } as never)).toEqual({ workspaceId: "decorated" })
    expect(workspaceCtxFromRequest({ headers: { "x-boring-workspace-id": "header" } } as never)).toEqual({ workspaceId: "header" })
    expect(workspaceCtxFromRequest({ headers: {} } as never)).toEqual({ workspaceId: "default" })
  })
})

describe("automationRoutes", () => {
  it("creates, reads, patches, and lists automations", async () => {
    const temp = await TempStore.create()
    const app = appWithStore(temp.store)

    const created = await app.inject({
      method: "POST",
      url: `${BORING_AUTOMATION_ROUTE_PREFIX}/automations`,
      headers: { "x-boring-workspace-id": "ws-1" },
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
    expect(automation).toMatchObject({ title: "Daily summary", workspaceId: "ws-1" })

    const patched = await app.inject({
      method: "PATCH",
      url: `${BORING_AUTOMATION_ROUTE_PREFIX}/automations/${automation.id}`,
      headers: { "x-boring-workspace-id": "ws-1" },
      payload: { enabled: false },
    })
    expect(patched.statusCode).toBe(200)
    expect(patched.json().automation.enabled).toBe(false)

    const list = await app.inject({ method: "GET", url: `${BORING_AUTOMATION_ROUTE_PREFIX}/automations`, headers: { "x-boring-workspace-id": "ws-1" } })
    expect(list.statusCode).toBe(200)
    expect(list.json().automations).toHaveLength(1)

    await app.close()
    await temp.cleanup()
  })

  it("updates prompts and stores run metadata", async () => {
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
    await expect(temp.store.getPrompt({ workspaceId: "default" }, automation.id)).resolves.toBe("updated")

    const run = await app.inject({
      method: "POST",
      url: `${BORING_AUTOMATION_ROUTE_PREFIX}/automations/${automation.id}/runs`,
      payload: {
        automationId: automation.id,
        trigger: "manual",
        promptSnapshot: "updated",
        modelSnapshot: "model-a",
        cronSnapshot: automation.cron,
        timezoneSnapshot: automation.timezone,
      },
    })
    expect(run.statusCode).toBe(201)
    expect(run.json().run).toMatchObject({ automationId: automation.id, status: "queued" })

    const runs = await app.inject({ method: "GET", url: `${BORING_AUTOMATION_ROUTE_PREFIX}/automations/${automation.id}/runs` })
    expect(runs.statusCode).toBe(200)
    expect(runs.json().runs).toHaveLength(1)

    await app.close()
    await temp.cleanup()
  })

  it("does not patch runs through the wrong automation route", async () => {
    const temp = await TempStore.create()
    const app = appWithStore(temp.store)
    const first = (await app.inject({
      method: "POST",
      url: `${BORING_AUTOMATION_ROUTE_PREFIX}/automations`,
      payload: { title: "First", cron: "0 9 * * *", timezone: "UTC", model: "model-a" },
    })).json().automation
    const second = (await app.inject({
      method: "POST",
      url: `${BORING_AUTOMATION_ROUTE_PREFIX}/automations`,
      payload: { title: "Second", cron: "0 10 * * *", timezone: "UTC", model: "model-a" },
    })).json().automation
    const run = (await app.inject({
      method: "POST",
      url: `${BORING_AUTOMATION_ROUTE_PREFIX}/automations/${second.id}/runs`,
      payload: {
        automationId: second.id,
        trigger: "manual",
        promptSnapshot: "prompt",
        modelSnapshot: "model-a",
        cronSnapshot: second.cron,
        timezoneSnapshot: second.timezone,
      },
    })).json().run

    const wrongAutomation = await app.inject({
      method: "PATCH",
      url: `${BORING_AUTOMATION_ROUTE_PREFIX}/automations/${first.id}/runs/${run.id}`,
      payload: { status: "failed" },
    })
    expect(wrongAutomation.statusCode).toBe(404)

    await app.close()
    await temp.cleanup()
  })

  it("returns validation and not-found errors", async () => {
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
