import type { Context } from '@earendil-works/chord';
import type { Conversation, ConversationWatch, EntryRecord } from '@earendil-works/pi-durable';

import { CONVERSATION_PROJECTION_LIMITS as limits, projectionEncoder, projectionIdentity, projectionKey } from './projection-format.js';
import type { ProjectionIdentity, ConversationTextProjection, ConversationTextSnapshot } from './projection-format.js';
import { projectConversationWindow } from './projection-window.js';
export { CONVERSATION_PROJECTION_LIMITS, createConversationTextReceiver } from './projection-format.js';
export type { ProjectionIdentity, ConversationTextProjection, ConversationTextSnapshot, ConversationTextDelta, ConversationTextRow, ConversationTextKey, ConversationTextReceiver } from './projection-format.js';

export interface ConversationProjectionAccess {
  readonly runtimeId: string;
  readonly scopeId: string;
  readonly principalId: string;
  readonly conversation: Conversation;
  readonly context: Context;
  /** The host must abort on revocation or identity change, including while idle. */
  readonly revoked: AbortSignal;
  readonly authorize: (identity: ProjectionIdentity, phase: 'open' | 'initial' | 'delivery') => Promise<boolean>;
  readonly allowEntry: (identity: ProjectionIdentity, entry: EntryRecord) => boolean;
}

export interface ConversationProjectionOptions {
  /** Authenticate and resolve the native conversation in trusted host code. */
  readonly authenticate: (request: Request) => Promise<ConversationProjectionAccess | null>;
}

function failure(status: number, reason: string): Response {
  return Response.json({ schema: 'boring.conversation-text', version: 2, reason }, {
    status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
}

// request-guard: exempt (GET only; this handler never reads a request body)
export function createConversationProjectionHandler(options: ConversationProjectionOptions): (request: Request) => Promise<Response> {
  return async request => {
    if (request.method !== 'GET') return failure(405, 'method-not-supported');
    if (new URL(request.url).searchParams.get('version') !== '2') return failure(426, 'unsupported-version');
    let access: ConversationProjectionAccess | null;
    try { access = await options.authenticate(request); }
    catch { return failure(503, 'authentication-unavailable'); }
    if (!access) return failure(401, 'authentication-required');
    const { conversation, context, revoked } = access;
    const authorize = access.authorize.bind(access), allowEntry = access.allowEntry.bind(access);
    const identity: ProjectionIdentity = Object.freeze({ runtimeId: access.runtimeId, scopeId: access.scopeId, principalId: access.principalId, conversationId: conversation.id });
    if (!projectionIdentity(identity)) return failure(503, 'identity-unavailable');
    const signal = AbortSignal.any([request.signal, revoked]);
    try {
      if (signal.aborted || await authorize(identity, 'open') !== true || signal.aborted) return failure(403, 'not-authorized');
    } catch { return failure(503, 'authorization-unavailable'); }
    let watch: ConversationWatch;
    try { watch = await conversation.watch(context); }
    catch { return failure(503, 'source-unavailable'); }
    // A watch that already ended may reject on stop; teardown must never turn a refusal into a rejection.
    const stopWatch = (): Promise<void> => Promise.resolve().then(() => watch.stop()).then(() => undefined, () => undefined);
    try {
      if (signal.aborted || await authorize(identity, 'initial') !== true || signal.aborted) {
        await stopWatch();
        return failure(403, 'not-authorized');
      }
    } catch {
      await stopWatch();
      return failure(503, 'authorization-unavailable');
    }

    const connectionId = globalThis.crypto.randomUUID();
    let previous: ConversationTextSnapshot | undefined;
    let revision = 0, delivered = -1, frame = 0;
    let wake: (() => void) | undefined;
    let stopped = false;
    let controller: ReadableStreamDefaultController<Uint8Array>;
    let stopping: Promise<void> | undefined;
    function stop(): Promise<void> {
      if (!stopped) {
        stopped = true;
        signal.removeEventListener('abort', onAbort);
        wake?.();
        try { controller.close(); } catch { /* already closed or cancelled */ }
      }
      return stopping ??= stopWatch();
    }
    function onAbort(): void { void stop(); }
    const body = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) { void stop(); return; }
        watch.start(async () => { revision++; wake?.(); });
        void watch.closed.then(() => stop());
      },
      async pull() {
        while (!stopped) {
          while (!stopped && delivered === revision) await new Promise<void>(resolve => { wake = resolve; });
          wake = undefined;
          if (stopped) return;
          try {
            if (await authorize(identity, 'delivery') !== true || signal.aborted || stopped) { await stop(); return; }
            const visible = projectConversationWindow(watch.value.entries, identity, allowEntry);
            delivered = revision;
            if (signal.aborted || stopped) { await stop(); return; }
            if (previous && JSON.stringify(previous.messages) === JSON.stringify(visible.messages)
              && previous.window.truncated === visible.window.truncated) continue;
            const snapshot: ConversationTextSnapshot = {
              schema: 'boring.conversation-text', version: 2, nativeVersion: 'pi-durable@1.0.1', source: identity,
              connection: { id: connectionId, frame, observedAt: new Date().toISOString() }, kind: 'snapshot', ...visible,
            };
            const snapshotBytes = projectionEncoder.encode(JSON.stringify(snapshot) + '\n');
            let bytes = snapshotBytes;
            if (previous) {
              const before = new Map(previous.messages.map(message => [projectionKey(message), JSON.stringify(message)]));
              const { messages, ...common } = snapshot;
              const projection: ConversationTextProjection = { ...common, kind: 'delta', baseFrame: previous.connection.frame,
                upsert: messages.filter(message => before.get(projectionKey(message)) !== JSON.stringify(message)),
                order: messages.map(({ conversationId, entryId, messageIndex }) => ({ conversationId, entryId, messageIndex })),
              };
              const deltaBytes = projectionEncoder.encode(JSON.stringify(projection) + '\n');
              if (deltaBytes.byteLength < snapshotBytes.byteLength) bytes = deltaBytes;
            }
            if (bytes.byteLength > limits.maxFrameBytes || signal.aborted || stopped) { await stop(); return; }
            previous = snapshot;
            frame++;
            controller.enqueue(bytes);
            return;
          } catch { await stop(); return; }
        }
      },
      async cancel() {
        stopped = true;
        signal.removeEventListener('abort', onAbort);
        wake?.();
        await (stopping ??= stopWatch());
      },
    }, { highWaterMark: 0 });
    return new Response(body, { headers: {
      'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
    } });
  };
}
