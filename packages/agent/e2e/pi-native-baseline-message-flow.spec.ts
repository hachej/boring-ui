import { expect, test } from "./fixtures";
import { navigateBrowserToBackend } from "./helpers/browser";
import { assertChatDomInvariants, readChatDomState } from "./helpers/chat-state";
import {
  countOccurrences,
  emitPiNativeFrames,
  markMessageRow,
  markWorkingSlot,
  readLegacyHydrationFlash,
  readMessageRowMarker,
  readMessageSummary,
  readMockPromptState,
  readWorkingSlotState,
} from "./helpers/pi-native-message-flow";
import { installPiNativeMock } from "./pi-native-mock";

test.describe("Pi-native baseline message flow", () => {
  test("ignores stale legacy browser transcript cache on Pi-native hydration", async ({
    page,
    backend,
  }, testInfo) => {
    await installPiNativeMock(page);
    await page.addInitScript(() => {
      const staleNeedles = [
        "STALE_LEGACY_USER_PROMPT",
        "STALE_LEGACY_ASSISTANT_TEXT",
      ];
      const flashState = { seen: false, matches: [] as string[] };
      Object.defineProperty(window, "__piNativeLegacyFlash", {
        value: flashState,
        configurable: true,
      });
      const scanForLegacyText = () => {
        const bodyText = document.body?.textContent ?? "";
        for (const needle of staleNeedles) {
          if (bodyText.includes(needle) && !flashState.matches.includes(needle)) {
            flashState.seen = true;
            flashState.matches.push(needle);
          }
        }
      };
      const observer = new MutationObserver(scanForLegacyText);
      observer.observe(document, {
        childList: true,
        subtree: true,
        characterData: true,
      });
      scanForLegacyText();

      localStorage.setItem(
        "boring-ui:chat-sessions:v1",
        JSON.stringify({
          activeSessionId: "legacy-active",
          sessions: [
            {
              id: "legacy-active",
              title: "Legacy cached transcript",
              lastModified: Date.now(),
              status: "active",
              draft: "",
              messages: [
                {
                  id: "legacy-user",
                  role: "user",
                  parts: [{ type: "text", text: "STALE_LEGACY_USER_PROMPT" }],
                },
                {
                  id: "legacy-assistant",
                  role: "assistant",
                  parts: [
                    { type: "text", text: "STALE_LEGACY_ASSISTANT_TEXT" },
                  ],
                },
              ],
            },
          ],
        }),
      );
      localStorage.setItem(
        "__boring_pi_native_e2e_state__",
        JSON.stringify({
          seq: 2,
          status: "idle",
          messages: [
            {
              id: "server-user",
              role: "user",
              status: "done",
              parts: [
                {
                  type: "text",
                  id: "server-user:text",
                  text: "<redacted server prompt>",
                },
              ],
            },
            {
              id: "server-assistant",
              role: "assistant",
              status: "done",
              parts: [
                {
                  type: "text",
                  id: "server-assistant:text",
                  text: "SERVER_STATE_ONLY_TEXT",
                },
              ],
            },
          ],
          queue: { followUps: [] },
          prompts: [],
          followups: [],
          stops: 0,
          interrupts: 0,
          clears: 0,
          reloads: 0,
          uiCommandDispatches: 0,
        }),
      );
    });

    await navigateBrowserToBackend(page, `${backend.browserUrl}?piNative=1`);

    const chat = page.locator('[data-boring-agent-part="chat"]');
    const conversation = page.getByLabel("Agent conversation");

    await expect(chat).toHaveAttribute("data-pi-chat-connection", "connected", {
      timeout: 10_000,
    });
    await expect(conversation.getByText("SERVER_STATE_ONLY_TEXT")).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      conversation.getByText("STALE_LEGACY_USER_PROMPT"),
    ).toHaveCount(0);
    await expect(
      conversation.getByText("STALE_LEGACY_ASSISTANT_TEXT"),
    ).toHaveCount(0);
    const legacyFlash = await readLegacyHydrationFlash(page);
    expect(legacyFlash.seen).toBe(false);

    const summary = await readMessageSummary(page);
    await testInfo.attach("pi-native-baseline-legacy-cache-ignored.json", {
      body: Buffer.from(
        JSON.stringify(
          { checkpoint: "T0-legacy-cache-ignored", messages: summary, legacyFlash },
          null,
          2,
        ),
        "utf8",
      ),
      contentType: "application/json",
    });

    expect(summary.map((message) => message.id)).toEqual([
      "server-user",
      "server-assistant",
    ]);
    expect(summary.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
  });

  test("reconciles replayed user starts by nonce without duplicating the prompt row", async ({
    page,
    backend,
  }, testInfo) => {
    await installPiNativeMock(page);
    await page.addInitScript(() => {
      localStorage.setItem(
        "__boring_pi_native_e2e_state__",
        JSON.stringify({
          seq: 5,
          status: "idle",
          messages: [
            {
              id: "user-from-state",
              role: "user",
              status: "done",
              clientNonce: "duplicate-user-nonce",
              parts: [
                {
                  type: "text",
                  id: "user-from-state:text",
                  text: "redacted duplicate prompt",
                },
              ],
            },
          ],
          queue: { followUps: [] },
          prompts: [],
          followups: [],
          stops: 0,
          interrupts: 0,
          clears: 0,
          reloads: 0,
          uiCommandDispatches: 0,
        }),
      );
    });

    await navigateBrowserToBackend(page, `${backend.browserUrl}?piNative=1`);

    const chat = page.locator('[data-boring-agent-part="chat"]');
    const conversation = page.getByLabel("Agent conversation");
    await expect(chat).toHaveAttribute("data-pi-chat-connection", "connected", {
      timeout: 10_000,
    });
    await expect(page.getByText("redacted duplicate prompt")).toBeVisible({
      timeout: 10_000,
    });

    await page.evaluate(() => {
      (window as unknown as {
        __piNativeE2EEmit: (sessionId: string, frame: unknown) => void;
      }).__piNativeE2EEmit("pi-e2e", {
        type: "message-start",
        seq: 6,
        messageId: "user-from-live-replay",
        role: "user",
        clientNonce: "duplicate-user-nonce",
        text: "redacted duplicate prompt",
      });
    });

    await expect(
      page.locator('[data-boring-agent-message-role="user"]'),
    ).toHaveCount(1, { timeout: 10_000 });

    const summary = await readMessageSummary(page);
    await testInfo.attach("pi-native-baseline-user-replay-dedupe.json", {
      body: Buffer.from(
        JSON.stringify({ checkpoint: "T2-user-replay-dedupe", messages: summary }, null, 2),
        "utf8",
      ),
      contentType: "application/json",
    });

    expect(summary).toHaveLength(1);
    expect(summary[0]).toMatchObject({
      id: "user-from-live-replay",
      role: "user",
      status: "done",
    });
    expect(countOccurrences(summary[0]?.text ?? "", "redacted duplicate prompt")).toBe(1);
  });

  test("renders one ordered turn with stable reasoning, tool, and text parts", async ({
    page,
    backend,
  }, testInfo) => {
    await installPiNativeMock(page);
    await page.addInitScript(() => {
      localStorage.setItem("boring-agent:v2:agent-playground:composer:show-thoughts", "1");
      localStorage.setItem(
        "__boring_pi_native_e2e_state__",
        JSON.stringify({ promptResponseDelayMs: 1500 }),
      );
    });
    await navigateBrowserToBackend(page, `${backend.browserUrl}?piNative=1`);

    const chat = page.locator('[data-boring-agent-part="chat"]');
    const composer = page.locator('[data-boring-agent-part="composer-input"]');
    const conversation = page.getByLabel("Agent conversation");

    await expect(chat).toHaveAttribute("data-pi-chat-connection", "connected", {
      timeout: 10_000,
    });

    await composer.fill("baseline inspect workspace");
    await page.locator('[data-boring-agent-part="composer-submit"]').click();
    await expect(composer).toHaveValue("", { timeout: 500 });

    await expect(
      conversation.getByText("PI_NATIVE_ASSISTANT_DONE"),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("chat-working")).toHaveCount(0, {
      timeout: 10_000,
    });

    const summary = await readMessageSummary(page);
    await testInfo.attach("pi-native-baseline-message-flow.json", {
      body: Buffer.from(
        JSON.stringify({ checkpoint: "T5", messages: summary }, null, 2),
        "utf8",
      ),
      contentType: "application/json",
    });

    expect(summary).toHaveLength(2);
    expect(new Set(summary.map((message) => message.id)).size).toBe(
      summary.length,
    );
    expect(summary.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(summary.map((message) => message.id)).toEqual(["u1", "a1"]);

    const assistant = summary[1];
    expect(assistant?.reasoningCount).toBe(1);
    expect(assistant?.toolGroupCount).toBe(1);
    expect(assistant?.textPartCount).toBe(1);
    expect(assistant?.partOrder).toEqual([
      "message-reasoning",
      "message-tools",
      "message-text",
    ]);
    expect(
      countOccurrences(assistant?.text ?? "", "PI_NATIVE_ASSISTANT_DONE"),
    ).toBe(1);
  });

  test("renders fragmented assistant text deltas as one final text part", async ({
    page,
    backend,
  }, testInfo) => {
    await installPiNativeMock(page);
    await page.addInitScript(() => {
      localStorage.setItem(
        "__boring_pi_native_e2e_state__",
        JSON.stringify({
          promptFinalText: "FRAGMENTED_STREAM_DONE",
          promptTextDeltas: ["FRAGMENTED_", "STREAM_", "DONE"],
        }),
      );
    });
    await navigateBrowserToBackend(page, `${backend.browserUrl}?piNative=1`);

    const chat = page.locator('[data-boring-agent-part="chat"]');
    const composer = page.locator('[data-boring-agent-part="composer-input"]');
    const conversation = page.getByLabel("Agent conversation");

    await expect(chat).toHaveAttribute("data-pi-chat-connection", "connected", {
      timeout: 10_000,
    });

    await composer.fill("fragmented streaming probe");
    await page.locator('[data-boring-agent-part="composer-submit"]').click();

    await expect(
      conversation.getByText("FRAGMENTED_STREAM_DONE"),
    ).toBeVisible({ timeout: 10_000 });

    const summary = await readMessageSummary(page);
    const assistant = summary.find((message) => message.role === "assistant");

    await testInfo.attach("pi-native-baseline-fragmented-text.json", {
      body: Buffer.from(
        JSON.stringify({
          checkpoint: "T5-fragmented-text",
          messages: summary,
        }, null, 2),
        "utf8",
      ),
      contentType: "application/json",
    });

    expect(summary.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(assistant?.textPartCount).toBe(1);
    expect(
      countOccurrences(assistant?.text ?? "", "FRAGMENTED_STREAM_DONE"),
    ).toBe(1);
  });

  test("keeps previous completed turns ordered after a second prompt", async ({
    page,
    backend,
  }, testInfo) => {
    await installPiNativeMock(page);
    await page.addInitScript(() => {
      localStorage.setItem(
        "__boring_pi_native_e2e_state__",
        JSON.stringify({
          promptFinalTexts: ["FIRST_TURN_DONE", "SECOND_TURN_DONE"],
        }),
      );
    });
    await navigateBrowserToBackend(page, `${backend.browserUrl}?piNative=1`);

    const chat = page.locator('[data-boring-agent-part="chat"]');
    const composer = page.locator('[data-boring-agent-part="composer-input"]');
    const submit = page.locator('[data-boring-agent-part="composer-submit"]');
    const conversation = page.getByLabel("Agent conversation");

    await expect(chat).toHaveAttribute("data-pi-chat-connection", "connected", {
      timeout: 10_000,
    });

    await composer.fill("first ordering probe");
    await submit.click();
    await expect(conversation.getByText("FIRST_TURN_DONE")).toBeVisible({
      timeout: 10_000,
    });

    const firstSummary = await readMessageSummary(page);
    expect(firstSummary.map((message) => message.id)).toEqual(["u1", "a1"]);
    expect(firstSummary.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    const firstAssistantText = firstSummary[1]?.text ?? "";
    expect(countOccurrences(firstAssistantText, "FIRST_TURN_DONE")).toBe(1);

    await composer.fill("second ordering probe");
    await submit.click();
    await expect(conversation.getByText("SECOND_TURN_DONE")).toBeVisible({
      timeout: 10_000,
    });

    const finalSummary = await readMessageSummary(page);
    const assistants = finalSummary.filter((message) => message.role === "assistant");

    await testInfo.attach("pi-native-baseline-two-turn-ordering.json", {
      body: Buffer.from(
        JSON.stringify({
          checkpoint: "T5-two-turn-ordering",
          firstSummary,
          finalSummary,
        }, null, 2),
        "utf8",
      ),
      contentType: "application/json",
    });

    expect(finalSummary.map((message) => message.id)).toEqual([
      "u1",
      "a1",
      "u2",
      "a2",
    ]);
    expect(finalSummary.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(new Set(finalSummary.map((message) => message.id)).size).toBe(4);
    expect(assistants).toHaveLength(2);
    expect(assistants[0]?.status).toBe("done");
    expect(assistants[1]?.status).toBe("done");
    expect(countOccurrences(assistants[0]?.text ?? "", "FIRST_TURN_DONE")).toBe(1);
    expect(countOccurrences(assistants[0]?.text ?? "", "SECOND_TURN_DONE")).toBe(0);
    expect(countOccurrences(assistants[1]?.text ?? "", "SECOND_TURN_DONE")).toBe(1);
    expect(countOccurrences(assistants[1]?.text ?? "", "FIRST_TURN_DONE")).toBe(0);
  });

  test("shows a running tool state before settling the same tool group", async ({
    page,
    backend,
  }, testInfo) => {
    await installPiNativeMock(page);
    await page.addInitScript(() => {
      localStorage.setItem(
        "__boring_pi_native_e2e_state__",
        JSON.stringify({
          promptFinalText: "DELAYED_TOOL_DONE",
          promptToolResultDelayMs: 1500,
        }),
      );
    });
    await navigateBrowserToBackend(page, `${backend.browserUrl}?piNative=1`);

    const chat = page.locator('[data-boring-agent-part="chat"]');
    const composer = page.locator('[data-boring-agent-part="composer-input"]');
    const submit = page.locator('[data-boring-agent-part="composer-submit"]');
    const conversation = page.getByLabel("Agent conversation");

    await expect(chat).toHaveAttribute("data-pi-chat-connection", "connected", {
      timeout: 10_000,
    });

    await composer.fill("delayed tool state probe");
    await submit.click();

    await expect(
      page.locator('[data-boring-agent-tool-state="running"]'),
    ).toHaveCount(1, { timeout: 10_000 });

    const runningState = await readChatDomState(page);
    const runningAssistant = runningState.messages.find((message) => message.role === "assistant");

    expect(runningState.workingVisible).toBe(true);
    expect(runningAssistant?.id).toBe("a1");
    expect(runningAssistant?.status).toBe("streaming");
    expect(runningAssistant?.toolStates).toEqual(["running"]);
    expect(runningAssistant?.partOrder).toEqual([
      "message-reasoning",
      "message-tools",
    ]);
    expect(runningAssistant?.text).not.toContain("DELAYED_TOOL_DONE");

    await expect(conversation.getByText("DELAYED_TOOL_DONE")).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.locator('[data-boring-agent-tool-state="running"]'),
    ).toHaveCount(0, { timeout: 10_000 });
    await expect(
      page.locator('[data-boring-agent-tool-state="settled"]'),
    ).toHaveCount(1);

    const settledState = await readChatDomState(page);
    const settledAssistant = settledState.messages.find((message) => message.role === "assistant");
    assertChatDomInvariants(settledState);

    await testInfo.attach("pi-native-baseline-delayed-tool-state.json", {
      body: Buffer.from(
        JSON.stringify({
          checkpoint: "T4-delayed-tool-state",
          runningState,
          settledState,
        }, null, 2),
        "utf8",
      ),
      contentType: "application/json",
    });

    expect(settledState.workingVisible).toBe(false);
    expect(settledAssistant?.id).toBe("a1");
    expect(settledAssistant?.status).toBe("done");
    expect(settledAssistant?.toolStates).toEqual(["settled"]);
    expect(settledAssistant?.partOrder).toEqual([
      "message-reasoning",
      "message-tools",
      "message-text",
    ]);
    expect(countOccurrences(settledAssistant?.text ?? "", "DELAYED_TOOL_DONE")).toBe(1);
  });

  test("shows a failed tool state without leaving the turn running", async ({
    page,
    backend,
  }, testInfo) => {
    await installPiNativeMock(page);
    await page.addInitScript(() => {
      localStorage.setItem(
        "__boring_pi_native_e2e_state__",
        JSON.stringify({
          promptFinalText: "FAILED_TOOL_DONE",
          promptToolResultDelayMs: 1000,
          promptToolError: true,
          promptToolErrorText: "TOOL_E2E_ERROR",
          promptToolDescription: "failed-command-header-layout-token-without-breakpoints-0123456789abcdefghijklmnopqrstuvwxyz-0123456789abcdefghijklmnopqrstuvwxyz",
        }),
      );
    });
    await navigateBrowserToBackend(page, `${backend.browserUrl}?piNative=1`);

    const chat = page.locator('[data-boring-agent-part="chat"]');
    const composer = page.locator('[data-boring-agent-part="composer-input"]');
    const submit = page.locator('[data-boring-agent-part="composer-submit"]');
    const conversation = page.getByLabel("Agent conversation");

    await expect(chat).toHaveAttribute("data-pi-chat-connection", "connected", {
      timeout: 10_000,
    });

    await composer.fill("failed tool state probe");
    await submit.click();

    await expect(
      page.locator('[data-boring-agent-tool-state="running"]'),
    ).toHaveCount(1, { timeout: 10_000 });

    const runningState = await readChatDomState(page);
    const runningAssistant = runningState.messages.find((message) => message.role === "assistant");

    expect(runningState.workingVisible).toBe(true);
    expect(runningAssistant?.id).toBe("a1");
    expect(runningAssistant?.status).toBe("streaming");
    expect(runningAssistant?.toolStates).toEqual(["running"]);

    await expect(conversation.getByText("FAILED_TOOL_DONE")).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.locator('[data-boring-agent-tool-state="running"]'),
    ).toHaveCount(0, { timeout: 10_000 });
    await expect(
      page.locator('[data-boring-agent-tool-state="failed"]'),
    ).toHaveCount(1);
    await expect(page.locator('[data-testid="chat-working"]')).toHaveCount(0, {
      timeout: 10_000,
    });

    const failedState = await readChatDomState(page);
    const failedAssistant = failedState.messages.find((message) => message.role === "assistant");
    assertChatDomInvariants(failedState);

    const failedToolTrigger = page.getByRole("button", {
      name: /Tool calls: Failed command/i,
    });
    await expect(failedToolTrigger).toBeVisible();
    const failedToolTriggerClass = await failedToolTrigger.getAttribute("class");
    expect(failedToolTriggerClass).toContain("text-muted-foreground/70");
    expect(failedToolTriggerClass).not.toContain("border-destructive");
    expect(failedToolTriggerClass).not.toContain("text-destructive");
    const failedToolDot = page.locator('[data-boring-agent-tool-state="failed"] [data-boring-agent-part="tool-group-state-dot"]');
    await expect(failedToolDot).toHaveClass(/bg-destructive/);
    await expect(failedToolDot).toHaveClass(/ring-destructive\/20/);
    const failedToolGroup = page.locator('[data-boring-agent-tool-state="failed"]');
    await expect(failedToolGroup).toHaveAttribute("data-state", "closed");
    await failedToolTrigger.click();
    await expect(failedToolGroup).toHaveAttribute("data-state", "open");
    const failedToolCard = page.locator('[data-boring-agent-part="tool-card"]');
    await expect(failedToolCard).toHaveAttribute("data-state", "closed");
    await failedToolCard.getByRole("button", { name: /bash · failed-command-header-layout-token.*Error/i }).click();
    await expect(failedToolCard).toHaveAttribute("data-state", "open");
    const errorPre = page.locator('[data-boring-agent-part="tool-result"] pre').filter({ hasText: "TOOL_E2E_ERROR" });
    await expect(errorPre).toBeVisible();
    await expect(errorPre).toHaveClass(/whitespace-pre-wrap/);
    await expect(errorPre).toHaveClass(/break-words/);
    await expect(errorPre).toHaveClass(/\[overflow-wrap:anywhere\]/);
    const toolResultText = await page.locator('[data-boring-agent-part="tool-result"]').textContent();
    expect(countOccurrences(toolResultText ?? "", "TOOL_E2E_ERROR")).toBe(1);
    const failedToolLayout = await readFailedToolLayout(page);
    expect(failedToolLayout.detailsWidth).toBeLessThanOrEqual(672);
    expect(failedToolLayout.cardWidth).toBeLessThanOrEqual(failedToolLayout.detailsWidth - 17);
    expect(failedToolLayout.cardTop).toBeGreaterThan(failedToolLayout.triggerBottom);
    expect(failedToolLayout.headerRight).toBeLessThanOrEqual(failedToolLayout.cardRight);
    expect(failedToolLayout.badgeRight).toBeLessThanOrEqual(failedToolLayout.headerRight);
    expect(failedToolLayout.chevronRight).toBeLessThanOrEqual(failedToolLayout.headerRight);
    expect(failedToolLayout.titleScrollWidth).toBeGreaterThan(failedToolLayout.titleClientWidth);
    expect(failedToolLayout.dotLeft).toBeLessThan(failedToolLayout.triggerTextLeft);

    await testInfo.attach("pi-native-baseline-failed-tool-state.json", {
      body: Buffer.from(
        JSON.stringify({
          checkpoint: "T4-failed-tool-state",
          runningState,
          failedState,
          failedToolLayout,
        }, null, 2),
        "utf8",
      ),
      contentType: "application/json",
    });

    expect(failedState.workingVisible).toBe(false);
    expect(failedAssistant?.id).toBe("a1");
    expect(failedAssistant?.status).toBe("done");
    expect(failedAssistant?.toolStates).toEqual(["failed"]);
    expect(failedAssistant?.partOrder).toEqual([
      "message-reasoning",
      "message-tools",
      "message-text",
    ]);
    expect(countOccurrences(failedAssistant?.text ?? "", "FAILED_TOOL_DONE")).toBe(1);
  });

  test("keeps an aborted tool state when a different-id late final arrives", async ({
    page,
    backend,
  }, testInfo) => {
    await installPiNativeMock(page);
    await navigateBrowserToBackend(page, `${backend.browserUrl}?piNative=1`);

    const chat = page.locator('[data-boring-agent-part="chat"]');
    const conversation = page.getByLabel("Agent conversation");
    await expect(chat).toHaveAttribute("data-pi-chat-connection", "connected", {
      timeout: 10_000,
    });

    await emitPiNativeFrames(page, [
      { type: "agent-start", seq: 1, turnId: "turn-aborted-tool" },
      {
        type: "message-start",
        seq: 2,
        messageId: "u-abort",
        role: "user",
        clientNonce: "late-final-abort-user",
        text: "redacted abort prompt",
      },
      {
        type: "message-start",
        seq: 3,
        messageId: "a-tool",
        role: "assistant",
      },
      {
        type: "tool-call",
        seq: 4,
        messageId: "a-tool",
        toolCallId: "call-aborted",
        toolName: "bash",
        input: { command: "sleep 10" },
      },
      {
        type: "message-end",
        seq: 5,
        messageId: "a-tool",
        final: {
          id: "a-tool",
          role: "assistant",
          status: "done",
          parts: [],
        },
      },
      { type: "agent-end", seq: 6, turnId: "turn-aborted-tool", status: "aborted" },
    ]);

    await expect(
      page.locator('[data-boring-agent-tool-state="aborted"]'),
    ).toHaveCount(1, { timeout: 10_000 });
    await expect(
      page.getByRole("button", { name: /Tool calls: Stopped command/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Tool calls: Used command/i }),
    ).toHaveCount(0);

    const abortedState = await readChatDomState(page);
    const abortedAssistant = abortedState.messages.find((message) => message.role === "assistant");
    expect(abortedAssistant?.id).toBe("a-tool");
    expect(abortedAssistant?.status).toBe("aborted");
    expect(abortedAssistant?.toolStates).toEqual(["aborted"]);

    const liveRowMarker = "late-final-live-row-marker";
    const markedBeforeLateFinal = await markMessageRow(page, "a-tool", liveRowMarker);
    expect(markedBeforeLateFinal).toBe(true);

    await emitPiNativeFrames(page, [
      {
        type: "message-end",
        seq: 7,
        messageId: "a-final",
        final: {
          id: "a-final",
          role: "assistant",
          status: "done",
          parts: [
            {
              type: "tool-call",
              id: "call-aborted",
              toolName: "bash",
              input: { command: "sleep 10" },
              state: "output-available",
              output: { content: "late success" },
            },
            { type: "text", id: "late-final:text", text: "LATE_FINAL_AFTER_ABORT" },
          ],
        },
      },
    ]);

    await expect(
      page.locator('[data-boring-agent-message-role="assistant"]'),
    ).toHaveCount(1, { timeout: 10_000 });
    await expect(
      page.locator('[data-boring-agent-tool-state="aborted"]'),
    ).toHaveCount(1);
    await expect(conversation.getByText("LATE_FINAL_AFTER_ABORT")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Tool calls: Used command/i }),
    ).toHaveCount(0);

    const finalState = await readChatDomState(page);
    const finalAssistant = finalState.messages.find((message) => message.role === "assistant");
    assertChatDomInvariants(finalState);

    await testInfo.attach("pi-native-baseline-late-final-aborted-tool.json", {
      body: Buffer.from(
        JSON.stringify({
          checkpoint: "T4-late-final-aborted-tool",
          abortedState,
          finalState,
        }, null, 2),
        "utf8",
      ),
      contentType: "application/json",
    });

    expect(finalState.messages.map((message) => message.id)).toEqual([
      "u-abort",
      "a-final",
    ]);
    expect(finalState.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(finalAssistant?.status).toBe("aborted");
    expect(finalAssistant?.toolStates).toEqual(["aborted"]);
    expect(finalAssistant?.partOrder).toEqual([
      "message-tools",
      "message-text",
    ]);
    expect(await readMessageRowMarker(page, "a-final")).toBe(liveRowMarker);
    expect(countOccurrences(finalAssistant?.text ?? "", "LATE_FINAL_AFTER_ABORT")).toBe(1);
  });

  test("keeps the working indicator slot mounted through turn start and finish", async ({
    page,
    backend,
  }, testInfo) => {
    await installPiNativeMock(page);
    await page.addInitScript(() => {
      localStorage.setItem(
        "__boring_pi_native_e2e_state__",
        JSON.stringify({
          promptFinalText: "WORKING_SLOT_DONE",
          promptToolResultDelayMs: 1500,
        }),
      );
    });
    await navigateBrowserToBackend(page, `${backend.browserUrl}?piNative=1`);

    const chat = page.locator('[data-boring-agent-part="chat"]');
    const composer = page.locator('[data-boring-agent-part="composer-input"]');
    const submit = page.locator('[data-boring-agent-part="composer-submit"]');
    const conversation = page.getByLabel("Agent conversation");

    await expect(chat).toHaveAttribute("data-pi-chat-connection", "connected", {
      timeout: 10_000,
    });

    const idleBefore = await markWorkingSlot(page, "baseline-working-slot");
    expect(idleBefore.exists).toBe(true);
    expect(idleBefore.marker).toBe("baseline-working-slot");
    expect(idleBefore.ariaHidden).toBe("true");
    expect(idleBefore.visibleStatus).toBe(false);

    await composer.fill("working slot stability probe");
    await submit.click();

    await expect(page.getByTestId("chat-working")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole("progressbar", { name: "Agent working" })).toHaveCount(0);
    await expect.poll(async () => {
      const state = await readWorkingSlotState(page);
      return `${state.maxHeight}|${state.opacity}`;
    }).toBe("32px|1");

    const running = await readWorkingSlotState(page);
    expect(running.exists).toBe(true);
    expect(running.marker).toBe("baseline-working-slot");
    expect(running.ariaHidden).toBe("false");
    expect(running.visibleStatus).toBe(true);
    expect(running.maxHeight).toBe("32px");
    expect(running.opacity).toBe("1");
    expect(await submit.getAttribute("aria-label")).toBe("Stop");

    await expect(conversation.getByText("WORKING_SLOT_DONE")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("chat-working")).toHaveCount(0, {
      timeout: 10_000,
    });
    await expect.poll(async () => {
      const state = await readWorkingSlotState(page);
      return `${state.maxHeight}|${state.opacity}`;
    }).toBe("0px|0");

    const settled = await readWorkingSlotState(page);
    await testInfo.attach("pi-native-baseline-working-slot-stability.json", {
      body: Buffer.from(
        JSON.stringify({
          checkpoint: "T2-working-slot-stability",
          idleBefore,
          running,
          settled,
        }, null, 2),
        "utf8",
      ),
      contentType: "application/json",
    });

    expect(settled.exists).toBe(true);
    expect(settled.marker).toBe("baseline-working-slot");
    expect(settled.ariaHidden).toBe("true");
    expect(settled.visibleStatus).toBe(false);
    expect(settled.maxHeight).toBe("0px");
    expect(settled.opacity).toBe("0");
    expect(await submit.getAttribute("aria-label")).toBe("Submit");
  });

  test("restores the composer draft when prompt submit fails before acceptance", async ({
    page,
    backend,
  }, testInfo) => {
    await installPiNativeMock(page);
    await page.addInitScript(() => {
      localStorage.setItem(
        "__boring_pi_native_e2e_state__",
        JSON.stringify({
          promptFailure: {
            remaining: 1,
            status: 500,
            message: "SIMULATED_PROMPT_FAILURE",
          },
        }),
      );
    });
    await navigateBrowserToBackend(page, `${backend.browserUrl}?piNative=1`);

    const chat = page.locator('[data-boring-agent-part="chat"]');
    const composer = page.locator('[data-boring-agent-part="composer-input"]');
    const submit = page.locator('[data-boring-agent-part="composer-submit"]');
    const messages = page.locator('[data-boring-agent-part="message"]');
    const draft = "keep this failed submit draft";

    await expect(chat).toHaveAttribute("data-pi-chat-connection", "connected", {
      timeout: 10_000,
    });

    await composer.fill(draft);
    await submit.click();

    await expect(composer).toHaveValue(draft, { timeout: 10_000 });
    await expect(submit).toHaveAttribute("aria-label", "Submit");
    await expect(messages).toHaveCount(0);

    const state = await readMockPromptState(page);
    expect(state.prompts).toHaveLength(0);
    expect(state.promptFailuresServed).toBe(1);

    await testInfo.attach("pi-native-baseline-failed-submit-draft.json", {
      body: Buffer.from(
        JSON.stringify({
          checkpoint: "T2-failed-submit-draft",
          promptFailuresServed: state.promptFailuresServed,
          promptCount: state.prompts.length,
          messageCount: state.messages.length,
        }, null, 2),
        "utf8",
      ),
      contentType: "application/json",
    });
  });
});

async function readFailedToolLayout(page: Page): Promise<{
  triggerBottom: number
  detailsWidth: number
  cardWidth: number
  cardRight: number
  cardTop: number
  headerRight: number
  badgeRight: number
  chevronRight: number
  titleClientWidth: number
  titleScrollWidth: number
  dotLeft: number
  triggerTextLeft: number
}> {
  return page.evaluate(() => {
    const trigger = document.querySelector<HTMLElement>('[data-boring-agent-tool-state="failed"] > button')
    const triggerDot = trigger?.querySelector<HTMLElement>('[data-boring-agent-part="tool-group-state-dot"]')
    const triggerText = trigger?.querySelector<HTMLElement>('[data-boring-agent-part="tool-group-title"]')
    const details = document.querySelector<HTMLElement>('[data-boring-agent-part="tool-group-details"]')
    const card = document.querySelector<HTMLElement>('[data-boring-agent-part="tool-card"]')
    const header = card?.querySelector<HTMLElement>('[data-boring-agent-part="tool-header"]')
    const badge = header?.querySelector<HTMLElement>('[data-slot="badge"]')
    const chevron = header?.querySelector<SVGElement>('[data-boring-agent-part="tool-chevron"]')
    const title = header?.querySelector<HTMLElement>('[data-boring-agent-part="tool-title"]')
    if (!trigger || !triggerDot || !triggerText || !details || !card || !header || !badge || !chevron || !title) throw new Error('Failed tool layout nodes are missing')
    const triggerRect = trigger.getBoundingClientRect()
    const triggerDotRect = triggerDot.getBoundingClientRect()
    const triggerTextRect = triggerText.getBoundingClientRect()
    const detailsRect = details.getBoundingClientRect()
    const cardRect = card.getBoundingClientRect()
    const headerRect = header.getBoundingClientRect()
    const badgeRect = badge.getBoundingClientRect()
    const chevronRect = chevron.getBoundingClientRect()
    return {
      triggerBottom: triggerRect.bottom,
      detailsWidth: detailsRect.width,
      cardWidth: cardRect.width,
      cardRight: cardRect.right,
      cardTop: cardRect.top,
      headerRight: headerRect.right,
      badgeRight: badgeRect.right,
      chevronRight: chevronRect.right,
      titleClientWidth: title.clientWidth,
      titleScrollWidth: title.scrollWidth,
      dotLeft: triggerDotRect.left,
      triggerTextLeft: triggerTextRect.left,
    }
  })
}
