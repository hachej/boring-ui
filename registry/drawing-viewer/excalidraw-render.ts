// An Excalidraw scene drawn by Excalidraw itself (D-1398): `restore` (the library's own reader: defaults, migrations, bound text) then
// `exportToSvg` on a white page, so the drawing has Excalidraw's hand-drawn strokes, fills and fonts. The library loads with this module,
// which the viewer imports only when an Excalidraw file opens. Fonts come from the app (`assets`, the folder that serves Excalidraw's
// `dist/prod/fonts`). Excalidraw falls back to its CDN (esm.sh) for a font it cannot get from there; while an export runs, this module
// refuses the CDN (a font fetch, and the CDN sources of the font faces it creates), so a drawing never fetches from it; an export that fails is drawn
// again without fonts. The page's `fetch` and `FontFace` are given back as they were once no drawing is being made.
import type { DrawingArrow, DrawingShape, RenderedDrawing } from './drawing';
import { DrawingError } from './drawing';

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

/** A `FontFace` source list without Excalidraw's CDN entries (`url(https://esm.sh/@excalidraw/…) format('woff2')`). */
function withoutCdnSources(source: string): string {
  const kept = source.split(/,\s*(?=url\(|local\()/).filter(part => !FONT_CDN.test(part.replace(/^url\(\s*["']?/, '')));
  return kept.length ? kept.join(', ') : 'local("Excalidraw font not served")';
}

let running = 0;
let restore: (() => void) | undefined;
/**
 * Runs `work` (Excalidraw's import and export) with its CDN refused, by the two ways Excalidraw reaches it: a `fetch` of a font to inline
 * is refused, and a `FontFace` it creates drops its CDN sources. Every other request and font goes through unchanged. Both are in place
 * only while work runs (counted, for drawings side by side) and are given back after the last one, unless the page replaced them meanwhile.
 */
async function withoutFontCdn<T>(work: () => Promise<T>): Promise<T> {
  if (running++ === 0) {
    const pageFetch = globalThis.fetch, PageFontFace = globalThis.FontFace;
    const fetchGuard = typeof pageFetch === 'function' ? (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      return FONT_CDN.test(url) ? Promise.reject(new TypeError('The drawing viewer does not fetch Excalidraw fonts from its CDN.')) : pageFetch(input, init);
    } : undefined;
    const fontGuard = typeof PageFontFace === 'function' ? new Proxy(PageFontFace, {
      construct: (target, [family, source, descriptors]: ConstructorParameters<typeof FontFace>) =>
        new target(family, typeof source === 'string' ? withoutCdnSources(source) : source, descriptors),
    }) : undefined;
    if (fetchGuard) globalThis.fetch = fetchGuard;
    if (fontGuard) globalThis.FontFace = fontGuard;
    restore = () => {
      if (fetchGuard && globalThis.fetch === fetchGuard) globalThis.fetch = pageFetch;
      if (fontGuard && globalThis.FontFace === fontGuard) globalThis.FontFace = PageFontFace;
    };
  }
  try { return await work(); }
  finally { if (--running === 0) { restore?.(); restore = undefined; } }
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

/** The scene's shapes and arrows from the restored elements: a container's text is its label, deleted elements are left out. */
export function readExcalidraw(elements: readonly Element[]): { readonly shapes: DrawingShape[]; readonly arrows: DrawingArrow[] } {
  const live = elements.filter(element => !element.isDeleted);
  const bound = new Map(live.filter(element => element.type === 'text' && element.containerId).map(element => [element.containerId!, element.originalText ?? element.text ?? '']));
  const shapes: DrawingShape[] = [], arrows: DrawingArrow[] = [];
  for (const element of live) {
    if (element.type === 'text' && element.containerId && live.some(other => other.id === element.containerId)) continue;
    const label = element.type === 'text' ? element.originalText ?? element.text : bound.get(element.id);
    if (element.type === 'arrow' || element.type === 'line') {
      arrows.push({ id: element.id, kind: element.type, from: element.startBinding?.elementId, to: element.endBinding?.elementId, points: pagePoints(element), label: label || undefined, stroke: colour(element.strokeColor) });
      continue;
    }
    const rotation = element.angle ? Math.round((element.angle * 180 / Math.PI) * 100) / 100 : undefined;
    shapes.push({ id: element.id, kind: element.type, x: element.x, y: element.y, width: element.width, height: element.height, ...(rotation ? { rotation } : {}), label: label || undefined,
      stroke: colour(element.strokeColor), fill: colour(element.backgroundColor), parent: element.frameId ?? undefined });
  }
  return { shapes, arrows };
}

/** Draws an `.excalidraw` file's text; throws a `DrawingError` for a file that is not a scene or draws nothing. */
export async function renderExcalidraw(text: string, { assets }: { readonly assets: string | false }): Promise<RenderedDrawing> {
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new DrawingError('unreadable', 'The file is not JSON.'); }
  const scene = data as { readonly type?: unknown; readonly elements?: unknown } | null;
  if (!scene || typeof scene !== 'object' || scene.type !== 'excalidraw' || !Array.isArray(scene.elements)) throw new DrawingError('unreadable', 'The file is not an Excalidraw scene.');
  // Where the fonts are must be known before the library loads: its font faces take their sources when it is first imported.
  const own = globalThis.window?.EXCALIDRAW_ASSET_PATH;
  const base = typeof own === 'string' ? own : assets;
  const fonts = base !== false && await fontsServed(base);
  if (fonts && base !== false && own === undefined) window.EXCALIDRAW_ASSET_PATH = baseOf(base).href;
  return withoutFontCdn(() => draw(data, fonts));
}

async function draw(data: unknown, fonts: boolean): Promise<RenderedDrawing> {
  const excalidraw = await import('@excalidraw/excalidraw');
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
  const read = readExcalidraw(elements as unknown as readonly Element[]);
  // Excalidraw's own bounds of what it drew: each shape's geometry turned by its angle, bound text included.
  const [left, top, right, bottom] = excalidraw.getCommonBounds(elements);
  const width = Number.parseFloat(svg.getAttribute('width') ?? '') || 0, height = Number.parseFloat(svg.getAttribute('height') ?? '') || 0;
  return { svg: new XMLSerializer().serializeToString(svg), width, height, blocked: [],
    drawing: { format: 'excalidraw', bounds: { x: left, y: top, width: right - left, height: bottom - top }, ...read } };
}
