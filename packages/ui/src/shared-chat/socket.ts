import { z } from 'zod';
import { randomUUID } from '@hachej/boring-files/platform';
import { ChannelRequestError } from './error.js';
import type { ChannelEvent, ChannelMessage, ChannelSource, Member } from './source.js';

const member = z.object({ id: z.string(), name: z.string(), kind: z.enum(['person', 'agent', 'admin']), role: z.union([z.enum(['owner', 'validator', 'member', 'admin']), z.templateLiteral(['agent:', z.string()])]).optional(), roleLabel: z.string().optional(), avatarUrl: z.string().optional(), presence: z.enum(['here', 'away']).optional() });
const conversation = z.object({ id: z.string(), title: z.string(), kind: z.string(), members: z.array(z.string()) });
const step = z.object({ label: z.string(), detail: z.string().optional(), status: z.enum(['running', 'done', 'failed']) });
const cardAction = z.object({ id: z.string(), label: z.string(), variant: z.enum(['primary', 'secondary']).optional() });
// An unknown `kind` from a newer host reads as absent (a plain message, a request card), never as a refused event.
const message = z.object({ id: z.string(), conversationId: z.string(), author: z.string(), at: z.string(), via: z.string().optional(), text: z.string().optional(),
  kind: z.enum(['system']).optional().catch(undefined),
  card: z.object({ requestId: z.string(), kind: z.enum(['request', 'pin']).optional().catch(undefined), title: z.string(), line: z.string(), since: z.string().optional(), state: z.string().optional(), action: cardAction.optional(), actions: z.array(cardAction).optional() }).optional(),
  mentions: z.array(z.string()).optional(), replyTo: z.string().optional(), attachments: z.array(z.object({ path: z.string(), title: z.string().optional() })).optional(), steps: z.array(step).optional(), streaming: z.boolean().optional(),
  removed: z.object({ by: z.string(), at: z.string() }).optional(), clientId: z.string().optional() });
const event = z.discriminatedUnion('type', [z.object({ type: z.literal('message'), message }),
  z.object({ type: z.literal('delta'), messageId: z.string(), conversationId: z.string(), text: z.string() }),
  z.object({ type: z.literal('step'), messageId: z.string(), conversationId: z.string(), index: z.number().int().nonnegative(), step }),
  z.object({ type: z.literal('presence'), members: z.array(z.object({ id: z.string(), presence: z.enum(['here', 'away']) })) }),
  z.object({ type: z.literal('members'), conversationId: z.string(), members: z.array(member) })]);

type Routes = Pick<ChannelSource, 'conversations' | 'members' | 'history' | 'send' | 'action' | 'remove' | 'canRemove'>;
export interface ChannelSocketOptions {
  /** App URL, for example `https://app.example/`. RPC lives under `_channel`; `me` supplies the live space. */
  readonly url: string | URL;
  readonly fetch?: (request: Request) => Promise<Response>;
  /** Host HTTP functions override the default routes independently. */
  readonly routes?: Partial<Routes>;
  /** Host subprotocol authentication may be supplied here. Closing a viewer closes only its own socket. */
  readonly open?: (url: URL) => WebSocket;
  readonly reconnectMs?: number;
}

export interface ChannelSocketSource extends ChannelSource {
  readonly space: string;
  readonly join: () => Promise<void>;
}

/** The platform app host's POST `_channel/<op>` and space WebSocket. Policy and identity remain at that host. */
export async function createChannelSocket(options: ChannelSocketOptions): Promise<ChannelSocketSource> {
  const base = new URL(options.url, globalThis.location?.href);
  base.pathname = base.pathname.replace(/\/$/, '') + '/';
  const request = options.fetch ?? (request => globalThis.fetch(request));
  const url = (path: string) => new URL(path, base);
  const failure = z.object({ error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean() }) });
  async function rpc(op: string, input: unknown = {}): Promise<unknown> {
    let response: Response;
    try { response = await request(new Request(url(`_channel/${op}`), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })); }
    catch (error) { throw new ChannelRequestError('network', error instanceof Error ? error.message : 'Channel connection was lost', true); }
    const body: unknown = await response.json().catch(() => undefined);
    const rejected = failure.safeParse(body);
    if (rejected.success) {
      const error = rejected.data.error;
      throw new ChannelRequestError(error.code, error.message, error.retryable, { refused: true });
    }
    if (!response.ok || body === undefined) throw new ChannelRequestError('invalid-response', `Channel ${op} returned an invalid response (${response.status})`, false);
    return body;
  }
  const bootstrap = z.object({ space: z.string().min(1), me: member }).parse(await rpc('me'));
  const space = bootstrap.space, me = bootstrap.me as Member;
  return {
    me, space,
    conversations: options.routes?.conversations ?? (async () => z.array(conversation).parse(await rpc('conversations'))),
    members: options.routes?.members ?? (async conversationId => z.array(member).parse(await rpc('members', { conversationId })) as Member[]),
    history: options.routes?.history ?? (async (conversationId, opts) =>
      z.object({ messages: z.array(message), before: z.string().optional() }).parse(await rpc('history', { conversationId, ...opts })) as Awaited<ReturnType<ChannelSource['history']>>),
    send: options.routes?.send ?? (async input => {
      if (input.attachments?.length) throw new ChannelRequestError('unsupported-attachments', 'File attachments are not available here.', false, { refused: true });
      const { conversationId, text, mentions, replyTo, clientId } = input;
      return message.parse(await rpc('send', { conversationId, text, mentions, ...(replyTo === undefined ? {} : { replyTo }), clientId, idempotencyKey: clientId })) as ChannelMessage;
    }),
    action: options.routes?.action ?? (async input => { await rpc('action', { ...input, idempotencyKey: randomUUID() }); }),
    remove: options.routes?.remove ?? (async messageId => { await rpc('remove', { messageId }); }),
    join: async () => { z.object({ space: z.string() }).parse(await rpc('join')); },
    ...(options.routes?.canRemove ? { canRemove: options.routes.canRemove } : {}),
    subscribe: (id, onEvent, onStatus) => {
      let disposed = false, socket: WebSocket | undefined, retry: ReturnType<typeof setTimeout> | undefined, attempt = 0;
      function connect() {
        if (disposed) return;
        onStatus?.('reconnecting');
        const target = url(`spaces/${encodeURIComponent(space)}/live`); target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
        let current: WebSocket;
        try { current = (options.open ?? (url => new WebSocket(url)))(target); }
        catch { lost(); return; }
        socket = current;
        current.onopen = () => { if (!disposed && current === socket) { attempt = 0; onStatus?.('live'); } };
        current.onmessage = frame => {
          if (disposed || current !== socket || typeof frame.data !== 'string') return;
          const parsed = event.safeParse((() => { try { return JSON.parse(frame.data) as unknown; } catch { return undefined; } })());
          if (parsed.success) {
            const update = parsed.data as ChannelEvent;
            if (update.type === 'presence' || (update.type === 'message' ? update.message.conversationId : update.conversationId) === id) onEvent(update);
          }
          else { current.close(1002, 'Invalid channel event'); }
        };
        current.onerror = () => current.close();
        current.onclose = () => { if (!disposed && current === socket) { socket = undefined; lost(); } };
      }
      function lost() {
        if (disposed) return;
        onStatus?.('offline');
        clearTimeout(retry);
        retry = setTimeout(connect, Math.min(30000, (options.reconnectMs ?? 1000) * 2 ** attempt++));
      }
      connect();
      return () => { disposed = true; clearTimeout(retry); const current = socket; socket = undefined; current?.close(); };
    },
  };
}
