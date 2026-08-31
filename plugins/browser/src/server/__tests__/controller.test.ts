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
      revokeView: async () => {}, redactText: (value: string) => value.replace(/CANARY/g, "[redacted]").replace(/(token|password)[:=]\s*\[redacted\]/gi, "$1=[redacted]"),
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
      revokeView: async () => {}, redactText: (value: string) => value.replace(/CANARY/g, "[redacted]").replace(/(token|password)[:=]\s*\[redacted\]/gi, "$1=[redacted]"),
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
  it("shares one in-flight startup for the same authenticated scope", async () => {
    let resolveEnsure!: () => void;
    const gate = new Promise<void>((resolve) => { resolveEnsure = resolve; });
    const exec = vi.fn(async ({ intent }: { intent: string }) => { if (intent === "ensure") await gate; return { ok: true }; });
    const c = new BrowserController({ exec, acquire: async () => ({ generationId: "g", release: async () => {} }), revokeView: async () => {}, redactText: (value) => value, admitPlan: async () => ({ admitted: true }), admit: async () => ({ admitted: true }) });
    const first = c.start(scope); const second = c.start(scope); resolveEnsure();
    const [a, b] = await Promise.all([first, second]);
    expect(a.sessionId).toBe(b.sessionId);
    expect(exec.mock.calls.filter(([request]) => request.intent === "ensure")).toHaveLength(1);
  });
  it("cleans up and releases a thrown partial start", async () => {
    const release = vi.fn(async () => {});
    const exec = vi.fn(async ({ intent }: { intent: string }) => { if (intent === "ensure") throw new Error("secret upstream"); return { ok: true }; });
    const c = new BrowserController({ exec, acquire: async () => ({ generationId: "g", release }), revokeView: async () => {}, redactText: (value: string) => value.replace(/CANARY/g, "[redacted]").replace(/(token|password)[:=]\s*\[redacted\]/gi, "$1=[redacted]"), admitPlan: async () => ({ admitted: true }), admit: async () => ({ admitted: true }) });
    const result = await c.start(scope);
    expect(result.state).toBe("error");
    expect(exec).toHaveBeenCalledWith(expect.objectContaining({ intent: "stop" }));
    expect(release).toHaveBeenCalledOnce();
  });
  it("retries environment release after cleanup succeeded", async () => {
    const release = vi.fn().mockRejectedValueOnce(new Error("temporary")).mockResolvedValue(undefined);
    const c = new BrowserController({ exec: async () => ({ ok: true }), acquire: async () => ({ generationId: "g", release }), revokeView: async () => {}, redactText: (value) => value, admitPlan: async () => ({ admitted: true }), admit: async () => ({ admitted: true }) });
    const s = await c.start(scope);
    await expect(c.stop(scope, s.sessionId)).rejects.toThrow("temporary");
    await expect(c.stop(scope, s.sessionId)).resolves.toMatchObject({ state: "stopped" });
    expect(release).toHaveBeenCalledTimes(2);
  });
  it("retains the environment handle when stop cannot prove cleanup", async () => {
    const release = vi.fn(async () => {});
    const exec = vi.fn(async ({ intent }: { intent: string }) => ({ ok: intent !== "stop" }));
    const c = new BrowserController({ exec, acquire: async () => ({ generationId: "g", release }), revokeView: async () => {}, redactText: (value: string) => value.replace(/CANARY/g, "[redacted]").replace(/(token|password)[:=]\s*\[redacted\]/gi, "$1=[redacted]"), admitPlan: async () => ({ admitted: true }), admit: async () => ({ admitted: true }) });
    const s = await c.start(scope);
    await expect(c.stop(scope, s.sessionId)).rejects.toThrow("reconciliation");
    expect(c.status(scope, s.sessionId)).toMatchObject({ state: "error" });
    expect(release).not.toHaveBeenCalled();
  });
  it("rolls takeover back to agent authority when the launcher fails", async () => {
    const exec = vi.fn(async ({ intent }: { intent: string }) => ({ ok: intent !== "takeover" }));
    const c = new BrowserController({ exec, acquire: async () => ({ generationId: "g", release: async () => {} }), revokeView: async () => {}, redactText: (value: string) => value.replace(/CANARY/g, "[redacted]").replace(/(token|password)[:=]\s*\[redacted\]/gi, "$1=[redacted]"), admitPlan: async () => ({ admitted: true }), admit: async () => ({ admitted: true }) });
    const s = await c.start(scope);
    await expect(c.takeover(scope, s.sessionId)).rejects.toThrow("reconciliation");
    expect(c.status(scope, s.sessionId)).toMatchObject({ state: "error", controlEpoch: 1 });
  });
  it("returns a bounded typed observation and redacts credential canaries", async () => {
    const exec = vi.fn(async ({ intent }: { intent: string }) => ({ ok: true, stdout: intent === "observe" ? JSON.stringify({ url: "https://user:pass@example.com/private", title: "token=CANARY", elements: [{ index: 1, role: "textbox", text: "password: CANARY" }], cookies: "CANARY" }) : "" }));
    const c = new BrowserController({ exec, acquire: async () => ({ generationId: "g", release: async () => {} }), revokeView: async () => {}, redactText: (value: string) => value.replace(/CANARY/g, "[redacted]").replace(/(token|password)[:=]\s*\[redacted\]/gi, "$1=[redacted]"), admitPlan: async () => ({ admitted: true }), admit: async () => ({ admitted: true }) });
    const s = await c.start(scope);
    const observed = await c.observe(scope, s.sessionId, 0);
    expect(observed.observation).toEqual({ origin: "https://example.com", title: "token=[redacted]", elements: [{ index: 1, role: "textbox", text: "password=[redacted]" }] });
    expect(JSON.stringify(observed)).not.toContain("CANARY");
  });
  it("clears active state when plan admission throws and propagates pre-aborted calls", async () => {
    let throwAdmission = true;
    const c = new BrowserController({ exec: async () => ({ ok: true }), acquire: async () => ({ generationId: "g", release: async () => {} }), revokeView: async () => {}, redactText: (value) => value, admitPlan: async () => { if (throwAdmission) throw new Error("admission failed"); return { admitted: true }; }, admit: async () => ({ admitted: true }) });
    const s = await c.start(scope);
    const input = { sessionId: s.sessionId, controlEpoch: 0, actions: [{ kind: "click", target: { index: 1 } }] };
    await expect(c.act(scope, input, undefined, { toolCallId: "one" })).rejects.toThrow("admission failed");
    throwAdmission = false;
    const abort = new AbortController(); abort.abort();
    await expect(c.act(scope, input, abort.signal, { toolCallId: "two" })).rejects.toThrow("aborted");
  });
  it("rejects cross-scope session replay", async () => {
    const c = new BrowserController({
      exec: async () => ({ ok: true }),
      acquire: async () => ({ generationId: "g", release: async () => {} }),
      revokeView: async () => {}, redactText: (value: string) => value.replace(/CANARY/g, "[redacted]").replace(/(token|password)[:=]\s*\[redacted\]/gi, "$1=[redacted]"),
      admitPlan: async () => ({ admitted: true }),
      admit: async () => ({ admitted: true }),
    });
    const s = await c.start(scope);
    expect(() =>
      c.status({ ...scope, workspaceId: "other" }, s.sessionId),
    ).toThrow("not found");
  });
});
