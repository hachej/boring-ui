import { preparationSlots, parsePreparationDossier } from './preparation-schema.mjs';
export const preparationCanaries = Object.freeze({ header: 'FICTIONAL_PREPARATION_HEADER_817', synthesis: 'FICTIONAL_PREPARATION_SYNTHESIS_296', schedule: 'FICTIONAL_PREPARATION_SCHEDULE_403', detail: 'FICTIONAL_PREPARATION_DETAIL_628' });
export function preparationDossier() {
  return parsePreparationDossier({ format: 'fictional.redaction.dossier', version: 1, header: preparationCanaries.header, synthesis: preparationCanaries.synthesis,
    schedule: [{ label: preparationCanaries.schedule, at: 'Fictional afternoon appointment' }],
    cards: preparationSlots.map((slot, index) => ({ itemId: slot.itemId, title: `Fictional ${slot.kind} ${index + 1}`, summary: `Invented source statement ${index + 1}`,
      details: [{ text: `${preparationCanaries.detail} ${index + 1}`, status: index % 3 === 0 ? 'not-found' : index % 3 === 1 ? 'uncertain' : 'documented' }],
      status: index % 3 === 0 ? 'not-found' : index % 3 === 1 ? 'uncertain' : 'documented', attention: index % 3 === 0 ? 'acute' : index % 3 === 1 ? 'today' : 'routine',
      target: index % 3 === 0 ? 'unknown' : index % 3 === 1 ? 'above' : 'within', review: index % 3 === 0 ? 'unknown' : index % 3 === 1 ? 'due' : 'current' })) });
}
export const preparationConfig = () => ({ format: 'fictional.redaction.preparation-config', version: 1, scenario: 'valid' });
