'use client';

// The maquette viewer: a PM agent's `*.maquette.json` mock-up, one screen at a time at full size. A stepper walks the screens (Previous,
// Next, arrow keys, swipe on a phone), goto blocks open their screen, Back and the breadcrumb follow the path taken, and a case with
// `steps` is a guided tour with a caption per step. The workflow sits in a collapsed "How it works" section. `maquetteKind` is the kind
// the pi-app artifact panel uses by default for `.maquette.json` files; an app's own kind in `artifactKinds` wins. It draws data only.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType, KeyboardEvent, ReactNode, TouchEvent } from 'react';
import { ArrowLeftIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, CompassIcon, InfoIcon, LayoutTemplateIcon, TriangleAlertIcon, XIcon } from 'lucide-react';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Separator } from '@/components/ui/separator';
import { MAQUETTE_FORMAT_VERSION, isMaquettePath, parseMaquette, screenFromFragment } from './maquette';
import type { Maquette, MaquetteCase, MaquetteScreen } from './maquette';
import { maquetteLabelsFor } from './maquette-labels';
import type { MaquetteLabels, MaquetteLocale } from './maquette-labels';
import { MaquetteScreenView } from './maquette-blocks';
import type { MaquetteLinks } from './maquette-blocks';
import { MaquetteDiagram } from './maquette-diagram';

export { MAQUETTE_FORMAT_VERSION, isMaquettePath, linksOf, parseMaquette, screenFromFragment } from './maquette';
export type { Maquette, MaquetteBlock, MaquetteBlockV1, MaquetteCase, MaquetteFileV1, MaquetteParse, MaquetteScreen, MaquetteState, MaquetteTransition, MaquetteWorkflow } from './maquette';
export { defaultMaquetteLabels, frenchMaquetteLabels, maquetteLabelsFor } from './maquette-labels';
export type { MaquetteLabels, MaquetteLocale } from './maquette-labels';

export interface MaquetteViewerProps {
  /** The file's text (JSON). */
  readonly text: string;
  /** The page's URL fragment: `screen=<id>` opens that screen (and follows later changes). */
  readonly fragment?: string | undefined;
  /** The base words: English by default. */
  readonly locale?: MaquetteLocale | undefined;
  /** Any word over the locale's. */
  readonly labels?: Partial<MaquetteLabels> | undefined;
}

/** Where the person is: the screens visited (the last is shown) and the guided tour under way. */
interface Walk { readonly history: readonly string[]; readonly tour: { readonly name: string; readonly index: number } | null }

const TYPING = 'input, select, textarea, [contenteditable="true"]';

/** The screen in its frame: a light phone or desktop frame when the maquette asks for one, the panel's width otherwise. */
function Frame({ device, title, children }: { readonly device: Maquette['device']; readonly title: string; readonly children: ReactNode }) {
  if (device === 'phone') return <div className="mx-auto w-full max-w-sm"><Card data-testid="maquette-frame" data-device="phone">
    <div aria-hidden="true" className="flex justify-center"><span className="block h-1 w-14 bg-muted" /></div>
    <CardContent>{children}</CardContent>
  </Card></div>;
  if (device === 'desktop') return <Card data-testid="maquette-frame" data-device="desktop">
    <div aria-hidden="true" className="flex items-center gap-1.5 px-4">
      {[0, 1, 2].map(dot => <span key={dot} className="block size-2 bg-muted" />)}
      <span className="ml-2 min-w-0 truncate text-xs text-muted-foreground">{title}</span>
    </div>
    <Separator />
    <CardContent>{children}</CardContent>
  </Card>;
  return <Card data-testid="maquette-frame" data-device="panel"><CardContent>{children}</CardContent></Card>;
}

