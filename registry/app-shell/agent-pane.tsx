'use client';

// The right pane (`composer: 'bar'`): one place with a back stack, whatever put content there: the app's own views (`pane.push({ title, content })`,
// `preview`), a file opened from a chip, the library or a page (`pane.push({ file })`, shown in the kit's `LocalFileViewer` through `agent.files`),
// and the agent's `present`. Data first: a stack of typed entries (`PaneEntry`), the top one last. The top one shows; the ones under it stay mounted,
// hidden, so back returns to them as they were (scroll, selection). Wide: the `preview` Dock on the right, or over the docked conversation in its
// column (« ← Assistant »). Phone: full screen, and the system Back steps back too. Every entry is drawn in the kit's `ViewerFrame`.
import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { ArrowLeftIcon, LibraryIcon } from '../_shared/icons';
import { Button } from '@/components/ui/button';
import { useArtifactFollow } from '@hachej/boring-ui-kit/chat-react';
import { pieces } from '@hachej/boring-ui-kit/chat-text';
import type { NativeChatController } from '@hachej/boring-ui-kit/native-chat';
import { Dock } from '../dock/dock';
import { ViewerFrame, ViewerWindowProvider } from '../viewer-frame/viewer-frame';
import { frenchViewerLabels } from '../viewer-frame/viewer-labels-fr';
import type { LocalTextKind } from '../viewer-pdf/local-file-viewer';
import { csvKind } from '../viewer-code/code-kinds';
import { StepButtons, stepIndex, stepOffset } from '../pi-chat/image-viewer';
import { useBackLayer } from '../utils/back';
import { cn } from '../utils/utils';
import type { PresentedArtifact } from '../pi-artifacts/artifact';
import type { AppShellLocale, AppShellText } from './text';
import { shellWords, useInternal } from './layer-context';
import type { AgentPane, AgentSpec, PaneEntry, PaneItem, PanePresent } from './layer-context';

const MAX_DEPTH = 12;
type FileReader = NonNullable<AgentSpec['files']>['read'];
/** A new entry, before the stack gives it an id and its opener. */
type Draft = PaneEntry extends infer E ? E extends PaneEntry ? Omit<E, 'id' | 'opener'> : never : never;
const nameOf = (path: string) => path.split('/').at(-1) || path;

/** A Markdown file read as a note, with the chat's own renderer (no editor: the bytes are the app's, read only). */
const markdownKind: LocalTextKind = {
  match: (_target, artifact) => artifact.type === 'markdown',
  load: () => import('../pi-chat-markdown/markdown').then(module => ({ default: ({ text }: { readonly text: string }) => <div data-testid="pane-markdown" className="pi-chat text-sm"><module.Markdown text={text} /></div> })),
};
const TEXT_KINDS: readonly LocalTextKind[] = [csvKind, markdownKind];
// The viewer (image, PDF and their libraries) loads the first time a file opens: a page that only uses the layer keeps none of it up front.
const LocalFileViewer = lazy(() => import('../viewer-pdf/local-file-viewer').then(module => ({ default: module.LocalFileViewer })));

/** The files cited or attached in the message that names `path` (the latest one): the set previous and next step through. */
export function citedWith(controller: NativeChatController | undefined, path: string): readonly string[] {
  const entries = controller?.getSnapshot().view?.entries ?? [];
  for (let at = entries.length - 1; at >= 0; at -= 1) {
    for (const message of entries[at]!.model ?? []) {
      const content = (message as { readonly content?: unknown }).content;
      const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map(part => (part as { readonly type?: string; readonly text?: string }).type === 'text' ? (part as { readonly text: string }).text : '').join('\n') : '';
      const files = [...new Set(pieces(text, { mentions: true, skills: [] }).flatMap(piece => piece.kind === 'mention' && piece.value && !/^[a-z][\w-]*:/i.test(piece.value) ? [piece.value] : []))];
      if (files.includes(path)) return files;
    }
  }
  return [path];
}

interface Persisted { readonly kind: 'file' | 'library'; readonly title: string; readonly path?: string; readonly files?: readonly string[] }

