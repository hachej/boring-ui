// Compiles a preview's TSX with sucrase and evaluates it against an import allowlist. Any other import throws before the component renders.
import { transform } from 'sucrase';

export type Modules = Readonly<Record<string, unknown>>;

/** Returns the component the source exports (default, else the first exported function). Throws a readable message otherwise. */
export function compileComponent(source: string, modules: Modules): (props: Record<string, unknown>) => unknown {
  const { code } = transform(source, { transforms: ['typescript', 'jsx', 'imports'], jsxRuntime: 'automatic', production: true, filePath: 'preview.tsx' });
  const module = { exports: {} as Record<string, unknown> };
  const require = (name: string): unknown => {
    if (!Object.hasOwn(modules, name)) throw new Error(`Import "${name}" is not allowed in a preview (allowed: ${Object.keys(modules).join(', ')})`);
    return modules[name];
  };
  // The sandbox is the boundary (opaque origin, CSP connect-src 'none'); the allowlist makes a stray import a readable error. See the CSP note in preview-frame.html.
  new Function('require', 'module', 'exports', code)(require, module, module.exports);
  const found = module.exports.default ?? Object.values(module.exports).find(value => typeof value === 'function');
  if (typeof found !== 'function') throw new Error('The preview must export a component (export default function …)');
  return found as (props: Record<string, unknown>) => unknown;
}
