// Points on a surface (FeedbackSurface): viewport coordinates to fractions of the element's own box, and back. The element may sit
// under CSS transforms (a mirrored video, a rotated card): the element's and its ancestors' transforms are folded into one linear map.
// Translation needs no maths of its own: an affine map sends the centre of the box to the centre of the bounding box it draws.

/** A point on a surface, as fractions (0 to 1) of the surface element's own box: `x` from its left edge, `y` from its top edge. */
export interface SurfacePoint { readonly x: number; readonly y: number }

interface Frame { readonly width: number; readonly height: number; readonly centre: { readonly x: number; readonly y: number }; readonly a: number; readonly b: number; readonly c: number; readonly d: number }

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
      const css = view.getComputedStyle(node).transform;
      if (!css || css === 'none') continue;
      let matrix: DOMMatrix;
      try { matrix = new Matrix(css); } catch { continue; }
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
