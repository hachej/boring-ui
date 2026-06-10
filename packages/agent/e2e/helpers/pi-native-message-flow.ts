import type { Page } from "@playwright/test";

export interface MessageSummary {
  id: string | null;
  role: string | null;
  status: string | null;
  text: string;
  reasoningCount: number;
  toolGroupCount: number;
  textPartCount: number;
  partOrder: string[];
}

export interface WorkingSlotState {
  exists: boolean;
  marker: string | null;
  ariaHidden: string | null;
  visibleStatus: boolean;
  maxHeight: string | null;
  opacity: string | null;
}

export async function readMessageSummary(page: Page): Promise<MessageSummary[]> {
  return page
    .locator('[data-boring-agent-part="message"]')
    .evaluateAll((nodes: Element[]) =>
      nodes.map((node) => ({
        id: node.getAttribute("data-boring-agent-message-id"),
        role: node.getAttribute("data-boring-agent-message-role"),
        status: node.getAttribute("data-boring-agent-message-status"),
        text: node.textContent?.replace(/\s+/g, " ").trim() ?? "",
        reasoningCount: node.querySelectorAll(
          '[data-boring-agent-part="message-reasoning"]',
        ).length,
        toolGroupCount: node.querySelectorAll(
          '[data-boring-agent-part="message-tools"]',
        ).length,
        textPartCount: node.querySelectorAll(
          '[data-boring-agent-part="message-text"]',
        ).length,
        partOrder: Array.from(
          node.querySelectorAll(
            [
              '[data-boring-agent-part="message-reasoning"]',
              '[data-boring-agent-part="message-tools"]',
              '[data-boring-agent-part="message-text"]',
              '[data-boring-agent-part="message-notice"]',
            ].join(","),
          ),
        ).map((part) => part.getAttribute("data-boring-agent-part") ?? ""),
      })),
    );
}

export async function readLegacyHydrationFlash(page: Page): Promise<{ seen: boolean; matches: string[] }> {
  return page.evaluate(() => {
    const state = (window as unknown as { __piNativeLegacyFlash?: { seen?: boolean; matches?: string[] } }).__piNativeLegacyFlash;
    return {
      seen: Boolean(state?.seen),
      matches: Array.isArray(state?.matches) ? state.matches : [],
    };
  });
}

export async function emitPiNativeFrames(page: Page, frames: unknown[]): Promise<void> {
  await page.evaluate((nextFrames) => {
    const emit = (window as unknown as {
      __piNativeE2EEmit: (sessionId: string, frame: unknown) => void;
    }).__piNativeE2EEmit;
    for (const frame of nextFrames) emit("pi-e2e", frame);
  }, frames);
}

export async function markMessageRow(page: Page, messageId: string, marker: string): Promise<boolean> {
  return page.evaluate(({ messageId: targetMessageId, marker: nextMarker }) => {
    const row = document.querySelector<HTMLElement>(
      `[data-boring-agent-part="message"][data-boring-agent-message-id="${targetMessageId}"]`,
    );
    if (!row) return false;
    row.dataset.e2eStableRow = nextMarker;
    return true;
  }, { messageId, marker });
}

export async function readMessageRowMarker(page: Page, messageId: string): Promise<string | null> {
  return page.evaluate((targetMessageId) => {
    const row = document.querySelector<HTMLElement>(
      `[data-boring-agent-part="message"][data-boring-agent-message-id="${targetMessageId}"]`,
    );
    return row?.dataset.e2eStableRow ?? null;
  }, messageId);
}

export async function markWorkingSlot(page: Page, marker: string): Promise<WorkingSlotState> {
  return page.evaluate((nextMarker) => {
    const slot = document.querySelector<HTMLElement>('[data-boring-agent-part="chat-working-slot"]');
    slot?.setAttribute("data-e2e-working-slot-id", nextMarker);
    if (!slot) {
      return {
        exists: false,
        marker: null,
        ariaHidden: null,
        visibleStatus: false,
        maxHeight: null,
        opacity: null,
      };
    }
    const style = getComputedStyle(slot);
    return {
      exists: true,
      marker: slot.getAttribute("data-e2e-working-slot-id"),
      ariaHidden: slot.getAttribute("aria-hidden"),
      visibleStatus: Boolean(document.querySelector('[data-testid="chat-working"]')),
      maxHeight: style.maxHeight,
      opacity: style.opacity,
    };
  }, marker);
}

export async function readWorkingSlotState(page: Page): Promise<WorkingSlotState> {
  return page.evaluate(() => {
    const slot = document.querySelector<HTMLElement>('[data-boring-agent-part="chat-working-slot"]');
    if (!slot) {
      return {
        exists: false,
        marker: null,
        ariaHidden: null,
        visibleStatus: false,
        maxHeight: null,
        opacity: null,
      };
    }
    const style = getComputedStyle(slot);
    return {
      exists: true,
      marker: slot.getAttribute("data-e2e-working-slot-id"),
      ariaHidden: slot.getAttribute("aria-hidden"),
      visibleStatus: Boolean(document.querySelector('[data-testid="chat-working"]')),
      maxHeight: style.maxHeight,
      opacity: style.opacity,
    };
  });
}

export function countOccurrences(text: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = text.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(needle, index + needle.length);
  }
  return count;
}

export async function readMockPromptState(page: Page): Promise<{
  prompts: Array<Record<string, unknown>>;
  promptFailuresServed?: number;
  messages: unknown[];
}> {
  return page.evaluate(() => {
    const state = (window as unknown as {
      __piNativeE2EState: () => {
        prompts: Array<Record<string, unknown>>;
        promptFailuresServed?: number;
        messages: unknown[];
      };
    }).__piNativeE2EState();
    return {
      prompts: state.prompts,
      promptFailuresServed: state.promptFailuresServed,
      messages: state.messages,
    };
  });
}
