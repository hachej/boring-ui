'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { CheckIcon, PaletteIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { MockupViewer } from '../mockup-viewer/mockup-viewer';
import type { ShadcnTheme } from '../mockup-viewer/mockup-viewer';
import { besideLooks, parseLooks, swatches } from './looks';
import type { Look, Looks } from './looks';

export { parseLooks, parseShadcnTheme, swatches, besideLooks, shadcnValue, SHADCN_COLOR_VARIABLES, SHADCN_SHAPE_VARIABLES } from './looks';
export type { Look, Looks, LayoutVariant } from './looks';

export const isLooksPath = (path: string): boolean => /\.looks\.json$/i.test(path);

/** The person pressed Pick: the host says it in the conversation (or records it); the viewer only marks it. */
export interface LookPick {
  readonly kind: 'look' | 'layout';
  readonly id: string;
  readonly label: string;
  /** The looks file the pick was made in. */
  readonly path: string;
}

export interface LooksViewerProps {
  readonly text: string;
  readonly path?: string | undefined;
  /** Another file of the workspace as text (the artifact panel's `read`): the key screen and the layouts, next to the looks file. */
  readonly read?: ((path: string) => Promise<string | undefined>) | undefined;
  readonly onPick?: ((pick: LookPick) => void) | undefined;
  readonly locale?: 'en' | 'fr' | undefined;
  readonly onReady?: (() => void) | undefined;
  readonly onFailed?: ((reason: string) => void) | undefined;
}

const LABELS = {
  en: { looks: 'Pick a look', layouts: 'Pick a layout', layoutsIn: (look: string) => `In the ${look} look`, pick: 'Pick', picked: 'Picked', light: 'Light', dark: 'Dark',
    loading: 'Loading the looks…', missing: 'The key screen cannot be read.', invalid: 'These looks cannot be shown', font: 'Font', radius: 'Roundness', look: (label: string) => `${label} look`, layout: (label: string) => `${label} layout` },
  fr: { looks: 'Choisir un style', layouts: 'Choisir une mise en page', layoutsIn: (look: string) => `Dans le style ${look}`, pick: 'Choisir', picked: 'Choisi', light: 'Clair', dark: 'Sombre',
    loading: 'Chargement des styles…', missing: "L'écran clé est illisible.", invalid: 'Ces styles ne peuvent pas être affichés', font: 'Police', radius: 'Arrondi', look: (label: string) => `Style ${label}`, layout: (label: string) => `Mise en page ${label}` },
} as const;

