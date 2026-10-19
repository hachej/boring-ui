/*
 * The maquette format: a lo-fi mock-up a PM agent writes as `<name>.maquette.json` (screens built from a small catalogue of blocks, goto
 * links between them, an optional workflow and its cases). Plain data drawn by `MaquetteViewer`: nothing in it is built or runs.
 * The format is documented in registry/README.md ("Maquette viewer"). Model output is untrusted: `parseMaquette` reads it defensively,
 * keeps what it understands, bounds every list and string, and never throws. The workflow is a diagram (`parseDiagram` of the
 * diagram-viewer item reads it), written inline or linked as a `*.diagram.json` path.
 */
import { parseDiagram } from '../diagram-viewer/diagram';
import type { Diagram, DiagramEdge, DiagramNode } from '../diagram-viewer/diagram';

/** The format version this viewer writes and reads. A file without `version` is read as version 1. */
export const MAQUETTE_FORMAT_VERSION = 1;

/** A block as written in format v1. `type` picks the drawing; the other fields are read by the types that use them. */
export interface MaquetteBlockV1 {
  readonly type: string;
  /** A stable name for the block, used when someone comments on it; its position (`2`, `2.0` for a child) otherwise. */
  readonly id?: string;
  /** The block's words (`text` and `title` are accepted as aliases). */
  readonly label?: string;
  readonly text?: string;
  readonly title?: string;
  /** The screen id a click on this block opens (buttons, links, list items, placeholders). */
  readonly goto?: string;
  /** A primary button. */
  readonly primary?: boolean;
  /** Nested blocks of `card`, `row`, `stack` (`blocks` is accepted as an alias). */
  readonly children?: readonly MaquetteBlockV1[];
  readonly blocks?: readonly MaquetteBlockV1[];
  /** `list` rows, or `select` options. */
  readonly items?: readonly string[];
  readonly options?: readonly string[];
  /** `table` header and rows. */
  readonly columns?: readonly string[];
  readonly rows?: readonly (readonly string[])[];
  /** `chat` messages; `from: "user"` (or `person`, `me`, `moi`) is the person's side. */
  readonly messages?: readonly { readonly from?: string; readonly text?: string }[];
  /** `document` lines. */
  readonly lines?: readonly string[];
  /** `input`, `select` and `chat` hint and value. */
  readonly placeholder?: string;
  readonly value?: string;
  /** A placeholder's note under its name. */
  readonly note?: string;
}

/** A maquette file as written in format v1. */
export interface MaquetteFileV1 {
  /** Absent means 1. */
  readonly version?: 1;
  readonly title?: string;
  /** The screen id play mode opens first; the first screen otherwise. */
  readonly start?: string;
  /** The frame screens are drawn in: a light phone or desktop frame. Absent: the panel's width. */
  readonly device?: 'phone' | 'desktop';
  /** Screens by id, in the order the stepper walks them. `note` says why the screen exists and what the person does there. */
  readonly screens: Readonly<Record<string, { readonly title?: string; readonly note?: string; readonly blocks: readonly MaquetteBlockV1[] }>>;
  /** The app's navigation bar, shown above every screen. */
  readonly nav?: readonly { readonly label: string; readonly goto: string }[];
  /**
   * The workflow understood: states and the transitions between them (`on` is accepted as an alias of `label`). It is a diagram (format v1
   * of `*.diagram.json`: `nodes`/`edges` are the same as `states`/`transitions`, plus optional `groups`, `path` and `note`), or the path of a
   * `*.diagram.json` file, relative to the maquette's folder.
   */
  readonly workflow?: string | {
    readonly states?: readonly ({ readonly id: string; readonly label?: string; readonly group?: string } | string)[];
    readonly transitions?: readonly { readonly from: string; readonly to: string; readonly label?: string; readonly on?: string; readonly by?: string }[];
    readonly nodes?: readonly ({ readonly id: string; readonly label?: string; readonly group?: string } | string)[];
    readonly edges?: readonly { readonly from: string; readonly to: string; readonly label?: string; readonly on?: string; readonly by?: string }[];
    readonly groups?: readonly ({ readonly id: string; readonly label?: string } | string)[];
    readonly path?: readonly string[];
    readonly note?: string;
  };
  /**
   * Cases. `steps` makes a guided tour: its screens in order, each with a caption ("Camille receives the invoice and approves it").
   * `path` (workflow state ids) highlights the case in the workflow diagram. A case may carry both.
   */
  readonly cases?: readonly { readonly name: string; readonly steps?: readonly { readonly screen: string; readonly caption?: string }[]; readonly path?: readonly string[] }[];
}

