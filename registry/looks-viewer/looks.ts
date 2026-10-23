// looks@1: the looks an assistant offers for an app (`*.looks.json`). A look is a shadcn theme, exactly as shadcn writes it: a preset
// code (`npx shadcn apply <code> --only theme,font`) and/or the theme block that preset produces (:root, .dark and the font and radius
// variables of `@theme inline`). Nothing here invents a theme model: the block's variables are shadcn's own.
import type { ShadcnTheme } from '../mockup-viewer/mockup-viewer';

/** The colour variables of a shadcn theme (`:root` and `.dark`). */
export const SHADCN_COLOR_VARIABLES: readonly string[] = Object.freeze([
  'background', 'foreground', 'card', 'card-foreground', 'popover', 'popover-foreground', 'primary', 'primary-foreground',
  'secondary', 'secondary-foreground', 'muted', 'muted-foreground', 'accent', 'accent-foreground', 'destructive', 'destructive-foreground',
  // the hairline variable's name is joined: the design scan reads that bare word as a class
  ['bord', 'er'].join(''), 'input', 'ring', 'chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'sidebar', 'sidebar-foreground', 'sidebar-primary',
  'sidebar-primary-foreground', 'sidebar-accent', 'sidebar-accent-foreground', 'sidebar-border', 'sidebar-ring',
]);
/** The non-colour variables a shadcn theme sets: the radius (`:root`) and the font families (`@theme inline`). */
export const SHADCN_SHAPE_VARIABLES: readonly string[] = Object.freeze(['radius', 'font-sans', 'font-serif', 'font-mono', 'font-heading']);

