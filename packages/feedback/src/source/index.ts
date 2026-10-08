// @hachej/boring-feedback/source: the development helper that stamps `data-source="<path>:<line>"` on host elements (WP8).
//
// Build-side only. This module runs inside esbuild (in Node) and never imports React or the browser runtime: it only
// names the runtime module, `@hachej/boring-feedback/source/jsx-dev-runtime`, which esbuild then bundles into the page.
// See docs/architecture/FEEDBACK.md ("Source locations"). A Babel/Vite variant is not part of this package.
import type { ImportKind, OnResolveArgs, OnResolveResult, Plugin, PluginBuild } from 'esbuild';

/** Build modes. Only `development` and `preview` may carry source locations. */
export type FeedbackSourceMode = 'development' | 'preview' | 'production';

export interface FeedbackSourceOptions {
  /**
   * Absolute project root. It must equal the build's `absWorkingDir`: esbuild names each JSX source relative to that
   * directory, so this is what makes stamped paths project-relative. React is resolved from here too, so the page
   * keeps one React instance.
   */
  readonly root: string;
  readonly mode: FeedbackSourceMode;
}

/** The browser runtime module the plugin substitutes for `react/jsx-dev-runtime`. */
export const FEEDBACK_SOURCE_RUNTIME = '@hachej/boring-feedback/source/jsx-dev-runtime';

const REACT_DEV_RUNTIME = 'react/jsx-dev-runtime';
const NAME = 'feedback-source';
// Marks the plugin's own lookup of React's runtime so that lookup is not redirected again.
const ORIGINAL = { feedbackSource: 'react-dev-runtime' } as const;

const trimEnd = (path: string): string => path.replace(/[\\/]+$/, '');
const isAbsolute = (path: string): boolean => /^(?:\/|[A-Za-z]:[\\/])/.test(path);

/**
 * esbuild plugin for development and preview builds.
 *
 * The build must set `bundle: true`, `jsx: 'automatic'`, `jsxDev: true` and `absWorkingDir: root`. Every
 * `react/jsx-dev-runtime` import (except the runtime's own) then resolves to the feedback runtime, which adds
 * `data-source` to intrinsic elements. Production builds are refused: creating the plugin with `mode: 'production'`
 * throws, so a production build that enables it fails.
 */
export function feedbackSourcePlugin(options: FeedbackSourceOptions): Plugin {
  const { root, mode } = options;
  if (mode === 'production') throw new Error(`${NAME}: refusing a production build; source locations are for development and preview builds only`);
  if (mode !== 'development' && mode !== 'preview') throw new Error(`${NAME}: unknown mode ${JSON.stringify(mode)}; expected "development" or "preview"`);
  if (typeof root !== 'string' || !isAbsolute(root)) throw new Error(`${NAME}: root must be an absolute project directory`);
  return {
    name: NAME,
    setup(build: PluginBuild) {
      const initial = build.initialOptions;
      if (initial.bundle !== true) throw new Error(`${NAME}: the build must set bundle: true`);
      if (initial.jsx !== 'automatic' || initial.jsxDev !== true) throw new Error(`${NAME}: the build must set jsx: 'automatic' and jsxDev: true`);
      if (initial.jsxImportSource !== undefined && initial.jsxImportSource !== 'react') throw new Error(`${NAME}: jsxImportSource must be react`);
      if (initial.absWorkingDir === undefined || trimEnd(initial.absWorkingDir) !== trimEnd(root)) {
        throw new Error(`${NAME}: the build must set absWorkingDir to the project root (${root}) so source paths are project-relative`);
      }
      let runtime: Promise<string> | undefined;
      build.onResolve({ filter: /^react\/jsx-dev-runtime$/ }, async (args: OnResolveArgs): Promise<OnResolveResult | undefined> => {
        if (args.pluginData === ORIGINAL) return undefined;
        const path = await (runtime ??= resolveRuntime(build, root, args.kind));
        if (args.importer !== path) return { path };
        const original = await build.resolve(REACT_DEV_RUNTIME, { kind: args.kind, resolveDir: root, pluginData: ORIGINAL });
        if (original.errors.length) return { errors: original.errors };
        return { path: original.path, external: original.external, namespace: original.namespace, sideEffects: original.sideEffects };
      });
    },
  };
}

async function resolveRuntime(build: PluginBuild, root: string, kind: ImportKind): Promise<string> {
  const result = await build.resolve(FEEDBACK_SOURCE_RUNTIME, { kind, resolveDir: root });
  if (result.errors.length || result.external || result.namespace !== 'file') {
    throw new Error(`${NAME}: cannot bundle ${FEEDBACK_SOURCE_RUNTIME} from ${root}; install @hachej/boring-feedback in the project and do not mark it external`);
  }
  return result.path;
}
