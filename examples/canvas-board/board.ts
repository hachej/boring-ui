// The board format a PM agent writes as `<name>.board.json` (spike, format `board@1`). It is plain data that references other workspace
// files: a maquette item becomes one frame per screen, laid out left to right, with an arrow for each `goto`; an HTML item becomes one frame
// holding the page in a sandboxed iframe; a note item becomes a sticky note. People's moves and notes come back into `layout` and `items`, so
// the board file stays the only authority and tldraw's store is a projection of it (never saved as such). Parsing is defensive and bounded.
import { linksOf, parseMaquette } from '../../registry/maquette-viewer/maquette';
import type { Maquette } from '../../registry/maquette-viewer/maquette';

export const BOARD_FORMAT = 'board@1';
export const isBoardPath = (path: string) => /\.board\.json$/i.test(path);
export const isMockupPath = (path: string) => /\.mockup\.html$/i.test(path);

export type BoardItem =
  | { readonly id: string; readonly maquette: string; readonly title?: string }
  | { readonly id: string; readonly html: string; readonly title?: string; readonly device?: 'phone' | 'desktop'; readonly width?: number; readonly height?: number }
  | { readonly id: string; readonly note: string; readonly near?: string };
export interface BoardLink { readonly from: string; readonly to: string; readonly label?: string }
export interface Board {
  readonly format: typeof BOARD_FORMAT;
  readonly title: string;
  readonly items: readonly BoardItem[];
  readonly links: readonly BoardLink[];
  /** Where people put things: frame or note id to its top-left corner. Absent: the automatic layout. */
  readonly layout: Readonly<Record<string, { readonly x: number; readonly y: number }>>;
}

const str = (value: unknown, max = 200) => typeof value === 'string' ? value.slice(0, max) : '';
const num = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : undefined;
const obj = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$/;
/** A workspace path relative to the board's folder: no scheme, no absolute path, no `..`. Anything else is dropped. */
const safePath = (value: unknown) => { const path = str(value, 200); return path && !/^[a-z]+:|^\/|(^|\/)\.\.(\/|$)/i.test(path) ? path : ''; };

export type BoardParse = { readonly kind: 'ok'; readonly board: Board } | { readonly kind: 'invalid'; readonly reason: string };

export function parseBoard(text: string): BoardParse {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { kind: 'invalid', reason: 'json' }; }
  const spec = obj(raw);
  if (spec['format'] !== BOARD_FORMAT) return { kind: 'invalid', reason: 'format' };
  const seen = new Set<string>();
  const items: BoardItem[] = [];
  for (const value of (Array.isArray(spec['items']) ? spec['items'] : []).slice(0, 40)) {
    const item = obj(value), id = str(item['id'], 60);
    if (!ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    const title = str(item['title'], 120) || undefined;
    if (safePath(item['maquette'])) items.push({ id, maquette: safePath(item['maquette']), ...(title ? { title } : {}) });
    else if (safePath(item['html'])) {
      const device = item['device'] === 'desktop' ? 'desktop' : 'phone';
      const width = num(item['width'], 240, 1600), height = num(item['height'], 240, 2400);
      items.push({ id, html: safePath(item['html']), device, ...(title ? { title } : {}), ...(width ? { width } : {}), ...(height ? { height } : {}) });
    } else if (str(item['note'], 1000)) items.push({ id, note: str(item['note'], 1000), ...(str(item['near'], 120) ? { near: str(item['near'], 120) } : {}) });
  }
  const links = (Array.isArray(spec['links']) ? spec['links'] : []).slice(0, 80).map(value => {
    const link = obj(value);
    return { from: str(link['from'], 120), to: str(link['to'], 120), ...(str(link['label'], 80) ? { label: str(link['label'], 80) } : {}) };
  }).filter(link => link.from && link.to);
  const layout: Record<string, { x: number; y: number }> = {};
  for (const [id, value] of Object.entries(obj(spec['layout'])).slice(0, 200)) {
    const x = num(obj(value)['x'], -1e6, 1e6), y = num(obj(value)['y'], -1e6, 1e6);
    if (x !== undefined && y !== undefined) layout[id.slice(0, 120)] = { x, y };
  }
  return { kind: 'ok', board: { format: BOARD_FORMAT, title: str(spec['title'], 120), items, links, layout } };
}

