// What a drawing is once read (D-1398): the shapes and arrows the native library loaded, in the drawing's own coordinates. The drawing
// viewer hands it to `onRead`, so an app can describe a drawing to a model without parsing the file again. This module is cheap: it
// loads neither Excalidraw nor the draw.io viewer, which the viewer imports only when a drawing of that format opens.

/** The two formats: an Excalidraw scene (JSON) and a draw.io file (XML, plain or compressed). */
export type DrawingFormat = 'excalidraw' | 'drawio';

/** A shape: its kind in the native vocabulary (Excalidraw `rectangle`, `ellipse`, `diamond`, `text`, `freedraw`, …; draw.io `rectangle`, `ellipse`, `rhombus`, `swimlane`, …). */
export interface DrawingShape {
  readonly id: string;
  readonly kind: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Its text: a container's bound text, or a text element's own; HTML stripped. */
  readonly label?: string | undefined;
  readonly stroke?: string | undefined;
  readonly fill?: string | undefined;
  /** The group or container it sits in, when there is one. */
  readonly parent?: string | undefined;
}

/** An arrow or a line: the shapes it joins (absent when an end is free) and its points, from start to end, on their outlines. */
export interface DrawingArrow {
  readonly id: string;
  readonly kind: 'arrow' | 'line';
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly points: readonly (readonly [number, number])[];
  readonly label?: string | undefined;
  readonly stroke?: string | undefined;
}

export interface Drawing {
  readonly format: DrawingFormat;
  /** The bounds of everything drawn, in the drawing's coordinates. */
  readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly shapes: readonly DrawingShape[];
  readonly arrows: readonly DrawingArrow[];
}

/** The format of a file by its name (`.excalidraw`, `.excalidraw.json`, `.drawio`, `.drawio.xml`, `.dio`), else by its text. */
export function drawingFormat(path: string | undefined, text?: string): DrawingFormat | undefined {
  const name = (path ?? '').toLowerCase();
  if (/\.excalidraw(?:\.json)?$/.test(name)) return 'excalidraw';
  if (/\.(?:drawio(?:\.xml)?|dio)$/.test(name)) return 'drawio';
  const start = (text ?? '').trimStart();
  if (start.startsWith('{') && /"type"\s*:\s*"excalidraw"/.test(start.slice(0, 400))) return 'excalidraw';
  if (start.startsWith('<') && /<(?:mxfile|mxGraphModel)\b/.test(start.slice(0, 2000))) return 'drawio';
  return undefined;
}

/** Whether a path names a drawing file. */
export const isDrawingPath = (path: string): boolean => drawingFormat(path) !== undefined;

const round = (value: number) => Math.round(value);
const name = (drawing: Drawing, id: string | undefined) => {
  if (!id) return 'nothing';
  const shape = drawing.shapes.find(entry => entry.id === id);
  return shape ? (shape.label ? `"${shape.label}"` : `${shape.kind} ${id}`) : id;
};

/** A plain-text account of a drawing for a model: every shape with its place, size, label and colours, then every arrow with its ends. */
export function describeDrawing(drawing: Drawing): string {
  const lines = [`A ${drawing.format === 'drawio' ? 'draw.io' : 'Excalidraw'} drawing of ${drawing.shapes.length} shapes and ${drawing.arrows.length} arrows, ${round(drawing.bounds.width)}×${round(drawing.bounds.height)}.`];
  for (const shape of drawing.shapes) {
    const colours = [shape.stroke && `stroke ${shape.stroke}`, shape.fill && `fill ${shape.fill}`].filter(Boolean).join(', ');
    lines.push(`- ${shape.kind} ${shape.id}${shape.label ? ` "${shape.label}"` : ''} at (${round(shape.x)}, ${round(shape.y)}), ${round(shape.width)}×${round(shape.height)}${colours ? `, ${colours}` : ''}${shape.parent ? `, in ${name(drawing, shape.parent)}` : ''}`);
  }
  for (const arrow of drawing.arrows) lines.push(`- ${arrow.kind} ${arrow.id}${arrow.label ? ` "${arrow.label}"` : ''} from ${name(drawing, arrow.from)} to ${name(drawing, arrow.to)}`);
  return lines.join('\n');
}

/** Why a drawing could not be shown: the file is not one (`unreadable`), it draws nothing (`empty`) or the native renderer failed (`renderer`). */
export type DrawingFailure = 'unreadable' | 'empty' | 'renderer';

export class DrawingError extends Error {
  readonly reason: DrawingFailure;
  constructor(reason: DrawingFailure, message?: string) { super(message ?? reason); this.name = 'DrawingError'; this.reason = reason; }
}

/** A drawing as the native library drew it: an SVG document (shown as an image, so nothing in it runs) and what it read. */
export interface RenderedDrawing {
  readonly svg: string;
  readonly width: number;
  readonly height: number;
  readonly drawing: Drawing;
}

/** The bounds of boxes, or an empty box at the origin. */
export function boundsOf(boxes: readonly { readonly x: number; readonly y: number; readonly width: number; readonly height: number }[]): Drawing['bounds'] {
  if (!boxes.length) return { x: 0, y: 0, width: 0, height: 0 };
  const left = Math.min(...boxes.map(box => box.x)), top = Math.min(...boxes.map(box => box.y));
  const right = Math.max(...boxes.map(box => box.x + box.width)), bottom = Math.max(...boxes.map(box => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}
