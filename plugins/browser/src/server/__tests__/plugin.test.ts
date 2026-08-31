import { describe, expect, it, vi } from "vitest";
vi.mock("@hachej/boring-workspace/server", () => ({
  defineServerPlugin: <T>(plugin: T) => plugin,
}));
import { createBrowserServerPlugin } from "..";
const scope = {
  workspaceId: "w",
  userId: "u",
  agentId: "a",
  agentSessionId: "s",
};
describe("browser server plugin", () => {
  it("registers exactly two native tools and no lifecycle tool", () => {
    const plugin = createBrowserServerPlugin({
      enabled: false,
      exec: async () => ({ ok: true }),
      acquire: async () => ({ generationId: "g", release: async () => {} }),
      revokeView: async () => {},
      admitPlan: async () => ({ admitted: true }),
      admit: async () => ({ admitted: true }),
      resolveScope: () => scope,
      resolveToolScope: () => scope,
    });
    expect(plugin.agentTools?.map((tool) => tool.name)).toEqual([
      "browser_observe",
      "browser_act",
    ]);
    expect(
      JSON.stringify(plugin.agentTools?.map((tool) => tool.parameters)),
    ).not.toMatch(/command|cdp|mcp|provider|runtime|password|credential/i);
  });
  it("refuses attempted enablement until Host security seams exist", () => {
    expect(() => createBrowserServerPlugin({ enabled: true, exec: async () => ({ ok: true }), acquire: async () => ({ generationId: "g", release: async () => {} }), revokeView: async () => {}, admitPlan: async () => ({ admitted: true }), admit: async () => ({ admitted: true }), resolveScope: () => scope, resolveToolScope: () => scope })).toThrow("not security-qualified");
  });
  it("fails tools closed when flag is disabled", async () => {
    const plugin = createBrowserServerPlugin({
      enabled: false,
      exec: async () => ({ ok: true }),
      acquire: async () => ({ generationId: "g", release: async () => {} }),
      revokeView: async () => {},
      admitPlan: async () => ({ admitted: true }),
      admit: async () => ({ admitted: true }),
      resolveScope: () => scope,
      resolveToolScope: () => scope,
    });
    const result = await plugin.agentTools![0]!.execute(
      { sessionId: "x", controlEpoch: 0 },
      {
        abortSignal: new AbortController().signal,
        toolCallId: "t",
        sessionId: "s",
        userId: "u",
        workspaceId: "w",
      },
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("disabled");
  });
});
