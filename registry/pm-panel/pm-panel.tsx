'use client';

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { ListTodoIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { AgentWorkspace } from '../pi-app/agent-workspace';
import type { WorkspaceBarPanel } from '../pi-app/workspace-bar';
import { defaultKinds } from '../pi-app-kinds/pi-app-kinds';
import { ChatTextProvider } from '../pi-chat/labels';
import { chatTextFor } from '../pi-chat/locale';
import { cn } from '../utils/utils';
import { usePhone } from '../utils/use-media';
import { PmComposer } from './pm-composer';
import { PointComment } from './point-comment';
import { usePmPanel } from './use-pm-panel';
import { POINT_PREFACE, pointMessage } from './point-message';
import { usePmMentions } from './pm-mentions';
import { TaskBoard } from '../task-board/task-board';
import type { TaskRecord } from '@hachej/boring-ui-kit/task-board';
import { selectTasks } from '@hachej/boring-ui-kit/task-board';
import { requestOutcome } from './pm-task-source';
import type { ImproveSpec, StudioTaskBoardSeam } from './use-pm-panel';
import { useImproveAgent } from './use-improve-agent';
import type { ImproveProp } from './use-improve-agent';
import { pmTextFor } from './pm-text';
import type { PmPreset } from './pm-composer';
import type { PmText } from './pm-text';
import { useSiblingPointing } from './point-frames';
import { createPrivacyPolicy } from '@hachej/boring-feedback/page';
import { PM_HOST_ORIGINS, usePmHostTheme } from './pm-host-theme';
import { PointChipView } from './inline-point-input';

export { PM_HOST_ORIGINS } from './pm-host-theme';
export { PmComposer, PointerIcon } from './pm-composer';
export type { PmComposerProps, PmPreset } from './pm-composer';
export { usePmPanel } from './use-pm-panel';
export type { PmComment, PmPanelState } from './use-pm-panel';
export { PointComment } from './point-comment';
export { usePmMentions } from './pm-mentions';
export { pmTextEn, pmTextFor, pmTextFr } from './pm-text';
export type { PmText } from './pm-text';
export { PointChipView } from './inline-point-input';
export { pointMessage } from './point-message';
export type { ImproveSpec, PmVoice, PmTranscript, StudioTaskBoardSeam } from './use-pm-panel';
export { useImproveAgent, isImproveAgent } from './use-improve-agent';
export type { ImproveAgent, ImproveProp } from './use-improve-agent';

interface Binding { readonly spec: ImproveSpec; readonly open: boolean; readonly close: () => void; readonly onFull?: ((full: boolean, collapse: () => void) => void) | undefined }
interface Pending { readonly open: boolean; readonly close: () => void; readonly problem: string | undefined; readonly retry: () => void; readonly text: PmText }
const PmContext = createContext<Binding | Pending | null>(null);
const AppNameContext = createContext('');
const defaultPolicy = createPrivacyPolicy();
// What a mock-up the PM presents may load besides its own inline code: libraries from two public hosts, in the kit's sandboxed preview.
const PM_INTERACTIVE = { scriptSources: ['https://cdnjs.cloudflare.com', 'https://cdn.jsdelivr.net'] };
async function imageFiles(files: readonly File[]) {
  return Promise.all(files.map(async (file, index) => {
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type) || file.size > 3 * 1024 * 1024) throw new Error('Joignez une image de moins de 3 Mo.');
    let binary = '';
    for (const byte of new Uint8Array(await file.arrayBuffer())) binary += String.fromCharCode(byte);
    return { id: `pm-file-${Date.now()}-${index}`, name: file.name, content: { type: 'image' as const, mimeType: file.type, data: btoa(binary) } };
  }));
}

