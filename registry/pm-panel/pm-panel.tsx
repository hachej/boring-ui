'use client';

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { ChevronUpIcon, XIcon } from 'lucide-react';
import type { EntryRecord } from '@earendil-works/pi-durable';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { PiChat } from '../pi-chat/pi-chat';
import { ChatTextProvider } from '../pi-chat/labels';
import { chatTextFor } from '../pi-chat/locale';
import { withChatPlugins } from '../pi-chat-plugins/chat-plugins';
import { Markdown } from '../pi-chat-markdown/markdown';
import { cn } from '../utils/utils';
import { PmComposer } from './pm-composer';
import { PointComment } from './point-comment';
import { usePmPanel } from './use-pm-panel';
import { POINT_PREFACE, plainMessage, pointMessage } from './point-message';
import { PmSteps } from './pm-steps';
import { PmMockupProvider, PmMockupView, pmArtifacts } from './pm-mockups';
import type { ArtifactDescriptor } from '@hachej/boring-ui-kit/chat-view';
import { usePmMentions } from './pm-mentions';
import { TaskBoard } from '../task-board/task-board';
import type { ImproveSpec, StudioTaskBoardSeam } from './use-pm-panel';
import { useImproveAgent } from './use-improve-agent';
import type { ImproveProp } from './use-improve-agent';
import { pmTextFor } from './pm-text';
import type { PmPreset } from './pm-composer';
import type { PmText } from './pm-text';
import type { MentionsConfig } from '../pi-chat/config';
import type { PiChatProps } from '../pi-chat/pi-chat';
import type { ChatTextPart } from '../pi-chat/message';

export { PmComposer, PointerIcon } from './pm-composer';
export type { PmComposerProps, PmPreset } from './pm-composer';
export { usePmPanel } from './use-pm-panel';
export type { PmComment, PmPanelState } from './use-pm-panel';
export { PointComment } from './point-comment';
export { usePmMentions } from './pm-mentions';
export { pmTextEn, pmTextFor, pmTextFr } from './pm-text';
export type { PmText } from './pm-text';
export { PointChipView } from './inline-point-input';
export { PmSteps, stepLabel, turnSteps } from './pm-steps';
export type { PmStep, PmTurnSteps } from './pm-steps';
export { PmArtifactCard, PmMockupView } from './pm-mockups';
export type { PmReadArtifact } from './pm-mockups';
export { pointMessage } from './point-message';
export type { ImproveSpec, PmVoice, PmTranscript, StudioTaskBoardSeam } from './use-pm-panel';
export { useImproveAgent, isImproveAgent } from './use-improve-agent';
export type { ImproveAgent, ImproveProp } from './use-improve-agent';

interface Binding { readonly spec: ImproveSpec; readonly open: boolean; readonly close: () => void; readonly onFull?: ((full: boolean, collapse: () => void) => void) | undefined }
interface Pending { readonly open: boolean; readonly close: () => void; readonly problem: string | undefined; readonly title: string }
async function imageFiles(files: readonly File[]) {
  return Promise.all(files.map(async (file, index) => {
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type) || file.size > 3 * 1024 * 1024) throw new Error('Joignez une image de moins de 3 Mo.');
    let binary = '';
    for (const byte of new Uint8Array(await file.arrayBuffer())) binary += String.fromCharCode(byte);
    return { id: `pm-file-${Date.now()}-${index}`, name: file.name, content: { type: 'image' as const, mimeType: file.type, data: btoa(binary) } };
  }));
}

const PmContext = createContext<Binding | Pending | null>(null);

/**
 * `spec` is either the host's own `ImproveSpec` or the one line `{ agent: 'pm' }`, which the kit resolves to that agent's conversation
 * through the app's door on the first open (`useImproveAgent`). `onFull` reports the full panel (C7) so the shell gives it its own Back step.
 */
