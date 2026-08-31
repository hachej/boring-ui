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
      acquire: async () => ({ generationId: "g", release }),
      revokeView: async () => {},
      admitPlan: async () => ({ admitted: true }),
      admit: async () => ({ admitted: true }),
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
    const c = new BrowserController({ exec, acquire: async () => ({ generationId: "g", release: async () => {} }),
      revokeView: async () => {},
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
      }, undefined, { toolCallId: "tool" }),
    ).rejects.toThrow("unknown");
    expect(admit).toHaveBeenCalledTimes(2);
    expect(acts).toBe(2);
  });
  it("cleans up and releases a thrown partial start", async () => {
    const release = vi.fn(async () => {});
    const exec = vi.fn(async ({ intent }: { intent: string }) => { if (intent === "ensure") throw new Error("secret upstream"); return { ok: true }; });
    const c = new BrowserController({ exec, acquire: async () => ({ generationId: "g", release }), revokeView: async () => {}, admitPlan: async () => ({ admitted: true }), admit: async () => ({ admitted: true }) });
    const result = await c.start(scope);
    expect(result.state).toBe("error");
    expect(exec).toHaveBeenCalledWith(expect.objectContaining({ intent: "stop" }));
    expect(release).toHaveBeenCalledOnce();
  });
  it("retains the environment handle when stop cannot prove cleanup", async () => {
    const release = vi.fn(async () => {});
    const exec = vi.fn(async ({ intent }: { intent: string }) => ({ ok: intent !== "stop" }));
    const c = new BrowserController({ exec, acquire: async () => ({ generationId: "g", release }), revokeView: async () => {}, admitPlan: async () => ({ admitted: true }), admit: async () => ({ admitted: true }) });
    const s = await c.start(scope);
    await expect(c.stop(scope, s.sessionId)).rejects.toThrow("reconciliation");
    expect(c.status(scope, s.sessionId)).toMatchObject({ state: "error" });
    expect(release).not.toHaveBeenCalled();
  });
  it("rolls takeover back to agent authority when the launcher fails", async () => {
    const exec = vi.fn(async ({ intent }: { intent: string }) => ({ ok: intent !== "takeover" }));
    const c = new BrowserController({ exec, acquire: async () => ({ generationId: "g", release: async () => {} }), revokeView: async () => {}, admitPlan: async () => ({ admitted: true }), admit: async () => ({ admitted: true }) });
    const s = await c.start(scope);
    await expect(c.takeover(scope, s.sessionId)).rejects.toThrow("takeover failed");
    expect(c.status(scope, s.sessionId)).toMatchObject({ state: "agent-controlled", owner: "agent", controlEpoch: 1 });
  });
  it("returns a bounded typed observation and redacts credential canaries", async () => {
    const exec = vi.fn(async ({ intent }: { intent: string }) => ({ ok: true, stdout: intent === "observe" ? JSON.stringify({ url: "https://user:pass@example.com/private", title: "token=CANARY", elements: [{ index: 1, role: "textbox", text: "password: CANARY" }], cookies: "CANARY" }) : "" }));
    const c = new BrowserController({ exec, acquire: async () => ({ generationId: "g", release: async () => {} }), revokeView: async () => {}, admitPlan: async () => ({ admitted: true }), admit: async () => ({ admitted: true }) });
    const s = await c.start(scope);
    const observed = await c.observe(scope, s.sessionId, 0);
    expect(observed.observation).toEqual({ origin: "https://example.com", title: "token=[redacted]", elements: [{ index: 1, role: "textbox", text: "password=[redacted]" }] });
    expect(JSON.stringify(observed)).not.toContain("CANARY");
  });
  it("rejects cross-scope session replay", async () => {
    const c = new BrowserController({
      exec: async () => ({ ok: true }),
      acquire: async () => ({ generationId: "g", release: async () => {} }),
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
