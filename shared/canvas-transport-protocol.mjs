import { z } from 'zod';
import { parseCanvasEdits } from '@hachej/boring-ui-kit/canvas-document';
import { createTLSchema } from '@tldraw/tlschema';

export const schema = 'boring.canvas-presentation';
export const version = 1;
export const maxBodyBytes = 65_536;
export const maxResultBytes = 8_192;
const encoder = new TextEncoder();
const canvasSchema = createTLSchema();
const text = maximum => z.string().min(1).refine(value => encoder.encode(value).length <= maximum && !/[\uD800-\uDFFF]/u.test(value));
const id = text(256);
const resource = z.object({ providerId: id, path: text(2048) }).strict();
const locator = z.object({ resource, view: z.object({ kind: z.literal('published') }).strict() }).strict();
const base = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('absent'), target: locator }).strict(),
  z.object({ kind: z.literal('revision'), target: locator.extend({ revision: id }) }).strict(),
]);
const targetSchema = z.object({ instanceId: id, epoch: id, subject: z.object({
  scopeId: id, base, bufferVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), mountId: id,
  pageId: text(256).refine(value => value.startsWith('page:')),
}).strict() }).strict();
const identitySchema = z.object({ runtimeId: id, conversationId: id, scopeId: id, principalId: id }).strict();
const expiresAt = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const select = z.object({ expiresAt, shapeIds: z.array(text(256).refine(value => value.startsWith('shape:'))).max(100) }).strict();
const propose = z.object({ expiresAt, edits: z.array(z.unknown()).min(1).max(100), summary: text(4096) }).strict();
const header = { schema: z.literal(schema), version: z.literal(version) };

export const parseTarget = value => targetSchema.parse(value);
export const parseIdentity = value => identitySchema.parse(value);
export const sameTarget = (left, right) => JSON.stringify(parseTarget(left)) === JSON.stringify(parseTarget(right));
export const sameIdentity = (left, right) => JSON.stringify(parseIdentity(left)) === JSON.stringify(parseIdentity(right));
export function parseInput(command, value) {
  if (command === 'select') return select.parse(value);
  if (command === 'propose') {
    const parsed = propose.parse(value);
    return { ...parsed, edits: parseCanvasEdits(parsed.edits, canvasSchema) };
  }
  throw new TypeError('Unknown canvas presentation command');
}
export const inputSchema = command => ({ jsonSchema: z.toJSONSchema(command === 'select' ? select : propose), parse: value => parseInput(command, value) });
export const parseOpen = value => z.object({ ...header, target: targetSchema }).strict().parse(value);
export const parseOpened = value => z.object({ ...header, connectionId: id, target: targetSchema }).strict().parse(value);
export const parseConnection = value => id.parse(value);

export function parseEnvelope(value) {
  const parsed = z.object({ ...header, connectionId: id, requestId: id, command: z.enum(['select', 'propose']), target: targetSchema, input: z.unknown() }).strict().parse(value);
  return { ...parsed, input: parseInput(parsed.command, parsed.input) };
}
export function parseResult(command, value, target) {
  const refusal = z.object({ kind: z.enum(['stale', 'conflict', 'denied', 'unavailable', 'unknown']), reason: text(1024) }).strict();
  if (value?.kind !== 'applied' && value?.kind !== 'proposed') return refusal.parse(value);
  if (command === 'select') {
    z.object({ kind: z.literal('applied'), value: z.undefined().optional() }).strict().parse(value);
    return { kind: 'applied', value: undefined };
  }
  const parsed = z.object({ kind: z.literal('proposed'), proposalId: id, base: targetSchema }).strict().parse(value);
  if (!sameTarget(parsed.base, target)) throw new TypeError('Proposal target changed');
  return parsed;
}
export function parseReply(value) {
  return z.object({ ...header, connectionId: id, requestId: id, result: z.unknown() }).strict().parse(value);
}
export function json(value, maximum = maxBodyBytes) {
  const bytes = JSON.stringify(value);
  if (encoder.encode(bytes).length > maximum) throw new TypeError('Canvas presentation payload exceeds its byte limit');
  return bytes;
}