export function PmPanelProvider({ spec, open, close, appName, locale, onFull, children }: { readonly spec?: ImproveProp | undefined; readonly open: boolean; readonly close: () => void; readonly appName?: string | undefined; readonly locale?: string | undefined; readonly onFull?: ((full: boolean, collapse: () => void) => void) | undefined; readonly children: ReactNode }) {
  const resolved = useImproveAgent(spec, open, { ...(appName ? { appName } : {}), ...(locale ? { locale } : {}) });
  const title = pmTextFor(locale).title;
  const value = useMemo<Binding | Pending | null>(() => resolved.spec ? { spec: resolved.spec, open, close, onFull } : spec ? { open, close, problem: resolved.problem, title } : null, [resolved.spec, resolved.problem, spec, open, close, onFull, title]);
  return <PmContext.Provider value={value}>{children}</PmContext.Provider>;
}

/**
 * The app's content and tab bar remain in flow. The sheet (C2, C6) and the strip (C3–C5) take layout space, so the page shrinks and stays
 * scrollable and tappable; only the full panel (C7) overlays the page, from 40px below the top.
 */
export function ImproveLayout({ children, navigation, screen }: { readonly children: ReactNode; readonly navigation?: ReactNode; readonly screen?: string }) {
  const binding = useContext(PmContext);
  return <BoundLayout binding={binding} navigation={navigation} screen={screen}>{children}</BoundLayout>;
}

function BoundLayout({ binding: bound, children, navigation, screen }: { readonly binding: Binding | Pending | null; readonly children: ReactNode; readonly navigation?: ReactNode; readonly screen: string | undefined }) {
  const [page, setPage] = useState<HTMLDivElement | null>(null);
  const binding = bound && 'spec' in bound ? bound : null, pending = bound && !('spec' in bound) ? bound : null;
  const controller = binding?.spec.controller;
  const [instance, setInstance] = useState({ controller, sequence: 0 });
  if (instance.controller !== controller) setInstance({ controller, sequence: instance.sequence + 1 });
  const [placement, setPlacement] = useState({ controller, mode: 'sheet', show: false });
  const report = useCallback((controller: ImproveSpec['controller'], mode: string, show: boolean) => setPlacement(current => current.controller === controller && current.mode === mode && current.show === show ? current : { controller, mode, show }), []);
  const current = placement.controller === controller ? placement : { mode: 'sheet', show: false };
  const [opened, setOpened] = useState(false);
  if (binding?.open && !opened) setOpened(true);
  const strip = current.mode === 'point' || current.mode === 'navigate';
  return <div data-pm-layout="" className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
    <div ref={setPage} data-pm-page="" data-pm-screen={screen} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
    {/* Mounted on the first open, then kept: the picks, pins and recording survive × (spec 2, draft persistence). */}
    {binding && opened && <PanelSession key={instance.sequence} binding={binding} page={page} screen={screen} report={report} />}
    {pending?.open && <section data-feedback-ignore="" data-testid="pm-panel" data-mode="connecting" className="flex shrink-0 flex-col gap-1.5 rounded-t-pm-sheet bg-background px-3 pt-2 pb-6 shadow-pm-sheet">
      <div className="flex items-center"><h2 className="m-0 min-w-0 flex-1 truncate text-[13px] font-pm-title">{pending.title}</h2>
        <Button variant="ghost" size="icon" aria-label="Fermer" data-testid="pm-close" onClick={pending.close} className="min-h-9 min-w-9"><XIcon className="size-4" aria-hidden="true" /></Button></div>
      <p role={pending.problem ? 'alert' : 'status'} className="m-0 px-1 text-sm text-muted-foreground">{pending.problem ?? 'Connexion…'}</p>
    </section>}
    {/* The tab bar shows under the strip and works normally; the sheet sits at the bottom instead of it. */}
    <div data-pm-navigation="" hidden={Boolean(bound?.open && !strip)} className="shrink-0">{navigation}</div>
  </div>;
}

function PanelSession({ binding, page, screen, report }: { readonly binding: Binding; readonly page: HTMLElement | null; readonly screen: string | undefined; readonly report: (controller: ImproveSpec['controller'], mode: string, show: boolean) => void }) {
  const pm = usePmPanel(binding.spec, binding.open, page, screen, { comment: useFinePointer() });
  const { mode, show } = pm.state;
  useLayoutEffect(() => { report(binding.spec.controller, mode, show); }, [binding.spec.controller, mode, show, report]);
  return <>
    <Panel binding={binding} pm={pm} strip={mode === 'point' || mode === 'navigate'} full={mode === 'full'} />
    {pm.comment && page && <ChatTextProvider value={chatTextFor(binding.spec.chatProps?.locale ?? 'fr')}><PointComment comment={pm.comment} frame={page} text={pm.text} /></ChatTextProvider>}
  </>;
}

