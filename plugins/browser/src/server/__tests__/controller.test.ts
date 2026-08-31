import { describe, expect, it, vi } from "vitest";
import { BrowserController, type BrowserScope } from "../controller";
const scope: BrowserScope = {
  workspaceId: "w",
  userId: "u",
  agentId: "a",
  agentSessionId: "chat",
};
describe("BrowserController", () => {
  it("fences takeover/return by epoch and releases once", async () => {
    const exec = vi.fn(async () => ({ ok: true, stdout: "state" }));
    const release = vi.fn();
    const c = new BrowserController({
      exec,
      revokeView: async () => {},
      admitPlan: async () => ({ admitted: true }),
      admit: async () => ({ admitted: true }),
      release,
    });
    const started = await c.start(scope);
    await c.takeover(scope, started.sessionId);
    await expect(c.observe(scope, started.sessionId, 0)).rejects.toThrow(
      "stale",
    );
    const returned = await c.return(scope, started.sessionId, true);
    expect(returned.controlEpoch).toBe(2);
    await c.stop(scope, started.sessionId);
    await c.stop(scope, started.sessionId);
    expect(release).toHaveBeenCalledTimes(1);
  });
  it("admits every action and stops without retry on unknown outcome", async () => {
    let acts = 0;
    const exec = vi.fn(async ({ intent }: { intent: string }) =>
      intent === "act" && ++acts === 2
        ? { ok: false }
        : { ok: true, stdout: "ok" },
    );
    const admit = vi.fn(async () => ({
      admitted: true,
      approvalRef: "approved",
    }));
    const c = new BrowserController({ exec, revokeView: async () => {},
      admitPlan: async () => ({ admitted: true }), admit });
    const s = await c.start(scope);
    await expect(
      c.act(scope, {
        sessionId: s.sessionId,
        controlEpoch: 0,
        actions: [
          { kind: "click", target: { index: 1 } },
          { kind: "click", target: { index: 2 } },
        ],
      }),
    ).rejects.toThrow("unknown");
    expect(admit).toHaveBeenCalledTimes(2);
    expect(acts).toBe(2);
  });
  it("rejects cross-scope session replay", async () => {
    const c = new BrowserController({
      exec: async () => ({ ok: true }),
      revokeView: async () => {},
      admitPlan: async () => ({ admitted: true }),
      admit: async () => ({ admitted: true }),
    });
    const s = await c.start(scope);
    expect(() =>
      c.status({ ...scope, workspaceId: "other" }, s.sessionId),
    ).toThrow("not found");
  });
});
