import type {
  AgentSessionEvent,
  AgentSessionEventListener,
  PromptOptions,
} from "@mariozechner/pi-coding-agent";

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
  subscribe(listener: (event: AgentSessionEvent) => void): () => void;
  prompt(input: PiAgentPromptInput): Promise<void>;
  followUp(text: string): Promise<void>;
  clearQueue(): { steering: string[]; followUp: string[] };
  abort(): Promise<void>;
  abortRetry?: () => void;
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
  getSteeringMessages(): readonly string[];
  getFollowUpMessages(): readonly string[];
  subscribe(listener: AgentSessionEventListener): () => void;
  prompt(text: string, options?: PromptOptions): Promise<void>;
  followUp(text: string): Promise<void>;
  clearQueue(): { steering: string[]; followUp: string[] };
  abort(): Promise<void>;
  abortRetry?: () => void;
}

function normalizePromptInput(input: PiAgentPromptInput): { text: string; options?: PromptOptions } {
  if (typeof input === "string") return { text: input };
  return input;
}

export function createPiAgentSessionAdapter(session: PiAgentSessionLike): PiAgentSessionAdapter {
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
        sessionId: session.sessionId,
        sessionName: session.sessionName,
      };
    },

    subscribe(listener) {
      return session.subscribe(listener);
    },

    async prompt(input) {
      const { text, options } = normalizePromptInput(input);
      await session.prompt(text, options);
    },

    async followUp(text) {
      await session.followUp(text);
    },

    clearQueue() {
      return session.clearQueue();
    },

    async abort() {
      await session.abort();
    },
  };

  if (typeof session.abortRetry === "function") {
    adapter.abortRetry = () => session.abortRetry?.();
  }

  return adapter;
}
