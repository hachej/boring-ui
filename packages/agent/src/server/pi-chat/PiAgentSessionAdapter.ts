import type {
  AgentSessionEvent,
  AgentSessionEventListener,
  PromptOptions,
} from "@mariozechner/pi-coding-agent";
import {
  createPiFollowUpQueueCompat,
  type PiFollowUpQueueOptions,
  type PiFollowUpSelector,
} from "../harness/pi-coding-agent/piFollowUpQueueCompat.js";

export interface PiAgentSessionSnapshot {
  state: unknown;
  messages: readonly unknown[];
  isStreaming: boolean;
  isRetrying: boolean;
  retryAttempt: number;
  pendingMessageCount: number;
  steeringMessages: readonly string[];
  followUpMessages: readonly string[];
  followUpMode: "all" | "one-at-a-time";
  sessionId: string;
  sessionName?: string;
}

export type PiAgentPromptInput =
  | string
  | {
      text: string;
      options?: PromptOptions;
    };

export interface PiAgentSessionAdapter {
  readSnapshot(): PiAgentSessionSnapshot;
  currentModel?: () => { provider: string; id: string } | undefined;
  subscribe(listener: (event: AgentSessionEvent) => void): () => void;
  prompt(input: PiAgentPromptInput): Promise<void>;
  /** Queue a follow-up for after the current turn. Nonce-deduped per session. */
  followUp(text: string, options?: PiFollowUpQueueOptions): Promise<void>;
  /** Remove queued follow-up(s): all of them, or just the selected one. */
  clearFollowUp(options?: PiFollowUpSelector): void;
  abort(): Promise<void>;
  abortRetry?: () => void;
  continueQueuedFollowUp?: () => Promise<void>;
}

/**
 * Narrow Pi-only surface used by the private adapter.
 *
 * Keep this as a focused anti-corruption layer over Pi AgentSession API drift.
 * Do not generalize it into a runtime-agnostic harness abstraction.
 */
export interface PiAgentSessionLike {
  readonly state: unknown;
  readonly messages: readonly unknown[];
  readonly isStreaming: boolean;
  readonly isRetrying: boolean;
  readonly retryAttempt: number;
  readonly pendingMessageCount: number;
  readonly followUpMode: "all" | "one-at-a-time";
  readonly sessionId: string;
  readonly sessionName?: string;
  readonly model?: { provider?: string; id?: string };
  getSteeringMessages(): readonly string[];
  getFollowUpMessages(): readonly string[];
  subscribe(listener: AgentSessionEventListener): () => void;
  prompt(text: string, options?: PromptOptions): Promise<void>;
  followUp(text: string): Promise<void>;
  abort(): Promise<void>;
  abortRetry?: () => void;
}

export interface PiAgentSessionAdapterOptions {
  sessionId?: string;
  continueQueuedFollowUp?: () => Promise<void>;
}

function normalizePromptInput(input: PiAgentPromptInput): { text: string; options?: PromptOptions } {
  if (typeof input === "string") return { text: input };
  return input;
}

export function createPiAgentSessionAdapter(session: PiAgentSessionLike, options: PiAgentSessionAdapterOptions = {}): PiAgentSessionAdapter {
  const followUpQueue = createPiFollowUpQueueCompat();
  const adapter: PiAgentSessionAdapter = {
    readSnapshot() {
      return {
        state: session.state,
        messages: session.messages,
        isStreaming: session.isStreaming,
        isRetrying: session.isRetrying,
        retryAttempt: session.retryAttempt,
        pendingMessageCount: session.pendingMessageCount,
        steeringMessages: session.getSteeringMessages(),
        followUpMessages: session.getFollowUpMessages(),
        followUpMode: session.followUpMode,
        sessionId: options.sessionId ?? session.sessionId,
        sessionName: session.sessionName,
      };
    },

    currentModel() {
      const model = session.model
      return typeof model?.provider === 'string' && typeof model?.id === 'string'
        ? { provider: model.provider, id: model.id }
        : undefined
    },

    subscribe(listener) {
      return session.subscribe(listener);
    },

    async prompt(input) {
      const { text, options } = normalizePromptInput(input);
      await session.prompt(text, options);
    },

    async followUp(text, followUpOptions) {
      const accepted = followUpQueue.record(text, followUpOptions);
      if (!accepted) return;
      await session.followUp(text);
    },

    clearFollowUp(selector) {
      followUpQueue.clear(session, selector);
    },

    async abort() {
      await session.abort();
    },
  };

  if (typeof session.abortRetry === "function") {
    adapter.abortRetry = () => session.abortRetry?.();
  }
  if (options.continueQueuedFollowUp) {
    adapter.continueQueuedFollowUp = options.continueQueuedFollowUp;
  }

  return adapter;
}