/** What the canvas draws: frames, arrows between frames and notes, each with a stable id derived from the board. */
export interface PlannedFrame { readonly id: string; readonly kind: 'maquette' | 'html'; readonly src: string; readonly screen: string; readonly title: string; readonly x: number; readonly y: number; readonly w: number; readonly h: number }
export interface PlannedArrow { readonly id: string; readonly from: string; readonly to: string; readonly label: string }
export interface PlannedNote { readonly id: string; readonly text: string; readonly x: number; readonly y: number }
export interface BoardPlan { readonly frames: readonly PlannedFrame[]; readonly arrows: readonly PlannedArrow[]; readonly notes: readonly PlannedNote[] }

const SIZE = { phone: { w: 390, h: 780 }, desktop: { w: 1024, h: 720 } };
const GAP = 160;

/** Lays the board out left to right. `files` holds the referenced files' text (maquettes are needed for their screens and links). */
export function planBoard(board: Board, files: ReadonlyMap<string, string>): BoardPlan {
  const frames: PlannedFrame[] = [], arrows: PlannedArrow[] = [], notes: PlannedNote[] = [];
  let x = 0;
  const place = (id: string, w: number, h: number) => { const at = board.layout[id] ?? { x, y: 0 }; x = Math.max(x, at.x + w + GAP); return at; };
  for (const item of board.items) {
    if ('maquette' in item) {
      const parsed = parseMaquette(files.get(item.maquette) ?? '');
      if (parsed.kind !== 'ok') continue;
      const maquette: Maquette = parsed.maquette;
      const size = SIZE[maquette.device === 'desktop' ? 'desktop' : 'phone'];
      for (const screen of maquette.screens) {
        const id = `${item.id}/${screen.id}`, at = place(id, size.w, size.h);
        frames.push({ id, kind: 'maquette', src: item.maquette, screen: screen.id, title: screen.title, x: at.x, y: at.y, ...size });
      }
      for (const screen of maquette.screens) for (const target of linksOf(screen.blocks))
        if (maquette.screens.some(other => other.id === target)) arrows.push({ id: `${item.id}/${screen.id}->${item.id}/${target}`, from: `${item.id}/${screen.id}`, to: `${item.id}/${target}`, label: '' });
    } else if ('html' in item) {
      const size = { w: item.width ?? SIZE[item.device ?? 'phone'].w, h: item.height ?? SIZE[item.device ?? 'phone'].h };
      const at = place(item.id, size.w, size.h);
      frames.push({ id: item.id, kind: 'html', src: item.html, screen: '', title: item.title ?? item.html, x: at.x, y: at.y, ...size });
    }
  }
  const ids = new Set(frames.map(frame => frame.id));
  for (const link of board.links) if (ids.has(link.from) && ids.has(link.to)) arrows.push({ id: `${link.from}->${link.to}`, from: link.from, to: link.to, label: link.label ?? '' });
  for (const item of board.items) if ('note' in item) {
    const near = frames.find(frame => frame.id === item.near);
    const at = board.layout[item.id] ?? (near ? { x: near.x + near.w - 120, y: near.y - 260 } : { x, y: 0 });
    notes.push({ id: item.id, text: item.note, x: at.x, y: at.y });
  }
  return { frames, arrows, notes };
}

/** The board after people moved frames and added, edited or removed notes on the canvas: only `layout` and note items change. */
export function withCanvasEdits(board: Board, positions: Readonly<Record<string, { x: number; y: number }>>, notes: readonly { readonly id: string; readonly text: string }[]): Board {
  const kept = board.items.filter(item => !('note' in item));
  const layout: Record<string, { x: number; y: number }> = {};
  for (const [id, at] of Object.entries(positions)) layout[id] = { x: Math.round(at.x), y: Math.round(at.y) };
  return { ...board, items: [...kept, ...notes.map(note => ({ id: note.id, note: note.text.slice(0, 1000) }))], layout };
}

export const serializeBoard = (board: Board) => `${JSON.stringify(board, null, 2)}\n`;