/** The desktop preset's click to comment (spec 1 §3b) follows the pointer: web width without a touch screen as the main pointer, never a phone. */
const COARSE = '(pointer: coarse)', WIDE = '(min-width: 768px)';
const fine = () => !matchMedia(COARSE).matches && matchMedia(WIDE).matches;
function useFinePointer() {
  return useSyncExternalStore(listener => {
    const queries = [matchMedia(COARSE), matchMedia(WIDE)];
    for (const query of queries) query.addEventListener('change', listener);
    return () => { for (const query of queries) query.removeEventListener('change', listener); };
  }, fine, () => false);
}

/** The grabber: drag up opens the full panel, drag down closes (the draft stays). */
function Grabber({ wide, onUp, onDown }: { readonly wide: boolean; readonly onUp?: (() => void) | undefined; readonly onDown: () => void }) {
  const start = useRef<number | undefined>(undefined);
  const end = (event: ReactPointerEvent) => {
    if (start.current === undefined) return;
    const moved = event.clientY - start.current; start.current = undefined;
    if (moved < -24) onUp?.(); else if (moved > 24) onDown();
  };
  return <div data-testid="pm-grabber" aria-hidden="true" className="flex shrink-0 cursor-grab touch-none justify-center pb-1" onPointerDown={event => { start.current = event.clientY; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerUp={end} onPointerCancel={() => { start.current = undefined; }}>
    <div className={cn('h-1 rounded-pm-round', wide ? 'w-[100px] bg-border' : 'w-10 bg-pm-line')} />
  </div>;
}

function assistantText(entry: EntryRecord): string | undefined {
  const messages = entry.model?.filter(message => message.role === 'assistant');
  if (!messages?.length) return undefined;
  const text = messages.map(message => typeof message.content === 'string' ? message.content : message.content.filter(part => part.type === 'text').map(part => part.text).join('')).join('\n').trim();
  return text || undefined;
}
const failedRun = (entry: EntryRecord) => entry.model?.filter(message => message.role === 'assistant').at(-1)?.stopReason === 'error';

const callsTools = (entry: EntryRecord) => entry.model?.some(message => message.role === 'assistant' && typeof message.content !== 'string' && message.content.some(part => part.type === 'toolCall')) === true;

/** The PM's reply text in the app panel, while it streams and once committed: the C7 type, headings at body size. */
export const pmReplyText = ({ text, streaming }: ChatTextPart) => <div data-testid="pm-reply-text" className="text-[15px] leading-[1.45] [&_:is(h1,h2,h3,h4,h5,h6)]:text-[length:inherit]"><Markdown text={text} streaming={streaming} /></div>;

/**
 * The PM thread's entries: sent points with their chips, the PM's reply (Markdown; plain text on touch, a bubble on desktop) and its
 * request card. `member` is the app panel's member thread (C7): each sent message is followed by its turn's step list (`PmSteps`), a round
 * that calls tools keeps the chat's own rows (so its mockup and question cards stay), and a run that ends in error without a reply shows
 * one muted line.
 */
export function pmEntries({ preset, text, mentions, renderEntry, renderRequest, edit, member = false, controller }: {
  readonly preset: PmPreset; readonly text: PmText; readonly mentions: MentionsConfig | undefined;
  readonly renderEntry?: ((entry: EntryRecord) => ReturnType<NonNullable<PiChatProps['renderEntry']>>) | undefined;
  readonly renderRequest?: StudioTaskBoardSeam['renderRequest']; readonly edit: (text: string) => void; readonly member?: boolean;
  /** The member thread's controller: its step lists read the live turn from it. */
  readonly controller?: ImproveSpec['controller'] | undefined;
}) {
  return (entry: EntryRecord) => {
    const sent = pointMessage(entry, mentions, { preset, text });
    const own = sent ? undefined : renderEntry?.(entry);
    if (own) return own;
    const user = sent?.content ?? (member ? plainMessage(entry, mentions) : undefined);
    if (user && member && controller) return { inline: true, content: <div className="flex flex-col gap-1.5">{user}<PmSteps controller={controller} turn={entry.id} text={text} /></div> };
    if (sent) return sent;
    if (member && callsTools(entry) && !failedRun(entry)) return undefined;
    const reply = assistantText(entry);
    if (reply === undefined) return member && failedRun(entry) ? { inline: true, content: <p data-testid="pm-failed" className="m-0 text-sm text-muted-foreground">{text.failed}</p> } : undefined;
    // Headings stay at body size inside the panel.
    return { inline: true, content: <div data-testid="pm-reply" data-role="assistant" className="flex flex-col items-start gap-3.5">
      <div className={cn('rounded-pm-bubble rounded-bl-pm-tail bg-pm-reply [&_:is(h1,h2,h3,h4,h5,h6)]:text-[length:inherit]', preset === 'touch' ? 'text-[15px] leading-[1.45]' : 'max-w-[88%] px-3 py-[9px] text-sm leading-[1.45]')}><Markdown text={reply} /></div>
      {renderRequest?.({ entry, edit })}
    </div> };
  };
}

/**
 * The PM conversation for a column (Studio, desktop preset) or any host surface: the thread and the one composer, which the strip
 * replaces while pointing. `page` is the element the point layer picks in (Studio: the app's device frame).
 */
export function PmChat({ spec, page, screen, preset = 'desktop' }: { readonly spec: ImproveSpec; readonly page: HTMLElement | null; readonly screen?: string; readonly preset?: PmPreset }) {
  const pm = usePmPanel(spec, true, page, screen, { comment: preset === 'desktop' });
  const { text } = pm;
  const mentions = usePmMentions(spec.tasks, spec.chatProps?.mentions, text);
  const edit = useCallback((value: string) => { spec.controller.setText(value); }, [spec.controller]);
  const strip = pm.state.mode === 'point' || pm.state.mode === 'navigate';
  const props = { preset, text, selections: pm.state.chips, onRemove: pm.remove, show: pm.state.show, onShow: (value: boolean) => pm.dispatch({ type: 'show', value }),
    onPoint: () => pm.dispatch({ type: 'point' }), onReturn: pm.returnToComposer, onOpenRecorder: () => pm.dispatch({ type: 'return' }), focusInput: pm.focusVersion > 0 && !strip, voice: pm.voice, meta: pm.meta, notice: pm.sent ? text.sentToPm : undefined };
  return <ChatTextProvider value={chatTextFor(spec.chatProps?.locale ?? 'en')}><div data-testid="pm-chat" data-mode={pm.state.mode} data-preset={preset} className={cn('flex min-h-0 flex-1 flex-col',
    '[&_[data-boring=pi-chat]]:bg-transparent [&_[data-testid=empty-state]]:hidden [&_[data-testid=transcript-scroll]>div:last-child]:flex [&_[data-testid=transcript-scroll]>div:last-child]:min-h-full [&_[data-testid=transcript-scroll]>div:last-child]:flex-col [&_[data-testid=transcript-scroll]>div:last-child]:justify-end [&_[data-boring=pi-chat]>footer]:px-3.5 [&_[data-boring=pi-chat]>footer]:pt-0 [&_[data-boring=pi-chat]>footer]:pb-3.5 [&_[data-testid=transcript]]:gap-2.5 [&_[data-testid=transcript-scroll]>div:last-child]:px-[18px] [&_[data-testid=transcript-scroll]>div:last-child]:py-4 [&_[data-testid=transcript-history]]:min-h-0 [&_[data-testid=transcript-history]>span:not([role])]:hidden [&_[data-testid=transcript-navigation]]:pointer-events-none [&_[data-testid=transcript-navigation]]:absolute [&_[data-testid=transcript-navigation]]:inset-x-0 [&_[data-testid=transcript-navigation]]:bottom-0 [&_[data-testid=transcript-navigation]_*]:pointer-events-auto')}>
    <p role="status" aria-live="polite" data-testid="pm-announce" className="sr-only">{pm.announcement}</p>
    {pm.problem && <p role="alert" className="m-0 px-4 text-sm">{pm.problem}</p>}
    <PiChat {...withChatPlugins({ ...spec.chatProps, ...(mentions ? { mentions } : {}) })} controller={spec.controller} locale={spec.chatProps?.locale ?? 'en'} header={false} emptyLayout="docked"
      labels={{ ...spec.chatProps?.labels, placeholder: `${text.placeholderBefore}↖${text.placeholderAfter}`, add: text.attach, send: text.send }} onFiles={spec.chatProps?.onFiles ?? imageFiles}
      sendContext={pm.sendContext} renderEntry={pmEntries({ preset, text, mentions, renderEntry: spec.chatProps?.renderEntry, renderRequest: spec.tasks?.renderRequest, edit })}
      renderComposer={composer => strip ? <PmComposer variant="strip" {...props} /> : <PmComposer {...props} composer={{ ...composer, sendBlocked: composer.sendBlocked || pm.voice.phase === 'processing' }} />} />
    {pm.comment && page && <PointComment comment={pm.comment} frame={page} text={text} />}
  </div></ChatTextProvider>;
}

function Panel({ binding, pm, strip, full }: { readonly binding: Binding; readonly pm: ReturnType<typeof usePmPanel>; readonly strip: boolean; readonly full: boolean }) {
  const { spec, open, close: closeLayer } = binding;
  const [requests, setRequestsState] = useState(false);
  // An opened mockup (`present`): full height in the sheet, under « ‹ Retour ».
  const [mockup, setMockup] = useState<ArtifactDescriptor>();
  // The task source is read again when « Mes demandes » opens and when the panel opens (a 403 or 404 is « unavailable for now »).
  const setRequests = (next: boolean) => { if (next && !requests) spec.tasks?.refresh?.(); setRequestsState(next); };
  const refreshTasks = spec.tasks?.refresh;
  useEffect(() => { if (open) refreshTasks?.(); }, [open, refreshTasks]);
  // Closing leaves « Mes demandes » and the mockup: the next full panel opens on the thread.
  const close = () => { setRequestsState(false); setMockup(undefined); closeLayer(); };
  const mentions = usePmMentions(spec.tasks, spec.chatProps?.mentions, pm.text);
  const sheet = useRef<HTMLDivElement | null>(null);
  const submit = pm.sendContext;
  const { dispatch, text } = pm;
  // Plain-text sends have no context attachment, but still expand on observed native admission.
  // A comment sent from the popover keeps the strip (spec 1 §3b): only the composer's own sends open C7.
  const admitted = pm.snapshot.send.kind === 'admitted' && !pm.quietSend(pm.snapshot.send.attempt.draft.text) ? pm.snapshot.send.attempt.requestId : undefined;
  const previousAdmission = useRef<string | undefined>(undefined);
  // The full panel is its own Back step (full, then sheet, then closed): the shell owns the history entries.
  const { onFull } = binding;
  useEffect(() => { onFull?.(full, () => dispatch({ type: 'collapse' })); }, [full, onFull, dispatch]);
  useEffect(() => {
    if (admitted && admitted !== previousAdmission.current) dispatch({ type: 'full' });
    if (admitted) previousAdmission.current = admitted;
  }, [admitted, dispatch]);
  const uncertain = pm.snapshot.send.kind === 'unknown' ? pm.snapshot.send.attempt : undefined;
  const focusVersion = pm.focusVersion;
  useEffect(() => {
    if (!focusVersion || !open || strip) return;
    const input = sheet.current?.querySelector<HTMLElement>('[data-testid=composer-input]');
    input?.focus({ preventScroll: true });
    if (input instanceof HTMLTextAreaElement) input.setSelectionRange(input.value.length, input.value.length);
  }, [focusVersion, open, strip, spec.controller]);
  const edit = useCallback((value: string) => { spec.controller.setText(value); }, [spec.controller]);
  const pointProps = { preset: 'touch' as const, text, selections: pm.state.chips, onRemove: pm.remove, show: pm.state.show, onShow: (value: boolean) => pm.dispatch({ type: 'show', value }),
    onPoint: () => pm.dispatch({ type: 'point' }), onReturn: pm.returnToComposer, onOpenRecorder: () => pm.dispatch({ type: 'return' }), focusInput: focusVersion > 0 && open && !strip, voice: pm.voice, meta: pm.meta, notice: pm.sent ? text.sentToPm : undefined };
  const chatText = chatTextFor(spec.chatProps?.locale ?? 'fr');
  const review = !full && pm.meta !== undefined;
  const transcript = pm.voice.phase === 'processing' ? <p data-testid="pm-transcribing" role="status" className="m-0 px-2">Transcription…</p> : pm.liveText && <p role="status" data-testid="pm-live-transcript" className="m-0 px-2">{pm.liveText}</p>;
  const renderEntry = pmEntries({ preset: 'touch', text, mentions, renderEntry: spec.chatProps?.renderEntry, renderRequest: spec.tasks?.renderRequest, edit, member: true, controller: spec.controller });
  const showMockup = useCallback((artifact: ArtifactDescriptor) => { setMockup(artifact); dispatch({ type: 'full' }); }, [dispatch]);
  const artifacts = useMemo(() => spec.chatProps?.artifacts ?? pmArtifacts(showMockup, mockup), [spec.chatProps?.artifacts, showMockup, mockup]);
  const aside = full && (requests || mockup !== undefined);
  const header = full ? <>
    <div className="flex shrink-0 items-center gap-2.5 py-2 pr-2 pl-4">
      <div className="min-w-0 flex-1">
        <h2 data-testid="pm-title" className="m-0 truncate text-[15px] leading-tight font-pm-title">{text.title}</h2>
        <p className="m-0 truncate text-xs text-muted-foreground">{text.subtitle(spec.appName ?? spec.label ?? '')}</p>
      </div>
      <span className="flex shrink-0 [&_button]:px-0 [&_button]:text-sm [&_button]:font-semibold [&_button]:text-foreground [&_button]:underline"><Button variant="link" data-testid="pm-requests" disabled={!spec.tasks} onClick={() => setRequests(!requests)} className="min-h-11">{text.requests}</Button></span>
      <Button variant="ghost" size="icon" aria-label={text.close} title={text.close} data-testid="pm-close" onClick={close} className="min-h-11 min-w-11"><XIcon className="size-[18px]" aria-hidden="true" /></Button>
    </div>
    <Separator />
  </> : review ? <div className="flex shrink-0 items-center px-1 py-0.5">
    <h2 data-testid="pm-title" className="m-0 min-w-0 flex-1 truncate text-sm font-pm-title">{text.title}</h2>
    <span data-testid="pm-review-hint" className="text-xs text-muted-foreground">{text.review}</span>
  </div> : <div className="flex shrink-0 items-center">
    <h2 data-testid="pm-title" className="m-0 min-w-0 flex-1 truncate text-[13px] font-pm-title">{text.title}</h2>
    <Button variant="ghost" size="icon" aria-label={text.openPanel} title={text.openPanel} data-testid="pm-expand" onClick={() => pm.dispatch({ type: 'full' })} className="min-h-9 min-w-9"><ChevronUpIcon className="size-[18px]" aria-hidden="true" /></Button>
    <Button variant="ghost" size="icon" aria-label={text.close} title={text.close} data-testid="pm-close" onClick={close} className="min-h-9 min-w-9"><XIcon className="size-4" aria-hidden="true" /></Button>
  </div>;
  return <section hidden={!open} data-feedback-ignore="" data-testid="pm-panel" data-mode={pm.state.mode} data-review={review || undefined}
    className={cn(open && !strip && (full ? 'absolute inset-x-0 top-10 bottom-0 z-40 flex flex-col' : 'flex max-h-[85dvh] min-h-0 shrink-0 flex-col'), strip && 'shrink-0')}>
    <p role="status" aria-live="polite" data-testid="pm-announce" className="sr-only">{pm.announcement}</p>
    <ChatTextProvider value={chatText}><PmMockupProvider read={spec.readArtifact} text={text}>
      <div hidden={!strip}><PmComposer variant="strip" {...pointProps} /></div>
      <div hidden={strip} ref={sheet} data-testid="pm-sheet" className={cn('min-h-0 flex-1 flex-col rounded-t-pm-sheet bg-background', strip ? 'hidden' : 'flex', full ? 'shadow-pm-panel pt-2' : 'gap-1.5 px-3 pt-2 pb-6 shadow-pm-sheet')}>
        <Grabber wide={full} onUp={full ? undefined : () => pm.dispatch({ type: 'full' })} onDown={close} />
        {mockup && full && !requests ? <PmMockupView artifact={mockup} text={text} onBack={() => setMockup(undefined)} /> : requests && full ? <>
          <div className="flex shrink-0 items-center py-1 pr-2 pl-2"><Button variant="ghost" data-testid="pm-requests-back" onClick={() => setRequests(false)} className="min-h-11">{text.back}</Button></div>
          <Separator />
          <div className="min-h-0 flex-1 overflow-auto" data-testid="pm-task-board-seam">{spec.tasks && <TaskBoard tasks={spec.tasks.tasks} variant="compact" filter="mine" currentUser={spec.tasks.currentUser} bar={false} title={text.requests}
            onOpen={spec.tasks.onOpen} cardActions={spec.tasks.cardActions} locale={text.locale} viewerAction="confirmation" className="p-4" />}</div>
        </> : header}
        {pm.problem && <p role="alert" className="m-0 px-4 text-sm">{pm.problem}</p>}
        <div hidden={aside} className={cn('min-h-0 flex-1 flex-col', aside ? 'hidden' : 'flex',
          full ? '[&_[data-boring=pi-chat]>footer]:px-4 [&_[data-boring=pi-chat]>footer]:pb-6 [&_[data-testid=transcript]]:gap-3.5 [&_[data-testid=transcript]]:text-[15px] [&_[data-testid=transcript-scroll]>div:last-child]:p-4 [&_[data-testid=transcript-history]]:min-h-0 [&_[data-testid=transcript-history]>span:not([role])]:hidden [&_[data-testid=transcript-navigation]]:pointer-events-none [&_[data-testid=transcript-navigation]]:absolute [&_[data-testid=transcript-navigation]]:inset-x-0 [&_[data-testid=transcript-navigation]]:bottom-0 [&_[data-testid=transcript-navigation]_*]:pointer-events-auto [&_[data-testid=preparing]]:hidden [&_[data-testid=copy]]:hidden [&_[data-testid=conversation-files]]:hidden [&_[data-testid=question-option]]:min-h-11 [&_[data-testid=question-input]]:min-h-11 [&_[data-testid=question-submit]]:min-h-11'
            : '[&_[data-testid=transcript]]:hidden [&_[data-boring=pi-chat]>.relative]:hidden [&_[data-boring=pi-chat]>footer]:p-0')}>
          <PiChat {...withChatPlugins({ ...spec.chatProps, renderText: spec.chatProps?.renderText ?? pmReplyText, artifacts, ...(mentions ? { mentions } : {}) })} controller={spec.controller} locale={spec.chatProps?.locale ?? 'fr'} header={false} emptyLayout="docked" keyboardInset={false} presentation="natural"
            labels={{ ...spec.chatProps?.labels, placeholder: `${text.placeholderBefore}↖${text.placeholderAfter}`, add: text.attach, send: text.send }} onFiles={spec.chatProps?.onFiles ?? imageFiles}
            sendContext={submit} renderEntry={renderEntry} renderComposer={composer => <PmComposer {...pointProps} composer={{ ...composer, sendBlocked: composer.sendBlocked || pm.voice.phase === 'processing' || pm.snapshot.send.kind === 'validating' || pm.snapshot.send.kind === 'submitting', ...(uncertain ? { text: uncertain.draft.text.split(POINT_PREFACE)[0]!.trimEnd(), disabled: true } : {}) }} transcript={transcript} />} />
        </div>
      </div>
    </PmMockupProvider></ChatTextProvider>
  </section>;
}
