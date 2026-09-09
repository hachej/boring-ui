import { describe, expect, it, vi } from "vitest";
import {
  BrowserController,
  type BrowserExecRequest,
  type BrowserExecResult,
  type BrowserHostCapability,
  type BrowserScope,
} from "../controller";

const scope: BrowserScope = { workspaceId: "w", userId: "u", agentId: "a", agentSessionId: "chat" };

function host(exec: (request: BrowserExecRequest) => Promise<BrowserExecResult>, release = vi.fn(async () => {})): BrowserHostCapability {
  return {
    async acquire() {
      return {
        generationId: "g",
        signal: new AbortController().signal,
        invoke: exec,
        createView: async ({ mode, controlEpoch }) => ({
          url: `/api/v1/runtime-projection/bootstrap/opaque-${mode}-${controlEpoch}`,
          grant: "opaque",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          revoke: vi.fn(async () => {}),
        }),
        release,
      };
    },
  };
}
const redact = (value: string) => value.replace(/CANARY/g, "[redacted]").replace(/(token|password)[:=]\s*\[redacted\]/gi, "$1=[redacted]");
const policies = { redactText: redact, admitPlan: async () => ({ admitted: true }), admit: async () => ({ admitted: true }) };

describe("BrowserController", () => {
  it("fences takeover/return by epoch, rotates opaque views, and releases once", async () => {
    const exec = vi.fn(async () => ({ ok: true, stdout: "state" }));
    const release = vi.fn(async () => {});
    const c = new BrowserController({ host: host(exec, release), ...policies });
    const started = await c.start(scope);
    expect(started.view?.url).not.toMatch(/port=|provider|6080|https?:\/\//);
    const taken = await c.takeover(scope, started.sessionId);
    expect(taken.view?.url).not.toBe(started.view?.url);
    await expect(c.observe(scope, started.sessionId, 0)).rejects.toThrow("stale");
    const returned = await c.return(scope, started.sessionId, true);
    expect(returned.controlEpoch).toBe(2);
    expect(returned.view?.url).not.toBe(taken.view?.url);
    await c.stop(scope, started.sessionId);
    await c.stop(scope, started.sessionId);
    expect(release).toHaveBeenCalledOnce();
  });

  it("admits every action and stops without retry on unknown outcome", async () => {
    let acts = 0;
    const exec = vi.fn(async ({ intent }: { intent: string }) => intent === "act" && ++acts === 2 ? { ok: false } : { ok: true, stdout: "ok" });
    const admit = vi.fn(async () => ({ admitted: true, approvalRef: "approved" }));
    const c = new BrowserController({ host: host(exec), ...policies, admit });
    const s = await c.start(scope);
    await expect(c.act(scope, { sessionId: s.sessionId, controlEpoch: 0, actions: [
      { kind: "click", target: { index: 1 } }, { kind: "click", target: { index: 2 } },
    ] }, undefined, { toolCallId: "tool" })).rejects.toThrow("unknown");
    expect(admit).toHaveBeenCalledTimes(2);
    expect(acts).toBe(2);
  });

  it("shares one in-flight startup for the same authenticated scope", async () => {
    let resolveEnsure!: () => void;
    const gate = new Promise<void>((resolve) => { resolveEnsure = resolve; });
    const exec = vi.fn(async ({ intent }: { intent: string }) => { if (intent === "ensure") await gate; return { ok: true }; });
    const c = new BrowserController({ host: host(exec), ...policies });
    const first = c.start(scope); const second = c.start(scope); resolveEnsure();
    const [a, b] = await Promise.all([first, second]);
    expect(a.sessionId).toBe(b.sessionId);
    expect(exec.mock.calls.filter(([request]) => request.intent === "ensure")).toHaveLength(1);
  });

  it("retains the environment when stop cannot prove cleanup", async () => {
    const release = vi.fn(async () => {});
    const exec = vi.fn(async ({ intent }: { intent: string }) => ({ ok: intent !== "stop" }));
    const c = new BrowserController({ host: host(exec, release), ...policies });
    const s = await c.start(scope);
    await expect(c.stop(scope, s.sessionId)).rejects.toThrow("reconciliation");
    expect(c.status(scope, s.sessionId)).toMatchObject({ state: "error" });
    expect(release).not.toHaveBeenCalled();
  });

  it("returns a bounded typed observation and redacts credential canaries", async () => {
    const exec = vi.fn(async ({ intent }: { intent: string }) => ({ ok: true, stdout: intent === "observe" ? JSON.stringify({ url: "https://user:pass@example.com/private", title: "token=CANARY", elements: [{ index: 1, role: "textbox", text: "password: CANARY" }], cookies: "CANARY" }) : "" }));
    const c = new BrowserController({ host: host(exec), ...policies });
    const s = await c.start(scope);
    const observed = await c.observe(scope, s.sessionId, 0);
    expect(observed.observation).toEqual({ origin: "https://example.com", title: "token=[redacted]", elements: [{ index: 1, role: "textbox", text: "password=[redacted]" }] });
    expect(JSON.stringify(observed)).not.toContain("CANARY");
  });

  it("rejects cross-scope and generation-aborted authority", async () => {
    const abort = new AbortController();
    const exec = vi.fn(async () => ({ ok: true }));
    const capability: BrowserHostCapability = { acquire: async () => ({
      ...(await host(exec).acquire(scope)), signal: abort.signal,
    }) };
    const c = new BrowserController({ host: capability, ...policies });
    const s = await c.start(scope);
    expect(() => c.status({ ...scope, workspaceId: "other" }, s.sessionId)).toThrow("not found");
    abort.abort();
    await vi.waitFor(() => expect(c.status(scope, s.sessionId).state).toMatch(/stopped|error/));
  });
});
