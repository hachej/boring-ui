import { describe, expect, it, vi } from "vitest";
import { createBrowserHostCapability } from "../hostCapability";

const scope = { workspaceId: "w", userId: "u", agentId: "a", agentSessionId: "s" };

describe("createBrowserHostCapability", () => {
  it("binds fixed operations and opaque projections to the exact retained generation", async () => {
    const releaseEnvironment = vi.fn();
    const close = vi.fn(async () => {});
    const revokeUpstream = vi.fn(async () => {});
    const invoke = vi.fn(async () => ({ status: "ok" as const, payload: new TextEncoder().encode("observed") }));
    const createProjection = vi.fn(async () => ({
      url: "https://provider.invalid/vnc?secret=never-client-visible",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      revoke: revokeUpstream,
    }));
    const capability = createBrowserHostCapability({
      idleTtlMs: 60_000,
      absoluteTtlMs: 120_000,
      acquireExactSessionEnvironment: async () => ({
        environmentGenerationId: "generation-exact",
        signal: new AbortController().signal,
        acquireTrustedService: async () => ({ invoke, createProjection, close }),
        release: releaseEnvironment,
      }),
      issueProjection: ({ generationId, upstream }) => {
        expect(generationId).toBe("generation-exact");
        expect(upstream.url).toContain("provider.invalid");
        return {
          bootstrapPath: "/api/v1/runtime-projection/bootstrap/opaque?grant=opaque",
          expiresAt: upstream.expiresAt,
          revoke: upstream.revoke,
        };
      },
    });

    const environment = await capability.acquire(scope);
    expect(environment.generationId).toBe("generation-exact");
    expect(await environment.invoke({ intent: "observe", sessionId: "browser", controlEpoch: 0 }))
      .toEqual({ ok: true, stdout: "observed" });
    const view = await environment.createView({ mode: "observe", controlEpoch: 0 });
    expect(view.url).toBe("/api/v1/runtime-projection/bootstrap/opaque?grant=opaque");
    expect(view.url).not.toContain("provider.invalid");
    await view.revoke();
    expect(revokeUpstream).toHaveBeenCalledOnce();
    await environment.release();
    await environment.release();
    expect(close).toHaveBeenCalledOnce();
    expect(releaseEnvironment).toHaveBeenCalledOnce();
    expect(JSON.stringify(invoke.mock.calls)).not.toMatch(/command|argv|image|port|provider/);
  });

  it("releases the exact Environment if trusted-service acquisition fails", async () => {
    const release = vi.fn();
    const capability = createBrowserHostCapability({
      idleTtlMs: 1_000,
      absoluteTtlMs: 2_000,
      acquireExactSessionEnvironment: async () => ({
        environmentGenerationId: "g",
        signal: new AbortController().signal,
        acquireTrustedService: async () => { throw new Error("unsupported"); },
        release,
      }),
      issueProjection: () => { throw new Error("unreachable"); },
    });
    await expect(capability.acquire(scope)).rejects.toThrow("unsupported");
    expect(release).toHaveBeenCalledOnce();
  });
});
