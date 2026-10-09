import { z } from 'zod';
import { locator, reference } from '@hachej/boring-files/publication';

export const preparationSections = Object.freeze([
  { id: 'overview', title: "Vue d'ensemble" },
  { id: 'prevention', title: 'Prévention et dépistage' },
  { id: 'cardiovascular', title: 'Facteurs de risque cardiovasculaire' },
  { id: 'followup', title: 'Suivi spécialisé et biologique par pathologie' },
  { id: 'recent-history', title: 'Histoire récente' },
  { id: 'today', title: "À explorer aujourd'hui" },
].map(Object.freeze));

const sectionKinds = ['problem', 'followup', 'risk-factor', 'followup', 'problem', 'question'];
export const preparationSlots = Object.freeze(preparationSections.flatMap((section, index) => [0, 1].map(offset => {
  const itemId = `c${String(index * 2 + offset + 1).padStart(2, '0')}`;
  return Object.freeze({ itemId, section: section.id, kind: sectionKinds[index], ref: `preparation/${itemId}` });
})));

const text = maxBytes => z.string().refine(value => value.isWellFormed() && new TextEncoder().encode(value).length <= maxBytes, 'Invalid bounded Unicode text');
const status = z.enum(['documented', 'not-found', 'uncertain']);
const card = z.object({
  itemId: z.enum(preparationSlots.map(slot => slot.itemId)), title: text(128), summary: text(768),
  details: z.array(z.object({ text: text(768), status }).strict()).max(8), status,
  attention: z.enum(['routine', 'acute', 'today']), target: z.enum(['unknown', 'within', 'above']),
  review: z.enum(['unknown', 'due', 'current']),
}).strict();
const cards = z.array(card).length(preparationSlots.length).superRefine((values, context) => {
  if (new Set(values.map(value => value.itemId)).size !== preparationSlots.length) context.addIssue({ code: 'custom', message: 'Every preparation slot is required exactly once' });
}).transform(values => preparationSlots.map(slot => values.find(value => value.itemId === slot.itemId)));
const content = { header: text(256), synthesis: text(2048),
  schedule: z.array(z.object({ label: text(128), at: text(128) }).strict()).max(8), cards };
const dossier = z.object({ format: z.literal('fictional.redaction.dossier'), version: z.literal(1), ...content }).strict();
const uuid = z.string().uuid();
const resourceRef = z.unknown().transform((value, context) => {
  try { return reference(value); }
  catch { context.addIssue({ code: 'custom', message: 'Invalid preparation source reference' }); return z.NEVER; }
});
const preparation = z.object({ format: z.literal('fictional.redaction.preparation'), version: z.literal(1),
  instanceId: uuid, requestId: z.string().regex(/^[a-z0-9-]{1,80}$/), generationId: uuid,
  sources: z.object({ notes: resourceRef, dossier: resourceRef, config: resourceRef }).strict(), ...content,
}).strict();

export function preparationTargets(instanceId) {
  uuid.parse(instanceId);
  const at = path => ({ resource: { providerId: 'redaction', path: `${instanceId}/${path}` }, view: { kind: 'published' } });
  return { notes: at('source.md'), ...Object.fromEntries(['dossier', 'config', 'output', 'layout', 'generation'].map(name => [name, at(`preparation/${name}.json`)])) };
}

export const parsePreparationDossier = value => dossier.parse(value);
export function parsePreparation(value) {
  const parsed = preparation.parse(value), targets = preparationTargets(parsed.instanceId);
  for (const name of ['notes', 'dossier', 'config']) {
    if (JSON.stringify(locator(parsed.sources[name])) !== JSON.stringify(targets[name])) throw new TypeError('Preparation source belongs to another target');
  }
  return parsed;
}

export function preparationMetadata(value) {
  const document = parsePreparation(value);
  return preparationSlots.map((slot, index) => {
    const item = document.cards[index];
    return { ref: slot.ref, metadata: { section: slot.section, attention: item.attention, target: item.target, review: item.review } };
  });
}

export const preparationDeliveryOperation = (instanceId, taskId) => JSON.stringify(['fictional.preparation.deliver.v1', instanceId, taskId]);