/** One borrowed PM conversation, resolved through the app's existing door on the first open. */
export function PmPanelProvider({ spec, open, close, appName, locale, onFull, children }: { readonly spec?: ImproveProp | undefined; readonly open: boolean; readonly close: () => void; readonly appName?: string | undefined; readonly locale?: string | undefined; readonly onFull?: ((full: boolean, collapse: () => void) => void) | undefined; readonly children: ReactNode }) {
  const resolved = useImproveAgent(spec, open, { ...(appName ? { appName } : {}), ...(locale ? { locale } : {}) });
  const text = pmTextFor(locale);
  const value = useMemo<Binding | Pending | null>(() => resolved.spec ? { spec: resolved.spec, open, close, onFull } : spec ? { open, close, problem: resolved.problem, retry: resolved.retry, text } : null, [resolved.spec, resolved.problem, resolved.retry, spec, open, close, onFull, text]);
  return <PmContext.Provider value={value}><AppNameContext.Provider value={appName ?? ''}>{children}</AppNameContext.Provider></PmContext.Provider>;
}

/** Desktop: beside the pointable app. Phone: full-screen chat, or the in-flow strip while pointing. */
export function ImproveLayout({ children, navigation, screen }: { readonly children: ReactNode; readonly navigation?: ReactNode; readonly screen?: string }) {
  const bound = useContext(PmContext);
  const [page, setPage] = useState<HTMLDivElement | null>(null);
  const binding = bound && 'spec' in bound ? bound : null, pending = bound && !('spec' in bound) ? bound : null;
  const controller = binding?.spec.controller;
  const [instance, setInstance] = useState({ controller, sequence: 0 });
  if (instance.controller !== controller) setInstance({ controller, sequence: instance.sequence + 1 });
  const [pointing, setPointing] = useState(false);
  const [opened, setOpened] = useState(false);
  if (binding?.open && !opened) setOpened(true);
  return <div data-pm-layout="" className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:flex-row">
    <div ref={setPage} data-pm-page="" data-pm-screen={screen} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
    {bound && inFrame() && <SiblingPoint page={page} screen={screen ?? ''} bound={bound} />}
    {binding && opened && <PanelSession key={instance.sequence} binding={binding} page={page} screen={screen} report={setPointing} />}
    {pending?.open && <PmConnecting text={pending.text} problem={pending.problem} retry={pending.retry} close={pending.close} className="absolute inset-0 z-40 md:static md:w-[26rem] md:shrink-0" />}
    <div data-pm-navigation="" hidden={Boolean(bound?.open && !pointing)} className="shrink-0 md:hidden">{navigation}</div>
  </div>;
}

const inFrame = () => typeof window !== 'undefined' && window.parent !== window;

/** This page is framed beside a standalone PM: pointing started there runs here, and this frame's own PM steps aside for it. */
function SiblingPoint({ page, screen, bound }: { readonly page: HTMLElement | null; readonly screen: string; readonly bound: Binding | Pending }) {
  const text = 'spec' in bound ? pmTextFor(bound.spec.chatProps?.locale) : bound.text;
  useSiblingPointing({ app: useContext(AppNameContext), page, screen, policy: ('spec' in bound ? bound.spec.policy : undefined) ?? defaultPolicy, text, onStart: bound.close });
  return null;
}

function PanelSession({ binding, page, screen, report }: { readonly binding: Binding; readonly page: HTMLElement | null; readonly screen: string | undefined; readonly report: (pointing: boolean) => void }) {
  const pm = usePmPanel(binding.spec, binding.open, page, screen, { comment: useFinePointer() });
  const strip = pm.state.mode === 'point' || pm.state.mode === 'navigate';
  const returning = useRef(pm.returnToComposer);
  useLayoutEffect(() => { returning.current = pm.returnToComposer; });
  const collapse = useCallback(() => returning.current(), []);
  useLayoutEffect(() => { report(strip); }, [strip, report]);
  const onFull = binding.onFull;
  useEffect(() => { onFull?.(strip, collapse); }, [strip, collapse, onFull]);
  useEffect(() => () => { onFull?.(false, collapse); }, [onFull, collapse]);
  return <section hidden={!binding.open} data-feedback-ignore="" data-testid="pm-panel" data-mode={strip ? pm.state.mode : 'chat'}
    className={cn('min-h-0 min-w-0 bg-background md:relative md:w-[26rem] md:shrink-0', binding.open && 'flex flex-col', strip ? 'shrink-0' : 'absolute inset-0 z-40')}>
    <PmWorkspace spec={binding.spec} pm={pm} page={page} preset="touch" open={binding.open} close={binding.close} />
    <Separator orientation="vertical" className="absolute inset-y-0 left-0 z-50 hidden w-px md:block" />
  </section>;
}

