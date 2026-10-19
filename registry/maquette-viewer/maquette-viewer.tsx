'use client';

// The maquette viewer: a PM agent's `*.maquette.json` mock-up, one screen at a time. The screen is the content; the chrome is one thin bar
// of icons: Back, ‹ 2 / 5 › (also arrow keys and swipe) and a menu holding the guided tours and "How it works" (the workflow, in a dialog).
// During a tour the bar shows the step dots and ×, with the step's caption under it. `maquetteKind` is the kind the pi-app artifact panel
// uses by default for `.maquette.json` files; an app's own kind in `artifactKinds` wins. It draws data only: nothing in the file runs.
// The workflow is drawn by the diagram-viewer item's `DiagramView`, inline or from a linked `*.diagram.json`. With `comments` (the feedback
// item's `usePointComments`, structurally) one more icon enters point mode on the screen: a tap on a block pins a note that names the
// maquette path, the screen id and the block id; the pins of the current screen show as small numbers on their blocks.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType, KeyboardEvent, ReactNode, TouchEvent } from 'react';
import { ArrowLeftIcon, ChevronLeftIcon, ChevronRightIcon, CompassIcon, EllipsisIcon, InfoIcon, LayoutTemplateIcon, MessageSquarePlusIcon, TriangleAlertIcon, WorkflowIcon, XIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { parseDiagram } from '../diagram-viewer/diagram';
import type { Diagram } from '../diagram-viewer/diagram';
import { DiagramView } from '../diagram-viewer/diagram-view';
import { MAQUETTE_FORMAT_VERSION, diagramPathOf, isMaquettePath, parseMaquette, screenFromFragment } from './maquette';
import type { Maquette, MaquetteBlock, MaquetteCase, MaquetteScreen } from './maquette';
import { maquetteLabelsFor } from './maquette-labels';
import type { MaquetteLabels, MaquetteLocale } from './maquette-labels';
import { MaquetteScreenView } from './maquette-blocks';
import type { MaquetteLinks } from './maquette-blocks';

export { MAQUETTE_FORMAT_VERSION, diagramPathOf, isMaquettePath, linksOf, parseMaquette, screenFromFragment } from './maquette';
export type { Maquette, MaquetteBlock, MaquetteBlockV1, MaquetteCase, MaquetteFileV1, MaquetteParse, MaquetteScreen, MaquetteState, MaquetteTransition, MaquetteWorkflow } from './maquette';
export { defaultMaquetteLabels, frenchMaquetteLabels, maquetteLabelsFor } from './maquette-labels';
export type { MaquetteLabels, MaquetteLocale } from './maquette-labels';

/**
 * Comment pins, structurally the feedback item's `usePointComments(session)`: pass it and the bar shows a comment icon; omit it (no feedback
 * session in the host) and nothing shows.
 */
export interface MaquetteComments {
  /** Point mode is on. */
  readonly active: boolean;
  /** Enters point mode (the person taps blocks to pin notes), or ends it when it is on. */
  readonly point: () => void;
  /** The pins taken: each one's number and the `data-feedback-id` its element sits in. */
  readonly pins: readonly { readonly number: number; readonly target: string }[];
}

/** Reads another file of the workspace as text (the artifact panel passes one): a linked `*.diagram.json`. Undefined when it cannot. */
export type MaquetteRead = (path: string) => Promise<string | undefined>;

/** A block's `data-feedback-id`: `maquette:<path>#screen=<screen id>&block=<block id>`. */
export const maquetteTarget = (path: string | undefined, screen: string, block: string): string => `maquette:${path ?? ''}#screen=${screen}&block=${block}`;

export interface MaquetteViewerProps {
  /** The file's text (JSON). */
  readonly text: string;
  /** The file's path: named by comment pins, and the folder a linked diagram is read from. */
  readonly path?: string | undefined;
  /** Comment pins on blocks (the feedback item's `usePointComments`). */
  readonly comments?: MaquetteComments | undefined;
  /** Reads a linked `*.diagram.json`; without it a linked workflow is not offered. */
  readonly read?: MaquetteRead | undefined;
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
const ICON = 'pointer-coarse:min-h-11 pointer-coarse:min-w-11';

/** One dot per tour step, the current one in the primary colour. */
function Dots({ count, index, label }: { readonly count: number; readonly index: number; readonly label: string }) {
  return <svg role="img" aria-label={label} data-testid="maquette-dots" width={count * 12} height="8" viewBox={`0 0 ${count * 12} 8`} className="shrink-0">
    {Array.from({ length: count }, (_, i) => <circle key={i} cx={i * 12 + 6} cy="4" r="3" className={i === index ? 'fill-primary' : 'fill-muted-foreground/30'} />)}
  </svg>;
}

/** The diagram of a linked `*.diagram.json`, read when the dialog opens: undefined while reading, null when it cannot be read. */
function useLinked(read: MaquetteRead | undefined, path: string | undefined, open: boolean): Diagram | null | undefined {
  const [loaded, setLoaded] = useState<{ readonly path: string; readonly diagram: Diagram | null }>();
  useEffect(() => {
    if (!open || !path || !read || loaded?.path === path) return undefined;
    let off = false;
    read(path).then(text => text === undefined ? null : parseDiagram(text), () => null).then(parsed => {
      if (!off) setLoaded({ path, diagram: parsed?.kind === 'ok' ? parsed.diagram : null });
    });
    return () => { off = true; };
  }, [open, path, read, loaded?.path]);
  return loaded && loaded.path === path ? loaded.diagram : undefined;
}

/** The workflow diagram, its legend and the cases' `path` highlights, in a dialog opened from the menu. */
function HowItWorks({ maquette, source, labels, open, onOpenChange }: {
  readonly maquette: Maquette; readonly source: DiagramSource; readonly labels: MaquetteLabels; readonly open: boolean; readonly onOpenChange: (open: boolean) => void;
}) {
  const [shown, setShown] = useState<string | null>(null);
  const loaded = useLinked(source.read, source.path, open);
  const diagram = maquette.diagram ?? loaded;
  const highlighted = maquette.cases.filter(item => item.path.length > 0);
  if (!maquette.diagram && !source.path) return null;
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent data-testid="maquette-how" className="max-h-[85dvh] overflow-y-auto">
      <DialogHeader><DialogTitle>{labels.howItWorks}</DialogTitle></DialogHeader>
      {diagram ? <DiagramView diagram={diagram} highlight={highlighted.find(item => item.name === shown)?.path ?? diagram.path} labels={labels} />
        : diagram === null ? <Alert variant="destructive" data-testid="maquette-how-error"><TriangleAlertIcon aria-hidden="true" /><AlertTitle>{labels.diagramUnavailable}</AlertTitle></Alert>
          : <p role="status" className="m-0 text-sm text-muted-foreground">{labels.loading}</p>}
      {highlighted.length > 0 && <div role="group" className="flex flex-wrap gap-2">
        {highlighted.map(item => <Button key={item.name} type="button" size="sm" variant={shown === item.name ? 'secondary' : 'outline'} aria-pressed={shown === item.name}
          data-testid="maquette-case" className="pointer-coarse:min-h-11" onClick={() => setShown(current => current === item.name ? null : item.name)}>{item.name}</Button>)}
      </div>}
    </DialogContent>
  </Dialog>;
}

/** Where a linked diagram is read from: its resolved path and the reader (both absent for an inline workflow, or with no reader). */
interface DiagramSource { readonly path: string | undefined; readonly read: MaquetteRead | undefined }

function Walkthrough({ maquette, labels, fragment, path, comments, read }: {
  readonly maquette: Maquette; readonly labels: MaquetteLabels; readonly fragment: string | undefined;
  readonly path: string | undefined; readonly comments: MaquetteComments | undefined; readonly read: MaquetteRead | undefined;
}) {
  const exists = (id: string | undefined): id is string => !!id && maquette.screens.some(screen => screen.id === id);
  const linked = screenFromFragment(fragment);
  const [walk, setWalk] = useState<Walk>(() => ({ history: [exists(linked) ? linked : maquette.start], tour: null }));
  const [how, setHow] = useState(false);
  const seen = useRef(new Set<string>());
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const screens = maquette.screens;
  const current: MaquetteScreen = screens.find(screen => screen.id === walk.history.at(-1)) ?? screens[0]!;
  const position = screens.indexOf(current);
  const tour: MaquetteCase | undefined = walk.tour ? maquette.cases.find(item => item.name === walk.tour!.name) : undefined;
  const tours = maquette.cases.filter(item => item.steps.length > 0);
  const titleOf = (id: string) => screens.find(screen => screen.id === id)?.title ?? id;
  // Goto blocks pulse once, the first time their screen is shown.
  const firstView = !seen.current.has(current.id);
  useEffect(() => { seen.current.add(current.id); }, [current.id]);

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
  // After a move, keyboard focus starts on the new screen, so Tab continues inside the screen just opened.
  useEffect(() => { if (moved.current) { moved.current = false; heading.current?.focus(); } }, [walk]);

  const index = tour && walk.tour ? walk.tour.index : position, count = tour ? tour.steps.length : screens.length;
  const target = (block: MaquetteBlock) => maquetteTarget(path, current.id, block.id);
  // While pointing, the session draws its own numbered pins over the page; the small numbers on the blocks are for afterwards.
  const pins = (block: MaquetteBlock) => comments && !comments.active ? comments.pins.filter(pin => pin.target === target(block)).map(pin => pin.number) : [];
  const links: MaquetteLinks = { go, hint: id => labels.opens(titleOf(id)), target, pins };
  const source: DiagramSource = { path: maquette.diagramLink && read ? diagramPathOf(path ?? '', maquette.diagramLink) : undefined, read };
  const workflow = !!maquette.diagram || !!source.path;
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
  const caption = tour && walk.tour ? tour.steps[walk.tour.index]?.caption : undefined;

  return <div data-testid="maquette-walk" data-screen={current.id} data-tour={tour?.name} className="flex min-w-0 flex-col gap-2" onKeyDown={onKeyDown}>
    {/* The viewer's own chrome is never pinned, and keeps working while pointing: walk to another screen and pin there too. */}
    <nav aria-label={labels.screens} data-testid="maquette-stepper" data-feedback-ignore="" className="flex items-center gap-1">
      {walk.history.length > 1 && <Button type="button" variant="ghost" size="icon-sm" className={ICON} aria-label={labels.back} data-testid="maquette-back" onClick={back}><ArrowLeftIcon aria-hidden="true" /></Button>}
      <div className="flex flex-1 items-center justify-center gap-1">
        <Button type="button" variant="ghost" size="icon-sm" className={ICON} aria-label={labels.previous} data-testid="maquette-previous" disabled={index <= 0} onClick={() => step(-1)}><ChevronLeftIcon aria-hidden="true" /></Button>
        {tour ? <Dots count={count} index={index} label={labels.tourStep(index + 1, count)} />
          : <span data-testid="maquette-position" className="min-w-10 text-center text-sm text-muted-foreground tabular-nums">{index + 1} / {count}</span>}
        <Button type="button" variant="ghost" size="icon-sm" className={ICON} aria-label={labels.next} data-testid="maquette-next" disabled={index >= count - 1} onClick={() => step(1)}><ChevronRightIcon aria-hidden="true" /></Button>
      </div>
      {comments && <Tooltip><TooltipTrigger render={<Button type="button" variant="ghost" size="icon-sm" className={ICON} aria-label={labels.comment} aria-pressed={comments.active}
        data-testid="maquette-comment" onClick={() => comments.point()} />}><MessageSquarePlusIcon aria-hidden="true" /></TooltipTrigger><TooltipContent>{labels.comment}</TooltipContent></Tooltip>}
      {tour ? <Button type="button" variant="ghost" size="icon-sm" className={ICON} aria-label={labels.endTour} data-testid="maquette-end-tour" onClick={() => setWalk(previous => ({ ...previous, tour: null }))}><XIcon aria-hidden="true" /></Button>
        : (tours.length > 0 || workflow) && <DropdownMenu>
          <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" className={ICON} aria-label={labels.more} data-testid="maquette-menu" />}><EllipsisIcon aria-hidden="true" /></DropdownMenuTrigger>
          <DropdownMenuContent align="end" data-testid="maquette-menu-list">
            {tours.map(item => <DropdownMenuItem key={item.name} className="pointer-coarse:min-h-11" data-testid="maquette-tour" onClick={() => startTour(item)}><CompassIcon aria-hidden="true" />{item.name}</DropdownMenuItem>)}
            {tours.length > 0 && workflow && <DropdownMenuSeparator />}
            {workflow && <DropdownMenuItem className="pointer-coarse:min-h-11" data-testid="maquette-how-open" onClick={() => setHow(true)}><WorkflowIcon aria-hidden="true" />{labels.howItWorks}</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>}
    </nav>
    {caption && <p data-testid="maquette-caption" className="m-0 line-clamp-2 px-1 text-sm text-pretty text-muted-foreground">{caption}</p>}

    <div className={maquette.device === 'phone' ? 'mx-auto flex w-full max-w-sm flex-col gap-2' : 'flex min-w-0 flex-col gap-2'}>
      <div className="min-w-0" data-hint={firstView ? 'pulse' : undefined} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <Card data-testid="maquette-frame" data-device={maquette.device ?? 'panel'}><CardContent>
          <MaquetteScreenView key={current.id} maquette={maquette} screen={current} links={links} labels={labels} headingRef={heading} />
        </CardContent></Card>
      </div>
      {current.note && <div className="flex min-w-0 items-center gap-1 px-1">
        <p data-testid="maquette-note" title={current.note} className="m-0 min-w-0 flex-1 truncate text-xs text-muted-foreground">{current.note}</p>
        <Popover>
          <PopoverTrigger render={<Button type="button" variant="ghost" size="icon-xs" className={ICON} aria-label={labels.aboutScreen} data-testid="maquette-note-more" />}><InfoIcon aria-hidden="true" /></PopoverTrigger>
          <PopoverContent align="end" data-testid="maquette-note-full">{current.note}</PopoverContent>
        </Popover>
      </div>}
    </div>
    <p aria-live="polite" className="m-0 sr-only">{labels.showing(current.title)}</p>
    <HowItWorks maquette={maquette} source={source} labels={labels} open={how} onOpenChange={setHow} />
  </div>;
}

/** A maquette file drawn one screen at a time; a newer format version shows a notice, an unreadable file an inline error. */
export function MaquetteViewer({ text, fragment, locale, labels: given, path, comments, read }: MaquetteViewerProps) {
  const labels = useMemo(() => maquetteLabelsFor(locale, given), [locale, given]);
  const parsed = useMemo(() => parseMaquette(text), [text]);
  const newer = parsed.version !== undefined && parsed.version > MAQUETTE_FORMAT_VERSION;
  const notice = newer && <Alert data-testid="maquette-newer"><InfoIcon aria-hidden="true" /><AlertTitle>{labels.newerTitle}</AlertTitle><AlertDescription>{labels.newer(parsed.version!)}</AlertDescription></Alert>;
  return <section data-boring="maquette-viewer" data-state={parsed.kind} aria-label={parsed.kind === 'ok' ? parsed.maquette.title || labels.kind : labels.kind}
    className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-2 px-3 pt-1 pb-4 sm:px-6">
    {notice}
    {parsed.kind === 'ok' ? <Walkthrough maquette={parsed.maquette} labels={labels} fragment={fragment} path={path} comments={comments} read={read} />
      : <Alert variant="destructive" data-testid="maquette-error" data-reason={parsed.reason}><TriangleAlertIcon aria-hidden="true" /><AlertTitle>{labels.errorTitle}</AlertTitle>
        <AlertDescription>{parsed.reason === 'json' ? labels.invalidJson : labels.invalidShape}</AlertDescription></Alert>}
  </section>;
}

/**
 * The artifact kind of a maquette file (structurally an `ArtifactKind` of pi-chat): it matches `*.maquette.json`, names it, gives its icon
 * and draws it with `MaquetteViewer`. Pass it, or your own, in `artifactKinds`; kinds an app passes are consulted before the built-in one.
 */
export interface MaquetteKind {
  readonly match: (target: { readonly resource: { readonly path: string } }) => boolean;
  readonly label: string;
  readonly icon: ComponentType<{ readonly className?: string; readonly 'aria-hidden'?: boolean | 'true' }>;
  readonly renderer: (props: {
    readonly text: string; readonly fragment?: string | undefined;
    readonly artifact?: { readonly target: { readonly resource: { readonly path: string } } } | undefined; readonly read?: MaquetteRead | undefined;
  }) => ReactNode;
}

/**
 * A maquette kind in `locale` ("Mock-up" in English, "Maquette" in French) with any word overridden. `comments` (the feedback item's
 * `usePointComments(session)`) adds the comment icon; pass a fresh kind when it changes.
 */
export function createMaquetteKind({ locale, labels, comments }: {
  readonly locale?: MaquetteLocale | undefined; readonly labels?: Partial<MaquetteLabels> | undefined; readonly comments?: MaquetteComments | undefined;
} = {}): MaquetteKind {
  return {
    match: target => isMaquettePath(target.resource.path),
    label: maquetteLabelsFor(locale, labels).kind,
    icon: LayoutTemplateIcon,
    renderer: ({ text, fragment, artifact, read }) => <MaquetteViewer text={text} fragment={fragment} locale={locale} labels={labels}
      path={artifact?.target.resource.path} comments={comments} read={read} />,
  };
}

/** The built-in maquette kind, in English. */
export const maquetteKind: MaquetteKind = createMaquetteKind();
