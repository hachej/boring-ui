import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// Tailwind inlines these defaults and prunes unused custom properties. Expose the
// identical installed values for measurement without changing any component rule.
const tailwind = readFileSync(require.resolve('tailwindcss/theme.css'), 'utf8');
const shadows = [...tailwind.matchAll(/(--shadow-(?:xs|sm|md|lg|xl|2xl)):\s*([^;]+);/g)].map(([, name, value]) => `${name}:${value};`).join('');
export const stockShadowTokens = `:root{${shadows}}`;

export const brandCss = readFileSync(new URL('./brand.css', import.meta.url), 'utf8');
// Example-only opt-in. No fixture, reset or selector override is installed into a consumer.
export const themePreviewHead = `<script>(() => {
  const query = new URLSearchParams(location.search);
  if (query.get('mode') === 'dark') document.documentElement.classList.add('dark');
  if (query.get('theme') === 'brand') {
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = '/__test/brand.css';
    document.head.append(link);
  }
})()</script>`;
export const themePreviewStatics = { '/__test/brand.css': ['text/css; charset=utf-8', brandCss] };
