// An Excalidraw scene drawn by Excalidraw itself (D-1398): `restore` (the library's own reader: defaults, migrations, bound text) then
// `exportToSvg` on a white page, so the drawing has Excalidraw's hand-drawn strokes, fills and fonts. The library loads with this module,
// which the viewer imports only when an Excalidraw file opens. Fonts come from the app (`assets`, the folder that serves Excalidraw's
// `dist/prod/fonts`); when the app serves none, the export skips the fonts rather than let Excalidraw fetch them from its CDN.
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

const FONT_PROBE = 'fonts/Virgil/Virgil-Regular.woff2';
const colour = (value: string | undefined) => value && value !== 'transparent' ? value : undefined;

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

/** The scene's shapes and arrows from the restored elements: a container's text is its label, deleted elements are left out. */
export function readExcalidraw(elements: readonly Element[]): { readonly shapes: DrawingShape[]; readonly arrows: DrawingArrow[] } {
  const live = elements.filter(element => !element.isDeleted);
  const bound = new Map(live.filter(element => element.type === 'text' && element.containerId).map(element => [element.containerId!, element.originalText ?? element.text ?? '']));
  const shapes: DrawingShape[] = [], arrows: DrawingArrow[] = [];
  for (const element of live) {
    if (element.type === 'text' && element.containerId && live.some(other => other.id === element.containerId)) continue;
    const label = element.type === 'text' ? element.originalText ?? element.text : bound.get(element.id);
    if (element.type === 'arrow' || element.type === 'line') {
      arrows.push({ id: element.id, kind: element.type, from: element.startBinding?.elementId, to: element.endBinding?.elementId,
        points: (element.points ?? []).map(([x, y]) => [element.x + x, element.y + y] as const), label: label || undefined, stroke: colour(element.strokeColor) });
      continue;
    }
    shapes.push({ id: element.id, kind: element.type, x: element.x, y: element.y, width: element.width, height: element.height, label: label || undefined,
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
  const svg = await excalidraw.exportToSvg({
    elements,
    appState: { ...restored.appState, exportBackground: true, viewBackgroundColor: '#ffffff', exportWithDarkMode: false, exportEmbedScene: false },
    files: restored.files ?? null,
    exportPadding: 16,
    ...(fonts ? {} : { skipInliningFonts: true as const }),
  });
  const read = readExcalidraw(elements as unknown as readonly Element[]);
  const width = Number.parseFloat(svg.getAttribute('width') ?? '') || 0, height = Number.parseFloat(svg.getAttribute('height') ?? '') || 0;
  return { svg: new XMLSerializer().serializeToString(svg), width, height,
    drawing: { format: 'excalidraw', bounds: boundsOf([...read.shapes, ...(elements as unknown as readonly Element[]).filter(element => element.type === 'arrow' || element.type === 'line')]), ...read } };
}
