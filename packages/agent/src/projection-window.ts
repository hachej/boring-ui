import type { EntryRecord } from '@earendil-works/pi-durable';
import { CONVERSATION_PROJECTION_LIMITS as limits, projectionBytes } from './projection-format.js';
import type { ConversationTextRow, ProjectionIdentity } from './projection-format.js';

type NativeMessage = NonNullable<EntryRecord['model']>[number];
function* textBlocks(message: NativeMessage): Generator<{ blockIndex: number; text: string }> {
  if (typeof message.content === 'string') yield { blockIndex: 0, text: message.content };
  else for (const [blockIndex, block] of message.content.entries()) if (block.type === 'text') yield { blockIndex, text: block.text };
}
function scalarPrefix(text: string, length: number): string {
  const last = text.charCodeAt(length - 1), next = text.charCodeAt(length);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff ? length - 1 : length);
}
function clippedText(text: string, bytes: number): string {
  let low = 0, high = Math.min(text.length, bytes);
  const candidate = scalarPrefix(text, high);
  if (projectionBytes(candidate) - 2 <= bytes) return candidate;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (projectionBytes(scalarPrefix(text, middle)) - 2 <= bytes) low = middle;
    else high = middle - 1;
  }
  return scalarPrefix(text, low);
}
function projectRow(entry: EntryRecord, message: NativeMessage, messageIndex: number): ConversationTextRow | undefined {
  if (message.role !== 'user' && message.role !== 'assistant') return;
  const content: { blockIndex: number; text: string }[] = [];
  const base = { entryId: entry.id, conversationId: entry.conversationId,
    ...(entry.byTaskId === undefined ? {} : { byTaskId: entry.byTaskId }), messageIndex, role: message.role };
  let bytes = projectionBytes({ ...base, content, clipped: false }), clipped = false;
  for (const block of textBlocks(message)) {
    const overhead = projectionBytes({ blockIndex: block.blockIndex, text: '' }) + (content.length ? 1 : 0);
    const available = limits.maxMessageBytes - bytes - overhead;
    if (available < 0) { clipped = true; break; }
    const text = clippedText(block.text, available);
    content.push({ blockIndex: block.blockIndex, text });
    bytes += overhead + projectionBytes(text) - 2;
    if (text.length !== block.text.length) { clipped = true; break; }
  }
  return content.length ? { ...base, content, clipped } : undefined;
}

export function projectConversationWindow(entries: readonly EntryRecord[], identity: ProjectionIdentity,
  allowEntry: (identity: ProjectionIdentity, entry: EntryRecord) => boolean,
  earlier = false,
): { messages: readonly ConversationTextRow[]; window: { truncated: boolean } } {
  const selected: { row: ConversationTextRow; position: number }[] = [];
  let bytes = 2, truncated = earlier;
  outer: for (let position = entries.length - 1; position >= 0; position--) {
    const entry = entries[position];
    if (!entry) continue;
    if (allowEntry(identity, entry) !== true) continue;
    const model = entry.model ?? [];
    for (let j = model.length - 1; j >= 0; j--) {
      const message = model[j];
      if (!message) continue;
      const row = projectRow(entry, message, j);
      if (!row) continue;
      const size = projectionBytes(row) + (selected.length ? 1 : 0);
      if (selected.length === limits.maxMessages || bytes + size > limits.maxWindowBytes) { truncated = true; break outer; }
      selected.push({ row, position }); bytes += size;
    }
  }
  selected.sort((a, b) => a.position - b.position || a.row.messageIndex - b.row.messageIndex);
  return { messages: selected.map(item => item.row), window: { truncated } };
}

/**
 * The entries of the active conversation: a view's entries are a window over the whole history, and the newest reset or compaction
 * marker's `head` starts what the conversation is now. Entries below it are archived.
 */
export function activeEntries(entries: readonly EntryRecord[]): readonly EntryRecord[] {
  let head: EntryRecord['id'] | undefined;
  for (const entry of entries) if (entry.head !== undefined) head = entry.head;
  return head === undefined ? entries : entries.filter(entry => entry.id >= head!);
}

/** Whether an entry shows as a message row (the text of a user or assistant message). */
export function showsRow(entry: EntryRecord): boolean {
  return (entry.model ?? []).some((message, index) => projectRow(entry, message, index) !== undefined);
}
