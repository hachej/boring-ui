import type { SessionDetail } from "../../../shared/session.js";
import { getEnv } from "../../config/env.js";
import { createLogger, type Logger } from "../../logging.js";

const DEFAULT_SESSION_TITLE = "New session";
const FALLBACK_PREFIX = "New chat";
const DEFAULT_TITLE_MODEL = "claude-3-5-haiku-latest";
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_POLL_MS = 250;
const MAX_PROMPT_CHARS = 1200;
const MAX_TITLE_CHARS = 80;

export interface SessionTitleScheduleInput {
  sessionId: string;
  firstUserMessage: string;
  firstAssistantReply: string;
}

export interface SessionTitleSchedulerOptions {
  loadSession: (sessionId: string) => Promise<SessionDetail>;
  writeTitle: (sessionId: string, title: string) => void;
  fetchImpl?: typeof fetch;
  getApiKey?: () => string | undefined;
  model?: string;
  timeoutMs?: number;
  pollMs?: number;
  now?: () => Date;
  onWarn?: (message: string, error?: unknown) => void;
  logger?: Pick<Logger, "warn">;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncateForPrompt(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_PROMPT_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_PROMPT_CHARS)}…`;
}

export function formatFallbackTitle(now: Date = new Date()): string {
  const timestamp = now.toISOString().slice(0, 16).replace("T", " ");
  return `${FALLBACK_PREFIX} ${timestamp}`;
}

export function normalizeSessionTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const squashed = value.replace(/\s+/g, " ").trim();
  if (!squashed) return null;
  const unquoted = squashed.replace(/^["'`]+|["'`]+$/g, "").trim();
  if (!unquoted) return null;
  if (unquoted.length <= MAX_TITLE_CHARS) return unquoted;
  return unquoted.slice(0, MAX_TITLE_CHARS).trim();
}

function extractAnthropicText(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const content = (body as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const typedBlock = block as { type?: unknown; text?: unknown };
    if (typedBlock.type === "text" && typeof typedBlock.text === "string") {
      return typedBlock.text;
    }
  }
  return null;
}

function hasCustomTitle(title: string): boolean {
  const trimmed = title.trim();
  if (!trimmed) return false;
  if (trimmed === DEFAULT_SESSION_TITLE) return false;
  return !trimmed.startsWith(`${FALLBACK_PREFIX} `);
}

async function waitForSession(
  loadSession: (sessionId: string) => Promise<SessionDetail>,
  sessionId: string,
  timeoutMs: number,
  pollMs: number,
): Promise<SessionDetail | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    try {
      const detail = await loadSession(sessionId);
      if (detail.turnCount >= 1) return detail;
    } catch {
      // keep polling until timeout
    }
    if (Date.now() >= deadline) break;
    await sleep(pollMs);
  }
  return null;
}

async function generateTitleWithAnthropic(opts: {
  fetchImpl: typeof fetch;
  apiKey: string;
  model: string;
  firstUserMessage: string;
  firstAssistantReply: string;
}): Promise<string | null> {
  const prompt =
    "Summarize this conversation in 5 words or less for a session title: "
    + `${truncateForPrompt(opts.firstUserMessage)} / `
    + `${truncateForPrompt(opts.firstAssistantReply)}`;

  const response = await opts.fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": opts.apiKey,
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: 24,
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic title request failed (${response.status})`);
  }

  const body = await response.json();
  return extractAnthropicText(body);
}

export function createSessionTitleScheduler(
  opts: SessionTitleSchedulerOptions,
): (input: SessionTitleScheduleInput) => void {
  const logger = opts.logger ?? createLogger("session-title");
  const scheduled = new Set<string>();
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  const getNow = opts.now ?? (() => new Date());
  const model = opts.model ?? getEnv("BORING_AGENT_TITLE_MODEL")?.trim() ?? DEFAULT_TITLE_MODEL;
  const warn =
    opts.onWarn ??
    ((message: string, error?: unknown) => {
      logger.warn(message, {
        error: error instanceof Error ? error.message : String(error ?? ""),
      });
    });

  return (input: SessionTitleScheduleInput): void => {
    const firstUserMessage = input.firstUserMessage.trim();
    const firstAssistantReply = input.firstAssistantReply.trim();
    if (!firstUserMessage || !firstAssistantReply) return;
    if (scheduled.has(input.sessionId)) return;

    scheduled.add(input.sessionId);

    void (async () => {
      const detail = await waitForSession(
        opts.loadSession,
        input.sessionId,
        timeoutMs,
        pollMs,
      );
      if (!detail || detail.turnCount !== 1) return;
      if (hasCustomTitle(detail.title)) return;

      const fallbackTitle = formatFallbackTitle(getNow());
      const apiKey =
        opts.getApiKey?.()?.trim() ?? getEnv("ANTHROPIC_API_KEY")?.trim() ?? "";
      if (!apiKey || !fetchImpl) {
        opts.writeTitle(input.sessionId, fallbackTitle);
        return;
      }

      try {
        const llmTitle = await generateTitleWithAnthropic({
          fetchImpl,
          apiKey,
          model,
          firstUserMessage,
          firstAssistantReply,
        });
        opts.writeTitle(
          input.sessionId,
          normalizeSessionTitle(llmTitle) ?? fallbackTitle,
        );
      } catch (error) {
        warn("[session-title] failed to generate title, using fallback", error);
        opts.writeTitle(input.sessionId, fallbackTitle);
      }
    })().catch((error) => {
      warn("[session-title] unexpected background title failure", error);
    });
  };
}