/** A block as the viewer draws it: every field read, bounded and defaulted. */
export interface MaquetteBlock {
  readonly type: string;
  /** The block's `id`, or its position among the screen's blocks (`2`, `2.0` for the first child of the third block). */
  readonly id: string;
  readonly label: string;
  readonly goto: string | undefined;
  readonly primary: boolean;
  readonly children: readonly MaquetteBlock[];
  readonly items: readonly string[];
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
  readonly messages: readonly { readonly mine: boolean; readonly text: string }[];
  readonly lines: readonly string[];
  readonly placeholder: string;
  readonly value: string;
  readonly note: string;
}
export interface MaquetteScreen { readonly id: string; readonly title: string; readonly note: string; readonly blocks: readonly MaquetteBlock[] }
export type MaquetteState = DiagramNode;
export type MaquetteTransition = DiagramEdge;
export interface MaquetteWorkflow { readonly states: readonly MaquetteState[]; readonly transitions: readonly MaquetteTransition[] }
export interface MaquetteCase { readonly name: string; readonly steps: readonly { readonly screen: string; readonly caption: string }[]; readonly path: readonly string[] }
/** A maquette ready to draw. */
export interface Maquette {
  readonly title: string;
  readonly start: string;
  readonly device: 'phone' | 'desktop' | undefined;
  readonly screens: readonly MaquetteScreen[];
  readonly nav: readonly { readonly label: string; readonly goto: string }[];
  readonly workflow: MaquetteWorkflow | null;
  /** The inline workflow as a diagram (with its groups, path and note), for `DiagramView`. */
  readonly diagram: Diagram | null;
  /** The `*.diagram.json` path the workflow links to, as written (relative to the maquette's folder). */
  readonly diagramLink: string | undefined;
  readonly cases: readonly MaquetteCase[];
}

/**
 * The outcome of reading a file. `version` is the file's declared version (1 when absent); a version above `MAQUETTE_FORMAT_VERSION`
 * is read as v1, best effort. `invalid` is not JSON (`json`) or has no screen to show (`shape`).
 */
export type MaquetteParse =
  | { readonly kind: 'ok'; readonly maquette: Maquette; readonly version: number }
  | { readonly kind: 'invalid'; readonly reason: 'json' | 'shape'; readonly version: number | undefined };

const MINE = new Set(['user', 'person', 'me', 'moi']);
const str = (value: unknown, max = 400): string => typeof value === 'string' ? value.slice(0, max) : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
const arr = (value: unknown, max = 60): readonly unknown[] => Array.isArray(value) ? value.slice(0, max) : [];
const obj = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const strings = (value: unknown, max: number, length = 120): string[] => arr(value, max).map(item => str(item, length));

function block(value: unknown, depth: number, at: string): MaquetteBlock | null {
  const raw = obj(value);
  const type = str(raw['type'], 40).trim().toLowerCase();
  if (!type || depth > 6) return null;
  const goto = str(raw['goto'], 60);
  return {
    type, id: str(raw['id'], 60).trim() || at, label: str(raw['label'] ?? raw['text'] ?? raw['title']), goto: goto || undefined, primary: raw['primary'] === true,
    children: arr(raw['children'] ?? raw['blocks'], 40).map((child, index) => block(child, depth + 1, `${at}.${index}`)).filter((child): child is MaquetteBlock => child !== null),
    items: strings(raw['items'] ?? raw['options'], 12),
    columns: strings(raw['columns'], 8, 40),
    rows: arr(raw['rows'], 12).map(row => strings(row, 8, 80)),
    messages: arr(raw['messages'], 10).map(item => { const message = obj(item); return { mine: MINE.has(str(message['from'], 20).toLowerCase()), text: str(message['text'], 600) }; }).filter(message => message.text),
    lines: strings(raw['lines'], 16, 300),
    placeholder: str(raw['placeholder'], 120), value: str(raw['value'], 120), note: str(raw['note'], 200),
  };
}

