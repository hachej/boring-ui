import { sha256 } from '@hachej/boring-files/platform';
import { z } from 'zod';
export const morningIdentity = Object.freeze({ principalId: 'fictional-person', initiatorId: 'fictional-person', scopeId: 'fictional-morning' });
const text = z.string().min(1).max(4096).refine(value => !/[\uD800-\uDFFF]/u.test(value));
const id = text.max(256);
export const emailSchema = z.object({ kind: z.literal('fictional.email'), version: z.literal(1), subject: text, status: z.enum(['pending', 'queued', 'snoozed']), snooze: z.literal('later').nullable() }).strict();
export const calendarSchema = z.object({ kind: z.literal('fictional.calendar'), version: z.literal(1), title: text, attendees: z.array(text).max(20), options: z.array(z.object({ id, label: text }).strict()).min(1).max(10), selected: id.nullable() }).strict().refine(value => new Set(value.options.map(option => option.id)).size === value.options.length && (value.selected === null || value.options.some(option => option.id === value.selected)));
export const todoSchema = z.object({ kind: z.literal('fictional.todo'), version: z.literal(1), items: z.array(z.object({ id, title: text, completed: z.boolean() }).strict()).max(100) }).strict().refine(value => new Set(value.items.map(item => item.id)).size === value.items.length);
export const actionSchemas = {
  send_email: z.object({ operationId: id, expected: id, draftRevision: id }).strict(),
  snooze_email: z.object({ operationId: id, expected: id, option: z.literal('later') }).strict(),
  accept_calendar_slot: z.object({ operationId: id, expected: id, optionId: id }).strict(),
  complete_todo: z.object({ operationId: id, expected: id, itemId: id, completed: z.boolean() }).strict(),
};

export async function morningActionDigest(route, input) {
  const names = { '/email/send': 'send_email', '/email/snooze': 'snooze_email', '/calendar/slot': 'accept_calendar_slot', '/todo/tick': 'complete_todo' };
  if (!Object.hasOwn(names, route)) throw new TypeError('Unknown morning action');
  const parsed = actionSchemas[names[route]].parse(input);
  const fields = route === '/email/send' ? [parsed.expected, parsed.draftRevision]
    : route === '/email/snooze' ? [parsed.expected, parsed.option]
    : route === '/calendar/slot' ? [parsed.expected, parsed.optionId]
    : [parsed.expected, parsed.itemId, parsed.completed];
  return Array.from(await sha256(new TextEncoder().encode(JSON.stringify([route, ...fields]))), byte => byte.toString(16).padStart(2, '0')).join('');
}
