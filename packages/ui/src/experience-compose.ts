import { z } from 'zod';
import { experimental_composeSpec } from '@json-render/core';
import { compositionDefinition, compositionCandidate, compositionLimits, compositionId as newCompositionId } from './experience-composition-schema.js';
import type { Experimental_CompositionCandidate, Experimental_CompositionEvaluator, Spec } from '@json-render/core';
import { experienceCatalog, layoutProps, experienceIdentifier } from './experience-catalog.js';

const id = experienceIdentifier;
const element = z.strictObject({ type: z.enum(['boring/stack', 'boring/row', 'boring/grid', 'boring/cell', 'boring/generated']), props: z.record(z.string(), z.unknown()), children: z.array(id).max(200).default([]) });
const descriptor = z.strictObject({
  format: z.literal('boring.experience'), version: z.literal(1), name: id,
  title: z.string().max(120).optional(), source: z.enum(['fixed', 'derived', 'generated']),
  kinds: z.record(z.string().max(160), z.number().int().min(1).max(10000)),
  root: id, elements: z.record(id, element),
});

export type ExperienceDescriptor = z.infer<typeof descriptor>;
export interface ExperienceCell {
  readonly ref: string;
  readonly kind: string;
  readonly version: number;
  readonly maxUses?: number;
}
export interface ExperienceAccess {
  readonly cells: readonly ExperienceCell[];
  readonly canView: (ref: string) => boolean;
}

export function validateExperience(value: unknown, access: ExperienceAccess): ExperienceDescriptor {
  const parsed = descriptor.parse(value);
  const names = Object.keys(parsed.elements);
  if (names.length === 0 || names.length > 200 || Object.keys(parsed.kinds).length > 200) throw new TypeError('Experience exceeds its element or kind limits');
  for (const node of Object.values(parsed.elements)) node.props = layoutProps[node.type].parse(node.props);
  const cells = new Map<string, ExperienceCell>();
  const installed = new Map<string, number>(Object.keys(layoutProps).map(kind => [kind, 1]));
  for (const cell of access.cells) {
    layoutProps['boring/cell'].parse({ ref: cell.ref });
    if (cells.has(cell.ref) || !/^[a-zA-Z0-9_/-]{1,160}$/.test(cell.kind) || cell.kind.startsWith('boring/') || !Number.isSafeInteger(cell.version) || cell.version < 1
      || cell.maxUses !== undefined && (!Number.isSafeInteger(cell.maxUses) || cell.maxUses < 1)) throw new TypeError('Invalid cell registration');
    const version = installed.get(cell.kind);
    if (version !== undefined && version !== cell.version) throw new TypeError('Conflicting installed kind versions');
    cells.set(cell.ref, cell); installed.set(cell.kind, cell.version);
  }
  for (const [kind, version] of Object.entries(parsed.kinds)) if (installed.get(kind) !== version) throw new TypeError('Unknown or incompatible experience kind');
  const seen = new Set<string>(), uses = new Map<string, number>(), regions = new Set<string>();
  type Region = z.infer<typeof layoutProps['boring/generated']>;
  const visit = (key: string, depth: number, ancestors: readonly Region[] = []): void => {
    if (depth > 24 || seen.has(key)) throw new TypeError('Experience must be a bounded tree');
    const current = parsed.elements[key];
    if (!current || parsed.kinds[current.type] !== 1) throw new TypeError('Missing element or kind version');
    seen.add(key);
    for (const region of ancestors) if (region.kinds && !region.kinds.includes(current.type)) throw new TypeError('Region kind is not allowed');
    let childrenRegions = ancestors;
    const before = seen.size;
    if (current.type === 'boring/generated') {
      const region = layoutProps['boring/generated'].parse(current.props);
      if (regions.has(region.region) || new Set(region.candidates).size !== region.candidates.length || new Set(region.regenerate).size !== region.regenerate.length || region.kinds && new Set(region.kinds).size !== region.kinds.length) throw new TypeError('Invalid region registration');
      if (region.kinds?.some(kind => !Object.hasOwn(parsed.kinds, kind))) throw new TypeError('Undeclared region kind');
      regions.add(region.region); childrenRegions = [...ancestors, region];
    }
    if (current.type === 'boring/cell') {
      const { ref } = layoutProps['boring/cell'].parse(current.props);
      const cell = cells.get(ref);
      if (!cell || parsed.kinds[cell.kind] !== cell.version || access.canView(ref) !== true) throw new TypeError('Cell unavailable');
      for (const region of ancestors) if (!region.candidates.includes(ref) && !region.candidates.includes(cell.kind)
        || region.kinds && !region.kinds.includes(cell.kind)) throw new TypeError('Region cell is not allowed');
      const count = (uses.get(ref) ?? 0) + 1; uses.set(ref, count);
      if (current.children.length || count > (cell.maxUses ?? 1)) throw new TypeError('Cell placement exceeds its registration');
    }
    for (const child of current.children) visit(child, depth + 1, childrenRegions);
    if (current.type === 'boring/generated' && seen.size - before > layoutProps['boring/generated'].parse(current.props).maxElements) throw new TypeError('Region exceeds its element budget');
    for (const value of Object.values(current.props)) if (Array.isArray(value)) Object.freeze(value);
    Object.freeze(current.props); Object.freeze(current.children); Object.freeze(current);
  };
  visit(parsed.root, 0);
  if (seen.size !== names.length || !experienceCatalog.validate({ root: parsed.root, elements: parsed.elements }).success) throw new TypeError('Invalid experience structure');
  Object.freeze(parsed.kinds); Object.freeze(parsed.elements); return Object.freeze(parsed);
}

