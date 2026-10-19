/*
 * The board format (`board@1`): a PM agent writes `<name>.board.json` to lay out maquette and HTML mock-ups left to right, with arrows for
 * the maquette's goto links and sticky notes beside them. It is plain data that names other workspace files (paths relative to the board's
 * folder); nothing it names is embedded or run here. The board file is the only authority: a canvas is a projection of it, and people's
 * frame moves and notes come back through `applyCanvasEdits`, never as a canvas store. The format is documented in registry/README.md
 * ("Board format"). Model output is untrusted: `parseBoard` is strict and reports every problem as an issue, and never throws.
 */
import { linksOf, parseMaquette } from '../maquette-viewer/maquette';
import type { Maquette } from '../maquette-viewer/maquette';

/** The format this module reads and writes. A higher `board@N` is reported as `newer`, not read. */
export const BOARD_FORMAT = 'board@1';
export const BOARD_FORMAT_VERSION = 1;

export type BoardDevice = 'phone' | 'desktop';

/** One thing on the board: a maquette (one frame per screen), an HTML mock-up (one frame) or a sticky note. */
export type BoardItem =
  | { readonly id: string; readonly maquette: string; readonly title?: string }
  | { readonly id: string; readonly html: string; readonly title?: string; readonly device: BoardDevice; readonly width?: number; readonly height?: number }
  | { readonly id: string; readonly note: string; readonly near?: string };

/** An arrow between two frames (`<item>/<screen>` for a maquette screen, the item id for an HTML frame). */
export interface BoardLink { readonly from: string; readonly to: string; readonly label?: string }
export interface BoardPoint { readonly x: number; readonly y: number }

export interface Board {
  readonly format: typeof BOARD_FORMAT;
  readonly title: string;
  readonly items: readonly BoardItem[];
  readonly links: readonly BoardLink[];
  /** Where people put frames and notes: frame or note id to its top-left corner. An id absent here gets the automatic layout. */
  readonly layout: Readonly<Record<string, BoardPoint>>;
}

/** A problem at a JSON path (`items[2].html`), in words an agent can act on. */
export interface BoardIssue { readonly path: string; readonly message: string }

/**
 * The outcome of reading a board. `newer` is a valid `board@N` with N above this module's version: the host should say so, not guess.
 * `invalid` covers bad JSON, a missing or unknown `format` (unversioned files are invalid), and every shape error.
 */
export type BoardParse =
  | { readonly kind: 'ok'; readonly board: Board }
  | { readonly kind: 'newer'; readonly format: string; readonly version: number }
  | { readonly kind: 'invalid'; readonly issues: readonly BoardIssue[] };

const MAX_ITEMS = 40, MAX_LINKS = 80, MAX_LAYOUT = 200, MAX_NOTE = 1000;
const ITEM_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$/;
/** Frame ids are `<item>/<screen>`, so layout keys may hold one slash. */
const FRAME_ID = /^[A-Za-z0-9][\w./-]{0,119}$/;
const COORDINATE = 1e6;
const FORMAT_LIKE = /^board@(.*)$/;

type Obj = Record<string, unknown>;
const isObject = (value: unknown): value is Obj => value !== null && typeof value === 'object' && !Array.isArray(value);

/** A workspace path relative to the board's folder, ending in `ending`: no scheme, no absolute path, no `..`. */
export function boardPathProblem(value: unknown, ending: '.maquette.json' | '.mockup.html'): string | undefined {
  if (typeof value !== 'string' || !value) return 'must be a non-empty path string';
  if (value.length > 200) return 'path is longer than 200 characters';
  if (/^[a-z]+:/i.test(value) || value.startsWith('/') || value.includes('\\')) return 'must be a relative path inside the board folder';
  if (value.split('/').includes('..')) return 'must not contain ".."';
  if (!value.toLowerCase().endsWith(ending)) return `must end with ${ending}`;
  return undefined;
}

