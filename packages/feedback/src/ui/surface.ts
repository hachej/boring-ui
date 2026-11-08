// Points on a surface (FeedbackSurface): viewport coordinates to fractions of the element's own box, and back. The element may sit
// under CSS transforms (a mirrored video, a rotated card): the element's and its ancestors' transforms are folded into one linear map.
// Translation needs no maths of its own: an affine map sends the centre of the box to the centre of the bounding box it draws.

/** A point on a surface, as fractions (0 to 1) of the surface element's own box: `x` from its left edge, `y` from its top edge. */
export interface SurfacePoint { readonly x: number; readonly y: number }

interface Frame { readonly width: number; readonly height: number; readonly centre: { readonly x: number; readonly y: number }; readonly a: number; readonly b: number; readonly c: number; readonly d: number }

const ANGLE = /^(-?\d*\.?\d+(?:e[+-]?\d+)?)(deg|grad|rad|turn)?$/i;
const degrees = (text: string): number | undefined => {
  const match = ANGLE.exec(text);
  if (!match) return undefined;
  const value = Number(match[1]);
  const unit = (match[2] ?? 'deg').toLowerCase();
  return unit === 'rad' ? value * 180 / Math.PI : unit === 'grad' ? value * 0.9 : unit === 'turn' ? value * 360 : value;
};

/**
 * One node's own map, in the order CSS applies it: `translate` (no linear part), then `rotate`, then `scale`, then `transform`. The
 * individual properties leave `transform` at `none`, so reading `transform` alone misses `scale: -1 1`. Rotation about the z axis only
 * (the 2D case); a 3D axis is left out, as is perspective.
 */
function nodeMatrix(view: Window, Matrix: typeof DOMMatrix, node: Element): DOMMatrix | undefined {
  const style = view.getComputedStyle(node);
  const rotate = style.getPropertyValue('rotate').trim(), scale = style.getPropertyValue('scale').trim(), transform = style.transform;
  let matrix = new Matrix();
  let any = false;
  if (rotate && rotate !== 'none') {
    const words = rotate.split(/\s+/);
    const angle = degrees(words[words.length - 1]!);
    const axis = words.length === 1 || words[0] === 'z' || (words.length === 4 && words[0] === '0' && words[1] === '0' && Number(words[2]) > 0);
    if (angle !== undefined && axis) { matrix = matrix.rotate(angle); any = true; }
  }
  if (scale && scale !== 'none') {
    const factors = scale.split(/\s+/).map(Number);
    if (factors.length >= 1 && factors.every(Number.isFinite)) { matrix = matrix.scale(factors[0]!, factors[1] ?? factors[0]!); any = true; }
  }
  if (transform && transform !== 'none') {
    try { matrix = matrix.multiply(new Matrix(transform)); any = true; } catch { /* an unparsable transform leaves the node's map as it was */ }
  }
  return any ? matrix : undefined;
}

/** The element's untransformed size, its drawn centre and the linear part of every transform on it and its ancestors. */
function frameOf(element: Element): Frame | undefined {
  const view = element.ownerDocument.defaultView;
  const box = element.getBoundingClientRect();
  const html = element as HTMLElement;
  const width = html.offsetWidth || box.width, height = html.offsetHeight || box.height;
  if (!(width > 0) || !(height > 0)) return undefined;
  let a = 1, b = 0, c = 0, d = 1;
  const Matrix = (view as (Window & typeof globalThis) | null)?.DOMMatrix;
  if (view && typeof Matrix === 'function') {
    for (let node: Element | null = element; node; node = node.parentElement) {
      const matrix = nodeMatrix(view, Matrix, node);
      if (!matrix) continue;
      // The ancestor's map is applied after what we have so far.
      [a, b, c, d] = [matrix.a * a + matrix.c * b, matrix.b * a + matrix.d * b, matrix.a * c + matrix.c * d, matrix.b * c + matrix.d * d];
    }
  }
  if (![a, b, c, d].every(Number.isFinite) || Math.abs(a * d - b * c) < 1e-9) return undefined;
  return { width, height, centre: { x: box.left + box.width / 2, y: box.top + box.height / 2 }, a, b, c, d };
}

const unit = (value: number): number => Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;

/** Where a viewport point falls on the element, as fractions (0 to 1, three decimals) of its own box, whatever transform it is under. */
export function viewportToSurfacePoint(element: Element, clientX: number, clientY: number): SurfacePoint {
  const frame = frameOf(element);
  if (!frame) {
    const box = element.getBoundingClientRect();
    return { x: box.width > 0 ? unit((clientX - box.left) / box.width) : 0.5, y: box.height > 0 ? unit((clientY - box.top) / box.height) : 0.5 };
  }
  const { a, b, c, d, centre, width, height } = frame;
  const dx = clientX - centre.x, dy = clientY - centre.y;
  const det = a * d - b * c;
  const lx = (d * dx - c * dy) / det, ly = (-b * dx + a * dy) / det;
  return { x: unit(0.5 + lx / width), y: unit(0.5 + ly / height) };
}

/** The viewport position of a point of the element (the inverse of `viewportToSurfacePoint`): where a note's bubble goes. */
export function surfacePointToViewport(element: Element, point: SurfacePoint): { readonly x: number; readonly y: number } {
  const frame = frameOf(element);
  if (!frame) {
    const box = element.getBoundingClientRect();
    return { x: box.left + point.x * box.width, y: box.top + point.y * box.height };
  }
  const { a, b, c, d, centre, width, height } = frame;
  const lx = (point.x - 0.5) * width, ly = (point.y - 0.5) * height;
  return { x: centre.x + a * lx + c * ly, y: centre.y + b * lx + d * ly };
}
