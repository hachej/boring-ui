// An Excalidraw scene drawn by Excalidraw itself (D-1398): `restore` (the library's own reader: defaults, migrations, bound text) then
// `exportToSvg` on a white page, so the drawing has Excalidraw's hand-drawn strokes, fills and fonts. The library loads with this module,
// which the viewer imports only when an Excalidraw file opens. Fonts come from the app (`assets`, the folder that serves Excalidraw's
// `dist/prod/fonts`). Excalidraw falls back to its CDN (esm.sh) for a font it cannot get from there; this module refuses that request,
// so a drawing never fetches from the CDN, and an export that then fails is drawn again without fonts.
import type { DrawingArrow, DrawingShape, RenderedDrawing } from './drawing';
import { boundsOf, DrawingError } from './drawing';

declare global { interface Window { EXCALIDRAW_ASSET_PATH?: string | string[] } }

/** The fields of an Excalidraw element this module reads (the library's element type, structurally). */
interface Element {
  readonly id: string;
  readonly type: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly angle?: number;
  readonly isDeleted?: boolean;
  readonly strokeColor?: string;
  readonly backgroundColor?: string;
  readonly frameId?: string | null;
  readonly containerId?: string | null;
  readonly text?: string;
  readonly originalText?: string;
  readonly points?: readonly (readonly [number, number])[];
  readonly startBinding?: { readonly elementId: string } | null;
  readonly endBinding?: { readonly elementId: string } | null;
}

type Point = readonly [number, number];

const FONT_PROBE = 'fonts/Virgil/Virgil-Regular.woff2';
/** Where Excalidraw 0.18 falls back for its fonts (`ExcalidrawFontFace.ASSETS_FALLBACK_URL`). */
const FONT_CDN = /^https:\/\/esm\.sh\/@excalidraw\/excalidraw(?:@|\/)/;
const colour = (value: string | undefined) => value && value !== 'transparent' ? value : undefined;

let guarded = false;
/** Refuses Excalidraw's CDN font requests, and only those, for the page's life: every other fetch goes through unchanged. */
function refuseFontCdn() {
  if (guarded || typeof globalThis.fetch !== 'function') return;
  guarded = true;
  const original = globalThis.fetch;
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return FONT_CDN.test(url) ? Promise.reject(new TypeError('The drawing viewer does not fetch Excalidraw fonts from its CDN.')) : original(input, init);
  };
}

/** The base URL Excalidraw resolves its fonts against, as the library normalises it. */
function baseOf(assets: string): URL {
  return new URL(`${assets.replace(/\/+$/, '')}/`, globalThis.location?.href);
}

/** Whether the app serves Excalidraw's fonts under `assets` (a font, not an HTML fallback page). */
async function fontsServed(assets: string): Promise<boolean> {
  try {
    const response = await fetch(new URL(FONT_PROBE, baseOf(assets)), { cache: 'force-cache' });
    return response.ok && !/html/i.test(response.headers.get('content-type') ?? '');
  } catch { return false; }
}

/** `point` turned by `angle` (radians, clockwise on screen as Excalidraw draws) around `centre`. */
function turn([x, y]: Point, [cx, cy]: Point, angle: number): Point {
  if (!angle) return [x, y];
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return [cx + (x - cx) * cos - (y - cy) * sin, cy + (x - cx) * sin + (y - cy) * cos];
}

/** A linear element's points on the page: its local points moved to its place and turned by its angle around their own box's centre. */
function pagePoints(element: Element): Point[] {
  const local = element.points ?? [];
  if (!local.length) return [];
  const xs = local.map(([x]) => x), ys = local.map(([, y]) => y);
  const centre: Point = [element.x + (Math.min(...xs) + Math.max(...xs)) / 2, element.y + (Math.min(...ys) + Math.max(...ys)) / 2];
  return local.map(([x, y]) => turn([element.x + x, element.y + y], centre, element.angle ?? 0));
}

/** The corners of a shape's box turned by its angle around its centre. */
function corners(element: Element): Point[] {
  const centre: Point = [element.x + element.width / 2, element.y + element.height / 2];
  return ([[element.x, element.y], [element.x + element.width, element.y], [element.x + element.width, element.y + element.height], [element.x, element.y + element.height]] as Point[])
    .map(point => turn(point, centre, element.angle ?? 0));
}