function optionalText(value: unknown, path: string, max: number, issues: BoardIssue[]): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') { issues.push({ path, message: 'must be a string' }); return undefined; }
  if (value.length > max) issues.push({ path, message: `is longer than ${max} characters` });
  return value.slice(0, max);
}

function optionalNumber(value: unknown, path: string, min: number, max: number, issues: BoardIssue[]): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    issues.push({ path, message: `must be a number from ${min} to ${max}` });
    return undefined;
  }
  return value;
}

function unknownFields(value: Obj, allowed: readonly string[], path: string, issues: BoardIssue[]) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) issues.push({ path: path ? `${path}.${key}` : key, message: `unknown field (allowed: ${allowed.join(', ')})` });
}

function readItem(value: unknown, path: string, issues: BoardIssue[]): BoardItem | undefined {
  if (!isObject(value)) { issues.push({ path, message: 'must be an object' }); return undefined; }
  const id = value['id'];
  if (typeof id !== 'string' || !ITEM_ID.test(id)) { issues.push({ path: `${path}.id`, message: 'must be 1 to 60 letters, digits, "-" or "_", starting with a letter or digit' }); return undefined; }
  const kinds = ['maquette', 'html', 'note'].filter(kind => kind in value);
  if (kinds.length !== 1) { issues.push({ path, message: 'needs exactly one of "maquette", "html" or "note"' }); return undefined; }
  const kind = kinds[0];
  const title = optionalText(value['title'], `${path}.title`, 120, issues);
  if (kind === 'maquette') {
    unknownFields(value, ['id', 'maquette', 'title'], path, issues);
    const problem = boardPathProblem(value['maquette'], '.maquette.json');
    if (problem) { issues.push({ path: `${path}.maquette`, message: problem }); return undefined; }
    return { id, maquette: value['maquette'] as string, ...(title ? { title } : {}) };
  }
  if (kind === 'html') {
    unknownFields(value, ['id', 'html', 'title', 'device', 'width', 'height'], path, issues);
    const problem = boardPathProblem(value['html'], '.mockup.html');
    if (problem) { issues.push({ path: `${path}.html`, message: problem }); return undefined; }
    const device = value['device'] === undefined ? 'phone' : value['device'];
    if (device !== 'phone' && device !== 'desktop') { issues.push({ path: `${path}.device`, message: 'must be "phone" or "desktop"' }); return undefined; }
    const width = optionalNumber(value['width'], `${path}.width`, 240, 1600, issues);
    const height = optionalNumber(value['height'], `${path}.height`, 240, 2400, issues);
    return { id, html: value['html'] as string, device, ...(title ? { title } : {}), ...(width !== undefined ? { width } : {}), ...(height !== undefined ? { height } : {}) };
  }
  unknownFields(value, ['id', 'note', 'near'], path, issues);
  const note = value['note'];
  if (typeof note !== 'string' || !note.trim() || note.length > MAX_NOTE) { issues.push({ path: `${path}.note`, message: `must be 1 to ${MAX_NOTE} characters` }); return undefined; }
  const near = value['near'];
  if (near !== undefined && (typeof near !== 'string' || !FRAME_ID.test(near))) { issues.push({ path: `${path}.near`, message: 'must name a frame id, such as "booking/sessions"' }); return undefined; }
  return { id, note, ...(near !== undefined ? { near } : {}) };
}

function readLink(value: unknown, path: string, issues: BoardIssue[]): BoardLink | undefined {
  if (!isObject(value)) { issues.push({ path, message: 'must be an object' }); return undefined; }
  unknownFields(value, ['from', 'to', 'label'], path, issues);
  const from = value['from'], to = value['to'];
  for (const [field, end] of [['from', from], ['to', to]] as const) {
    if (typeof end !== 'string' || !FRAME_ID.test(end)) { issues.push({ path: `${path}.${field}`, message: 'must name a frame id, such as "booking/confirmed"' }); return undefined; }
  }
  const label = optionalText(value['label'], `${path}.label`, 80, issues);
  return { from: from as string, to: to as string, ...(label ? { label } : {}) };
}

