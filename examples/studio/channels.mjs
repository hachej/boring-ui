// External channels for the studio: a WhatsApp sender talks to a studio agent. Each allowed sender gets their own
// conversation, created like a browser one, so the WhatsApp thread shows (live) in the studio chat for that agent.
// Credentials come from the environment and never reach the browser; the sender allow-list is the host's policy.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createChannelGateway } from '../whatsapp/channels.ts';
import { createWhatsAppChannel } from '../whatsapp/channels-whatsapp.ts';

/** The WhatsApp settings of the environment, or undefined when it is not configured. */
export function whatsAppFromEnv(env = process.env) {
  const required = ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ALLOWED'];
  if (!required.every(name => env[name])) return undefined;
  return {
    credentials: { accessToken: env.WHATSAPP_ACCESS_TOKEN, appSecret: env.WHATSAPP_APP_SECRET, verifyToken: env.WHATSAPP_VERIFY_TOKEN,
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID, ...(env.WHATSAPP_API_VERSION ? { apiVersion: env.WHATSAPP_API_VERSION } : {}) },
    // WhatsApp IDs are digits without "+": "15550001,15550002".
    allowed: env.WHATSAPP_ALLOWED.split(',').map(value => value.trim().replace(/^\+/, '')).filter(Boolean),
    ...(env.WHATSAPP_AGENT ? { agent: env.WHATSAPP_AGENT } : {}),
  };
}

/**
 * @param {object} options
 * @param {{ credentials: object, allowed: string[], agent?: string, fetch?: typeof fetch, graphOrigin?: string }} options.whatsapp
 */
export function startChannels({ directory, harness, context, agents, conversations, create, whatsapp }) {
  const entry = agents.find(candidate => candidate.agent.id === whatsapp.agent) ?? agents[0];
  if (!entry) throw new Error('No agent for the WhatsApp channel');
  const bindingsPath = join(directory, 'channels.json');
  const bindings = existsSync(bindingsPath) ? JSON.parse(readFileSync(bindingsPath, 'utf8')) : {};
  const creating = new Map();

  /** Host policy: allow-listed senders only, one conversation each, created on their first message. */
  async function route(message) {
    if (!whatsapp.allowed.includes(message.address)) return null;
    const key = `${message.channel}:${message.address}`;
    const known = bindings[key] === undefined ? undefined : conversations.get(String(bindings[key]));
    if (known) return known;
    if (!creating.has(key)) creating.set(key, create(entry).then(conversation => {
      bindings[key] = conversation.id; writeFileSync(bindingsPath, JSON.stringify(bindings, null, 2));
      return conversation;
    }).finally(() => creating.delete(key)));
    return creating.get(key);
  }

  const adapter = createWhatsAppChannel({ withCredentials: use => Promise.resolve(use(whatsapp.credentials)),
    ...(whatsapp.fetch ? { fetch: whatsapp.fetch } : {}), ...(whatsapp.graphOrigin ? { graphOrigin: whatsapp.graphOrigin } : {}) });
  const gateway = createChannelGateway({ harness, context, adapters: [adapter], route,
    onEvent: event => { if (event.kind === 'refused' || event.kind === 'undeliverable') console.warn(`channel ${event.channel}: ${event.kind}${event.reason ? ` (${event.reason})` : ''}`); } });
  return {
    agent: entry.agent.id,
    routes: { '/api/channels/whatsapp': gateway.handler('whatsapp') },
    start: gateway.start,
    close: gateway.close,
  };
}
