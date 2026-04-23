import { describe, it, expect, vi } from "vitest";
import type { SessionDetail } from "../../../../shared/session.js";
import {
  createSessionTitleScheduler,
  formatFallbackTitle,
} from "../sessionTitle.js";

const FIXED_NOW = new Date("2026-04-23T12:34:56.000Z");

function sessionDetail(overrides: Partial<SessionDetail> = {}): SessionDetail {
  return {
    id: "sess-1",
    title: "New session",
    createdAt: "2026-04-23T12:30:00.000Z",
    updatedAt: "2026-04-23T12:34:56.000Z",
    turnCount: 1,
    messages: [],
    ...overrides,
  };
}

describe("createSessionTitleScheduler", () => {
  it("uses Anthropic title when request succeeds", async () => {
    const loadSession = vi.fn(async () => sessionDetail());
    const writeTitle = vi.fn();
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: "text", text: '"Review deployment checklist"' }],
      }),
    })) as unknown as typeof fetch;

    const schedule = createSessionTitleScheduler({
      loadSession,
      writeTitle,
      fetchImpl,
      getApiKey: () => "sk-ant-test",
      now: () => FIXED_NOW,
      timeoutMs: 20,
      pollMs: 1,
    });

    schedule({
      sessionId: "sess-1",
      firstUserMessage: "Help me deploy this service.",
      firstAssistantReply: "I can provide a deployment checklist.",
    });

    await vi.waitFor(() => {
      expect(writeTitle).toHaveBeenCalledWith(
        "sess-1",
        "Review deployment checklist",
      );
    });
    expect(loadSession).toHaveBeenCalledWith("sess-1");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [, init] = vi.mocked(fetchImpl).mock.calls[0] ?? [];
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.messages[0].content).toContain("Help me deploy this service.");
    expect(body.messages[0].content).toContain(
      "I can provide a deployment checklist.",
    );
  });

  it("falls back when Anthropic request fails", async () => {
    const writeTitle = vi.fn();
    const fetchImpl = vi.fn(async () => {
      throw new Error("network failed");
    }) as unknown as typeof fetch;

    const schedule = createSessionTitleScheduler({
      loadSession: async () => sessionDetail(),
      writeTitle,
      fetchImpl,
      getApiKey: () => "sk-ant-test",
      now: () => FIXED_NOW,
      timeoutMs: 20,
      pollMs: 1,
      onWarn: () => {},
    });

    schedule({
      sessionId: "sess-2",
      firstUserMessage: "Need help naming this chat",
      firstAssistantReply: "Sure, let's find a concise title.",
    });

    await vi.waitFor(() => {
      expect(writeTitle).toHaveBeenCalledWith(
        "sess-2",
        formatFallbackTitle(FIXED_NOW),
      );
    });
  });

  it("does not generate title after first turn", async () => {
    const writeTitle = vi.fn();
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: "text", text: "Should not be used" }],
      }),
    })) as unknown as typeof fetch;

    const schedule = createSessionTitleScheduler({
      loadSession: async () => sessionDetail({ turnCount: 2 }),
      writeTitle,
      fetchImpl,
      getApiKey: () => "sk-ant-test",
      now: () => FIXED_NOW,
      timeoutMs: 20,
      pollMs: 1,
    });

    schedule({
      sessionId: "sess-3",
      firstUserMessage: "second turn user message",
      firstAssistantReply: "second turn assistant reply",
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(writeTitle).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses fallback when API key is unavailable", async () => {
    const writeTitle = vi.fn();

    const schedule = createSessionTitleScheduler({
      loadSession: async () => sessionDetail(),
      writeTitle,
      getApiKey: () => "",
      now: () => FIXED_NOW,
      timeoutMs: 20,
      pollMs: 1,
    });

    schedule({
      sessionId: "sess-4",
      firstUserMessage: "what should we name this",
      firstAssistantReply: "Let's summarize the objective quickly.",
    });

    await vi.waitFor(() => {
      expect(writeTitle).toHaveBeenCalledWith(
        "sess-4",
        formatFallbackTitle(FIXED_NOW),
      );
    });
  });
});