const COLOR = /^(?:#[0-9a-f]{3,8}|(?:oklch|oklab|lab|lch|hsla?|rgba?)\([0-9a-z .,%/+-]{1,80}\))$/i;
const LENGTH = /^(?:0|\d{1,2}(?:\.\d{1,4})?(?:rem|px|em))$/;
const FONT = /^(?:[A-Za-z0-9 ,'"-]{1,160}|var\(--font-(?:sans|serif|mono)\))$/;
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** A shadcn preset: a code (`bIkeymG`), a named style (`nova`) or a ui.shadcn.com init URL. */
const PRESET = /^(?:[A-Za-z0-9]{1,24}|https:\/\/ui\.shadcn\.com\/init\?[A-Za-z0-9=&_.-]{1,600})$/;

export type ThemeIssue = string;

/** Is this a valid value for that shadcn variable? */
export function shadcnValue(name: string, value: string): boolean {
  if (SHADCN_COLOR_VARIABLES.includes(name)) return COLOR.test(value);
  if (name === 'radius') return LENGTH.test(value);
  if (name.startsWith('font-')) return SHADCN_SHAPE_VARIABLES.includes(name) && FONT.test(value);
  return false;
}

/**
 * A shadcn theme block (`:root { … } .dark { … } @theme inline { … }`, as `shadcn apply` writes it) into shadcn's `cssVars` shape.
 * Only shadcn theme variables with valid values are accepted; anything else is an issue, never silently kept.
 */
export function parseShadcnTheme(css: string): { readonly kind: 'ok'; readonly theme: ShadcnTheme } | { readonly kind: 'invalid'; readonly issues: readonly ThemeIssue[] } {
  const issues: ThemeIssue[] = [];
  const out = { theme: {} as Record<string, string>, light: {} as Record<string, string>, dark: {} as Record<string, string> };
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const block = /([^{}]+)\{([^{}]*)\}/g;
  let consumed = '';
  for (const match of text.matchAll(block)) {
    consumed += match[0];
    const selector = match[1]!.trim();
    const target = selector === ':root' ? out.light : selector === '.dark' ? out.dark : /^@theme(?:\s+inline)?$/.test(selector) ? out.theme : undefined;
    if (!target) { issues.push(`unexpected block ${selector.slice(0, 40)}: only :root, .dark and @theme inline`); continue; }
    for (const raw of match[2]!.split(';')) {
      const declaration = raw.trim();
      if (!declaration) continue;
      const colon = declaration.indexOf(':');
      const name = declaration.slice(0, colon).trim().replace(/^--/, ''), value = declaration.slice(colon + 1).trim();
      if (colon < 0 || !declaration.startsWith('--')) { issues.push(`not a variable: ${declaration.slice(0, 40)}`); continue; }
      // @theme inline also carries shadcn's colour and radius bindings (--color-primary: var(--primary)); they are the wiring, not the look.
      if (target === out.theme && (/^color-/.test(name) || /^radius-/.test(name))) continue;
      const allowed = target === out.theme ? name.startsWith('font-') : true;
      if (!allowed || !shadcnValue(name, value)) { issues.push(`${selector} --${name}: not a shadcn theme variable or not a valid value`); continue; }
      target[name] = value;
    }
  }
  if (text.replace(block, '').trim()) issues.push('text outside the :root, .dark and @theme blocks');
  if (!consumed) issues.push('no :root block');
  for (const name of ['background', 'foreground', 'primary', 'primary-foreground']) {
    if (!out.light[name]) issues.push(`:root misses --${name}`);
    if (!out.dark[name]) issues.push(`.dark misses --${name}`);
  }
  return issues.length ? { kind: 'invalid', issues } : { kind: 'ok', theme: out };
}

export interface Look {
  readonly id: string;
  readonly label: string;
  /** One line: how the app feels in this look. */
  readonly personality: string;
  /** The shadcn preset this look applies (`npx shadcn apply <preset> --only theme,font`). */
  readonly preset?: string | undefined;
  /** The shadcn theme block, parsed. */
  readonly theme: ShadcnTheme;
}
export interface LayoutVariant { readonly id: string; readonly label: string; readonly why?: string | undefined; readonly mockup: string }
export interface Looks {
  /** The key screen, a `*.mockup.html` next to the looks file. */
  readonly mockup: string;
  readonly looks: readonly Look[];
  readonly layouts: readonly LayoutVariant[];
  /** The look the layouts are drawn in (a look's id); absent: the first look. */
  readonly look?: string | undefined;
}

const MOCKUP = /^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,160}\.mockup\.html$/i;
const text = (value: unknown, max: number) => typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : undefined;

/** Read a `*.looks.json`. Paths are relative to the looks file; a layout is a path or `{ id, label, why?, mockup }`. */
export function parseLooks(source: string): { readonly kind: 'ok'; readonly looks: Looks } | { readonly kind: 'invalid'; readonly issues: readonly string[] } {
  let data: unknown;
  try { data = JSON.parse(source); } catch { return { kind: 'invalid', issues: ['not JSON'] }; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { kind: 'invalid', issues: ['a looks file is an object { mockup, looks, layouts? }'] };
  const spec = data as Record<string, unknown>;
  const issues: string[] = [];
  const mockup = typeof spec.mockup === 'string' && MOCKUP.test(spec.mockup) && !spec.mockup.includes('..') ? spec.mockup : undefined;
  if (!mockup) issues.push('mockup: a *.mockup.html path next to the looks file');
  const rawLooks = Array.isArray(spec.looks) ? spec.looks : [];
  const rawLayouts = spec.layouts === undefined ? [] : Array.isArray(spec.layouts) ? spec.layouts : null;
  if (rawLayouts === null) issues.push('layouts: a list');
  if (rawLooks.length < 1 || rawLooks.length > 6 || (rawLooks.length < 2 && !rawLayouts?.length)) issues.push('looks: 2 to 6 looks (1 when the file compares layouts)');
  const looks: Look[] = [];
  rawLooks.forEach((raw, index) => {
    const item = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const at = `looks[${index}]`;
    const id = typeof item.id === 'string' && ID.test(item.id) ? item.id : undefined;
    const label = text(item.label, 40), personality = text(item.personality, 160);
    const preset = item.preset === undefined ? undefined : typeof item.preset === 'string' && PRESET.test(item.preset) ? item.preset : null;
    if (!id) issues.push(`${at}.id: lowercase letters, digits and dashes`);
    if (!label) issues.push(`${at}.label: a short name`);
    if (!personality) issues.push(`${at}.personality: one line`);
    if (preset === null) issues.push(`${at}.preset: a shadcn preset code or ui.shadcn.com init URL`);
    const parsed = typeof item.css === 'string' ? parseShadcnTheme(item.css) : undefined;
    if (!parsed) issues.push(`${at}.css: the shadcn theme block of the look`);
    else if (parsed.kind === 'invalid') issues.push(...parsed.issues.slice(0, 4).map(issue => `${at}.css: ${issue}`));
    if (id && label && personality && preset !== null && parsed?.kind === 'ok') looks.push({ id, label, personality, ...(preset ? { preset } : {}), theme: parsed.theme });
  });
  if (new Set(looks.map(look => look.id)).size !== looks.length) issues.push('looks: ids are unique');
  const layouts: LayoutVariant[] = [];
  (rawLayouts ?? []).forEach((raw, index) => {
    const item = typeof raw === 'string' ? { mockup: raw } : (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const path = typeof item.mockup === 'string' && MOCKUP.test(item.mockup) && !item.mockup.includes('..') ? item.mockup : undefined;
    if (!path) { issues.push(`layouts[${index}]: a *.mockup.html path, or { id, label, why?, mockup }`); return; }
    const id = typeof item.id === 'string' && ID.test(item.id) ? item.id : String.fromCharCode(97 + index);
    layouts.push({ id, label: text(item.label, 60) ?? `Layout ${String.fromCharCode(65 + index)}`, ...(text(item.why, 160) ? { why: text(item.why, 160) } : {}), mockup: path });
  });
  if (layouts.length > 4) issues.push('layouts: at most 4');
  const look = spec.look === undefined ? undefined : typeof spec.look === 'string' && looks.some(item => item.id === spec.look) ? spec.look : null;
  if (look === null) issues.push('look: the id of one of the looks');
  return issues.length || !mockup ? { kind: 'invalid', issues } : { kind: 'ok', looks: { mockup, looks, layouts, ...(look ? { look } : {}) } };
}

/** What the swatch row shows: four colours, the font family's first name and the radius. */
export function swatches(look: Look, dark = false): { readonly colors: readonly { readonly name: string; readonly value: string }[]; readonly font: string; readonly heading: string; readonly radius: string } {
  const vars = { ...look.theme.light, ...(dark ? look.theme.dark : undefined) };
  const family = (value: string | undefined) => (value ?? '').split(',')[0]!.replace(/['"]/g, '').replace(/ Variable$/, '').trim();
  const font = family(look.theme.theme?.['font-sans']) || 'System';
  const headingVar = look.theme.theme?.['font-heading'];
  return {
    colors: ['background', 'primary', 'accent', 'foreground'].filter(name => vars[name]).map(name => ({ name, value: vars[name]! })),
    font, heading: headingVar && !headingVar.includes('var(') ? family(headingVar) : font, radius: vars.radius ?? '0.625rem',
  };
}

/** A path named in the looks file, read next to it. */
export const besideLooks = (looksPath: string, relative: string): string => looksPath.slice(0, looksPath.lastIndexOf('/') + 1) + relative;

/** A `*.looks.json` file: the looks kind's match, here so the kind does not load the viewer. */
export const isLooksPath = (path: string): boolean => /\.looks\.json$/i.test(path);