/** Reads a board (its JSON text or an already parsed value). Never throws. */
export function parseBoard(input: unknown): BoardParse {
  let raw: unknown = input;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { return { kind: 'invalid', issues: [{ path: '', message: 'is not valid JSON' }] }; }
  }
  if (!isObject(raw)) return { kind: 'invalid', issues: [{ path: '', message: 'must be a JSON object' }] };
  const format = raw['format'];
  if (format === undefined) return { kind: 'invalid', issues: [{ path: 'format', message: `is missing: an unversioned board is invalid, write "format": "${BOARD_FORMAT}"` }] };
  if (typeof format !== 'string') return { kind: 'invalid', issues: [{ path: 'format', message: `must be a string such as "${BOARD_FORMAT}"` }] };
  const versioned = FORMAT_LIKE.exec(format)?.[1];
  const version = versioned !== undefined && /^[1-9]\d{0,3}$/.test(versioned) ? Number(versioned) : undefined;
  if (version === undefined) return { kind: 'invalid', issues: [{ path: 'format', message: `is "${format.slice(0, 40)}", not a board format such as "${BOARD_FORMAT}"` }] };
  if (version > BOARD_FORMAT_VERSION) return { kind: 'newer', format, version };
  if (version !== BOARD_FORMAT_VERSION) return { kind: 'invalid', issues: [{ path: 'format', message: `"${format}" is not a known board version` }] };

  const issues: BoardIssue[] = [];
  unknownFields(raw, ['format', 'title', 'items', 'links', 'layout'], '', issues);
  const title = optionalText(raw['title'], 'title', 120, issues) ?? '';

  const items: BoardItem[] = [];
  const seen = new Set<string>();
  const list = raw['items'];
  if (!Array.isArray(list)) issues.push({ path: 'items', message: 'must be a list (use [] for an empty board)' });
  else if (list.length > MAX_ITEMS) issues.push({ path: 'items', message: `has ${list.length} items; at most ${MAX_ITEMS}` });
  else list.forEach((value, index) => {
    const item = readItem(value, `items[${index}]`, issues);
    if (!item) return;
    if (seen.has(item.id)) { issues.push({ path: `items[${index}].id`, message: `"${item.id}" is already used by another item` }); return; }
    seen.add(item.id);
    items.push(item);
  });

  const links: BoardLink[] = [];
  const linkList = raw['links'] ?? [];
  if (!Array.isArray(linkList)) issues.push({ path: 'links', message: 'must be a list' });
  else if (linkList.length > MAX_LINKS) issues.push({ path: 'links', message: `has ${linkList.length} links; at most ${MAX_LINKS}` });
  else linkList.forEach((value, index) => { const link = readLink(value, `links[${index}]`, issues); if (link) links.push(link); });

  const layout: Record<string, BoardPoint> = {};
  const layoutSpec = raw['layout'] ?? {};
  if (!isObject(layoutSpec)) issues.push({ path: 'layout', message: 'must be an object from frame or note id to {"x", "y"}' });
  else if (Object.keys(layoutSpec).length > MAX_LAYOUT) issues.push({ path: 'layout', message: `has more than ${MAX_LAYOUT} entries` });
  else for (const [id, value] of Object.entries(layoutSpec)) {
    const path = `layout.${id}`;
    if (!FRAME_ID.test(id)) { issues.push({ path, message: 'is not a frame or note id' }); continue; }
    if (!isObject(value)) { issues.push({ path, message: 'must be {"x": number, "y": number}' }); continue; }
    const x = optionalNumber(value['x'], `${path}.x`, -COORDINATE, COORDINATE, issues);
    const y = optionalNumber(value['y'], `${path}.y`, -COORDINATE, COORDINATE, issues);
    if (x !== undefined && y !== undefined) layout[id] = { x, y };
  }

  if (issues.length) return { kind: 'invalid', issues };
  return { kind: 'ok', board: { format: BOARD_FORMAT, title, items, links, layout } };
}