const COARSE = '(pointer: coarse)', WIDE = '(min-width: 768px)';
const fine = () => !matchMedia(COARSE).matches && matchMedia(WIDE).matches;
function useFinePointer() {
  return useSyncExternalStore(listener => {
    const queries = [matchMedia(COARSE), matchMedia(WIDE)];
    for (const query of queries) query.addEventListener('change', listener);
    return () => { for (const query of queries) query.removeEventListener('change', listener); };
  }, fine, () => false);
}

function PmConnecting({ text, problem, retry, close, className }: { readonly text: PmText; readonly problem: string | undefined; readonly retry: () => void; readonly close?: (() => void) | undefined; readonly className: string }) {
  return <section data-feedback-ignore="" data-testid="pm-panel" data-mode="connecting" className={cn('flex min-h-0 flex-col gap-3 bg-background p-4', className)}>
    <h2 className="m-0 text-sm">{text.title}</h2>
    <p role={problem ? 'alert' : 'status'} className="m-0 text-sm text-muted-foreground">{problem ? text.connectionFailed : text.connecting}</p>
    {problem && <Button variant="outline" onClick={retry} data-testid="pm-connect-retry">{text.retry}</Button>}
    {close && <Button variant="ghost" data-testid="pm-close" onClick={close}>{text.close}</Button>}
  </section>;
}

export interface PmChatProps {
  /** One line, `{ agent: 'pm' }` (the kit opens the app's PM door), or a host `ImproveSpec`. */
  readonly spec: ImproveProp;
  /** The page this chat points at when it is in the same document. Without it, pointing needs `siblingApp`. */
  readonly page?: HTMLElement | null;
  /** The app's name: this PM sits in a frame beside the app's frame, and pointing runs there. */
  readonly siblingApp?: string;
  readonly screen?: string;
  readonly preset?: PmPreset;
  readonly appName?: string;
  readonly locale?: string;
  readonly close?: (() => void) | undefined;
  /** The bar's title, instead of the app's name (a host that already shows it). */
  readonly title?: string | undefined;
}

/** The PM, plugged anywhere: the regular chat filling its container. What the PM presents sits beside it when the container is wide enough, otherwise replaces it with Back. */
export function PmChat({ spec, appName, locale, close, ...rest }: PmChatProps) {
  const resolved = useImproveAgent(spec, true, { ...(appName ? { appName } : {}), ...(locale ? { locale } : {}) });
  const controller = resolved.spec?.controller;
  const [instance, setInstance] = useState({ controller, sequence: 0 });
  if (instance.controller !== controller) setInstance({ controller, sequence: instance.sequence + 1 });
  if (!resolved.spec) return <PmConnecting text={pmTextFor(locale)} problem={resolved.problem} retry={resolved.retry} close={close} className="flex-1" />;
  return <PmChatSession key={instance.sequence} spec={resolved.spec} close={close} {...rest} />;
}

function PmChatSession({ spec, page = null, siblingApp, screen, preset = 'desktop', close, title }: Omit<PmChatProps, 'spec' | 'appName' | 'locale'> & { readonly spec: ImproveSpec }) {
  const pm = usePmPanel(spec, true, page, screen, { comment: preset === 'desktop' && siblingApp === undefined, sibling: siblingApp });
  return <div data-testid="pm-chat" data-mode={pm.state.mode} className="flex min-h-0 min-w-0 flex-1 flex-col"><PmWorkspace spec={spec} page={page} pm={pm} preset={preset} open close={close} beside={siblingApp !== undefined} title={title} /></div>;
}

/** `?pm=standalone`: only the PM, full frame, for a host's column beside the app's frame. Same origin and session as the app, no route of its own. */
export function PmStandalone({ spec, appName, locale, hostOrigins = PM_HOST_ORIGINS }: { readonly spec: ImproveProp; readonly appName: string; readonly locale?: string | undefined; readonly hostOrigins?: readonly string[] | undefined }) {
  usePmHostTheme(hostOrigins);
  return <main data-testid="pm-standalone" className="app-shell flex h-dvh min-h-0 flex-col overflow-hidden bg-background text-foreground">
    <PmChat spec={spec} appName={appName} siblingApp={appName} preset="touch" title={window.parent === window ? undefined : 'PM'} {...(locale ? { locale } : {})} />
  </main>;
}

