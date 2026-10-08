import { composeExperienceRegion } from '@hachej/boring-ui-kit/experience/regions';
import { validateExperience } from '@hachej/boring-ui-kit/experience/compose';
import { preparationSections, preparationSlots, preparationMetadata } from '../redaction/preparation-schema.mjs';

const fixed = ['header', 'synthesis', 'notes', 'actions', 'schedule'];
export const preparationCells = Object.freeze([
  ...fixed.map(name => ({ ref: `preparation/${name}`, kind: `preparation/${name}`, version: 1 })),
  ...preparationSections.map(section => ({ ref: `preparation/section-${section.id}`, kind: 'preparation/heading', version: 1 })),
  ...preparationSlots.map(slot => ({ ref: slot.ref, kind: `preparation/${slot.kind}`, version: 1 })),
].map(Object.freeze));
const cell = ref => ({ type: 'boring/cell', props: { ref }, children: [] });
function groups(order, gap = 'medium') {
  const elements = {};
  for (const section of preparationSections) {
    const slots = preparationSlots.filter(slot => slot.section === section.id);
    if (section.id !== 'recent-history') slots.sort((a, b) => order.indexOf(a.ref) - order.indexOf(b.ref));
    elements[`section-${section.id}`] = { type: 'boring/stack', props: { gap }, children: [`heading-${section.id}`, ...slots.map(slot => slot.itemId)] };
    elements[`heading-${section.id}`] = cell(`preparation/section-${section.id}`);
    for (const slot of slots) elements[slot.itemId] = cell(slot.ref);
  }
  return elements;
}
export const preparationLayout = validateExperience({
  format: 'boring.experience', version: 1, name: 'preparation', title: 'Préparation fictive', source: 'fixed',
  kinds: { 'boring/stack': 1, 'boring/row': 1, 'boring/grid': 1, 'boring/cell': 1, 'boring/generated': 1,
    ...Object.fromEntries(preparationCells.map(item => [item.kind, item.version])) },
  root: 'page', elements: {
    page: { type: 'boring/stack', props: {}, children: ['header', 'synthesis', 'preparation', 'notes', 'actions', 'schedule'] },
    ...Object.fromEntries(fixed.map(name => [name, cell(`preparation/${name}`)])),
    preparation: { type: 'boring/generated', props: { region: 'preparation',
      candidates: preparationCells.filter(item => !fixed.includes(item.ref.split('/')[1])).map(item => item.ref),
      maxElements: 48, minWidth: 260, regenerate: ['open', 'phase', 'request'], prompt: 'preparation' },
      children: preparationSections.map(section => `section-${section.id}`) },
    ...groups(preparationSlots.map(slot => slot.ref)),
  },
}, { cells: preparationCells, canView: () => true });

export function validatePreparationLayout(value, canView = () => true) {
  const parsed = validateExperience(value, { cells: preparationCells, canView });
  for (const key of ['format', 'version', 'name', 'title', 'source', 'kinds', 'root']) {
    if (JSON.stringify(parsed[key]) !== JSON.stringify(preparationLayout[key])) throw new TypeError('Invalid preparation layout');
  }
  for (const key of ['page', ...fixed, 'preparation']) {
    if (JSON.stringify(parsed.elements[key]) !== JSON.stringify(preparationLayout.elements[key])) throw new TypeError('Invalid preparation shell');
  }
  if (Object.keys(parsed.elements).length !== Object.keys(preparationLayout.elements).length) throw new TypeError('Invalid preparation completeness');
  for (const section of preparationSections) {
    const node = parsed.elements[`section-${section.id}`], slots = preparationSlots.filter(slot => slot.section === section.id);
    if (!node || node.type !== 'boring/stack' || node.children.length !== slots.length + 1 || node.children[0] !== `heading-${section.id}`) throw new TypeError('Invalid preparation hierarchy');
    const order = node.children.slice(1);
    if (slots.some(slot => !order.includes(slot.itemId)) || section.id === 'recent-history' && order.some((id, index) => id !== slots[index].itemId)) throw new TypeError('Invalid preparation order');
    for (const id of [`heading-${section.id}`, ...slots.map(slot => slot.itemId)]) {
      if (JSON.stringify(parsed.elements[id]) !== JSON.stringify(preparationLayout.elements[id])) throw new TypeError('Invalid preparation cell');
    }
  }
  return parsed;
}
const definition = {
  name: 'preparation', intents: { preparation: 'Arrange the registered preparation cards. Include every card once. Prefer cards requiring attention.' },
  kinds: [...new Set(preparationSlots.map(slot => slot.kind))].map(kind => ({ kind: `preparation/${kind}`, description: `Registered ${kind} card`,
    metadata: { section: preparationSections.map(section => section.id), attention: ['routine', 'acute', 'today'], target: ['unknown', 'within', 'above'], review: ['unknown', 'due', 'current'] } })),
};
function project(descriptor, base, canView) {
  const refs = [];
  const visit = id => {
    const node = descriptor.elements[id];
    if (node.type === 'boring/cell') refs.push(node.props.ref);
    node.children.forEach(visit);
  };
  descriptor.elements.preparation.children.forEach(visit);
  if (refs.length !== preparationSlots.length || new Set(refs).size !== refs.length || preparationSlots.some(slot => !refs.includes(slot.ref))) return null;
  const gap = descriptor.elements[descriptor.elements.preparation.children[0]]?.props.gap ?? 'medium';
  return validatePreparationLayout({ ...base, elements: { ...base.elements, ...groups(refs, gap) } }, canView);
}
export async function* composePreparation({ descriptor, document, trigger = 'request', canView, evaluate, signal }) {
  let base, candidates;
  try { base = validatePreparationLayout(descriptor, canView); candidates = preparationMetadata(document); }
  catch { throw new TypeError('Preparation input unavailable'); }
  for await (const event of composeExperienceRegion({ descriptor: base, region: 'preparation', trigger, definition,
    candidates, intent: 'preparation', cells: preparationCells, canView, evaluate, signal,
    limits: { maxElements: 32, maxDepth: 6, maxEvaluations: 24 } })) {
    if (event.kind === 'default') { yield event; continue; }
    const projected = project(event.descriptor, base, canView);
    if (projected) yield { ...event, descriptor: projected };
    else if (event.kind === 'final') yield { compositionId: event.compositionId, sequence: event.sequence, kind: 'default', descriptor: base, reason: 'unavailable' };
  }
}
export async function fakePreparationEvaluator({ questions }) {
  return { answers: Object.fromEntries(Object.entries(questions).map(([name, question]) => {
    const choices = Object.keys(question.criteria);
    const choice = name === 'root' && choices.includes('layout_stack') ? 'layout_stack'
      : name.startsWith('order_node_') ? String(choices.length + 1 - Number(name.slice(11)))
      : choices.find(key => key.startsWith('use:')) ?? choices[0];
    if (!choice) throw new TypeError('No fictional composition choice');
    return [name, { choice }];
  })) };
}
