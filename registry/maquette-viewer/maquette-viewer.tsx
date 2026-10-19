'use client';

// The maquette viewer: a PM agent's `*.maquette.json` mock-up as an overview (the workflow understood, then every screen with where it
// leads) and a play mode that walks the screens through their goto links. `maquetteKind` is the artifact kind the pi-app artifact panel
// uses by default for `.maquette.json` files; an app passes its own kind (or `createMaquetteKind({ locale, labels })`) in `artifactKinds`
// and it wins. It draws data only: nothing in the file runs.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType, KeyboardEvent, ReactNode } from 'react';
import { ArrowLeftIcon, InfoIcon, LayoutGridIcon, LayoutTemplateIcon, PlayIcon, TriangleAlertIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { MAQUETTE_FORMAT_VERSION, isMaquettePath, linksOf, parseMaquette } from './maquette';
import type { Maquette } from './maquette';
import { maquetteLabelsFor } from './maquette-labels';
import type { MaquetteLabels, MaquetteLocale } from './maquette-labels';
import { MaquetteScreenView } from './maquette-blocks';
import { MaquetteDiagram } from './maquette-diagram';

export { MAQUETTE_FORMAT_VERSION, isMaquettePath, linksOf, parseMaquette } from './maquette';
export type { Maquette, MaquetteBlock, MaquetteBlockV1, MaquetteFileV1, MaquetteParse, MaquetteScreen, MaquetteState, MaquetteTransition, MaquetteWorkflow } from './maquette';
export { defaultMaquetteLabels, frenchMaquetteLabels, maquetteLabelsFor } from './maquette-labels';
export type { MaquetteLabels, MaquetteLocale } from './maquette-labels';

export interface MaquetteViewerProps {
  /** The file's text (JSON). */
  readonly text: string;
  /** The base words: English by default. */
  readonly locale?: MaquetteLocale | undefined;
  /** Any word over the locale's. */
  readonly labels?: Partial<MaquetteLabels> | undefined;
}

type Mode = 'overview' | 'play';

function Overview({ maquette, labels, onPlay }: { readonly maquette: Maquette; readonly labels: MaquetteLabels; readonly onPlay: (screen: string) => void }) {
  const [shown, setShown] = useState<string | null>(null);
  const highlight = maquette.cases.find(item => item.name === shown)?.path ?? [];
  const titleOf = (id: string) => maquette.screens.find(screen => screen.id === id)?.title ?? id;
  return <>
    {maquette.workflow && <section aria-label={labels.workflow} data-testid="maquette-workflow" className="flex min-w-0 flex-col gap-3">
      <h3 className="m-0 text-sm font-semibold">{labels.workflow}</h3>
      <Card><CardContent className="flex min-w-0 flex-col gap-4">
        <MaquetteDiagram workflow={maquette.workflow} highlight={highlight} labels={labels} />
        {maquette.cases.length > 0 && <div role="group" aria-label={labels.cases} className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">{labels.cases}</span>
          {maquette.cases.map(item => <Button key={item.name} type="button" size="sm" variant={shown === item.name ? 'secondary' : 'outline'} aria-pressed={shown === item.name}
            data-testid="maquette-case" className="pointer-coarse:min-h-11" onClick={() => setShown(current => current === item.name ? null : item.name)}>{item.name}</Button>)}
        </div>}
      </CardContent></Card>
    </section>}
    <section aria-label={labels.screens} className="flex min-w-0 flex-col gap-3">
      <h3 className="m-0 text-sm font-semibold">{labels.screens}</h3>
      <ul className="m-0 list-none p-0 grid grid-cols-[repeat(auto-fill,minmax(min(100%,17rem),1fr))] gap-4">
        {maquette.screens.map(screen => {
          const leads = linksOf(screen.blocks).filter(id => id !== screen.id && maquette.screens.some(other => other.id === id));
          return <li key={screen.id} className="min-w-0">
            <Card data-testid="maquette-thumb" data-screen={screen.id}>
              <CardHeader>
                <CardTitle>{screen.title}</CardTitle>
                <CardDescription>{leads.length ? labels.leadsTo(leads.map(titleOf).join(', ')) : labels.noLinks}</CardDescription>
                <CardAction><Button type="button" variant="outline" size="sm" className="pointer-coarse:min-h-11" aria-label={labels.tryScreen(screen.title)}
                  data-testid="maquette-try" onClick={() => onPlay(screen.id)}><PlayIcon aria-hidden="true" />{labels.play}</Button></CardAction>
              </CardHeader>
              <CardContent>
                <div inert aria-hidden="true" className="relative h-56 overflow-hidden select-none">
                  <div className="origin-top-left [zoom:0.62]"><MaquetteScreenView maquette={maquette} screen={screen} go={undefined} labels={labels} /></div>
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-linear-to-t from-card" />
                </div>
              </CardContent>
            </Card>
          </li>;
        })}
      </ul>
    </section>
  </>;
}

function Play({ maquette, labels, history, onHistory }: {
  readonly maquette: Maquette; readonly labels: MaquetteLabels; readonly history: readonly string[]; readonly onHistory: (next: readonly string[]) => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const current = maquette.screens.find(screen => screen.id === history.at(-1)) ?? maquette.screens[0]!;
  const go = (id: string) => { if (id !== current.id && maquette.screens.some(screen => screen.id === id)) { moved.current = true; onHistory([...history, id]); } };
  const back = () => { if (history.length > 1) { moved.current = true; onHistory(history.slice(0, -1)); } };
  // After a goto or Back, keyboard focus starts on the new screen's name, so Tab continues inside the screen just opened.
  useEffect(() => { if (moved.current) { moved.current = false; heading.current?.focus(); } }, [current.id]);
  const onKeyDown = (event: KeyboardEvent) => { if (event.altKey && event.key === 'ArrowLeft') { event.preventDefault(); back(); } };
  return <div data-testid="maquette-play" className="flex min-w-0 flex-col gap-3" onKeyDown={onKeyDown}>
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="sm" className="pointer-coarse:min-h-11" data-testid="maquette-back" disabled={history.length < 2} onClick={back}>
        <ArrowLeftIcon aria-hidden="true" />{labels.back}</Button>
      <Label className="ml-auto min-w-0 gap-2"><span className="text-sm text-muted-foreground">{labels.screen}</span>
        <NativeSelect data-testid="maquette-screen-select" className="pointer-coarse:min-h-11" value={current.id} onChange={event => go(event.target.value)}>
          {maquette.screens.map(screen => <NativeSelectOption key={screen.id} value={screen.id}>{screen.title}</NativeSelectOption>)}
        </NativeSelect></Label>
    </div>
    <Card data-testid="maquette-play-frame"><CardContent>
      <MaquetteScreenView key={current.id} maquette={maquette} screen={current} go={go} labels={labels} headingRef={heading} />
    </CardContent></Card>
    <p aria-live="polite" className="m-0 sr-only">{labels.showing(current.title)}</p>
  </div>;
}

/** A maquette file drawn as its overview and play mode; a newer format version shows a notice, an unreadable file an inline error. */
export function MaquetteViewer({ text, locale, labels: given }: MaquetteViewerProps) {
  const labels = useMemo(() => maquetteLabelsFor(locale, given), [locale, given]);
  const parsed = useMemo(() => parseMaquette(text), [text]);
  const [mode, setMode] = useState<Mode>('overview');
  const [history, setHistory] = useState<readonly string[]>([]);
  const newer = parsed.version !== undefined && parsed.version > MAQUETTE_FORMAT_VERSION;
  const notice = newer && <Alert data-testid="maquette-newer"><InfoIcon aria-hidden="true" /><AlertTitle>{labels.newerTitle}</AlertTitle><AlertDescription>{labels.newer(parsed.version!)}</AlertDescription></Alert>;
  const frame = (children: ReactNode, state: string) => <section data-boring="maquette-viewer" data-state={state} data-mode={state === 'ok' ? mode : undefined}
    className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-6 p-4 sm:p-6">{children}</section>;
  if (parsed.kind === 'invalid') return frame(<>{notice}
    <Alert variant="destructive" data-testid="maquette-error" data-reason={parsed.reason}><TriangleAlertIcon aria-hidden="true" /><AlertTitle>{labels.errorTitle}</AlertTitle>
      <AlertDescription>{parsed.reason === 'json' ? labels.invalidJson : labels.invalidShape}</AlertDescription></Alert></>, 'invalid');
  const { maquette } = parsed;
  const play = (screen: string) => { setHistory([screen]); setMode('play'); };
  return frame(<>
    <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="m-0 text-xs font-medium tracking-wide text-muted-foreground uppercase">{labels.kind} · {labels.screenCount(maquette.screens.length)}</p>
        <h2 data-testid="maquette-title" className="m-0 text-lg font-semibold text-balance">{maquette.title || labels.kind}</h2>
        <p className="m-0 text-sm text-pretty text-muted-foreground">{labels.disclaimer}</p>
      </div>
      <ToggleGroup aria-label={labels.mode} variant="outline" value={[mode]} onValueChange={values => {
        if (values[0] === 'play' && mode !== 'play') play(maquette.start);
        else if (values[0] === 'overview') setMode('overview');
      }}>
        <ToggleGroupItem value="overview" data-testid="maquette-overview" className="pointer-coarse:min-h-11"><LayoutGridIcon aria-hidden="true" />{labels.overview}</ToggleGroupItem>
        <ToggleGroupItem value="play" data-testid="maquette-play-mode" className="pointer-coarse:min-h-11"><PlayIcon aria-hidden="true" />{labels.play}</ToggleGroupItem>
      </ToggleGroup>
    </header>
    {notice}
    {mode === 'overview' ? <Overview maquette={maquette} labels={labels} onPlay={play} /> : <Play maquette={maquette} labels={labels} history={history.length ? history : [maquette.start]} onHistory={setHistory} />}
  </>, 'ok');
}

/**
 * The artifact kind of a maquette file (structurally an `ArtifactKind` of pi-chat): it matches `*.maquette.json`, names it, gives its icon
 * and draws it with `MaquetteViewer`. Pass it, or your own, in `artifactKinds`; kinds an app passes are consulted before the built-in one.
 */
export interface MaquetteKind {
  readonly match: (target: { readonly resource: { readonly path: string } }) => boolean;
  readonly label: string;
  readonly icon: ComponentType<{ readonly className?: string; readonly 'aria-hidden'?: boolean | 'true' }>;
  readonly renderer: (props: { readonly text: string }) => ReactNode;
}

/** A maquette kind in `locale` ("Mock-up" in English, "Maquette" in French) with any word overridden. */
export function createMaquetteKind({ locale, labels }: { readonly locale?: MaquetteLocale | undefined; readonly labels?: Partial<MaquetteLabels> | undefined } = {}): MaquetteKind {
  return {
    match: target => isMaquettePath(target.resource.path),
    label: maquetteLabelsFor(locale, labels).kind,
    icon: LayoutTemplateIcon,
    renderer: ({ text }) => <MaquetteViewer text={text} locale={locale} labels={labels} />,
  };
}

/** The built-in maquette kind, in English. */
export const maquetteKind: MaquetteKind = createMaquetteKind();
