// Browser stand-in for `node:path`: the POSIX subset the virtual workspace and git service use.
const normalizeParts = (path: string, absolute: boolean): string[] => {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (out.length && out.at(-1) !== '..') out.pop(); else if (!absolute) out.push('..'); } else out.push(part);
  }
  return out;
};
export function normalize(path: string): string {
  if (path === '') return '.';
  const absolute = path.startsWith('/'), trailing = path.endsWith('/');
  const joined = normalizeParts(path, absolute).join('/');
  return `${absolute ? '/' : ''}${joined || (absolute ? '' : '.')}${trailing && joined ? '/' : ''}`;
}
export const isAbsolute = (path: string): boolean => path.startsWith('/');
export const join = (...parts: string[]): string => normalize(parts.filter(part => part !== '').join('/') || '.');
export function resolve(...parts: string[]): string {
  let path = '';
  for (let i = parts.length - 1; i >= 0 && !path.startsWith('/'); i--) path = parts[i] ? `${parts[i]}${path ? `/${path}` : ''}` : path;
  if (!path.startsWith('/')) path = `/${path}`;
  const normal = normalize(path);
  return normal.length > 1 && normal.endsWith('/') ? normal.slice(0, -1) : normal;
}
export function dirname(path: string): string {
  const normal = path.length > 1 ? path.replace(/\/+$/, '') : path;
  const index = normal.lastIndexOf('/');
  return index < 0 ? '.' : index === 0 ? '/' : normal.slice(0, index);
}
export function basename(path: string, extension?: string): string {
  const base = path.replace(/\/+$/, '').split('/').pop() ?? '';
  return extension && base.endsWith(extension) && base !== extension ? base.slice(0, -extension.length) : base;
}
export const extname = (path: string): string => { const base = basename(path), dot = base.lastIndexOf('.'); return dot > 0 ? base.slice(dot) : ''; };
export function relative(from: string, to: string): string {
  const a = resolve(from).split('/').filter(Boolean), b = resolve(to).split('/').filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/');
}
export const sep = '/', delimiter = ':';
export const posix: Record<string, unknown> = { normalize, isAbsolute, join, resolve, dirname, basename, extname, relative, sep, delimiter };
posix['posix'] = posix;
export default posix;