function HowItWorks({ maquette, labels }: { readonly maquette: Maquette; readonly labels: MaquetteLabels }) {
  const [shown, setShown] = useState<string | null>(null);
  const highlighted = maquette.cases.filter(item => item.path.length > 0);
  if (!maquette.workflow) return null;
  return <Collapsible data-testid="maquette-how" className="flex min-w-0 flex-col gap-3">
    <CollapsibleTrigger render={<Button type="button" variant="ghost" className="group w-fit pointer-coarse:min-h-11" data-testid="maquette-how-toggle" />}>
      <ChevronDownIcon aria-hidden="true" className="transition-transform group-data-panel-open:rotate-180" />{labels.howItWorks}
    </CollapsibleTrigger>
    <CollapsibleContent>
      <Card><CardContent className="flex min-w-0 flex-col gap-4">
        <MaquetteDiagram workflow={maquette.workflow} highlight={highlighted.find(item => item.name === shown)?.path ?? []} labels={labels} />
        {highlighted.length > 0 && <div role="group" aria-label={labels.cases} className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">{labels.cases}</span>
          {highlighted.map(item => <Button key={item.name} type="button" size="sm" variant={shown === item.name ? 'secondary' : 'outline'} aria-pressed={shown === item.name}
            data-testid="maquette-case" className="pointer-coarse:min-h-11" onClick={() => setShown(current => current === item.name ? null : item.name)}>{item.name}</Button>)}
        </div>}
      </CardContent></Card>
    </CollapsibleContent>
  </Collapsible>;
}

