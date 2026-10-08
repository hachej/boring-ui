import { z } from 'zod';
import { composeExperience, validateExperience } from './experience-compose.js';
import type { ExperienceAccess, ExperienceCompositionOptions, ExperienceCompositionSnapshot, ExperienceDescriptor } from './experience-compose.js';
import { compositionCandidate, compositionDefinition, compositionLimits, compositionId as newCompositionId } from './experience-composition-schema.js';
import { experienceRegion } from './experience-region-tree.js';
import { layoutProps } from './experience-catalog.js';

export type ExperienceRegionTrigger = 'open' | 'phase' | 'request';
export interface ExperienceRegionCompositionOptions extends Omit<ExperienceCompositionOptions, 'fallback' | 'layouts'> {
  readonly descriptor: unknown;
  readonly region: string;
  readonly trigger: ExperienceRegionTrigger;
}

function prepareRegion(base: ExperienceDescriptor, options: ExperienceRegionCompositionOptions, access: ExperienceAccess) {
  const region = experienceRegion(base, options.region);
  if (!region.props.regenerate.includes(options.trigger)) throw new TypeError('Region trigger is not enabled');
  const prompt = region.props.prompt;
  if (prompt !== undefined && prompt !== options.intent && prompt !== options.definition.intents[options.intent]) throw new TypeError('Region prompt is not a registered intent');
  const constraints = region.path.flatMap(id => {
    const node = base.elements[id];
    return node?.type === 'boring/generated' ? [experienceRegion(base, String(node.props.region))] : [];
  });
  const allowedKind = (kind: string) => Object.hasOwn(base.kinds, kind) && constraints.every(item => item.props.kinds === undefined || item.props.kinds.includes(kind));
  const used = new Map<string, number>();
  for (const [id, node] of Object.entries(base.elements)) if (!region.descendants.has(id) && node.type === 'boring/cell') {
    const { ref } = layoutProps['boring/cell'].parse(node.props);
    used.set(ref, (used.get(ref) ?? 0) + 1);
  }
  const cells = access.cells.flatMap(cell => {
    const remaining = (cell.maxUses ?? 1) - (used.get(cell.ref) ?? 0);
    return remaining > 0 && allowedKind('boring/cell') && allowedKind(cell.kind)
      && constraints.every(item => item.props.candidates.includes(cell.ref) || item.props.candidates.includes(cell.kind))
      ? [{ ...cell, maxUses: remaining }] : [];
  });
  const candidates = options.candidates.filter(candidate => cells.some(cell => cell.ref === candidate.ref));
  if (candidates.length === 0) throw new TypeError('Region has no eligible candidates');
  const layouts = (['boring/stack', 'boring/row', 'boring/grid'] as const).filter(allowedKind);
  const outside = Object.keys(base.elements).length - region.descendants.size;
  const maxElements = Math.min(options.limits.maxElements, 200 - outside,
    ...constraints.map(item => item.props.maxElements - (item.descendants.size - region.descendants.size)));
  if (maxElements < 1) throw new TypeError('Region has no available element budget');
  const maxDepth = Math.min(options.limits.maxDepth, 25 - region.path.length);
  if (maxDepth < 1) throw new TypeError('Region has no available depth');
  const limits = { ...options.limits, maxElements, maxDepth };
  return { region, options: { ...options, cells, candidates, layouts, limits, fallback: null } };
}

function mergeRegion(base: ExperienceDescriptor, prepared: ReturnType<typeof prepareRegion>, subtree: ExperienceDescriptor, prefix: string, access: ExperienceAccess): ExperienceDescriptor {
  const elements = new Map(Object.entries(base.elements).filter(([id]) => !prepared.region.descendants.has(id)));
  const names = new Map(Object.keys(subtree.elements).map((id, index) => [id, `${prefix}_${index}`]));
  const renamed = (id: string): string => {
    const name = names.get(id);
    if (!name || Object.hasOwn(base.elements, name)) throw new TypeError('Invalid region element identity');
    return name;
  };
  for (const [kind, version] of Object.entries(subtree.kinds)) if (base.kinds[kind] !== version) throw new TypeError('Undeclared region kind');
  for (const [id, node] of Object.entries(subtree.elements)) elements.set(renamed(id), { ...node, children: node.children.map(renamed) });
  elements.set(prepared.region.id, { ...prepared.region.node, children: [renamed(subtree.root)] });
  return validateExperience({ ...base, elements: Object.fromEntries(elements) }, access);
}

export async function* composeExperienceRegion(options: ExperienceRegionCompositionOptions): AsyncGenerator<ExperienceCompositionSnapshot> {
  const compositionId = newCompositionId(), prefix = `r_${compositionId}`;
  const { canView, evaluate, signal, intent, region, trigger } = options;
  const access: ExperienceAccess = { cells: options.cells.map(cell => ({ ...cell })), canView };
  let base: ExperienceDescriptor | undefined, prepared: ReturnType<typeof prepareRegion> | undefined;
  let sequence = 0;
  const captured = (() => {
    try {
      const parsed = compositionDefinition.parse(options.definition);
      const definition = { name: parsed.name, intents: parsed.intents, kinds: parsed.kinds, ...(parsed.title === undefined ? {} : { title: parsed.title }) };
      const candidates = z.array(compositionCandidate).max(128).parse(options.candidates).map(({ ref, metadata, root, resource }) => ({ ref, metadata, ...(root === undefined ? {} : { root }), ...(resource === undefined ? {} : { resource }) }));
      return { definition, candidates, limits: compositionLimits.parse(options.limits) };
    } catch { return null; }
  })();
  try {
    base = validateExperience(options.descriptor, access);
    signal.throwIfAborted();
    if (captured) prepared = prepareRegion(base, { ...access, ...captured, evaluate, signal, intent, region, trigger, descriptor: base }, access);
  } catch { prepared = undefined; }
  const fallback = (): ExperienceDescriptor | null => {
    try { return base === undefined ? null : validateExperience(base, access); } catch { return null; }
  };
  const snapshot = (reason: 'pending' | 'unavailable' | 'cancelled' | 'limit'): ExperienceCompositionSnapshot => Object.freeze({ compositionId, sequence: sequence++, kind: 'default', descriptor: fallback(), reason });
  yield snapshot('pending');
  if (!base || !prepared) { yield snapshot(signal.aborted ? 'cancelled' : 'unavailable'); return; }
  try {
    for await (const event of composeExperience({ ...prepared.options, evaluate: request => {
      if (!fallback()) throw new TypeError('Region default is no longer available');
      signal.throwIfAborted();
      return evaluate(request);
    } })) {
      signal.throwIfAborted();
      if (event.kind === 'default') {
        if (event.reason !== 'pending') yield snapshot(event.reason);
        continue;
      }
      const descriptor = mergeRegion(base, prepared, event.descriptor, prefix, access);
      signal.throwIfAborted();
      yield Object.freeze({ compositionId, sequence: sequence++, kind: event.kind, descriptor });
    }
  } catch { yield snapshot(signal.aborted ? 'cancelled' : 'unavailable'); }
}
