import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, test } from "vitest";
import { uiRoutes } from "../ui.js";
import { createInMemoryBridge } from "../../../ui-bridge/createInMemoryBridge.js";
import type { UiBridge } from "../../../../shared/ui-bridge.js";

const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

async function buildApp(
  bridge?: UiBridge,
): Promise<{ app: FastifyInstance; bridge: UiBridge }> {
  const b = bridge ?? createInMemoryBridge();
  const app = Fastify({ logger: false });
  await app.register(uiRoutes, { bridge: b });
  await app.ready();
  apps.push(app);
  return { app, bridge: b };
}

describe("UI bridge routes", () => {
  test("GET /api/v1/ui/state returns empty object initially", async () => {
    const { app } = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/ui/state" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({});
  });

  test("PUT + GET state roundtrip", async () => {
    const { app } = await buildApp();

    const putRes = await app.inject({
      method: "PUT",
      url: "/api/v1/ui/state",
      payload: { state: { openFiles: ["a.ts"], theme: "dark" } },
    });
    expect(putRes.statusCode).toBe(204);

    const getRes = await app.inject({
      method: "GET",
      url: "/api/v1/ui/state",
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json()).toEqual({ openFiles: ["a.ts"], theme: "dark" });
  });

  test("PUT state with causedBy is accepted", async () => {
    const { app } = await buildApp();

    const putRes = await app.inject({
      method: "PUT",
      url: "/api/v1/ui/state",
      payload: {
        state: { activePanel: "chat" },
        causedBy: "agent",
      },
    });
    expect(putRes.statusCode).toBe(204);
  });

  test("PUT state with invalid body returns 400", async () => {
    const { app } = await buildApp();

    const putRes = await app.inject({
      method: "PUT",
      url: "/api/v1/ui/state",
      payload: { notState: true },
    });
    expect(putRes.statusCode).toBe(400);
  });

  test("POST /api/v1/ui/commands dispatches and returns seq", async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/ui/commands",
      payload: { kind: "openFile", params: { path: "/a.ts" } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ seq: 1, status: "ok" });
  });

  test("POST command seq increments", async () => {
    const { app } = await buildApp();

    const r1 = await app.inject({
      method: "POST",
      url: "/api/v1/ui/commands",
      payload: { kind: "openFile", params: { path: "/a.ts" } },
    });
    const r2 = await app.inject({
      method: "POST",
      url: "/api/v1/ui/commands",
      payload: {
        kind: "showNotification",
        params: { msg: "hi" },
      },
    });

    expect(r1.json().seq).toBe(1);
    expect(r2.json().seq).toBe(2);
  });

  test("POST command with invalid body returns 400", async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/ui/commands",
      payload: { params: {} },
    });
    expect(res.statusCode).toBe(400);
  });

  test("poll=true returns empty batch", async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/ui/commands/next?poll=true",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ commands: [] });
  });

  test("POST command → bridge subscriber receives it", async () => {
    const bridge = createInMemoryBridge();
    const received: Array<{ kind: string; seq: number }> = [];
    bridge.subscribeCommands((cmd) =>
      received.push({ kind: cmd.kind, seq: cmd.seq }),
    );

    const { app } = await buildApp(bridge);

    await app.inject({
      method: "POST",
      url: "/api/v1/ui/commands",
      payload: { kind: "navigateToLine", params: { file: "x.ts", line: 5 } },
    });

    expect(received).toHaveLength(1);
    expect(received[0].kind).toBe("navigateToLine");
    expect(received[0].seq).toBe(1);
  });
});
