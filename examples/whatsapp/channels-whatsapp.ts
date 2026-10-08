import type { ChannelAdapter, ChannelMessage, ChannelReceipt, ChannelReply } from './channels.ts';

/**
 * WhatsApp Business Cloud API edge for `createChannelGateway`, ported from boring-ui-v2 `@hachej/channel-whatsapp`:
 * webhook challenge and `X-Hub-Signature-256` verification over the raw body, text and interactive replies in,
 * text, reply buttons and lists out. It holds no conversation state.
 */
export const WHATSAPP = Object.freeze({
  channel: 'whatsapp', bodyLimit: 1_048_576, graphOrigin: 'https://graph.facebook.com', apiVersion: 'v25.0', maxText: 4096,
  maxButtons: 3, maxButtonTitle: 20, maxRows: 10, maxRowTitle: 24, maxInteractiveBody: 1024,
});

/** Host-owned secrets. Only `withCredentials` sees them, for the length of one call. */
export interface WhatsAppCredentials {
  readonly accessToken: string;
  readonly appSecret: string;
  readonly verifyToken: string;
  /** The business phone number ID that sends replies; webhooks for other numbers are ignored. */
  readonly phoneNumberId: string;
  readonly apiVersion?: string;
}

export interface WhatsAppChannelOptions {
  readonly withCredentials: <T>(use: (credentials: WhatsAppCredentials) => T | Promise<T>) => Promise<T>;
  readonly fetch?: typeof fetch;
  readonly graphOrigin?: string;
  readonly bodyLimit?: number;
  readonly now?: () => number;
  /** Mark each admitted message read and show the typing indicator. Default true. */
  readonly typingIndicator?: boolean;
}

export class WhatsAppApiError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  constructor(status: number, retryable: boolean) {
    super(`WhatsApp Cloud API request failed (${status})`);
    this.name = 'WhatsAppApiError';
    this.status = status;
    this.retryable = retryable;
  }
}

type Payload = Record<string, unknown>;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const respond = (status: number, body: string): ChannelReceipt => ({ kind: 'response', response: new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } }) });