/** Reads a maquette (its JSON text or an already parsed value). Never throws. */
export function parseMaquette(input: unknown): MaquetteParse {
  let raw: unknown = input;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { return { kind: 'invalid', reason: 'json', version: undefined }; }
  }
  const spec = obj(raw);
  const declared = spec['version'];
  const version = declared === undefined ? 1 : typeof declared === 'number' && Number.isSafeInteger(declared) && declared >= 1 ? declared : undefined;
  if (version === undefined) return { kind: 'invalid', reason: 'shape', version: undefined };
  const screens = Object.entries(obj(spec['screens'])).slice(0, 30).map(([id, value]): MaquetteScreen => {
    const screen = obj(value);
    return { id: id.slice(0, 60), title: str(screen['title'], 120) || id.slice(0, 60), note: str(screen['note'], 300),
      blocks: arr(screen['blocks'] ?? screen['children']).map((item, index) => block(item, 0, String(index))).filter((item): item is MaquetteBlock => item !== null) };
  });
  if (!screens.length) return { kind: 'invalid', reason: 'shape', version };
  const ids = new Set(screens.map(screen => screen.id));
  const link = typeof spec['workflow'] === 'string' ? str(spec['workflow'], 200).trim() : '';
  const flow = link ? undefined : parseDiagram(obj(spec['workflow']));
  const diagram = flow?.kind === 'ok' ? flow.diagram : null;
  // A linked diagram is read later: its node ids are not known yet, so a case's path is kept as written.
  const known = (id: string) => link ? true : !!diagram?.nodes.some(node => node.id === id);
  const start = str(spec['start'], 60), device = spec['device'];
  return { kind: 'ok', version, maquette: {
    title: str(spec['title'], 120), start: ids.has(start) ? start : screens[0]!.id, device: device === 'phone' || device === 'desktop' ? device : undefined, screens,
    nav: arr(spec['nav'], 8).map(value => { const item = obj(value); return { label: str(item['label'], 40), goto: str(item['goto'], 60) }; }).filter(item => item.label && ids.has(item.goto)),
    workflow: diagram ? { states: diagram.nodes, transitions: diagram.edges } : null, diagram, diagramLink: isDiagramLink(link) ? link : undefined,
    cases: arr(spec['cases'], 10).map((value): MaquetteCase => {
      const item = obj(value);
      const steps = arr(item['steps'], 20).map(step => { const raw = obj(step); return { screen: str(raw['screen'], 60), caption: str(raw['caption'], 300) }; }).filter(step => ids.has(step.screen));
      return { name: str(item['name'], 80), steps, path: strings(item['path'], 20, 60).filter(known) };
    }).filter(item => item.name && (item.steps.length > 0 || item.path.length > 0)),
  } };
}

/** Every screen id a block tree links to, in order, without repeats. */
export function linksOf(blocks: readonly MaquetteBlock[]): string[] {
  const found = new Set<string>();
  const walk = (list: readonly MaquetteBlock[]) => { for (const item of list) { if (item.goto) found.add(item.goto); walk(item.children); } };
  walk(blocks);
  return [...found];
}

/** A workflow link the viewer follows: a relative `*.diagram.json` path (no scheme, no leading slash, no `..`). */
const isDiagramLink = (link: string): boolean => /\.diagram\.json$/i.test(link) && !/^[a-z][a-z0-9+.-]*:|^\/|(^|\/)\.\.(\/|$)/i.test(link);

/** The path of a linked diagram: `link` resolved against the folder of the maquette at `path`. */
export const diagramPathOf = (path: string, link: string): string => `${path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : ''}${link.replace(/^\.\//, '')}`;

/** True for a path the built-in maquette kind draws: a `.maquette.json` file. */
export const isMaquettePath = (path: string): boolean => /\.maquette\.json$/i.test(path);

/** The screen id a URL fragment names (`#screen=<id>`, alone or among other `&`-separated keys), or undefined. */
export function screenFromFragment(fragment: string | undefined): string | undefined {
  if (!fragment) return undefined;
  try { return new URLSearchParams(fragment.replace(/^#/, '')).get('screen') ?? undefined; } catch { return undefined; }
}
