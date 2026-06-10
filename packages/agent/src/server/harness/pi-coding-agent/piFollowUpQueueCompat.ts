import type { PiAgentSessionLike } from "../../pi-chat/PiAgentSessionAdapter.js";

export interface PiFollowUpQueueOptions {
  displayText?: string;
  clientNonce?: string;
  clientSeq?: number;
}

export interface PiFollowUpSelector {
  clientNonce?: string;
  clientSeq?: number;
}

interface NativeFollowUpRequest {
  text: string;
  displayText: string;
  clientNonce?: string;
  clientSeq?: number;
}

interface NativeFollowUpRemoval {
  request: NativeFollowUpRequest;
  textOrdinal: number;
}

type PiQueueCompatibleSession = {
  _followUpMessages?: string[];
  _emitQueueUpdate?: () => void;
  agent?: {
    clearFollowUpQueue?: () => void;
    followUpQueue?: { messages?: unknown[] };
  };
};

/**
 * Per-session follow-up queue bookkeeping layered over pi's native queue.
 * Owned by the session adapter (one instance per pi session): nonce-dedupes
 * repeated posts and supports selective removal, which pi does not expose.
 */
export interface PiFollowUpQueueCompat {
  /**
   * Records a follow-up post. Returns false when the post is a duplicate of
   * one already seen this session (same client nonce) and must not re-queue.
   */
  record(text: string, options?: PiFollowUpQueueOptions): boolean;
  clear(piSession: PiAgentSessionLike, options?: PiFollowUpSelector): void;
}

export function createPiFollowUpQueueCompat(): PiFollowUpQueueCompat {
  let queue: NativeFollowUpRequest[] = [];
  // Client nonces seen this session. Survives consumption so a retried post of
  // an already-drained follow-up is dropped.
  const seenNonces = new Set<string>();

  function record(text: string, options?: PiFollowUpQueueOptions): boolean {
    const nonce = options?.clientNonce;
    if (nonce && seenNonces.has(nonce)) return false;

    queue.push({
      text,
      displayText: options?.displayText ?? text,
      clientNonce: options?.clientNonce,
      clientSeq: options?.clientSeq,
    });
    if (nonce) seenNonces.add(nonce);
    return true;
  }

  function clear(piSession: PiAgentSessionLike, options?: PiFollowUpSelector): void {
    syncWithPi(piSession);
    const removed = removeNativeFollowUp(options);
    if (!options?.clientNonce && options?.clientSeq === undefined) {
      removePiQueuedFollowUp(piSession);
      return;
    }
    for (const item of removed) removePiQueuedFollowUp(piSession, item.request.text, item.textOrdinal);
  }

  function syncWithPi(piSession: PiAgentSessionLike): void {
    if (!queue.length) return;
    const piTexts = readPiQueuedFollowUpTexts(piSession);
    if (piTexts.length === 0) {
      queue = [];
      return;
    }
    if (piTexts.length >= queue.length) return;

    const remaining: NativeFollowUpRequest[] = [];
    let searchEnd = queue.length;
    for (let index = piTexts.length - 1; index >= 0; index -= 1) {
      const text = piTexts[index];
      let matchIndex = -1;
      for (let queueIndex = searchEnd - 1; queueIndex >= 0; queueIndex -= 1) {
        const item = queue[queueIndex];
        if (item.text === text || item.displayText === text) {
          matchIndex = queueIndex;
          break;
        }
      }
      if (matchIndex < 0) break;
      remaining.unshift(queue[matchIndex]);
      searchEnd = matchIndex;
    }

    if (remaining.length !== piTexts.length) return;
    queue = remaining;
  }

  function removeNativeFollowUp(options?: PiFollowUpSelector): NativeFollowUpRemoval[] {
    if (!queue.length) {
      if (!hasFollowUpSelector(options)) seenNonces.clear();
      return [];
    }

    const removed: NativeFollowUpRemoval[] = [];
    const next: NativeFollowUpRequest[] = [];
    const textCounts = new Map<string, number>();
    for (const request of queue) {
      const textOrdinal = textCounts.get(request.text) ?? 0;
      textCounts.set(request.text, textOrdinal + 1);
      if (matchesFollowUpSelector(request, options)) removed.push({ request, textOrdinal });
      else next.push(request);
    }

    queue = next;
    // Draining the queue via an explicit clear resets nonce memory so a later
    // resubmission of the same client message is accepted again. (Consumption
    // by pi deliberately does NOT reset it — retried posts of a drained
    // follow-up stay deduped; see syncWithPi.)
    if (queue.length === 0) seenNonces.clear();
    return removed;
  }

  return { record, clear };
}

function removePiQueuedFollowUp(piSession: PiAgentSessionLike, text?: string, textOrdinal = 0): void {
  const queue = piQueueAccess(piSession);
  if (!text) {
    queue.clearAll();
    return;
  }
  if (queue.queuedMessages) {
    removeFirstMatchingOrdinal(queue.queuedMessages, (message) => userMessageText(message) === text, textOrdinal);
  }
  if (queue.followUpMessages) {
    removeFirstMatchingOrdinal(queue.followUpMessages, (message) => message === text, textOrdinal);
  }
  queue.emitUpdate();
}

function readPiQueuedFollowUpTexts(piSession: PiAgentSessionLike): string[] {
  const queue = piQueueAccess(piSession);
  if (queue.queuedMessages) {
    return queue.queuedMessages.map(userMessageText).filter((text) => text.length > 0);
  }
  if (queue.followUpMessages) return [...queue.followUpMessages];
  return [];
}

function piQueueAccess(piSession: PiAgentSessionLike) {
  // Pi does not currently expose selective follow-up removal. Keep the
  // private-field compatibility shim isolated here so queue ownership does
  // not leak through the rest of the adapter.
  const session = piSession as unknown as PiQueueCompatibleSession;
  const followUpMessages = Array.isArray(session._followUpMessages)
    ? session._followUpMessages
    : undefined;
  const queuedMessages = Array.isArray(session.agent?.followUpQueue?.messages)
    ? session.agent.followUpQueue.messages
    : undefined;
  return {
    followUpMessages,
    queuedMessages,
    clearAll() {
      session.agent?.clearFollowUpQueue?.();
      if (followUpMessages) followUpMessages.length = 0;
      session._emitQueueUpdate?.();
    },
    emitUpdate() {
      session._emitQueueUpdate?.();
    },
  };
}

function userMessageText(message: unknown): string {
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => ((part as { type?: unknown; text?: unknown }).type === "text" && typeof (part as { text?: unknown }).text === "string") ? (part as { text: string }).text : "")
    .join("");
}

function removeFirstMatchingOrdinal<T>(items: T[], matches: (item: T) => boolean, ordinal: number): void {
  let seen = 0;
  const index = items.findIndex((item) => {
    if (!matches(item)) return false;
    if (seen++ !== ordinal) return false;
    return true;
  });
  if (index >= 0) items.splice(index, 1);
}

function hasFollowUpSelector(options?: PiFollowUpSelector): boolean {
  return Boolean(options?.clientNonce) || options?.clientSeq !== undefined;
}

function matchesFollowUpSelector(item: NativeFollowUpRequest, options?: PiFollowUpSelector): boolean {
  if (!hasFollowUpSelector(options)) return true;
  if (options?.clientNonce) return item.clientNonce === options.clientNonce;
  return options?.clientSeq !== undefined && item.clientSeq === options.clientSeq;
}