export function createWhatsAppChannel(options: WhatsAppChannelOptions): ChannelAdapter {
  const request = options.fetch ?? fetch;
  const origin = (options.graphOrigin ?? WHATSAPP.graphOrigin).replace(/\/$/, '');
  const limit = options.bodyLimit ?? WHATSAPP.bodyLimit;

  async function post(payload: Payload, credentials: WhatsAppCredentials): Promise<void> {
    const version = credentials.apiVersion ?? WHATSAPP.apiVersion;
    if (!/^v\d+\.\d+$/.test(version) || !/^\d+$/.test(credentials.phoneNumberId)) throw new WhatsAppApiError(0, false);
    const response = await request(`${origin}/${version}/${credentials.phoneNumberId}/messages`, {
      method: 'POST', headers: { authorization: `Bearer ${credentials.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
    });
    if (response.ok) return;
    let transient = false, code: number | undefined;
    try {
      const body: unknown = await response.json();
      if (record(body) && record(body['error'])) { transient = body['error']['is_transient'] === true; code = typeof body['error']['code'] === 'number' ? body['error']['code'] : undefined; }
    } catch { /* HTTP status still classifies it */ }
    const retryable = transient || (code !== undefined && [1, 2, 4, 17, 32, 613, 80007].includes(code)) || response.status === 408 || response.status === 429 || response.status >= 500;
    throw new WhatsAppApiError(response.status, retryable);
  }

  return {
    id: WHATSAPP.channel,
    receive: async incoming => options.withCredentials(async credentials => {
      const method = incoming.method.toUpperCase();
      if (method === 'GET') return challenge(incoming.url, credentials.verifyToken);
      if (method !== 'POST') return respond(405, 'method not allowed');
      const announced = Number(incoming.headers.get('content-length') ?? 0);
      if (Number.isFinite(announced) && announced > limit) return respond(413, 'payload too large');
      const body = await readBody(incoming, limit);
      if (!body) return respond(413, 'payload too large');
      const signature = incoming.headers.get('x-hub-signature-256');
      if (!signature || !await verifyWhatsAppSignature(body, signature, credentials.appSecret)) return respond(401, 'invalid signature');
      let payload: unknown;
      try { payload = JSON.parse(new TextDecoder().decode(body)); } catch { return respond(400, 'invalid json'); }
      try { return { kind: 'messages', messages: parseWhatsAppMessages(payload, { phoneNumberId: credentials.phoneNumberId, receivedAt: options.now?.() ?? Date.now() }) }; }
      catch { return respond(400, 'invalid envelope'); }
    }),
    send: async (address, reply) => options.withCredentials(async credentials => {
      for (const payload of renderWhatsAppReply(reply)) await post({ recipient_type: 'individual', to: address, ...payload }, credentials);
    }),
    ...(options.typingIndicator === false ? {} : {
      received: async (message: ChannelMessage) => options.withCredentials(credentials =>
        post({ status: 'read', message_id: message.messageId, typing_indicator: { type: 'text' } }, credentials)),
    }),
  };
}

function challenge(url: string, verifyToken: string): ChannelReceipt {
  const query = new URL(url, 'https://webhook.invalid').searchParams;
  const value = query.get('hub.challenge'), supplied = query.get('hub.verify_token');
  const encode = (text: string) => new TextEncoder().encode(text);
  if (query.get('hub.mode') !== 'subscribe' || value === null || supplied === null || !constantTimeEqual(encode(supplied), encode(verifyToken))) return respond(403, 'verification failed');
  return respond(200, value);
}

/** Verify Meta's `sha256=<hex>` HMAC of the exact raw body. */
export async function verifyWhatsAppSignature(body: Uint8Array, signature: string, appSecret: string): Promise<boolean> {
  if (!/^sha256=[0-9a-f]{64}$/.test(signature)) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, Uint8Array.from(body).buffer));
  const expected = new Uint8Array(32);
  for (let index = 0; index < 32; index += 1) expected[index] = Number.parseInt(signature.slice(7 + index * 2, 9 + index * 2), 16);
  return constantTimeEqual(digest, expected);
}

/**
 * Text and interactive (button/list) messages of a verified webhook body. Status callbacks, other phone numbers and
 * unsupported media are skipped; a malformed envelope throws.
 */
export function parseWhatsAppMessages(payload: unknown, options: { readonly phoneNumberId?: string; readonly receivedAt?: number } = {}): ChannelMessage[] {
  const receivedAt = options.receivedAt ?? Date.now();
  if (!record(payload) || payload['object'] !== 'whatsapp_business_account' || !Array.isArray(payload['entry'])) throw new Error('Invalid WhatsApp webhook envelope');
  const out: ChannelMessage[] = [];
  for (const entry of payload['entry']) {
    if (!record(entry) || !Array.isArray(entry['changes'])) throw new Error('Invalid WhatsApp webhook entry');
    for (const change of entry['changes']) {
      if (!record(change) || typeof change['field'] !== 'string' || !record(change['value'])) throw new Error('Invalid WhatsApp webhook change');
      const value = change['value'];
      if (change['field'] !== 'messages') continue;
      const metadata = record(value['metadata']) ? value['metadata'] : {};
      if (options.phoneNumberId !== undefined && metadata['phone_number_id'] !== options.phoneNumberId) continue;
      if (!Array.isArray(value['messages'])) { if (Array.isArray(value['statuses'])) continue; throw new Error('Invalid WhatsApp messages change'); }
      for (const message of value['messages']) {
        if (!record(message) || typeof message['id'] !== 'string' || typeof message['from'] !== 'string' || typeof message['type'] !== 'string') throw new Error('Invalid WhatsApp message');
        const text = inboundText(message);
        if (text === undefined) continue;
        const stamp = typeof message['timestamp'] === 'string' && /^\d+$/.test(message['timestamp']) ? Number(message['timestamp']) * 1000 : receivedAt;
        out.push({ channel: WHATSAPP.channel, address: message['from'], messageId: message['id'], text, receivedAt: Number.isSafeInteger(stamp) ? stamp : receivedAt });
      }
    }
  }
  return out;
}

function inboundText(message: Record<string, unknown>): string | undefined {
  const text = message['text'], interactive = message['interactive'], button = message['button'];
  if (message['type'] === 'text' && record(text) && typeof text['body'] === 'string') return text['body'];
  if (message['type'] === 'button' && record(button) && typeof button['text'] === 'string') return button['text'];
  if (message['type'] === 'interactive' && record(interactive)) {
    const choice = interactive['type'] === 'button_reply' ? interactive['button_reply'] : interactive['list_reply'];
    // Our buttons and rows carry the option text as their ID, so the answer is the exact option.
    if (record(choice)) return typeof choice['id'] === 'string' ? choice['id'] : typeof choice['title'] === 'string' ? choice['title'] : undefined;
  }
  return undefined;
}

/** Graph API message payloads (without `to`) for one gateway reply. */
export function renderWhatsAppReply(reply: ChannelReply): Payload[] {
  const text = (body: string): Payload[] => splitWhatsAppText(body, WHATSAPP.maxText).map(chunk => ({ type: 'text', text: { body: chunk, preview_url: false } }));
  if (reply.kind === 'notice') return text(reply.text);
  if (reply.kind === 'answer') return text(whatsAppMarkdown(reply.markdown));
  const prompt = whatsAppMarkdown(reply.prompt);
  const { options } = reply;
  const fits = (max: number) => options.every(option => [...option].length <= max);
  if (options.length && prompt.length <= WHATSAPP.maxInteractiveBody) {
    const footer = reply.allowFreeText ? { footer: { text: 'Or type your own answer.' } } : {};
    if (options.length <= WHATSAPP.maxButtons && fits(WHATSAPP.maxButtonTitle)) {
      return [{ type: 'interactive', interactive: { type: 'button', body: { text: prompt }, ...footer,
        action: { buttons: options.map(option => ({ type: 'reply', reply: { id: option, title: option } })) } } }];
    }
    if (options.length <= WHATSAPP.maxRows && fits(WHATSAPP.maxRowTitle)) {
      return [{ type: 'interactive', interactive: { type: 'list', body: { text: prompt }, ...footer,
        action: { button: 'Choose', sections: [{ title: 'Options', rows: options.map(option => ({ id: option, title: option })) }] } } }];
    }
  }
  const numbered = options.map((option, index) => `${index + 1}. ${option}`).join('\n');
  const hint = options.length ? (reply.allowFreeText ? 'Reply with a number or your own answer.' : 'Reply with a number.') : 'Reply with your answer.';
  return text([prompt, numbered, hint].filter(Boolean).join('\n\n'));
}

/** WhatsApp formatting: no headings, `*bold*`, `_italic_`; code fences are kept. */
export function whatsAppMarkdown(markdown: string): string {
  let fenced = false;
  return markdown.split(/(```)/g).map(section => {
    if (section === '```') { fenced = !fenced; return section; }
    if (fenced) return section;
    return section.replace(/^#{1,6}\s+(.*)$/gm, '**$1**')
      .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1_$2_')
      .replace(/\*\*([^*\n]+)\*\*/g, '*$1*')
      .replace(/\[([^\]\n]+)\]\((https?:[^)\s]+)\)/g, '$1 ($2)');
  }).join('');
}

/** Split at paragraph, then line boundaries; an open code fence is closed and reopened across chunks. */
export function splitWhatsAppText(text: string, max: number): string[] {
  const chunks: string[] = [];
  const high = (code: number) => code >= 0xd800 && code <= 0xdbff;
  let rest = text;
  while (rest.length > max) {
    let split = rest.lastIndexOf('\n\n', max);
    if (split < max / 2) split = rest.lastIndexOf('\n', max);
    if (split < max / 2) split = max;
    if (split > 0 && high(rest.charCodeAt(split - 1))) split -= 1;
    let chunk = rest.slice(0, split);
    rest = rest.slice(split).replace(/^\n+/, '');
    if ((chunk.match(/```/g) ?? []).length % 2 === 1) {
      const close = '\n```';
      if (chunk.length + close.length > max) {
        let keep = max - close.length;
        if (keep > 0 && high(chunk.charCodeAt(keep - 1))) keep -= 1;
        rest = chunk.slice(keep) + rest; chunk = chunk.slice(0, keep);
      }
      chunk += close; rest = '```\n' + rest;
    }
    chunks.push(chunk);
  }
  if (rest.length || !chunks.length) chunks.push(rest);
  return chunks;
}

async function readBody(request: Request, limit: number): Promise<Uint8Array | undefined> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > limit) { await reader.cancel(); return undefined; }
    parts.push(next.value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { body.set(part, offset); offset += part.byteLength; }
  return body;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.byteLength ^ right.byteLength;
  for (let index = 0; index < Math.max(left.byteLength, right.byteLength); index += 1) difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return difference === 0;
}
