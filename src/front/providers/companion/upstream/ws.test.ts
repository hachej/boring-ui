import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../config.js", () => ({
  getCompanionBaseUrl: vi.fn(),
  getCompanionAuthToken: vi.fn(),
}));

import { getCompanionBaseUrl, getCompanionAuthToken } from "../config.js";
import { __companionWsTestUtils } from "./ws.js";
import { useStore } from "./store.js";

describe("companion upstream ws URL", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rewrites legacy /ws/browser/{id} to canonical /ws/agent/companion/browser/{id}", () => {
    vi.mocked(getCompanionBaseUrl).mockReturnValue("https://companion.example/cc/");
    vi.mocked(getCompanionAuthToken).mockReturnValue("test-token");
    expect(__companionWsTestUtils.getWsUrl("sess-1")).toBe(
      "wss://companion.example/cc/ws/agent/companion/browser/sess-1?token=test-token",
    );
  });

  it("trims and normalizes base path slashes for ws URL construction", () => {
    vi.mocked(getCompanionBaseUrl).mockReturnValue("  https://companion.example/cc///  ");
    vi.mocked(getCompanionAuthToken).mockReturnValue("test-token");
    expect(__companionWsTestUtils.getWsUrl("sess-1")).toBe(
      "wss://companion.example/cc/ws/agent/companion/browser/sess-1?token=test-token",
    );
  });

  it("omits token query string when token is not set", () => {
    vi.mocked(getCompanionBaseUrl).mockReturnValue("http://companion.example");
    vi.mocked(getCompanionAuthToken).mockReturnValue("");
    expect(__companionWsTestUtils.getWsUrl("sess-2")).toBe(
      "ws://companion.example/ws/agent/companion/browser/sess-2",
    );
  });
});

describe("companion auth-required transitions", () => {
  afterEach(() => {
    useStore.getState().reset();
  });

  it("flags auth required on assistant login failure text", () => {
    const sessionId = "sess-auth-1";
    __companionWsTestUtils.dispatchMessage(sessionId, {
      type: "assistant",
      parent_tool_use_id: null,
      message: {
        id: "msg-1",
        type: "message",
        role: "assistant",
        model: "test",
        content: [{ type: "text", text: "Not logged in · Please run /login" }],
        stop_reason: null,
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    });
    expect(useStore.getState().authRequired.get(sessionId)).toContain("Please run /login");
  });

  it("does not clear auth required on cli/session lifecycle events", () => {
    const sessionId = "sess-auth-2";
    useStore.getState().setAuthRequired(sessionId, "Authentication required");

    __companionWsTestUtils.dispatchMessage(sessionId, { type: "cli_connected" });
    expect(useStore.getState().authRequired.get(sessionId)).toBe("Authentication required");

    __companionWsTestUtils.dispatchMessage(sessionId, {
      type: "session_init",
      session: {
        session_id: sessionId,
        model: "test",
        cwd: "/tmp",
        tools: [],
        permissionMode: "acceptEdits",
        claude_code_version: "test",
        mcp_servers: [],
        agents: [],
        slash_commands: [],
        skills: [],
        total_cost_usd: 0,
        num_turns: 0,
        context_used_percent: 0,
        is_compacting: false,
        git_branch: "main",
        is_worktree: false,
        repo_root: "/tmp",
        git_ahead: 0,
        git_behind: 0,
        total_lines_added: 0,
        total_lines_removed: 0,
      },
    });

    expect(useStore.getState().authRequired.get(sessionId)).toBe("Authentication required");
  });

  it("keeps auth required on auth_status without explicit success", () => {
    const sessionId = "sess-auth-3";
    useStore.getState().setAuthRequired(sessionId, "Authentication required");

    __companionWsTestUtils.dispatchMessage(sessionId, {
      type: "auth_status",
      isAuthenticating: false,
      output: ["Logged in as stale-token-user"],
    });

    expect(useStore.getState().authRequired.get(sessionId)).toBe("Authentication required");
  });
});
