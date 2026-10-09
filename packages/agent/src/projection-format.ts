import type { ConversationId, EntryId, TaskId } from '@earendil-works/pi-durable';
import { NATIVE_VERSION, isNativeVersion } from './native-version.js';
import type { NativeVersion } from './native-version.js';

export const CONVERSATION_PROJECTION_LIMITS = Object.freeze({
  maxMessages: 200, maxMessageBytes: 32768, maxWindowBytes: 196608, maxFrameBytes: 262144,
});

export interface ProjectionIdentity {
  readonly runtimeId: string;
  readonly scopeId: string;
  readonly principalId: string;
  readonly conversationId: ConversationId;
}

export interface ConversationTextKey {
  readonly entryId: EntryId;
  readonly conversationId: ConversationId;
  readonly messageIndex: number;
}

export interface ConversationTextRow extends ConversationTextKey {
  readonly byTaskId?: TaskId;
  readonly role: 'user' | 'assistant';
  readonly content: readonly { readonly blockIndex: number; readonly text: string }[];
  readonly clipped: boolean;
}

interface ProjectionFrame {
  readonly schema: 'boring.conversation-text';
  readonly version: 2;
  readonly nativeVersion: NativeVersion;
  readonly source: ProjectionIdentity;
  /** Ordering within this connection only, never a durable native cursor. */
  readonly connection: { readonly id: string; readonly frame: number; readonly observedAt: string };
  /** Whether older permitted rows were omitted from this window. */
  readonly window: { readonly truncated: boolean };
}

export interface ConversationTextSnapshot extends ProjectionFrame {
  readonly kind: 'snapshot';
  readonly messages: readonly ConversationTextRow[];
}

export interface ConversationTextDelta extends ProjectionFrame {
  readonly kind: 'delta';
  readonly baseFrame: number;
  readonly upsert: readonly ConversationTextRow[];
  /** Complete window order; omitted keys are removed. */
  readonly order: readonly ConversationTextKey[];
}

export type ConversationTextProjection = ConversationTextSnapshot | ConversationTextDelta;