function Walkthrough({ maquette, labels, fragment }: { readonly maquette: Maquette; readonly labels: MaquetteLabels; readonly fragment: string | undefined }) {
  const exists = (id: string | undefined): id is string => !!id && maquette.screens.some(screen => screen.id === id);
  const linked = screenFromFragment(fragment);
  const [walk, setWalk] = useState<Walk>(() => ({ history: [exists(linked) ? linked : maquette.start], tour: null }));
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const screens = maquette.screens;
  const current: MaquetteScreen = screens.find(screen => screen.id === walk.history.at(-1)) ?? screens[0]!;
  const position = screens.indexOf(current);
  const tour: MaquetteCase | undefined = walk.tour ? maquette.cases.find(item => item.name === walk.tour!.name) : undefined;
  const tours = maquette.cases.filter(item => item.steps.length > 0);
  const titleOf = (id: string) => screens.find(screen => screen.id === id)?.title ?? id;

  const move = (next: Walk) => { moved.current = true; setWalk(next); };
  const go = (id: string) => { if (exists(id) && id !== current.id) move({ history: [...walk.history, id], tour: null }); };
  const step = (delta: number) => {
    if (tour && walk.tour) {
      const index = walk.tour.index + delta, target = tour.steps[index];
      if (target) move({ history: [...walk.history, target.screen], tour: { name: tour.name, index } });
      return;
    }
    const target = screens[position + delta];
    if (target) move({ history: [...walk.history, target.id], tour: null });
  };
  const back = () => { if (walk.history.length > 1) move({ history: walk.history.slice(0, -1), tour: null }); };
  const startTour = (item: MaquetteCase) => move({ history: [...walk.history, item.steps[0]!.screen], tour: { name: item.name, index: 0 } });
  // A later `#screen=<id>` (the PM's "see screen 2" link) opens that screen.
  useEffect(() => { if (exists(linked) && linked !== walk.history.at(-1)) setWalk(previous => ({ history: [...previous.history, linked], tour: null })); }, [linked]); // eslint-disable-line react-hooks/exhaustive-deps
  // After a move, keyboard focus starts on the new screen's name, so Tab continues inside the screen just opened.
  useEffect(() => { if (moved.current) { moved.current = false; heading.current?.focus(); } }, [walk]);

  const index = tour && walk.tour ? walk.tour.index : position, count = tour ? tour.steps.length : screens.length;
  const links: MaquetteLinks = { go, hint: id => labels.opens(titleOf(id)) };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || (event.target as Element).closest?.(TYPING)) return;
    if (event.altKey) { if (event.key === 'ArrowLeft') { event.preventDefault(); back(); } return; }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); step(event.key === 'ArrowLeft' ? -1 : 1); }
  };
  const onTouchStart = (event: TouchEvent) => { const point = event.touches[0]; touch.current = point ? { x: point.clientX, y: point.clientY } : null; };
  const onTouchEnd = (event: TouchEvent) => {
    const start = touch.current, point = event.changedTouches[0];
    touch.current = null;
    if (!start || !point) return;
    const dx = point.clientX - start.x, dy = point.clientY - start.y;
    if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
  };
  const crumbs = walk.history.map((id, at) => ({ id, at })).slice(-3);

  return <div data-testid="maquette-walk" data-screen={current.id} data-tour={tour?.name} className="flex min-w-0 flex-col gap-4" onKeyDown={onKeyDown}>
    {tours.length > 0 && !tour && <div role="group" aria-label={labels.tours} className="flex flex-wrap items-center gap-2">
      <span className="flex items-center gap-1.5 text-sm text-muted-foreground"><CompassIcon className="size-4" aria-hidden="true" />{labels.tours}</span>
      {tours.map(item => <Button key={item.name} type="button" size="sm" variant="outline" className="pointer-coarse:min-h-11" data-testid="maquette-tour" onClick={() => startTour(item)}>{item.name}</Button>)}
    </div>}
    {tour && walk.tour && <Alert data-testid="maquette-tour-step">
      <CompassIcon aria-hidden="true" />
      <AlertTitle>{labels.tour} · {tour.name} · {labels.tourStep(walk.tour.index + 1, tour.steps.length)}</AlertTitle>
      <AlertDescription data-testid="maquette-caption">{tour.steps[walk.tour.index]?.caption || current.title}</AlertDescription>
      <AlertAction><Button type="button" size="icon-sm" variant="ghost" className="pointer-coarse:min-h-11 pointer-coarse:min-w-11" aria-label={labels.endTour} data-testid="maquette-end-tour"
        onClick={() => setWalk(previous => ({ ...previous, tour: null }))}><XIcon aria-hidden="true" /></Button></AlertAction>
    </Alert>}

    <nav aria-label={labels.screens} data-testid="maquette-stepper" className="flex items-center gap-2">
      <Button type="button" variant="outline" size="sm" className="pointer-coarse:min-h-11" data-testid="maquette-previous" disabled={index <= 0} onClick={() => step(-1)}>
        <ChevronLeftIcon aria-hidden="true" /><span className="max-sm:sr-only">{labels.previous}</span></Button>
      <span data-testid="maquette-position" className="shrink-0 text-sm text-muted-foreground tabular-nums">{labels.position(index + 1, count)}</span>
      <NativeSelect aria-label={labels.screen} data-testid="maquette-screen-select" className="min-w-0 flex-1 pointer-coarse:[&_select]:min-h-11" value={current.id} onChange={event => go(event.target.value)}>
        {screens.map(screen => <NativeSelectOption key={screen.id} value={screen.id}>{screen.title}</NativeSelectOption>)}
      </NativeSelect>
      <Button type="button" variant="outline" size="sm" className="pointer-coarse:min-h-11" data-testid="maquette-next" disabled={index >= count - 1} onClick={() => step(1)}>
        <span className="max-sm:sr-only">{labels.next}</span><ChevronRightIcon aria-hidden="true" /></Button>
    </nav>

    {walk.history.length > 1 && <div className="flex min-w-0 items-center gap-2">
      <Button type="button" variant="ghost" size="sm" className="pointer-coarse:min-h-11" data-testid="maquette-back" onClick={back}><ArrowLeftIcon aria-hidden="true" />{labels.back}</Button>
      <nav aria-label={labels.pathTaken} className="min-w-0 flex-1">
        <ol data-testid="maquette-breadcrumb" className="m-0 flex min-w-0 list-none items-center gap-1 overflow-hidden p-0 text-sm text-muted-foreground">
          {crumbs.map(({ id, at }, i) => <li key={at} className={`flex min-w-0 items-center gap-1 ${at === walk.history.length - 1 ? 'shrink-0' : 'shrink'}`}>
            {i > 0 && <ChevronRightIcon className="size-3.5 shrink-0" aria-hidden="true" />}
            <span aria-current={at === walk.history.length - 1 ? 'page' : undefined} className={`truncate ${at === walk.history.length - 1 ? 'max-w-[60vw] font-medium text-foreground' : ''}`}>{titleOf(id)}</span>
          </li>)}
        </ol>
      </nav>
    </div>}

    <div className="grid min-w-0 gap-4 @2xl:grid-cols-[minmax(0,1fr)_16rem] @2xl:items-start">
      <div className="min-w-0" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <Frame device={maquette.device} title={current.title}>
          <MaquetteScreenView key={current.id} maquette={maquette} screen={current} links={links} labels={labels} headingRef={heading} />
        </Frame>
      </div>
      {current.note && <p data-testid="maquette-note" className="m-0 flex gap-2 text-sm text-pretty text-muted-foreground"><InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{current.note}</p>}
    </div>
    <p aria-live="polite" className="m-0 sr-only">{labels.showing(current.title)}</p>
  </div>;
}

