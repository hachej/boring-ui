// Ported from examples/canvas-board/mockup-frame.ts on spike/canvas-board (3b838e3a5).
// This entire module is lazy. No document markup is parsed in the host.
import { compile } from 'tailwindcss';
import { sources } from './mockup-tailwind';

export async function compileMockup(html: string): Promise<string> {
  // A compiler per document keeps its accumulated candidates out of unrelated viewers.
  const compiler = await compile(`@layer theme, base, components, utilities;
@import "theme" layer(theme);
@import "preflight" layer(base);
@import "utilities" layer(utilities);
${sources.bindings}
@custom-variant dark (&:where(.dark, .dark *));`, {
    base: '/',
    loadStylesheet: async id => {
      if (id !== 'theme' && id !== 'preflight' && id !== 'utilities') throw new Error('Unsupported stylesheet');
      return { path: id, base: '/', content: sources[id] };
    },
  });
  return compiler.build([...new Set(`${html} bg-background text-foreground`.split(/[\s"'`<>=]+/).filter(Boolean))]);
}
