import { describe, expect, it, vi } from "vitest";
vi.mock("@hachej/boring-workspace/server", () => ({ defineServerPlugin: <T>(plugin: T) => plugin }));
import { createBrowserServerPlugin } from "..";
import type { BrowserHostCapability } from "../controller";

const scope = { workspaceId: "w", userId: "u", agentId: "a", agentSessionId: "s" };
const host: BrowserHostCapability = {
  acquire: async () => ({
    generationId: "g",
    signal: new AbortController().signal,
    invoke: async () => ({ ok: true }),
    createView: async () => ({ url: "/api/v1/runtime-projection/bootstrap/opaque?grant=opaque", expiresAt: new Date(Date.now() + 60_000).toISOString(), revoke: async () => {} }),
    release: async () => {},
  }),
};
const options = {
  host,
  admitPlan: async () => ({ admitted: true }),
  admit: async () => ({ admitted: true }),
  resolveScope: () => scope,
  resolveToolScope: () => scope,
  redactText: (value: string) => value,
};

describe("browser server plugin", () => {
  it("registers exactly two native tools and no lifecycle tool when explicitly enabled", () => {
    const plugin = createBrowserServerPlugin({ ...options, enabled: true });
    expect(plugin.agentTools?.map((tool) => tool.name)).toEqual(["browser_observe", "browser_act"]);
    expect(JSON.stringify(plugin.agentTools?.map((tool) => tool.parameters)))
      .not.toMatch(/command|cdp|mcp|provider|runtime|password|credential/i);
  });

  it("is immutable default-off composition with no tools, routes, skills, or assets", () => {
    const plugin = createBrowserServerPlugin({ ...options, enabled: false });
    expect(plugin.agentTools).toBeUndefined();
    expect(plugin.routes).toBeUndefined();
    expect(plugin.skills).toBeUndefined();
    expect(plugin.assets).toBeUndefined();
  });

  it("does not consult an ambient browser enablement variable", () => {
    vi.stubEnv("BORING_BROWSER_PLUGIN_ENABLED", "1");
    const plugin = createBrowserServerPlugin({ ...options, enabled: false });
    expect(plugin.agentTools).toBeUndefined();
    vi.unstubAllEnvs();
  });
});
