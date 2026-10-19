// Node test hook: a stylesheet import (the canvas renderer imports tldraw.css) loads as an empty module. Browsers and bundlers apply the
// real CSS; plain Node tests only exercise the JavaScript behind the canvas.
export async function load(url, context, next) {
  if (url.endsWith('.css')) return { format: 'module', source: 'export default {};', shortCircuit: true };
  return next(url, context);
}