/**
 * The pane's state and its verbs, held by the provider: `push`, `back` and `close`, the library, a file from the chat, previous and next, the
 * agent's `present` (useArtifactFollow: a presented file opens on top, the viewer's mount acknowledges it), focus, Échap, ← →, the phone's Back,
 * and the file and library entries kept across a reload (sessionStorage).
 */
export function usePane({ agent, bar, compact, locale, field, storageKey, uncover }: {
  readonly agent: AgentSpec | undefined; readonly bar: boolean; readonly compact: boolean; readonly locale: AppShellLocale | undefined;
  /** A phone: the conversation steps down to its peek (the field over the pane's foot), so the pane opened from it shows. */
  readonly uncover: () => void;
  /** The one field, where focus lands when the pane closes and its opener is gone. */
  readonly field: () => HTMLElement | null | undefined;
  readonly storageKey: string;
}) {
  const [stack, setStack] = useState<readonly PaneEntry[]>([]);
  // What was last asked, set at once (not after the render): a pick in the library that opens a file and then calls `onPicked` sees the file.
  const latest = useRef(stack);
  const ids = useRef(0);
  const focusPlan = useRef<{ readonly to: 'top' } | { readonly to: 'same'; readonly testId: string } | { readonly to: 'element'; readonly element: HTMLElement | null; readonly fallback: 'top' | 'field' } | null>(null);
  const commit = useCallback((next: readonly PaneEntry[], plan: typeof focusPlan.current) => { latest.current = next; focusPlan.current = plan; setStack(next); }, []);
  const files = agent?.files;
  const opener = () => document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;

  // Opening the pane leaves the conversation as it is (folded stays folded): the page keeps its place, the one field stays where it was.
  const pushEntry = useCallback((entry: Draft) => {
    const current = latest.current;
    const top = current.at(-1);
    // The same thing again replaces the top (an app updating its view, the agent presenting the file on show), so back never shows it twice.
    const same = top && top.kind === entry.kind && (entry.kind === 'file' ? top.kind === 'file' && top.path === entry.path : top.title === entry.title);
    const next = { ...entry, id: same ? top.id : ++ids.current, opener: same ? top.opener : opener() } as PaneEntry;
    commit([...(same ? current.slice(0, -1) : current), next].slice(-MAX_DEPTH), { to: 'top' });
    if (compact) uncover();
    return true;
  }, [commit, compact, uncover]);
  const push = useCallback((item: PaneItem): boolean => {
    if (!agent || !bar) return false;
    if ('content' in item) return pushEntry({ kind: 'view', title: item.title, content: item.content });
    if (!files) return false;
    const set = item.files?.includes(item.file) ? item.files : [item.file];
    return pushEntry({ kind: 'file', title: item.title ?? nameOf(item.file), path: item.file, files: set });
  }, [agent, bar, files, pushEntry]);
  const back = useCallback((): number => {
    const current = latest.current;
    const popped = current.at(-1);
    if (!popped) return 0;
    const next = current.slice(0, -1);
    commit(next, next.length ? { to: 'element', element: popped.opener, fallback: 'top' } : { to: 'element', element: popped.opener, fallback: 'field' });
    return next.length;
  }, [commit]);
  const close = useCallback(() => {
    const current = latest.current;
    if (current.length) commit([], { to: 'element', element: current[0]!.opener, fallback: 'field' });
  }, [commit]);
  const step = useCallback((offset: -1 | 1) => {
    const current = latest.current, top = current.at(-1);
    if (top?.kind !== 'file' || top.files.length < 2) return;
    const path = top.files[stepIndex(Math.max(0, top.files.indexOf(top.path)), offset, top.files.length)]!;
    // The viewer is drawn again for the new file: focus stays on the control that stepped (previous, next), else on nothing new (keys keep working).
    const held = document.activeElement instanceof HTMLElement && document.activeElement.closest('[data-pane-top]') ? document.activeElement.dataset['testid'] : undefined;
    commit([...current.slice(0, -1), { ...top, id: ++ids.current, path, title: nameOf(path), revision: undefined }], held ? { to: 'same', testId: held } : null);
  }, [commit]);

  // « Bibliothèque »: the app's navigator on top; a file the app (or the kit, from `onPicked({ path })`) opens goes above it, `onPicked()` alone closes it.
  const library = agent?.library;
  const words = shellWords(locale, agent);
  const libraryTitle = words.library;
  const libraryContent = useCallback(() => {
    if (!library) return null;
    let mine = -1;
    const content = library(file => {
      if (file && push({ file: file.path, files: file.files })) return;
      if (latest.current.at(-1)?.id === mine) back();
    });
    return { content, claim: (id: number) => { mine = id; } };
  }, [library, push, back]);
  const openLibrary = useMemo(() => {
    if (!library || !bar) return undefined;
    return () => {
      const made = libraryContent();
      if (!made) return;
      pushEntry({ kind: 'library', title: libraryTitle, content: made.content });
      made.claim(ids.current);
    };
  }, [library, bar, libraryContent, pushEntry, libraryTitle]);
  const chat = agent?.controller;
  const showFile = useCallback((path: string, set?: readonly string[]) => { push({ file: path, files: set ?? citedWith(chat, path) }); }, [push, chat]);
  const openFile = files && bar ? showFile : undefined;

  // The agent's `present`, and a card the person clicks: the file goes on top; the viewer's mount acknowledges it.
  const controller = bar && files ? agent?.controller : undefined;
  const conversations = agent?.chatProps?.conversations;
  const top = stack.at(-1);
  const onTop = useCallback((path: string) => { const shown = latest.current.at(-1); return shown?.kind === 'file' && shown.path === path; }, []);
  const presentFile = useCallback((artifact: PresentedArtifact) => {
    if (artifact.type === 'task') return false;
    const path = artifact.target.resource.path;
    pushEntry({ kind: 'file', title: artifact.title || nameOf(path), path, files: [path], revision: artifact.revision });
    return true;
  }, [pushEntry]);
  const follow = useArtifactFollow({ controller, conversationId: controller ? String(conversations?.activeId ?? controller.getSnapshot().conversationId) : undefined, active: null,
    onOpen: selection => { presentFile(selection.descriptor); }, autoOpen: true, narrow: () => compact, showing: onTop,
    openPresent: path => files ? pushEntry({ kind: 'file', title: nameOf(path), path, files: [path] }) : false,
    answer: agent?.chatProps?.actions?.answer as Parameters<typeof useArtifactFollow>[0]['answer'] });
  const { onShown } = follow;
  const presented = useMemo<PanePresent | undefined>(() => controller ? {
    open: artifact => { presentFile(artifact); },
    isOpen: artifact => artifact.type !== 'task' && onTop(artifact.target.resource.path),
    shown: onShown,
  } : undefined, [controller, presentFile, onTop, onShown]);

  // Focus: an entry's heading when it opens; back to the control that opened what closed (else the heading under it, or the field).
  useEffect(() => {
    const plan = focusPlan.current;
    focusPlan.current = null;
    if (!plan) return;
    const frame = requestAnimationFrame(() => {
      const heading = () => {
        const title = document.querySelector<HTMLElement>('[data-testid=agent-preview] [data-pane-top] [data-testid=agent-preview-title]');
        if (title && !title.hasAttribute('tabindex')) title.tabIndex = -1;
        return title;
      };
      const visible = (element: HTMLElement | null) => element?.isConnected && element.getClientRects().length > 0 && !element.closest('[inert]') ? element : null;
      const target = plan.to === 'top' ? heading() : plan.to === 'same' ? document.querySelector<HTMLElement>(`[data-pane-top] [data-testid="${plan.testId}"]`) ?? heading() : visible(plan.element) ?? (plan.fallback === 'top' ? heading() : field());
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [stack, field]);
  // Échap steps back (the field's own Échap, an open menu, list or dialog keep theirs); ← and → step through the set, never while typing or on a divider.
  const depth = stack.length;
  const stepping = top?.kind === 'file' && top.files.length > 1;
  useEffect(() => {
    if (!depth) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target instanceof Element ? event.target : null;
      if (event.key === 'Escape') {
        if (target?.closest('[data-testid=composer-input]') || document.querySelector('[data-testid=conversations], [role=menu], [role=listbox], [role=alertdialog], [role=dialog]:not([data-testid=agent-layer])')) return;
        event.preventDefault(); back(); return;
      }
      const offset = stepping ? stepOffset(event.key) : undefined;
      if (!offset || target?.closest('input, textarea, select, [contenteditable=true], [role=separator], [role=slider], [role=tree], [role=treegrid], [role=listbox], [role=menu], [role=tablist], [role=radiogroup]')) return;
      event.preventDefault(); step(offset);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [depth, stepping, back, step]);
  // A phone's Back steps back one entry; the entry stays while more are under it.
  useBackLayer(compact && depth > 0, () => back() > 0 ? false : undefined, 'artifact');

  // The file and library entries survive a reload (an app's own view cannot be kept: it is the app's to rebuild).
  const restored = useRef(false);
  useLayoutEffect(() => {
    if (restored.current || !agent || !bar) return;
    restored.current = true;
    let saved: readonly Persisted[] = [];
    try { saved = JSON.parse(globalThis.sessionStorage?.getItem(storageKey) ?? '[]') as Persisted[]; } catch { /* a convenience */ }
    const entries = saved.flatMap((item): PaneEntry[] => {
      if (item.kind === 'file' && files && typeof item.path === 'string') return [{ id: ++ids.current, opener: null, kind: 'file', title: item.title, path: item.path, files: item.files ?? [item.path] }];
      const made = item.kind === 'library' ? libraryContent() : null;
      if (!made) return [];
      made.claim(ids.current + 1);
      return [{ id: ++ids.current, opener: null, kind: 'library', title: item.title, content: made.content }];
    });
    if (entries.length) commit(entries, null);
  }, [agent, bar, files, libraryContent, storageKey, commit]);
  useEffect(() => {
    if (!restored.current) return;
    const kept: Persisted[] = stack.flatMap((entry): Persisted[] => entry.kind === 'file' ? [{ kind: 'file', title: entry.title, path: entry.path, files: entry.files }] : entry.kind === 'library' ? [{ kind: 'library', title: entry.title }] : []);
    try { if (kept.length) globalThis.sessionStorage?.setItem(storageKey, JSON.stringify(kept)); else globalThis.sessionStorage?.removeItem(storageKey); } catch { /* a convenience */ }
  }, [stack, storageKey]);
  // The pane goes with the agent it was opened beside.
  useEffect(() => { if (!agent && latest.current.length) commit([], null); }, [agent, commit]);

  const pane = useMemo<AgentPane>(() => ({ push: item => push(item), back: () => { back(); }, close, depth }), [push, back, close, depth]);
  return { stack, pane, openLibrary, openFile, step, presented };
}

/** The back control: « ← <what is under> », or « ← Assistant » over the docked conversation. */
function BackButton({ title, text, onBack, testId }: { readonly title: string; readonly text: AppShellText; readonly onBack: () => void; readonly testId: string }) {
  return <Button variant="ghost" size="sm" data-testid={testId} aria-label={`${text.backTo} ${title}`} title={`${text.backTo} ${title}`} onClick={onBack} className="max-w-48 min-w-0 shrink">
    <ArrowLeftIcon data-icon="inline-start" aria-hidden="true" /><span className="truncate">{title}</span></Button>;
}

/** Previous and next through the top file's set, with its position (« 2 / 5 »): the same buttons as the chat's image viewer. */
function FileSteps({ entry, text, onStep }: { readonly entry: Extract<PaneEntry, { kind: 'file' }>; readonly text: AppShellText; readonly onStep: (offset: -1 | 1) => void }) {
  if (entry.files.length < 2) return null;
  return <div data-testid="file-steps" className="flex items-center gap-1">
    <span data-testid="file-position" aria-live="polite" className="px-1 text-xs tabular-nums text-muted-foreground">{entry.files.indexOf(entry.path) + 1} / {entry.files.length}</span>
    <StepButtons count={entry.files.length} onStep={onStep} labels={{ previous: text.previousFile, next: text.nextFile }} testId="file" />
  </div>;
}

/**
 * The viewer replaces the « Ouverture… » frame once it has loaded: focus that sat on that frame's heading (and fell to the body with it) moves to
 * the viewer's. Inside the viewer's Suspense, so it runs only once the viewer is committed.
 */
function RefocusTitle() {
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (document.activeElement && document.activeElement !== document.body) return;
      const title = document.querySelector<HTMLElement>('[data-testid=agent-preview] [data-pane-top] [data-testid=agent-preview-title]');
      if (title && !title.hasAttribute('tabindex')) title.tabIndex = -1;
      title?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  return null;
}

/** A file entry: its bytes read through `agent.files`, shown by `LocalFileViewer`; once shown, a presented revision is acknowledged. */
function FileEntry({ entry, frame, read, onShown }: { readonly entry: Extract<PaneEntry, { kind: 'file' }>; readonly frame: { readonly id: string; readonly headerStart: ReactNode; readonly controls: ReactNode; readonly onClose: () => void; readonly text: AppShellText };
  readonly read: FileReader; readonly onShown: PanePresent['shown'] | undefined }) {
  const [loaded, setLoaded] = useState<{ readonly path: string; readonly blob: Blob | null; readonly revision?: string | undefined }>();
  useEffect(() => {
    let live = true;
    read(entry.path).then(found => { if (live) setLoaded(found instanceof Blob ? { path: entry.path, blob: found } : { path: entry.path, blob: found.blob, revision: found.revision }); },
      () => { if (live) setLoaded({ path: entry.path, blob: null }); });
    return () => { live = false; };
  }, [read, entry.path]);
  const file = loaded?.path === entry.path ? loaded : undefined;
  const blob = file?.blob;
  const path = entry.path, revision = entry.revision ?? file?.revision;
  useEffect(() => {
    if (!blob || !revision || !onShown) return;
    onShown({ path, revision });
    return () => onShown({ path, revision, hidden: true });
  }, [blob, path, revision, onShown]);
  const { id, headerStart, controls, onClose, text } = frame;
  const waiting = <ViewerFrame title={entry.title} testId={id} titleTestId={`${id}-title`} headerStart={headerStart} controls={controls} onClose={onClose}>
    <p role="status" data-testid={`${id}-status`} className="m-0 p-4 text-sm text-muted-foreground">{blob === null ? text.fileUnavailable : text.fileLoading}</p>
  </ViewerFrame>;
  if (!blob) return waiting;
  return <Suspense fallback={waiting}><LocalFileViewer key={path} name={path} blob={blob} kinds={TEXT_KINDS} testId={id} titleTestId={`${id}-title`} headerStart={headerStart} controls={controls} onClose={onClose} />{id === 'agent-preview' && <RefocusTitle key={path} />}</Suspense>;
}

/**
 * One entry in the kit's viewer frame: the back control, the title, previous and next, « Bibliothèque », Fermer. Only the top entry carries the
 * pane's test ids (`agent-preview-title`, `-close`, `-back`); an entry under it keeps its place as `agent-preview-under-*`.
 */
function EntryView({ entry, below, top, placement, assistant }: { readonly entry: PaneEntry; readonly below: PaneEntry | undefined; readonly top: boolean; readonly placement: 'column' | 'stacked' | 'screen'; readonly assistant: string }) {
  const layer = useInternal();
  const text = shellWords(layer.locale ?? layer.agent?.chatProps?.locale, layer.agent);
  const id = top ? 'agent-preview' : 'agent-preview-under';
  const backTitle = below?.title ?? (placement === 'stacked' ? assistant : undefined);
  const headerStart = backTitle ? <BackButton title={backTitle} text={text} onBack={layer.pane.back} testId={`${id}-back`} /> : undefined;
  const library = entry.kind === 'view' && layer.openLibrary ? [{ id: 'library', label: text.library, icon: LibraryIcon, onSelect: layer.openLibrary, placement: 'header' as const }] : undefined;
  if (entry.kind === 'file' && layer.agent?.files) {
    // A phone folds a frame's controls into its « … » menu: there previous and next sit under the file instead.
    const steps = <FileSteps entry={entry} text={text} onStep={layer.step} />;
    return <>
      <div className="flex min-h-0 flex-1 flex-col"><FileEntry entry={entry} read={layer.agent.files.read} onShown={layer.presented?.shown} frame={{ id, headerStart, controls: placement === 'screen' ? undefined : steps, onClose: layer.pane.close, text }} /></div>
      {placement === 'screen' && entry.files.length > 1 && <div className="flex shrink-0 justify-center px-2 py-1">{steps}</div>}
    </>;
  }
  return <ViewerFrame title={entry.title} testId={id} titleTestId={`${id}-title`} headerStart={headerStart} {...(library ? { actions: library } : {})} onClose={layer.pane.close}>
    {entry.kind === 'file' ? null : <div data-testid={entry.kind === 'library' ? `${id}-library-list` : `${id}-content`} className="flex min-h-0 flex-1 flex-col overflow-auto">{entry.content}</div>}
  </ViewerFrame>;
}

/** A touch swipe across the pane steps to the previous or next file (a pinch or a zoomed image keeps its own gestures). */
function useSwipe(onStep: (offset: -1 | 1) => void, enabled: boolean) {
  const start = useRef<{ readonly x: number; readonly y: number; readonly id: number } | null>(null);
  return enabled ? {
    onPointerDown: (event: ReactPointerEvent) => { start.current = event.pointerType === 'touch' && event.isPrimary ? { x: event.clientX, y: event.clientY, id: event.pointerId } : null; },
    onPointerUp: (event: ReactPointerEvent) => {
      const from = start.current;
      start.current = null;
      if (!from || from.id !== event.pointerId || (event.target instanceof Element && event.target.closest('[data-scale]:not([data-scale="1"])'))) return;
      const dx = event.clientX - from.x, dy = event.clientY - from.y;
      if (Math.abs(dx) > 64 && Math.abs(dx) > Math.abs(dy) * 1.5) onStep(dx < 0 ? 1 : -1);
    },
    onPointerCancel: () => { start.current = null; },
  } : {};
}

/**
 * The pane: every entry mounted, the top one shown. `column` is the wide Dock, `stacked` over the docked conversation, `screen` the phone: the whole
 * screen above the page and the tabs, under the conversation's drawer, whose peek (the one field) stays over the pane's foot.
 */
export function PaneStack({ placement, assistant }: { readonly placement: 'column' | 'stacked' | 'screen'; readonly assistant: string }) {
  const layer = useInternal();
  const text = shellWords(layer.locale ?? layer.agent?.chatProps?.locale, layer.agent);
  const { stack } = layer;
  const top = stack.at(-1);
  const fr = (layer.locale ?? layer.agent?.chatProps?.locale) === 'fr';
  const swipe = useSwipe(layer.step, placement === 'screen' && top?.kind === 'file' && top.files.length > 1);
  const viewer = useMemo(() => fr ? { labels: frenchViewerLabels } : {}, [fr]);
  if (!top) return null;
  return <ViewerWindowProvider value={viewer}>
    <aside data-testid="agent-preview" data-placement={placement} data-depth={stack.length} aria-label={`${text.preview} · ${top.title}`} {...swipe}
      {...(placement === 'screen' ? { style: { paddingBottom: layer.peekPoint } } : {})}
      className={cn('flex min-h-0 min-w-0 flex-col bg-background text-foreground', placement === 'screen' ? 'fixed inset-0 z-(--app-shell-z-peek)' : 'relative h-full flex-1')}>
      <div data-testid="agent-preview-body" className="relative min-h-0 flex-1">
        {stack.map((entry, index) => {
          const shown = index === stack.length - 1;
          return <div key={entry.id} data-pane-entry={entry.kind} {...(shown ? { 'data-pane-top': '' } : { inert: true, 'aria-hidden': true })} className={cn('absolute inset-0 flex flex-col', !shown && 'invisible')}>
            <EntryView entry={entry} below={stack[index - 1]} top={shown} placement={placement} assistant={assistant} />
          </div>;
        })}
      </div>
    </aside>
  </ViewerWindowProvider>;
}

/** The wide pane: the kit's `Dock`, as the docked conversation, so it resizes by drag or arrow keys and keeps its width whatever it shows. */
export function PaneDock({ assistant }: { readonly assistant: string }) {
  const layer = useInternal();
  const text = shellWords(layer.locale ?? layer.agent?.chatProps?.locale, layer.agent);
  const top = layer.stack.at(-1);
  return <Dock id="preview" side="right" defaultWidth={512} minWidth={320} open onOpenChange={next => { if (!next) layer.pane.close(); }} labels={{ region: `${text.preview} · ${top?.title ?? ''}`, resize: text.resizePreview }}>
    <PaneStack placement="column" assistant={assistant} />
  </Dock>;
}