export interface ExperienceCompositionKind {
  readonly kind: string;
  readonly description: string;
  readonly metadata: Readonly<Record<string, readonly string[]>>;
}
export interface ExperienceCompositionDefinition {
  readonly name: string;
  readonly title?: string;
  readonly intents: Readonly<Record<string, string>>;
  readonly kinds: readonly ExperienceCompositionKind[];
}
export interface ExperienceCompositionCandidate {
  readonly ref: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly root?: boolean;
  readonly resource?: string;
}
export interface ExperienceCompositionOptions extends ExperienceAccess {
  readonly definition: ExperienceCompositionDefinition;
  readonly candidates: readonly ExperienceCompositionCandidate[];
  readonly intent: string;
  readonly layouts?: readonly ('boring/stack' | 'boring/row' | 'boring/grid')[];
  readonly fallback: unknown;
  readonly evaluate: Experimental_CompositionEvaluator;
  readonly signal: AbortSignal;
  readonly limits: { readonly maxElements: number; readonly maxDepth: number; readonly maxEvaluations: number };
}
export type ExperienceCompositionSnapshot = { readonly compositionId: string; readonly sequence: number } & (
  { readonly kind: 'partial' | 'final'; readonly descriptor: ExperienceDescriptor }
  | { readonly kind: 'default'; readonly descriptor: ExperienceDescriptor | null; readonly reason: 'pending' | 'unavailable' | 'cancelled' | 'limit' }
);

function prepareComposition(options: ExperienceCompositionOptions, access: ExperienceAccess) {
  const definition = compositionDefinition.parse(options.definition), limits = compositionLimits.parse(options.limits);
  if (!Object.hasOwn(definition.intents, options.intent) || options.candidates.length > 128) throw new TypeError('Invalid composition input');
  const prompt = definition.intents[options.intent];
  if (!prompt) throw new TypeError('Composition intent is required');
  const inputs = z.array(compositionCandidate).max(128).parse(options.candidates);
  const installed = new Map(access.cells.map(cell => [cell.ref, cell]));
  const metadata = new Map(definition.kinds.map(kind => [kind.kind, kind]));
  if (metadata.size !== definition.kinds.length) throw new TypeError('Duplicate composition kind');
  const layouts = z.array(z.enum(['boring/stack', 'boring/row', 'boring/grid'])).max(3).parse(options.layouts ?? ['boring/stack', 'boring/row', 'boring/grid']);
  if (new Set(layouts).size !== layouts.length) throw new TypeError('Duplicate layout kind');
  const markers = new Map<string, ExperienceCell>(), resources = new Map<string, string>(), refs = new Set<string>();
  const candidates: Experimental_CompositionCandidate[] = [
    { id: 'layout_stack', description: 'Vertical layout', element: { type: 'boring/stack', props: { gap: 'medium' } }, maxUses: limits.maxElements },
    { id: 'layout_row', description: 'Wrapping horizontal layout', element: { type: 'boring/row', props: { gap: 'medium' } }, maxUses: limits.maxElements },
    { id: 'layout_grid', description: 'Two-column layout', element: { type: 'boring/grid', props: { gap: 'medium', columns: 2 } }, maxUses: limits.maxElements },
  ];
  candidates.splice(0, candidates.length, ...candidates.filter(candidate => layouts.some(kind => kind === candidate.element.type)));
  for (const [index, candidate] of inputs.entries()) {
    const cell = installed.get(candidate.ref);
    const registration = cell && metadata.get(cell.kind);
    if (!cell || !registration || refs.has(cell.ref) || access.canView(cell.ref) !== true) throw new TypeError('Composition cell unavailable');
    refs.add(cell.ref);
    const flags: string[] = [];
    for (const [key, value] of Object.entries(candidate.metadata)) {
      if (!Object.hasOwn(registration.metadata, key) || !registration.metadata[key]?.includes(value)) throw new TypeError('Unregistered composition metadata');
      flags.push(`${key}: ${value}`);
    }
    const marker = `composition/c${index}`;
    markers.set(marker, cell);
    let resource: string | undefined;
    if (candidate.resource !== undefined) {
      resource = resources.get(candidate.resource) ?? `resource_${resources.size}`;
      resources.set(candidate.resource, resource);
    }
    candidates.push({ id: `candidate_${index}`, description: [registration.description, ...flags].join('; '),
      element: { type: 'boring/cell', props: { ref: marker } }, root: candidate.root ?? false,
      maxUses: Math.min(cell.maxUses ?? 1, limits.maxElements), ...(resource === undefined ? {} : { resource }),
    });
  }
  if (!candidates.some(candidate => candidate.root !== false)) throw new TypeError('Composition has no root candidate');
  validateExperience({ format: 'boring.experience', version: 1, name: definition.name, source: 'generated',
    kinds: { 'boring/stack': 1 }, root: 'root', elements: { root: { type: 'boring/stack', props: {}, children: [] } },
  }, access);
  return { definition, limits, prompt, candidates, markers, access };
}

