// @hachej/boring-feedback/source/jsx-dev-runtime: browser code, bundled into development and preview pages by
// `feedbackSourcePlugin`. It is React's JSX development runtime plus one attribute: intrinsic elements get
// `data-source="<path>:<line>"` from the source esbuild passes. It uses no `process` or other Node API, and imports
// nothing but React's own development runtime.
import { Fragment, jsxDEV as reactJsxDEV, type JSXSource } from 'react/jsx-dev-runtime';

export { Fragment };

type Parameter = Parameters<typeof reactJsxDEV>;

/**
 * `<path>:<line>` for a project-relative source, or `undefined` when the path is absolute, carries a drive letter or
 * scheme, or contains `..` (the attribute is then omitted rather than leak or misname a location).
 */
function sourceLocation(source: JSXSource | undefined): string | undefined {
  const file = source?.fileName;
  const line = source?.lineNumber;
  if (typeof file !== 'string' || typeof line !== 'number' || !Number.isInteger(line) || line < 1) return undefined;
  const path = file.replaceAll('\\', '/');
  if (path === '' || path.startsWith('/') || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(path) || path.split('/').includes('..')) return undefined;
  return `${path}:${line}`;
}

const isProps = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

export function jsxDEV(
  type: Parameter[0],
  props: Parameter[1],
  key: Parameter[2],
  isStatic: Parameter[3],
  source?: Parameter[4],
  self?: Parameter[5],
): ReturnType<typeof reactJsxDEV> {
  const location = typeof type === 'string' ? sourceLocation(source) : undefined;
  // Never override an explicit data-source, and never mutate the caller's props object.
  const stamped = location !== undefined && isProps(props) && !Object.hasOwn(props, 'data-source')
    ? { ...props, 'data-source': location }
    : props;
  return reactJsxDEV(type, stamped, key, isStatic, source, self);
}