/** What a canvas draws. Ids are stable: `<item>/<screen>` for maquette frames, the item id for HTML frames and notes. */
export interface PlannedFrame { readonly id: string; readonly kind: 'maquette' | 'html'; readonly src: string; readonly screen: string; readonly title: string; readonly x: number; readonly y: number; readonly w: number; readonly h: number }
export interface PlannedArrow { readonly id: string; readonly from: string; readonly to: string; readonly label: string }
export interface PlannedNote { readonly id: string; readonly text: string; readonly x: number; readonly y: number }
export interface BoardPlan {
  readonly frames: readonly PlannedFrame[];
  readonly arrows: readonly PlannedArrow[];
  readonly notes: readonly PlannedNote[];
  /** Referenced files that are missing or unreadable, and links that name no frame. The plan still draws everything else. */
  readonly problems: readonly BoardIssue[];
}

const SIZE = { phone: { w: 390, h: 780 }, desktop: { w: 1024, h: 720 } } as const;
const GAP = 160;

/**
 * Lays the board out left to right. `files` maps each referenced path to its text: a maquette is needed for its screens and goto links.
 * A frame with a layout entry keeps that position; the automatic frames go to the right of everything placed before them.
 */
export function planBoard(board: Board, files: ReadonlyMap<string, string>): BoardPlan {
  const frames: PlannedFrame[] = [], notes: PlannedNote[] = [], problems: BoardIssue[] = [];
  const maquettes = new Map<string, Maquette>();
  const arrowLinks: { from: string; to: string; label: string; source: string }[] = [];
  let cursor = 0;
  // Automatic frames go to the right of everything placed so far, so a frame a person moved never overlaps one the layout did not place.
  const place = (id: string, w: number): BoardPoint => {
    const at = board.layout[id] ?? { x: cursor, y: 0 };
    cursor = Math.max(cursor, at.x + w + GAP);
    return at;
  };

  for (const item of board.items) {
    if ('maquette' in item) {
      const text = files.get(item.maquette);
      const parsed = text === undefined ? undefined : parseMaquette(text);
      if (!parsed || parsed.kind !== 'ok') {
        problems.push({ path: `items.${item.id}`, message: text === undefined ? `${item.maquette} is missing` : `${item.maquette} is not a readable maquette` });
        continue;
      }
      const maquette = parsed.maquette;
      maquettes.set(item.id, maquette);
      const size = SIZE[maquette.device === 'desktop' ? 'desktop' : 'phone'];
      for (const screen of maquette.screens) {
        const id = `${item.id}/${screen.id}`;
        const at = place(id, size.w);
        frames.push({ id, kind: 'maquette', src: item.maquette, screen: screen.id, title: screen.title, x: at.x, y: at.y, ...size });
      }
      for (const screen of maquette.screens) for (const target of linksOf(screen.blocks))
        arrowLinks.push({ from: `${item.id}/${screen.id}`, to: `${item.id}/${target}`, label: '', source: `${item.id}/${screen.id}` });
    } else if ('html' in item) {
      const device = SIZE[item.device];
      const size = { w: item.width ?? device.w, h: item.height ?? device.h };
      const at = place(item.id, size.w);
      frames.push({ id: item.id, kind: 'html', src: item.html, screen: '', title: item.title ?? item.html, x: at.x, y: at.y, ...size });
      if (!files.has(item.html)) problems.push({ path: `items.${item.id}`, message: `${item.html} is missing` });
    }
  }

  const frameIds = new Set(frames.map(frame => frame.id));
  for (const link of board.links) arrowLinks.push({ from: link.from, to: link.to, label: link.label ?? '', source: `links.${link.from}->${link.to}` });
  const arrows: PlannedArrow[] = [];
  for (const link of arrowLinks) {
    if (frameIds.has(link.from) && frameIds.has(link.to)) arrows.push({ id: `${link.from}->${link.to}`, from: link.from, to: link.to, label: link.label });
    else problems.push({ path: link.source, message: `${frameIds.has(link.from) ? link.to : link.from} is not a frame on this board` });
  }

  for (const item of board.items) if ('note' in item) {
    const near = item.near === undefined ? undefined : frames.find(frame => frame.id === item.near);
    if (item.near !== undefined && !near) problems.push({ path: `items.${item.id}.near`, message: `${item.near} is not a frame on this board` });
    const at = board.layout[item.id] ?? (near ? { x: near.x + near.w - 120, y: near.y - 260 } : { x: cursor, y: 0 });
    notes.push({ id: item.id, text: item.note, x: at.x, y: at.y });
  }
  return { frames, arrows, notes, problems };
}

