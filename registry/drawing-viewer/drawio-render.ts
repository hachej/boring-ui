// A draw.io file drawn by the official diagrams.net viewer (D-1398), vendored and pinned in the kit (`@hachej/boring-ui-kit/drawio-viewer`)
// and run in a hidden sandboxed frame (drawio-frame.ts) that cannot reach the network or this page. The viewer decodes the file (plain or
// compressed `<diagram>`), draws every shape and style as draw.io does and exports the SVG; the frame is removed once it answers. This
// module and the viewer's text load only when a draw.io file opens.
import type { Drawing, DrawingArrow, DrawingShape, RenderedDrawing } from './drawing';
import { DrawingError } from './drawing';
import { drawioFrameDocument } from './drawio-frame';

/** How long the viewer may take to answer before the drawing shows an error. */
const ANSWER_MS = 30000;

const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0;
const text = (value: unknown) => typeof value === 'string' && value ? value : undefined;
const list = (value: unknown): readonly Record<string, unknown>[] => Array.isArray(value) ? value.filter(entry => entry && typeof entry === 'object') : [];

/** What the frame read, kept to the fields and types of a `Drawing` (the frame is not trusted to send only those). */
function cleanDrawing(value: unknown): Drawing {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const bounds = (raw.bounds && typeof raw.bounds === 'object' ? raw.bounds : {}) as Record<string, unknown>;
  const shapes: DrawingShape[] = list(raw.shapes).map(shape => ({ id: String(shape.id), kind: text(shape.kind) ?? 'rectangle', x: finite(shape.x), y: finite(shape.y),
    width: finite(shape.width), height: finite(shape.height), label: text(shape.label), stroke: text(shape.stroke), fill: text(shape.fill), parent: text(shape.parent) }));
  const arrows: DrawingArrow[] = list(raw.arrows).map(arrow => ({ id: String(arrow.id), kind: arrow.kind === 'line' ? 'line' : 'arrow', from: text(arrow.from), to: text(arrow.to),
    points: (Array.isArray(arrow.points) ? arrow.points : []).filter(Array.isArray).map(point => [finite(point[0]), finite(point[1])] as const), label: text(arrow.label), stroke: text(arrow.stroke) }));
  return { format: 'drawio', bounds: { x: finite(bounds.x), y: finite(bounds.y), width: finite(bounds.width), height: finite(bounds.height) }, shapes, arrows };
}

function nonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Draws a `.drawio` file's text; throws a `DrawingError` for a file that is not one, draws nothing or that the viewer could not draw. */
export async function renderDrawio(source: string, { signal }: { readonly signal?: AbortSignal | undefined } = {}): Promise<RenderedDrawing> {
  if (!/<(?:mxfile|mxGraphModel|diagram)\b/.test(source)) throw new DrawingError('unreadable', 'The file is not a draw.io diagram.');
  const { DRAWIO_VIEWER_SCRIPT } = await import('@hachej/boring-ui-kit/drawio-viewer');
  signal?.throwIfAborted();
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('data-boring', 'drawio-frame');
  frame.tabIndex = -1;
  frame.title = 'draw.io';
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1200px;height:900px;border:0;visibility:hidden;pointer-events:none';
  frame.srcdoc = drawioFrameDocument(nonce());
  return new Promise<RenderedDrawing>((resolve, reject) => {
    const channel = new MessageChannel();
    const done = () => { clearTimeout(timer); channel.port1.close(); frame.remove(); signal?.removeEventListener('abort', aborted); };
    const aborted = () => { done(); reject(signal?.reason); };
    const timer = setTimeout(() => { done(); reject(new DrawingError('renderer', 'The draw.io viewer did not answer.')); }, ANSWER_MS);
    channel.port1.onmessage = event => {
      const data = (event.data && typeof event.data === 'object' ? event.data : {}) as Record<string, unknown>;
      done();
      if (data.type === 'drawn' && typeof data.svg === 'string') resolve({ svg: data.svg, width: finite(data.width), height: finite(data.height), drawing: cleanDrawing(data.drawing) });
      else reject(new DrawingError(data.reason === 'unreadable' || data.reason === 'empty' ? data.reason : 'renderer', text(data.message)));
    };
    signal?.addEventListener('abort', aborted, { once: true });
    frame.addEventListener('load', () => frame.contentWindow?.postMessage({ type: 'draw', viewer: DRAWIO_VIEWER_SCRIPT, xml: source }, '*', [channel.port2]), { once: true });
    document.body.append(frame);
  });
}
