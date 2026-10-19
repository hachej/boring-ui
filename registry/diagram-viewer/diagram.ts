/*
 * The diagram format: boxes and arrows an agent writes as `<name>.diagram.json` (a workflow, a flow between screens, the states of a case).
 * Plain data drawn by `DiagramView`: nothing in it is built or runs. It is a superset of a maquette's `workflow` (`states` and `transitions`
 * are aliases of `nodes` and `edges`), so a maquette hands its workflow to the same reader. Documented in registry/README.md ("Diagram viewer").
 * Model output is untrusted: `parseDiagram` keeps what it understands, bounds every list and string, and never throws.
 */

/** The format version this viewer writes and reads. A file without `version` is read as version 1. */
export const DIAGRAM_FORMAT_VERSION = 1;

/** A diagram file as written in format v1. */
export interface DiagramFileV1 {
  /** Absent means 1. */
  readonly version?: 1;
  readonly title?: string;
  /** The boxes, in reading order; the first is where the flow starts. A bare string is a node whose label is its id. `states` is an alias. */
  readonly nodes: readonly ({ readonly id: string; readonly label?: string; readonly group?: string } | string)[];
  /** The arrows between nodes (`transitions` is an alias; `on` is an alias of `label`). `by`: who acts. */
  readonly edges?: readonly { readonly from: string; readonly to: string; readonly label?: string; readonly on?: string; readonly by?: string }[];
  /** Named groups a node can belong to (its `group`); a group named by a node but not listed here is named by its id. */
  readonly groups?: readonly ({ readonly id: string; readonly label?: string } | string)[];
  /** Node ids of one path through the diagram, drawn stronger with the arrows between consecutive nodes. */
  readonly path?: readonly string[];
  /** One short paragraph under the diagram. */
  readonly note?: string;
}

export interface DiagramNode { readonly id: string; readonly label: string; readonly group?: string | undefined }
export interface DiagramEdge { readonly from: string; readonly to: string; readonly label: string; readonly by: string }
export interface DiagramGroup { readonly id: string; readonly label: string }
/** A diagram ready to draw: every field read, bounded and defaulted; edges and the path only name known nodes. */
export interface Diagram {
  readonly title: string;
  readonly nodes: readonly DiagramNode[];
  readonly edges: readonly DiagramEdge[];
  readonly groups: readonly DiagramGroup[];
  readonly path: readonly string[];
  readonly note: string;
}

/**
 * The outcome of reading a file. `version` is the file's declared version (1 when absent); a version above `DIAGRAM_FORMAT_VERSION`
 * is read as v1, best effort. `invalid` is not JSON (`json`) or has no node to draw (`shape`).
 */
export type DiagramParse =
  | { readonly kind: 'ok'; readonly diagram: Diagram; readonly version: number }
  | { readonly kind: 'invalid'; readonly reason: 'json' | 'shape'; readonly version: number | undefined };

const str = (value: unknown, max = 400): string => typeof value === 'string' ? value.slice(0, max) : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
const arr = (value: unknown, max: number): readonly unknown[] => Array.isArray(value) ? value.slice(0, max) : [];
const obj = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Reads a diagram (its JSON text, or an already parsed value such as a maquette's `workflow`). Never throws. */
export function parseDiagram(input: unknown): DiagramParse {
  let raw: unknown = input;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { return { kind: 'invalid', reason: 'json', version: undefined }; }
  }
  const spec = obj(raw);
  const declared = spec['version'];
  const version = declared === undefined ? 1 : typeof declared === 'number' && Number.isSafeInteger(declared) && declared >= 1 ? declared : undefined;
  if (version === undefined) return { kind: 'invalid', reason: 'shape', version: undefined };
  const seen = new Set<string>();
  const nodes = arr(spec['nodes'] ?? spec['states'], 40).map((value): DiagramNode | null => {
    const node = obj(value), id = str(node['id'], 60) || str(value, 60);
    if (!id || seen.has(id)) return null;
    seen.add(id);
    const group = str(node['group'], 60);
    return { id, label: str(node['label'], 80) || id, ...(group ? { group } : {}) };
  }).filter((node): node is DiagramNode => node !== null);
  if (!nodes.length) return { kind: 'invalid', reason: 'shape', version };
  const edges = arr(spec['edges'] ?? spec['transitions'], 80).map((value): DiagramEdge => {
    const edge = obj(value);
    return { from: str(edge['from'], 60), to: str(edge['to'], 60), label: str(edge['label'] ?? edge['on'], 80), by: str(edge['by'], 40) };
  }).filter(edge => seen.has(edge.from) && seen.has(edge.to));
  const listed = arr(spec['groups'], 12).map((value): DiagramGroup | null => {
    const group = obj(value), id = str(group['id'], 60) || str(value, 60);
    return id ? { id, label: str(group['label'], 80) || id } : null;
  }).filter((group): group is DiagramGroup => group !== null);
  const named = [...new Set(nodes.flatMap(node => node.group ? [node.group] : []))].filter(id => !listed.some(group => group.id === id)).map(id => ({ id, label: id }));
  return { kind: 'ok', version, diagram: {
    title: str(spec['title'], 120), nodes, edges, groups: [...listed, ...named],
    path: arr(spec['path'], 20).map(id => str(id, 60)).filter(id => seen.has(id)),
    note: str(spec['note'], 600),
  } };
}

/** True for a path the built-in diagram kind draws: a `.diagram.json` file. */
export const isDiagramPath = (path: string): boolean => /\.diagram\.json$/i.test(path);