/** Frame and note positions, and the notes after people edited them on the canvas. */
export interface CanvasEdits {
  readonly positions: Readonly<Record<string, BoardPoint>>;
  /** Every note that remains. A note missing here was deleted. Its `near` is kept from the board. */
  readonly notes: readonly { readonly id: string; readonly text: string }[];
}

export type BoardEditResult = { readonly kind: 'ok'; readonly board: Board } | { readonly kind: 'invalid'; readonly issues: readonly BoardIssue[] };

/**
 * Writes people's canvas edits back into a board, as `board@1`: `layout` takes the new positions and the note items take the notes.
 * Maquette, HTML and link entries are never changed. The result is valid by construction and is checked as if it were read from a file.
 */
export function applyCanvasEdits(board: Board, edits: CanvasEdits): BoardEditResult {
  const issues: BoardIssue[] = [];
  const kept = board.items.filter(item => !('note' in item));
  const keptIds = new Set(kept.map(item => item.id));
  const near = new Map(board.items.flatMap(item => 'note' in item ? [[item.id, item.near] as const] : []));
  const notes: BoardItem[] = [];
  edits.notes.forEach((note, index) => {
    if (!ITEM_ID.test(note.id) || keptIds.has(note.id)) { issues.push({ path: `notes[${index}].id`, message: `"${note.id}" is not a free note id` }); return; }
    const text = note.text.trim();
    if (!text) { issues.push({ path: `notes[${index}].text`, message: 'is empty' }); return; }
    const attached = near.get(note.id);
    notes.push({ id: note.id, note: text.slice(0, MAX_NOTE), ...(attached !== undefined ? { near: attached } : {}) });
  });
  const layout: Record<string, BoardPoint> = {};
  for (const [id, at] of Object.entries(edits.positions)) {
    if (!FRAME_ID.test(id)) { issues.push({ path: `positions.${id}`, message: 'is not a frame or note id' }); continue; }
    if (!Number.isFinite(at.x) || !Number.isFinite(at.y) || Math.abs(at.x) > COORDINATE || Math.abs(at.y) > COORDINATE) { issues.push({ path: `positions.${id}`, message: 'is not a finite position' }); continue; }
    layout[id] = { x: Math.round(at.x), y: Math.round(at.y) };
  }
  if (Object.keys(layout).length > MAX_LAYOUT) issues.push({ path: 'positions', message: `has more than ${MAX_LAYOUT} entries` });
  if (kept.length + notes.length > MAX_ITEMS) issues.push({ path: 'notes', message: `would make more than ${MAX_ITEMS} items` });
  if (issues.length) return { kind: 'invalid', issues };
  return { kind: 'ok', board: { ...board, items: [...kept, ...notes], layout } };
}

/** The board's file text: `board@1` JSON, two-space indented, with a trailing newline. */
export const serializeBoard = (board: Board): string => `${JSON.stringify(board, null, 2)}\n`;