/** Wiring only: the regular agent page, with the existing point composer and a host Tasks panel. */
function PmWorkspace({ spec, pm, page, preset, open, close, beside = false, title }: { readonly title?: string | undefined; readonly spec: ImproveSpec; readonly pm: ReturnType<typeof usePmPanel>; readonly page: HTMLElement | null; readonly preset: PmPreset; readonly open: boolean; readonly close?: (() => void) | undefined; readonly beside?: boolean }) {
  const { text } = pm;
  const files = spec.resources ? { resources: spec.resources } : { resources: undefined };
  // On a phone the chat gives the page its screen while pointing. A PM beside the app's frame covers nothing.
  const phone = usePhone() && !beside;
  const strip = pm.state.mode === 'point' || pm.state.mode === 'navigate';
  const root = useRef<HTMLDivElement | null>(null);
  const kinds = useMemo(() => spec.artifactKinds ?? defaultKinds({ locale: text.locale }), [spec.artifactKinds, text.locale]);
  const mentions = usePmMentions(spec.tasks, spec.chatProps?.mentions, text);
  const edit = useCallback((value: string) => { spec.controller.setText(value); }, [spec.controller]);
  const refreshTasks = spec.tasks?.refresh;
  useEffect(() => { if (open) refreshTasks?.(); }, [open, refreshTasks]);
  const seenKey = `boring.pm.ships.${JSON.stringify(pm.snapshot.identity)}`;
  const [seen, setSeen] = useState<readonly string[]>(() => { try { const value: unknown = JSON.parse(localStorage.getItem(seenKey) ?? '[]'); return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []; } catch { return []; } });
  const ships = spec.tasks ? selectTasks(spec.tasks.tasks, { filter: 'mine', currentUser: spec.tasks.currentUser }).filter(task => !task.technical && requestOutcome(task) === 'live').map(task => `${task.id}:${task.updated_at ?? ''}`) : [];
  const tasksLabel = text.locale === 'fr' ? 'Tâches' : 'Tasks';
  // Beside the app in a host's frame, the host owns the one way to the tasks (Julien, 2026-10-31: no second icon).
  const barPanels: readonly WorkspaceBarPanel[] = beside ? [] : [{ id: 'tasks', label: tasksLabel, icon: ListTodoIcon, dot: spec.tasks?.unread ?? ships.some(ship => !seen.includes(ship)), onOpenChange: spec.tasks?.onOpenChange, onOpen: () => {
    refreshTasks?.(); setSeen(ships); try { localStorage.setItem(seenKey, JSON.stringify(ships)); } catch { /* viewer storage is optional */ }
  }, content: () => <div data-testid="pm-task-board-seam" className="flex min-h-0 flex-1 flex-col">{spec.tasks ? <>{spec.tasks.header}<PmRequests seam={spec.tasks} text={text} /></> : <p role="status" className="p-4 text-sm text-muted-foreground">{text.connectionFailed}</p>}</div> }];
  useEffect(() => {
    if (!pm.focusVersion || !open || strip) return;
    const input = root.current?.querySelector<HTMLElement>('[data-testid=composer-input]');
    input?.focus({ preventScroll: true });
    if (input instanceof HTMLTextAreaElement) input.setSelectionRange(input.value.length, input.value.length);
  }, [pm.focusVersion, open, strip, spec.controller]);
  const pointProps = { preset, text, selections: pm.state.chips, onRemove: pm.remove, show: pm.state.show, onShow: (value: boolean) => pm.dispatch({ type: 'show', value }),
    canPoint: pm.canPoint, onPoint: () => pm.dispatch({ type: 'point' }), onReturn: pm.returnToComposer, onOpenRecorder: () => pm.dispatch({ type: 'return' }), focusInput: pm.focusVersion > 0 && open && !strip, voice: pm.voice, meta: pm.meta, notice: pm.sent ? text.sentToPm : undefined };
  const uncertain = pm.snapshot.send.kind === 'unknown' ? pm.snapshot.send.attempt : undefined;
  const transcript = pm.voice.phase === 'processing' ? <p data-testid="pm-transcribing" role="status" className="m-0 px-2">{text.locale === 'fr' ? 'Transcription…' : 'Transcribing…'}</p> : pm.liveText && <p role="status" data-testid="pm-live-transcript" className="m-0 px-2">{pm.liveText}</p>;
  return <ChatTextProvider value={chatTextFor(text.locale)}><div ref={root} className="flex min-h-0 flex-1 flex-col">
    <p role="status" aria-live="polite" data-testid="pm-announce" className="sr-only">{pm.announcement}</p>
    {pm.problem && <p role="alert" className="m-0 px-4 text-sm">{pm.problem}</p>}
    <div hidden={strip && phone} className={cn('min-h-0 flex-1 flex-col', strip && phone ? 'hidden' : 'flex')}>
      <AgentWorkspace layout="embedded" title={title ?? spec.appName ?? spec.label ?? text.title} locale={text.locale} controller={spec.controller}
        conversationId={spec.conversationId ?? String(pm.snapshot.conversationId)} conversations={spec.conversations ?? spec.chatProps?.conversations}
        {...files} artifactKinds={kinds} interactive={PM_INTERACTIVE} autoOpen={Boolean(spec.resources)} barPanels={barPanels} barOptions={{ panelsFirst: true }}
        controls={close && <Button variant="ghost" size="icon" data-testid="pm-close" aria-label={text.close} title={text.close} onClick={close}><XIcon data-icon="inline-start" aria-hidden="true" /></Button>}
        chat={{ ...spec.chatProps, ...(mentions ? { mentions } : {}),
          labels: { ...spec.chatProps?.labels, placeholder: `${text.placeholderBefore}↖${text.placeholderAfter}`, add: text.attach, send: text.send },
          onFiles: spec.chatProps?.onFiles ?? imageFiles, sendContext: pm.sendContext, replyError: spec.chatProps?.replyError ?? (() => text.failed),
          renderEntry: entry => pointMessage(entry, mentions, { preset, text }) ?? spec.chatProps?.renderEntry?.(entry),
          replyFooter: reply => { const entry = pm.snapshot.view?.entries.find(entry => String(entry.id) === reply.entryId); return <>{spec.chatProps?.replyFooter?.(reply)}{entry && spec.tasks?.renderRequest?.({ entry, edit })}</>; },
          renderComposer: composer => strip && phone ? null : strip ? <>{beside && pm.state.chips.length > 0 && <div data-testid="pm-beside-chips" className="flex flex-wrap gap-1.5 pb-2">{pm.state.chips.map(chip => <PointChipView key={chip.id} chip={chip} preset={preset} labels={text} onRemove={() => pm.remove(chip.id)} />)}</div>}<PmComposer variant="strip" {...pointProps} /></> : <PmComposer {...pointProps} composer={pm.answerComposer({ ...composer, sendBlocked: composer.sendBlocked || pm.voice.phase === 'processing', ...(uncertain ? { text: uncertain.draft.text.split(POINT_PREFACE)[0]!.trimEnd(), disabled: true } : {}) })} transcript={transcript} /> }} />
    </div>
    {strip && phone && <PmComposer variant="strip" {...pointProps} />}
    {pm.comment && page && <PointComment comment={pm.comment} frame={page} text={text} />}
  </div></ChatTextProvider>;
}

/** « Mes demandes »: the one board, the viewer's own tasks. The panel's width stacks it; the detail is where a request is answered or withdrawn. */
function PmRequests({ seam, text }: { readonly seam: StudioTaskBoardSeam; readonly text: PmText }) {
  const [selected, setSelected] = useState<string | null>(null);
  const answer = (task: TaskRecord, _question: unknown, value: string) => seam.answer?.(task, value);
  return <TaskBoard tasks={seam.tasks} filter="mine" currentUser={seam.currentUser} bar={false} title={text.requests} locale={text.locale} selectedTask={selected}
    onSelectedTaskChange={id => { setSelected(id); const task = seam.tasks.find(each => each.id === id); if (task) seam.onOpen(task); }}
    actions={task => requestOutcome(task) ? undefined : seam.cardActions?.(task)} onAnswer={answer} onOther={answer} className="min-h-0 flex-1" />;
}
