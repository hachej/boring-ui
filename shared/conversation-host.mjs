// The two pieces of host policy every example server repeats for the chat transport: a conversation's title and the
// `configure` allow-list. The host owns both; the transport only calls them.
import { MENTION_FILE_PREFIX } from '@hachej/boring-agent/mentions';

export const EFFORTS = ['minimal', 'low', 'medium', 'high'];

/** The first (oldest) user message of a conversation, shortened, or `undefined` before any. The scan runs newest first, so it reads every page and keeps the smallest entry id. */
export async function firstMessageTitle(conversation, context, maxLength = 80) {
  let cursor, first;
  for (let pages = 0; pages < 20; pages++) {
    const page = await conversation.entries({}, 100, cursor, context);
    for (const entry of page.items) for (const message of entry.model ?? []) {
      if (message.role !== 'user') continue;
      const text = (typeof message.content === 'string' ? message.content : message.content.map(part => part.type === 'text' && !part.text.startsWith(MENTION_FILE_PREFIX) ? part.text : '').join(' ')).replace(/\s+/g, ' ').trim();
      if (text && (!first || BigInt(entry.id) < first.id)) first = { id: BigInt(entry.id), text };
    }
    if (!page.next) break;
    cursor = page.next;
  }
  if (!first) return undefined;
  return first.text.length > maxLength ? `${first.text.slice(0, maxLength - 1)}…` : first.text;
}

/** Applies a model or effort change the host offers (`offers(model)` decides) and refuses anything else. */
export async function configureOffered(conversation, change, context, offers) {
  if (change.model && !offers(change.model)) return { kind: 'refused', reason: 'That model is not offered here.' };
  if (change.thinkingLevel !== undefined && !EFFORTS.includes(change.thinkingLevel)) return { kind: 'refused', reason: 'That effort level is not offered here.' };
  await conversation.configure({ ...(change.model ? { model: { provider: change.model.provider, modelId: change.model.modelId } } : {}), ...(change.thinkingLevel === undefined ? {} : { thinkingLevel: change.thinkingLevel }) }, context);
  return { kind: 'configured' };
}
