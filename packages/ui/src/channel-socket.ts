import { z } from 'zod';
import type { ChannelEvent, ChannelMessage, ChannelSource, Member } from './channel-source.js';

const member = z.object({ id: z.string(), name: z.string(), kind: z.enum(['person', 'agent', 'admin']), role: z.union([z.enum(['owner', 'validator', 'member', 'admin']), z.templateLiteral(['agent:', z.string()])]).optional(), avatarUrl: z.string().optional(), presence: z.enum(['here', 'away']).optional() });
const conversation = z.object({ id: z.string(), title: z.string(), kind: z.string(), members: z.array(z.string()) });
const step = z.object({ label: z.string(), detail: z.string().optional(), status: z.enum(['running', 'done', 'failed']) });
const message = z.object({ id: z.string(), conversationId: z.string(), author: z.string(), at: z.string(), via: z.string().optional(), text: z.string().optional(),
  card: z.object({ requestId: z.string(), title: z.string(), line: z.string(), since: z.string().optional(), state: z.string().optional(), action: z.object({ id: z.string(), label: z.string() }).optional() }).optional(),
  mentions: z.array(z.string()).optional(), replyTo: z.string().optional(), attachments: z.array(z.object({ path: z.string(), title: z.string().optional() })).optional(), steps: z.array(step).optional(), streaming: z.boolean().optional(),
  removed: z.object({ by: z.string(), at: z.string() }).optional(), clientId: z.string().optional() });
const event = z.discriminatedUnion('type', [z.object({ type: z.literal('message'), message }),
  z.object({ type: z.literal('delta'), messageId: z.string(), conversationId: z.string(), text: z.string() }),
  z.object({ type: z.literal('step'), messageId: z.string(), conversationId: z.string(), index: z.number().int().nonnegative(), step }),
  z.object({ type: z.literal('presence'), members: z.array(z.object({ id: z.string(), presence: z.enum(['here', 'away']) })) }),
  z.object({ type: z.literal('members'), conversationId: z.string(), members: z.array(member) })]);

type Routes = Pick<ChannelSource, 'conversations' | 'members' | 'history' | 'send' | 'action' | 'remove' | 'canRemove'>;
export interface ChannelSocketOptions {
  /** Space URL, for example `https://host/spaces/garden`. `live` is appended, with the selected conversationId. */
  readonly url: string | URL;
  readonly fetch?: (request: Request) => Promise<Response>;
  /** Omit to load the authenticated member from GET <url>/me. */
  readonly me?: Member;
  /** Host HTTP functions override the default routes independently. */
  readonly routes?: Partial<Routes>;
  /** Host subprotocol authentication may be supplied here. Closing a viewer closes only its own socket. */
  readonly open?: (url: URL) => WebSocket;
  readonly reconnectMs?: number;
}

/** WebSocket GET <space>/live plus overridable HTTP operations. All authorization and speaking policy remain at the host. */
export async function createChannelSocket(options: ChannelSocketOptions): Promise<ChannelSource> {
  const base = new URL(options.url, globalThis.location?.href);
  base.pathname = base.pathname.replace(/\/$/, '') + '/';
  const request = options.fetch ?? (request => globalThis.fetch(request));
  const url = (path: string) => new URL(path, base);
  async function json(path: string, init?: RequestInit): Promise<unknown> {
    const response = await request(new Request(url(path), init));
    if (!response.ok) throw new Error(`Channel request failed (${response.status})`);
    return response.status === 204 ? undefined : response.json();
  }
  const post = (value: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
  const me = options.me ?? member.parse(await json('me')) as Member;
  return {
    me,
    conversations: options.routes?.conversations ?? (async () => z.array(conversation).parse(await json('conversations'))),
    members: options.routes?.members ?? (async id => z.array(member).parse(await json(`conversations/${encodeURIComponent(id)}/members`)) as Member[]),
    history: options.routes?.history ?? (async (id, opts) => {
      const query = new URLSearchParams({ limit: String(opts.limit), ...(opts.before ? { before: opts.before } : {}) });
      return z.object({ messages: z.array(message), before: z.string().optional() }).parse(await json(`conversations/${encodeURIComponent(id)}/messages?${query}`)) as Awaited<ReturnType<ChannelSource['history']>>;
    }),
    send: options.routes?.send ?? (async input => {
      const { conversationId, attachments, ...body } = input;
      if (!attachments?.length) return message.parse(await json(`conversations/${encodeURIComponent(conversationId)}/messages`, post(body))) as ChannelMessage;
      const form = new FormData(); form.set('message', JSON.stringify(body)); for (const file of attachments) form.append('attachments', file);
      return message.parse(await json(`conversations/${encodeURIComponent(conversationId)}/messages`, { method: 'POST', body: form })) as ChannelMessage;
    }),
    action: options.routes?.action ?? (async ({ conversationId, requestId, actionId }) => { await json(`conversations/${encodeURIComponent(conversationId)}/actions`, post({ requestId, actionId })); }),
    ...(options.routes?.remove ? { remove: options.routes.remove } : {}), ...(options.routes?.canRemove ? { canRemove: options.routes.canRemove } : {}),
    subscribe: (id, onEvent, onStatus) => {
      let disposed = false, socket: WebSocket | undefined, retry: ReturnType<typeof setTimeout> | undefined, attempt = 0;
      function connect() {
        if (disposed) return;
        onStatus?.('reconnecting');
        const target = url('live'); target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:'; target.searchParams.set('conversationId', id);
        let current: WebSocket;
        try { current = (options.open ?? (url => new WebSocket(url)))(target); }
        catch { lost(); return; }
        socket = current;
        current.onopen = () => { if (!disposed && current === socket) { attempt = 0; onStatus?.('live'); } };
        current.onmessage = frame => {
          if (disposed || current !== socket || typeof frame.data !== 'string') return;
          const parsed = event.safeParse((() => { try { return JSON.parse(frame.data) as unknown; } catch { return undefined; } })());
          if (parsed.success) onEvent(parsed.data as ChannelEvent);
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