function rebindComposition(spec: Spec, prepared: ReturnType<typeof prepareComposition>): ExperienceDescriptor {
  const kinds = new Map<string, number>(), elements = new Map<string, ExperienceDescriptor['elements'][string]>();
  for (const [key, value] of Object.entries(spec.elements)) {
    const parsed = element.parse(value);
    kinds.set(parsed.type, 1);
    if (parsed.type === 'boring/cell') {
      const marker = layoutProps['boring/cell'].parse(parsed.props).ref, cell = prepared.markers.get(marker);
      if (!cell) throw new TypeError('Unknown composition marker');
      kinds.set(cell.kind, cell.version);
      parsed.props = { ref: cell.ref };
    }
    elements.set(key, parsed);
  }
  return validateExperience({ format: 'boring.experience', version: 1, name: prepared.definition.name,
    ...(prepared.definition.title === undefined ? {} : { title: prepared.definition.title }),
    source: 'generated', kinds: Object.fromEntries(kinds), root: spec.root, elements: Object.fromEntries(elements),
  }, prepared.access);
}

export async function* composeExperience(options: ExperienceCompositionOptions): AsyncGenerator<ExperienceCompositionSnapshot> {
  const compositionId = newCompositionId();
  const { signal, evaluate, canView } = options;
  const access: ExperienceAccess = { cells: options.cells.map(cell => ({ ...cell })), canView };
  const initial = descriptor.safeParse(options.fallback);
  let sequence = 0;
  const fallback = (): ExperienceDescriptor | null => {
    try { return initial.success ? validateExperience(initial.data, access) : null; }
    catch { return null; }
  };
  let prepared: ReturnType<typeof prepareComposition> | undefined;
  try { signal.throwIfAborted(); prepared = prepareComposition(options, access); }
  catch { prepared = undefined; }
  yield Object.freeze({ compositionId, sequence: sequence++, kind: 'default', descriptor: fallback(), reason: 'pending' });
  if (!prepared) {
    yield Object.freeze({ compositionId, sequence: sequence++, kind: 'default', descriptor: fallback(), reason: signal.aborted ? 'cancelled' : 'unavailable' });
    return;
  }
  try {
    signal.throwIfAborted();
    const evaluateVisible: Experimental_CompositionEvaluator = request => {
      signal.throwIfAborted();
      for (const cell of prepared.markers.values()) if (canView(cell.ref) !== true) throw new TypeError('Composition cell unavailable');
      signal.throwIfAborted();
      return evaluate(request);
    };
    for await (const event of experimental_composeSpec({ catalog: experienceCatalog, candidates: prepared.candidates, prompt: prepared.prompt,
      evaluate: evaluateVisible, signal, maxElements: prepared.limits.maxElements,
      maxDepth: prepared.limits.maxDepth, maxSteps: prepared.limits.maxEvaluations,
    })) {
      signal.throwIfAborted();
      if (event.type === 'complete' && (event.stopReason !== 'finish' || !event.spec)) {
        yield Object.freeze({ compositionId, sequence: sequence++, kind: 'default', descriptor: fallback(), reason: event.stopReason === 'limit' ? 'limit' : 'unavailable' });
        return;
      }
      if (!event.spec) throw new TypeError('Missing composed descriptor');
      const descriptor = rebindComposition(event.spec, prepared);
      signal.throwIfAborted();
      yield Object.freeze({ compositionId, sequence: sequence++, kind: event.type === 'complete' ? 'final' : 'partial', descriptor });
    }
  } catch {
    yield Object.freeze({ compositionId, sequence: sequence++, kind: 'default', descriptor: fallback(), reason: signal.aborted ? 'cancelled' : 'unavailable' });
  }
}
