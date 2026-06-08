import type { AgentSession } from "@mariozechner/pi-coding-agent";
import type { FollowUpOptions } from "../../../shared/harness.js";

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

export interface PiFollowUpQueueCompat {
  clearSession(sessionId: string): void;
  /**
   * Records a follow-up post. Returns false when the post is a duplicate of one
   * already seen this turn (same client nonce) and must not be re-queued.
   */
  record(sessionId: string, text: string, displayText: string, options?: FollowUpOptions): boolean;
  clear(sessionId: string, piSession?: AgentSession, options?: FollowUpOptions): void;
  consume(sessionId: string, text: string): void;
  hasPending(sessionId: string): boolean;
}

export function createPiFollowUpQueueCompat(): PiFollowUpQueueCompat {
  const pending = new Set<string>();
  const queues = new Map<string, NativeFollowUpRequest[]>();
  // Client nonces seen this turn. Survives consumption (so a retried post of an
  // already-drained follow-up is dropped) and is reset only at turn/session
  // boundaries via clearSession.
  const seenNonces = new Map<string, Set<string>>();

  function clearSession(sessionId: string): void {
    pending.delete(sessionId);
    queues.delete(sessionId);
    seenNonces.delete(sessionId);
  }

  function record(sessionId: string, text: string, displayText: string, options?: FollowUpOptions): boolean {
    const nonce = options?.clientNonce;
    if (nonce && seenNonces.get(sessionId)?.has(nonce)) return false;

    const queue = queues.get(sessionId) ?? [];
    queue.push({
      text,
      displayText,
      clientNonce: options?.clientNonce,
      clientSeq: options?.clientSeq,
    });
    queues.set(sessionId, queue);
    pending.add(sessionId);

    if (nonce) {
      const seen = seenNonces.get(sessionId) ?? new Set<string>();
      seen.add(nonce);
      seenNonces.set(sessionId, seen);
    }
    return true;
  }

  function clear(sessionId: string, piSession?: AgentSession, options?: FollowUpOptions): void {
    if (piSession) syncWithPi(sessionId, piSession);
    const removed = removeNativeFollowUp(sessionId, options);
    if (!piSession) return;
    if (!options?.clientNonce && options?.clientSeq === undefined) {
      removePiQueuedFollowUp(piSession);
      return;
    }
    for (const item of removed) removePiQueuedFollowUp(piSession, item.request.text, item.textOrdinal);
  }

  function consume(sessionId: string, text: string): void {
    const queue = queues.get(sessionId);
    if (!queue?.length) {
      pending.delete(sessionId);
      return;
    }
    const index = queue.findIndex((item) => item.text === text || item.displayText === text);
    if (index >= 0) queue.splice(index, 1);
    else queue.shift();
    if (queue.length > 0) {
      queues.set(sessionId, queue);
    } else {
      // Drain the queue but keep seen nonces: a duplicate post of a follow-up pi
      // already consumed this turn must still be deduped (clearSession resets it).
      queues.delete(sessionId);
      pending.delete(sessionId);
    }
  }

  function hasPending(sessionId: string): boolean {
    return pending.has(sessionId);
  }

  function syncWithPi(sessionId: string, piSession: AgentSession): void {
    const queue = queues.get(sessionId);
    if (!queue?.length) return;
    const piTexts = readPiQueuedFollowUpTexts(piSession);
    if (piTexts.length === 0) {
      clearSession(sessionId);
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
    queues.set(sessionId, remaining);
  }

  function removeNativeFollowUp(sessionId: string, options?: FollowUpOptions): NativeFollowUpRemoval[] {
    const queue = queues.get(sessionId);
    if (!queue?.length) {
      if (!hasFollowUpSelector(options)) clearSession(sessionId);
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

    if (next.length > 0) queues.set(sessionId, next);
    else clearSession(sessionId);
    return removed;
  }

  return { clearSession, record, clear, consume, hasPending };
}

function removePiQueuedFollowUp(piSession: AgentSession, text?: string, textOrdinal = 0): void {
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

function readPiQueuedFollowUpTexts(piSession: AgentSession): string[] {
  const queue = piQueueAccess(piSession);
  if (queue.queuedMessages) {
    return queue.queuedMessages.map(userMessageText).filter((text) => text.length > 0);
  }
  if (queue.followUpMessages) return [...queue.followUpMessages];
  return [];
}

function piQueueAccess(piSession: AgentSession) {
  // Pi does not currently expose selective follow-up removal. Keep the
  // private-field compatibility shim isolated here so queue ownership does
  // not leak through the rest of the harness.
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

function hasFollowUpSelector(options?: FollowUpOptions): boolean {
  return Boolean(options?.clientNonce) || options?.clientSeq !== undefined;
}

function matchesFollowUpSelector(item: NativeFollowUpRequest, options?: FollowUpOptions): boolean {
  if (!hasFollowUpSelector(options)) return true;
  if (options?.clientNonce) return item.clientNonce === options.clientNonce;
  return options?.clientSeq !== undefined && item.clientSeq === options.clientSeq;
}
