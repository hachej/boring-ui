// WCAG contrast measured in the browser: any CSS colour (oklch, color-mix) is turned into sRGB by painting it on a 1x1 canvas and reading the pixel back.
let context;
/** Null where the DOM has no canvas (a headless unit environment): the ratio is then NaN and the page shows n/a, never an invented number. */
const canvas = () => (context ??= Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true }));

/** The sRGB pixel of `color` painted over `layers` (colours painted in order, the first over opaque white: only the root sits over white). */
export function pixel(color, layers = []) {
  const paint = canvas();
  if (!paint) return [Number.NaN, Number.NaN, Number.NaN];
  paint.clearRect(0, 0, 1, 1);
  for (const layer of ['white', ...(Array.isArray(layers) ? layers : [layers]), color]) {
    paint.fillStyle = 'black';
    paint.fillStyle = layer;
    paint.fillRect(0, 0, 1, 1);
  }
  const [red, green, blue] = paint.getImageData(0, 0, 1, 1).data;
  return [red, green, blue];
}

const channel = value => { const unit = value / 255; return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4; };
const luminance = ([red, green, blue]) => 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);

/** The WCAG ratio of two computed colours: the surface is painted over `behind` (what really lies under it), the text over the surface. */
export function contrastRatio(foreground, background, behind = []) {
  const under = [...behind, background];
  const front = luminance(pixel(foreground, under)), back = luminance(pixel(background, behind));
  return (Math.max(front, back) + 0.05) / (Math.min(front, back) + 0.05);
}

// The page's own test drives this with a colour that has an alpha (black on 50% white over black is about 5.3:1).
globalThis.boringDsContrast = contrastRatio;

export const MIN_RATIO = 4.5;