/** The key screen drawn at a desktop (or, in a narrow column, phone) width and scaled into the card, so a look reads as the whole app. */
function ScaledMockup({ text, theme, mode, title, onReady }: { readonly text: string; readonly theme: ShadcnTheme; readonly mode?: 'light' | 'dark' | undefined; readonly title: string; readonly onReady: () => void }) {
  const outer = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = outer.current;
    if (!element) return undefined;
    const measure = () => setWidth(element.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // A phone draws the phone layout of the screen; a narrow column on a desktop still draws the desktop one, smaller.
  const phone = typeof matchMedia === 'function' && matchMedia('(max-width: 639px)').matches;
  const virtual = phone ? { w: 390, h: 640 } : { w: 1024, h: 600 };
  const scale = width > 0 ? width / virtual.w : 0.5;
  return <div ref={outer} data-testid="looks-frame" className="relative w-full overflow-hidden bg-muted" style={{ height: Math.round(virtual.h * scale) }}>
    <div className="absolute top-0 left-0 origin-top-left" style={{ width: virtual.w, height: virtual.h, transform: `scale(${scale})` }}>
      <MockupViewer text={text} themeOverride={theme} mode={mode} title={title} onReady={onReady} />
    </div>
  </div>;
}

/** The swatch's corner, in a 15px square: a rem radius at 16px, capped. */
const corner = (radius: string) => Math.min(15, Math.max(0, parseFloat(radius) * (radius.endsWith('px') ? 1 : 16)));

function Swatches({ look, dark, labels }: { readonly look: Look; readonly dark: boolean; readonly labels: (typeof LABELS)['en' | 'fr'] }) {
  const swatch = swatches(look, dark);
  return <div data-testid="looks-swatches" className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
    <svg role="img" aria-label={swatch.colors.map(color => color.name).join(', ')} width={swatch.colors.length * 20} height="18" viewBox={`0 0 ${swatch.colors.length * 20} 18`}>
      {swatch.colors.map((color, index) => <circle key={color.name} cx={index * 20 + 9} cy="9" r="8" fill={color.value} stroke="currentColor" strokeOpacity="0.3"><title>{`${color.name}: ${color.value}`}</title></circle>)}
    </svg>
    <span title={labels.font} style={{ fontFamily: look.theme.theme?.['font-sans'] }}>{swatch.heading === swatch.font ? swatch.font : `${swatch.heading} / ${swatch.font}`}</span>
    <span className="flex items-center gap-1" title={labels.radius}><svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18"><path d={`M2 17 V${2 + corner(swatch.radius)} Q2 2 ${2 + corner(swatch.radius)} 2 H17`} fill="none" stroke="currentColor" strokeWidth="2" /></svg>{swatch.radius}</span>
  </div>;
}

export function LooksViewer({ text, path = '', read, onPick, locale = 'en', onReady, onFailed }: LooksViewerProps) {
  const labels = LABELS[locale];
  const parsed = useMemo(() => parseLooks(text), [text]);
  const spec: Looks | undefined = parsed.kind === 'ok' ? parsed.looks : undefined;
  const sources = useMemo(() => spec ? [...new Set([spec.mockup, ...spec.layouts.map(layout => layout.mockup)])] : [], [spec]);
  const [files, setFiles] = useState<{ readonly key: string; readonly texts: ReadonlyMap<string, string> } | 'missing'>();
  const key = JSON.stringify([path, sources]);
  useEffect(() => {
    if (!sources.length) return undefined;
    let live = true;
    setFiles(undefined);
    void Promise.all(sources.map(async relative => [relative, read ? await read(besideLooks(path, relative)).catch(() => undefined) : undefined] as const)).then(entries => {
      if (!live) return;
      if (entries.some(([, value]) => value === undefined)) { setFiles('missing'); onFailed?.('a mock-up named by the looks file cannot be read'); return; }
      setFiles({ key, texts: new Map(entries as [string, string][]) });
    });
    return () => { live = false; };
  }, [key, read]); // eslint-disable-line react-hooks/exhaustive-deps
  const [mode, setMode] = useState<'light' | 'dark' | undefined>();
  const [look, setLook] = useState<string | undefined>(spec?.look);
  const [layout, setLayout] = useState<string>();
  useEffect(() => { setLook(spec?.look); setLayout(undefined); }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  const frames = spec ? (spec.looks.length > 1 ? spec.looks.length : 0) + spec.layouts.length : 0;
  const ready = useRef(new Set<string>());
  useEffect(() => { ready.current = new Set(); }, [text]);
  const frameReady = useCallback((id: string) => () => {
    ready.current.add(id);
    if (ready.current.size === frames) onReady?.();
  }, [frames, onReady]);
  useEffect(() => { if (parsed.kind === 'invalid') onFailed?.(`invalid looks file: ${parsed.issues.slice(0, 3).join('; ')}`); }, [parsed]); // eslint-disable-line react-hooks/exhaustive-deps
  if (parsed.kind === 'invalid' || !spec) return <Alert role="alert" data-testid="looks-invalid"><AlertTitle>{labels.invalid}</AlertTitle>
    <AlertDescription>{parsed.kind === 'invalid' ? parsed.issues.slice(0, 6).join('; ') : ''}</AlertDescription></Alert>;
  if (files === 'missing') return <Alert role="alert"><AlertTitle>{labels.missing}</AlertTitle></Alert>;
  if (!files || files.key !== key) return <p role="status" className="p-3 text-muted-foreground">{labels.loading}</p>;
  const keyScreen = files.texts.get(spec.mockup)!;
  const inLook = spec.looks.find(item => item.id === look) ?? spec.looks.find(item => item.id === spec.look) ?? spec.looks[0]!;
  const dark = mode === 'dark';
  const pick = (kind: LookPick['kind'], id: string, label: string) => { if (kind === 'look') setLook(id); else setLayout(id); onPick?.({ kind, id, label, path }); };
  return <div data-boring="looks-viewer" className="flex flex-col gap-6 p-3 md:p-4">
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-lg font-semibold">{spec.looks.length > 1 ? labels.looks : labels.layouts}</h2>
      <ToggleGroup value={[mode ?? 'host']} onValueChange={(value: unknown[]) => { const next = value[0]; setMode(next === 'light' || next === 'dark' ? next : undefined); }} aria-label={`${labels.light} / ${labels.dark}`}>
        <ToggleGroupItem value="light" data-testid="looks-light">{labels.light}</ToggleGroupItem>
        <ToggleGroupItem value="dark" data-testid="looks-dark">{labels.dark}</ToggleGroupItem>
      </ToggleGroup>
    </div>
    {spec.looks.length > 1 && <section aria-label={labels.looks} data-testid="looks-grid" className="grid gap-4 md:grid-cols-2">
      {spec.looks.map(item => <Choice key={item.id} testId={`look-${item.id}`} title={item.label} line={item.personality} chosen={inLook.id === item.id && look !== undefined} labels={labels}
        onPick={() => pick('look', item.id, item.label)} extra={<Swatches look={item} dark={dark} labels={labels} />}>
        <ScaledMockup text={keyScreen} theme={item.theme} mode={mode} title={labels.look(item.label)} onReady={frameReady(`look:${item.id}`)} />
      </Choice>)}
    </section>}
    {spec.layouts.length > 0 && <section aria-label={labels.layouts} data-testid="layouts-grid" className="flex flex-col gap-3">
      {spec.looks.length > 1 && <h2 className="text-lg font-semibold">{labels.layouts}</h2>}
      <p className="text-sm text-muted-foreground">{labels.layoutsIn(inLook.label)}</p>
      <div className={spec.layouts.length > 2 ? 'grid gap-4 md:grid-cols-2 xl:grid-cols-3' : 'grid gap-4 md:grid-cols-2'}>
        {spec.layouts.map(item => <Choice key={item.id} testId={`layout-${item.id}`} title={item.label} line={item.why} chosen={layout === item.id} labels={labels} onPick={() => pick('layout', item.id, item.label)}>
          <ScaledMockup text={files.texts.get(item.mockup)!} theme={inLook.theme} mode={mode} title={labels.layout(item.label)} onReady={frameReady(`layout:${item.id}`)} />
        </Choice>)}
      </div>
    </section>}
  </div>;
}

function Choice({ testId, title, line, chosen, labels, onPick, extra, children }: { readonly testId: string; readonly title: string; readonly line?: string | undefined; readonly chosen: boolean; readonly labels: (typeof LABELS)['en' | 'fr']; readonly onPick: () => void; readonly extra?: ReactNode; readonly children: ReactNode }) {
  return <Card data-testid={testId} data-chosen={chosen ? '' : undefined}>
    <CardContent>{children}</CardContent>
    <CardHeader>
      <CardTitle>{title}</CardTitle>
      {line && <CardDescription>{line}</CardDescription>}
      <CardAction>
        <Button size="sm" variant={chosen ? 'default' : 'outline'} aria-pressed={chosen} data-testid={`${testId}-pick`} onClick={onPick}>
          {chosen && <CheckIcon data-icon="inline-start" aria-hidden="true" />}{chosen ? labels.picked : labels.pick}
        </Button>
      </CardAction>
      {extra}
    </CardHeader>
  </Card>;
}

export interface LooksKind {
  readonly match: (target: { readonly resource: { readonly path: string } }) => boolean;
  readonly label: string;
  readonly icon: ComponentType<{ readonly className?: string; readonly 'aria-hidden'?: boolean | 'true' }>;
  readonly renderer: (props: { readonly text: string; readonly onReady?: (() => void) | undefined; readonly onFailed?: ((reason: string) => void) | undefined; readonly read?: ((path: string) => Promise<string | undefined>) | undefined; readonly artifact?: { readonly target: { readonly resource: { readonly path: string } } } | undefined }) => ReactNode;
  readonly waitsForReady: true;
}

/** The `*.looks.json` kind: opt-in, like the board. `onPick` is the host's (the PM page says the pick in the conversation). */
export function createLooksKind({ onPick, locale }: { readonly onPick?: ((pick: LookPick) => void) | undefined; readonly locale?: 'en' | 'fr' | undefined } = {}): LooksKind {
  return { match: target => isLooksPath(target.resource.path), label: locale === 'fr' ? 'Styles' : 'Looks', icon: PaletteIcon, waitsForReady: true,
    renderer: ({ text, artifact, read, onReady, onFailed }) => <LooksViewer key={artifact?.target.resource.path} text={text} path={artifact?.target.resource.path} read={read} onPick={onPick} locale={locale} onReady={onReady} onFailed={onFailed} /> };
}