export const projectionEncoder = new TextEncoder();
export function projectionBytes(value: unknown): number {
  return projectionEncoder.encode(JSON.stringify(value)).byteLength;
}
export function projectionKey(key: ConversationTextKey): string {
  return `${key.conversationId}/${key.entryId}/${key.messageIndex}`;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function fields(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  return required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}
function index(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function id(value: unknown): value is number { return index(value) && value > 0; }
export function projectionIdentity(value: unknown): value is ProjectionIdentity {
  return record(value) && fields(value, ['runtimeId', 'scopeId', 'principalId', 'conversationId']) && id(value.conversationId)
    && [value.runtimeId, value.scopeId, value.principalId].every(item => typeof item === 'string' && item.length > 0 && item.length <= 1024);
}
function sameSource(a: ProjectionIdentity, b: ProjectionIdentity): boolean {
  return a.runtimeId === b.runtimeId && a.scopeId === b.scopeId && a.principalId === b.principalId && a.conversationId === b.conversationId;
}
function rowKey(value: unknown): value is ConversationTextKey {
  return record(value) && id(value.entryId) && id(value.conversationId) && index(value.messageIndex);
}
function row(value: unknown): value is ConversationTextRow {
  if (!rowKey(value) || !record(value) || !fields(value, ['entryId', 'conversationId', 'messageIndex', 'role', 'content', 'clipped'], ['byTaskId'])
    || ('byTaskId' in value && !id(value.byTaskId)) || (value.role !== 'user' && value.role !== 'assistant') || typeof value.clipped !== 'boolean'
    || !Array.isArray(value.content) || value.content.length === 0 || projectionBytes(value) > CONVERSATION_PROJECTION_LIMITS.maxMessageBytes) return false;
  let previous = -1;
  for (const block of value.content) {
    if (!record(block) || !fields(block, ['blockIndex', 'text']) || !index(block.blockIndex) || block.blockIndex <= previous || typeof block.text !== 'string') return false;
    previous = block.blockIndex;
  }
  return true;
}
function rows(value: unknown): value is readonly ConversationTextRow[] {
  return Array.isArray(value) && value.length <= CONVERSATION_PROJECTION_LIMITS.maxMessages && value.every(row)
    && new Set(value.map(projectionKey)).size === value.length && projectionBytes(value) <= CONVERSATION_PROJECTION_LIMITS.maxWindowBytes;
}
function frame(value: unknown): value is ConversationTextProjection {
  if (!record(value) || value.schema !== 'boring.conversation-text' || value.version !== 2 || !isNativeVersion(value.nativeVersion)
    || !projectionIdentity(value.source) || !record(value.connection) || !fields(value.connection, ['id', 'frame', 'observedAt'])
    || typeof value.connection.id !== 'string' || !value.connection.id.length || value.connection.id.length > 128 || !index(value.connection.frame)
    || typeof value.connection.observedAt !== 'string' || !Number.isFinite(Date.parse(value.connection.observedAt))
    || !record(value.window) || !fields(value.window, ['truncated']) || typeof value.window.truncated !== 'boolean') return false;
  const common = ['schema', 'version', 'nativeVersion', 'source', 'connection', 'window', 'kind'];
  if (value.kind === 'snapshot') return fields(value, [...common, 'messages']) && rows(value.messages);
  return value.kind === 'delta' && fields(value, [...common, 'baseFrame', 'upsert', 'order']) && index(value.baseFrame) && rows(value.upsert)
    && Array.isArray(value.order) && value.order.length <= CONVERSATION_PROJECTION_LIMITS.maxMessages
    && value.order.every(key => rowKey(key) && record(key) && fields(key, ['entryId', 'conversationId', 'messageIndex']))
    && new Set(value.order.map(projectionKey)).size === value.order.length;
}

export interface ConversationTextReceiver {
  /** Accept one complete JSON frame. A failure clears the cache and requires a fresh initial snapshot. */
  readonly read: (line: string) => ConversationTextSnapshot;
  readonly reset: () => void;
}

export function createConversationTextReceiver(expectedIdentity: ProjectionIdentity): ConversationTextReceiver {
  if (!projectionIdentity(expectedIdentity)) throw new Error('Invalid projection identity');
  const expected = { ...expectedIdentity };
  let previous: ConversationTextSnapshot | undefined;
  return {
    reset: () => { previous = undefined; },
    read: line => {
      try {
        if (typeof line !== 'string' || line.length > CONVERSATION_PROJECTION_LIMITS.maxFrameBytes
          || projectionEncoder.encode(line.endsWith('\n') ? line : line + '\n').byteLength > CONVERSATION_PROJECTION_LIMITS.maxFrameBytes) throw new Error();
        const value: unknown = JSON.parse(line);
        if (!frame(value) || !sameSource(expected, value.source)) throw new Error();
        if (previous) {
          if (value.connection.id !== previous.connection.id || value.connection.frame !== previous.connection.frame + 1) throw new Error();
        } else if (value.kind !== 'snapshot' || value.connection.frame !== 0) throw new Error();
        let next: ConversationTextSnapshot;
        if (value.kind === 'snapshot') next = value;
        else {
          if (!previous || value.baseFrame !== previous.connection.frame) throw new Error();
          const retained = new Map(previous.messages.map(message => [projectionKey(message), message]));
          const ordered = new Set(value.order.map(projectionKey));
          for (const message of value.upsert) {
            if (!ordered.has(projectionKey(message))) throw new Error();
            retained.set(projectionKey(message), message);
          }
          const messages = value.order.map(key => {
            const message = retained.get(projectionKey(key));
            if (!message) throw new Error();
            return message;
          });
          if (!rows(messages)) throw new Error();
          const { baseFrame: _base, upsert: _upsert, order: _order, ...common } = value;
          next = { ...common, kind: 'snapshot', messages };
        }
        previous = next;
        return structuredClone(next);
      } catch {
        previous = undefined;
        throw new Error('Invalid conversation projection; reconnect required');
      }
    },
  };
}
