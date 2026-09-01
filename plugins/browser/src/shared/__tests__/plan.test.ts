import { describe, expect, it } from "vitest";
import { canonicalPlan, parseActionPlan } from "..";
describe("browser action plan", () => {
  it("normalizes and deeply freezes a closed plan", () => {
    const input = {
      sessionId: "s",
      controlEpoch: 2,
      actions: [{ kind: "click", target: { index: 4 } }],
    };
    const plan = parseActionPlan(input);
    input.actions[0]!.target.index = 9;
    expect(canonicalPlan(plan)).toBe(
      '{"sessionId":"s","controlEpoch":2,"actions":[{"kind":"click","target":{"index":4}}]}',
    );
    expect(Object.isFrozen(plan.actions)).toBe(true);
    expect(Object.isFrozen(plan.actions[0])).toBe(true);
    expect(
      Object.isFrozen((plan.actions[0] as { target: object }).target),
    ).toBe(true);
  });
  it.each([
    "http://localhost:3000",
    "http://127.0.0.1",
    "http://10.0.0.1",
    "http://172.31.2.3",
    "http://192.168.1.1",
    "http://169.254.169.254/latest",
    "http://[fd00::1]",
    "http://2130706433",
    "file:///etc/passwd",
    "https://u:p@example.com",
  ])("rejects unsafe navigation %s", (url) => {
    expect(() =>
      parseActionPlan({
        sessionId: "s",
        controlEpoch: 0,
        actions: [{ kind: "navigate", url }],
      }),
    ).toThrow();
  });
  it("rejects arbitrary commands and MCP fields", () => {
    expect(() =>
      parseActionPlan({
        sessionId: "s",
        controlEpoch: 0,
        actions: [{ kind: "click", target: { index: 1 }, command: "id" }],
      }),
    ).toThrow("unsupported field");
    expect(() =>
      parseActionPlan({
        sessionId: "s",
        controlEpoch: 0,
        actions: [{ kind: "call_tool", name: "eval" }],
      }),
    ).toThrow("unsupported");
  });
});