const boxOf = (points: readonly Point[]) => points.length ? boundsOf(points.map(([x, y]) => ({ x, y, width: 0, height: 0 }))) : undefined;

/** The scene's shapes and arrows from the restored elements: a container's text is its label, deleted elements are left out. */
export function readExcalidraw(elements: readonly Element[]): { readonly shapes: DrawingShape[]; readonly arrows: DrawingArrow[]; readonly bounds: RenderedDrawing['drawing']['bounds'] } {
  const live = elements.filter(element => !element.isDeleted);
  const bound = new Map(live.filter(element => element.type === 'text' && element.containerId).map(element => [element.containerId!, element.originalText ?? element.text ?? '']));
  const shapes: DrawingShape[] = [], arrows: DrawingArrow[] = [], extent: Point[] = [];
  for (const element of live) {
    if (element.type === 'text' && element.containerId && live.some(other => other.id === element.containerId)) continue;
    const label = element.type === 'text' ? element.originalText ?? element.text : bound.get(element.id);
    if (element.type === 'arrow' || element.type === 'line') {
      const points = pagePoints(element);
      extent.push(...points);
      arrows.push({ id: element.id, kind: element.type, from: element.startBinding?.elementId, to: element.endBinding?.elementId, points, label: label || undefined, stroke: colour(element.strokeColor) });
      continue;
    }
    extent.push(...(element.type === 'freedraw' ? pagePoints(element) : corners(element)));
    const rotation = element.angle ? Math.round((element.angle * 180 / Math.PI) * 100) / 100 : undefined;
    shapes.push({ id: element.id, kind: element.type, x: element.x, y: element.y, width: element.width, height: element.height, ...(rotation ? { rotation } : {}), label: label || undefined,
      stroke: colour(element.strokeColor), fill: colour(element.backgroundColor), parent: element.frameId ?? undefined });
  }
  return { shapes, arrows, bounds: boxOf(extent) ?? boundsOf([]) };
}

/** Draws an `.excalidraw` file's text; throws a `DrawingError` for a file that is not a scene or draws nothing. */
export async function renderExcalidraw(text: string, { assets }: { readonly assets: string | false }): Promise<RenderedDrawing> {
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new DrawingError('unreadable', 'The file is not JSON.'); }
  const scene = data as { readonly type?: unknown; readonly elements?: unknown } | null;
  if (!scene || typeof scene !== 'object' || scene.type !== 'excalidraw' || !Array.isArray(scene.elements)) throw new DrawingError('unreadable', 'The file is not an Excalidraw scene.');
  refuseFontCdn();
  const excalidraw = await import('@excalidraw/excalidraw');
  const own = globalThis.window?.EXCALIDRAW_ASSET_PATH;
  const base = typeof own === 'string' ? own : assets;
  const fonts = base !== false && await fontsServed(base);
  if (fonts && base !== false && own === undefined) window.EXCALIDRAW_ASSET_PATH = baseOf(base).href;
  let restored: ReturnType<typeof excalidraw.restore>;
  try { restored = excalidraw.restore(data as Parameters<typeof excalidraw.restore>[0], null, null); }
  catch (error) { throw new DrawingError('unreadable', String(error)); }
  const elements = restored.elements.filter(element => !element.isDeleted);
  if (!elements.length) throw new DrawingError('empty', 'The scene draws nothing.');
  const exportSvg = (inline: boolean) => excalidraw.exportToSvg({
    elements,
    appState: { ...restored.appState, exportBackground: true, viewBackgroundColor: '#ffffff', exportWithDarkMode: false, exportEmbedScene: false },
    files: restored.files ?? null,
    exportPadding: 16,
    ...(inline ? {} : { skipInliningFonts: true as const }),
  });
  let svg: SVGSVGElement;
  try { svg = await exportSvg(fonts); }
  catch (error) {
    if (!fonts) throw new DrawingError('renderer', String(error));
    svg = await exportSvg(false);
  }
  const { bounds, ...read } = readExcalidraw(elements as unknown as readonly Element[]);
  const width = Number.parseFloat(svg.getAttribute('width') ?? '') || 0, height = Number.parseFloat(svg.getAttribute('height') ?? '') || 0;
  return { svg: new XMLSerializer().serializeToString(svg), width, height, blocked: [], drawing: { format: 'excalidraw', bounds, ...read } };
}