/** A maquette file drawn one screen at a time; a newer format version shows a notice, an unreadable file an inline error. */
export function MaquetteViewer({ text, fragment, locale, labels: given }: MaquetteViewerProps) {
  const labels = useMemo(() => maquetteLabelsFor(locale, given), [locale, given]);
  const parsed = useMemo(() => parseMaquette(text), [text]);
  const newer = parsed.version !== undefined && parsed.version > MAQUETTE_FORMAT_VERSION;
  const notice = newer && <Alert data-testid="maquette-newer"><InfoIcon aria-hidden="true" /><AlertTitle>{labels.newerTitle}</AlertTitle><AlertDescription>{labels.newer(parsed.version!)}</AlertDescription></Alert>;
  const frame = (children: ReactNode, state: string) => <section data-boring="maquette-viewer" data-state={state}
    className="@container mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-5 p-4 sm:p-6">{children}</section>;
  if (parsed.kind === 'invalid') return frame(<>{notice}
    <Alert variant="destructive" data-testid="maquette-error" data-reason={parsed.reason}><TriangleAlertIcon aria-hidden="true" /><AlertTitle>{labels.errorTitle}</AlertTitle>
      <AlertDescription>{parsed.reason === 'json' ? labels.invalidJson : labels.invalidShape}</AlertDescription></Alert></>, 'invalid');
  const { maquette } = parsed;
  return frame(<>
    <header className="flex min-w-0 flex-col gap-1">
      <p className="m-0 text-xs font-medium tracking-wide text-muted-foreground uppercase">{labels.kind} · {labels.screenCount(maquette.screens.length)}</p>
      <h2 data-testid="maquette-title" className="m-0 text-lg font-semibold text-balance">{maquette.title || labels.kind}</h2>
      <p className="m-0 text-sm text-pretty text-muted-foreground">{labels.disclaimer}</p>
    </header>
    {notice}
    <Walkthrough maquette={maquette} labels={labels} fragment={fragment} />
    <HowItWorks maquette={maquette} labels={labels} />
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
  readonly renderer: (props: { readonly text: string; readonly fragment?: string | undefined }) => ReactNode;
}

/** A maquette kind in `locale` ("Mock-up" in English, "Maquette" in French) with any word overridden. */
export function createMaquetteKind({ locale, labels }: { readonly locale?: MaquetteLocale | undefined; readonly labels?: Partial<MaquetteLabels> | undefined } = {}): MaquetteKind {
  return {
    match: target => isMaquettePath(target.resource.path),
    label: maquetteLabelsFor(locale, labels).kind,
    icon: LayoutTemplateIcon,
    renderer: ({ text, fragment }) => <MaquetteViewer text={text} fragment={fragment} locale={locale} labels={labels} />,
  };
}

/** The built-in maquette kind, in English. */
export const maquetteKind: MaquetteKind = createMaquetteKind();
