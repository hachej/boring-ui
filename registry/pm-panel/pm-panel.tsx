'use client';

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { ChevronUpIcon, XIcon } from 'lucide-react';
import type { EntryRecord } from '@earendil-works/pi-durable';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { PiChat } from '../pi-chat/pi-chat';
import { ChatTextProvider } from '../pi-chat/labels';
import { chatTextFor } from '../pi-chat/locale';
import { withChatPlugins } from '../pi-chat-plugins/chat-plugins';
import { cn } from '../utils/utils';
import { PmComposer } from './pm-composer';
import { usePmPanel } from './use-pm-panel';
import { POINT_PREFACE, pointMessage } from './point-message';
import { useTaskMentions } from './task-mentions';
import type { ImproveSpec, StudioTaskBoardSeam } from './use-pm-panel';
import type { PmPreset } from './pm-composer';
import type { PmText } from './pm-text';
import type { MentionsConfig } from '../pi-chat/config';
import type { PiChatProps } from '../pi-chat/pi-chat';

export { PmComposer, PointerIcon } from './pm-composer';
export type { PmComposerProps, PmPreset } from './pm-composer';
export { usePmPanel } from './use-pm-panel';
export type { PmPanelState } from './use-pm-panel';
export { useTaskMentions } from './task-mentions';
export type { TaskMention, TaskMentionSource } from './task-mentions';
export { pmTextEn, pmTextFor, pmTextFr } from './pm-text';
export type { PmText } from './pm-text';
export { PointChipView } from './inline-point-input';
export { pointMessage } from './point-message';
export type { ImproveSpec, PmVoice, PmTranscript, StudioTaskBoardSeam } from './use-pm-panel';

interface Binding { readonly spec: ImproveSpec; readonly open: boolean; readonly close: () => void }
async function imageFiles(files: readonly File[]) {
  return Promise.all(files.map(async (file, index) => {
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type) || file.size > 3 * 1024 * 1024) throw new Error('Joignez une image de moins de 3 Mo.');
    let binary = '';
    for (const byte of new Uint8Array(await file.arrayBuffer())) binary += String.fromCharCode(byte);
    return { id: `pm-file-${Date.now()}-${index}`, name: file.name, content: { type: 'image' as const, mimeType: file.type, data: btoa(binary) } };
  }));
}

const PmContext = createContext<Binding | null>(null);

export function PmPanelProvider({ spec, open, close, children }: { readonly spec?: ImproveSpec | undefined; readonly open: boolean; readonly close: () => void; readonly children: ReactNode }) {
  const value = useMemo(() => spec ? { spec, open, close } : null, [spec, open, close]);
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

function BoundLayout({ binding, children, navigation, screen }: { readonly binding: Binding | null; readonly children: ReactNode; readonly navigation?: ReactNode; readonly screen: string | undefined }) {
  const [page, setPage] = useState<HTMLDivElement | null>(null);
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
    {/* The tab bar shows under the strip and works normally; the sheet sits at the bottom instead of it. */}
    <div data-pm-navigation="" hidden={Boolean(binding?.open && !strip)} className="shrink-0">{navigation}</div>
  </div>;
}

function PanelSession({ binding, page, screen, report }: { readonly binding: Binding; readonly page: HTMLElement | null; readonly screen: string | undefined; readonly report: (controller: ImproveSpec['controller'], mode: string, show: boolean) => void }) {
  const pm = usePmPanel(binding.spec, binding.open, page, screen);
  const { mode, show } = pm.state;
  useLayoutEffect(() => { report(binding.spec.controller, mode, show); }, [binding.spec.controller, mode, show, report]);
  return <Panel binding={binding} pm={pm} strip={mode === 'point' || mode === 'navigate'} full={mode === 'full'} />;
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

/** The PM thread's entries: sent points with their chips, the PM's reply (plain text on touch, a bubble on desktop) and its request card. */
export function pmEntries({ preset, text, mentions, renderEntry, renderRequest, edit }: {
  readonly preset: PmPreset; readonly text: PmText; readonly mentions: MentionsConfig | undefined;
  readonly renderEntry?: ((entry: EntryRecord) => ReturnType<NonNullable<PiChatProps['renderEntry']>>) | undefined;
  readonly renderRequest?: StudioTaskBoardSeam['renderRequest']; readonly edit: (text: string) => void;
}) {
  return (entry: EntryRecord) => {
    const sent = pointMessage(entry, mentions, { preset, text });
    if (sent) return sent;
    const own = renderEntry?.(entry);
    if (own) return own;
    const reply = assistantText(entry);
    if (reply === undefined) return undefined;
    return { inline: true, content: <div data-testid="pm-reply" data-role="assistant" className="flex flex-col items-start gap-3.5">
      <p className={cn('m-0 whitespace-pre-wrap rounded-pm-bubble rounded-bl-pm-tail bg-pm-reply', preset === 'touch' ? 'text-[15px] leading-[1.45]' : 'max-w-[88%] px-3 py-[9px] text-sm leading-[1.45]')}>{reply}</p>
      {renderRequest?.({ entry, edit })}
    </div> };
  };
}

/**
 * The PM conversation for a column (Studio, desktop preset) or any host surface: the thread and the one composer, which the strip
 * replaces while pointing. `page` is the element the point layer picks in (Studio: the app's device frame).
 */
export function PmChat({ spec, page, screen, preset = 'desktop' }: { readonly spec: ImproveSpec; readonly page: HTMLElement | null; readonly screen?: string; readonly preset?: PmPreset }) {
  const pm = usePmPanel(spec, true, page, screen);
  const { text } = pm;
  const mentions = useTaskMentions(spec.taskMentions, spec.chatProps?.mentions, text);
  const edit = useCallback((value: string) => { spec.controller.setText(value); }, [spec.controller]);
  const strip = pm.state.mode === 'point' || pm.state.mode === 'navigate';
  const props = { preset, text, selections: pm.state.chips, onRemove: pm.remove, show: pm.state.show, onShow: (value: boolean) => pm.dispatch({ type: 'show', value }),
    onPoint: () => pm.dispatch({ type: 'point' }), onReturn: pm.returnToComposer, onOpenRecorder: () => pm.dispatch({ type: 'return' }), focusInput: pm.focusVersion > 0 && !strip, voice: pm.voice, meta: pm.meta };
  return <ChatTextProvider value={chatTextFor(spec.chatProps?.locale ?? 'en')}><div data-testid="pm-chat" data-mode={pm.state.mode} data-preset={preset} className={cn('flex min-h-0 flex-1 flex-col',
    '[&_[data-boring=pi-chat]]:bg-transparent [&_[data-testid=empty-state]]:hidden [&_[data-testid=transcript-scroll]>div:last-child]:flex [&_[data-testid=transcript-scroll]>div:last-child]:min-h-full [&_[data-testid=transcript-scroll]>div:last-child]:flex-col [&_[data-testid=transcript-scroll]>div:last-child]:justify-end [&_[data-boring=pi-chat]>footer]:px-3.5 [&_[data-boring=pi-chat]>footer]:pt-0 [&_[data-boring=pi-chat]>footer]:pb-3.5 [&_[data-testid=transcript]]:gap-2.5 [&_[data-testid=transcript-scroll]>div:last-child]:px-[18px] [&_[data-testid=transcript-scroll]>div:last-child]:py-4 [&_[data-testid=transcript-history]]:min-h-0 [&_[data-testid=transcript-history]>span:not([role])]:hidden [&_[data-testid=transcript-navigation]]:pointer-events-none [&_[data-testid=transcript-navigation]]:absolute [&_[data-testid=transcript-navigation]]:inset-x-0 [&_[data-testid=transcript-navigation]]:bottom-0 [&_[data-testid=transcript-navigation]_*]:pointer-events-auto')}>
    <p role="status" aria-live="polite" data-testid="pm-announce" className="sr-only">{pm.announcement}</p>
    {pm.problem && <p role="alert" className="m-0 px-4 text-sm">{pm.problem}</p>}
    <PiChat {...withChatPlugins({ ...spec.chatProps, ...(mentions ? { mentions } : {}) })} controller={spec.controller} locale={spec.chatProps?.locale ?? 'en'} header={false} emptyLayout="docked"
      labels={{ ...spec.chatProps?.labels, placeholder: `${text.placeholderBefore}↖${text.placeholderAfter}`, add: text.attach, send: text.send }} onFiles={spec.chatProps?.onFiles ?? imageFiles}
      sendContext={pm.sendContext} renderEntry={pmEntries({ preset, text, mentions, renderEntry: spec.chatProps?.renderEntry, renderRequest: spec.tasks?.renderRequest, edit })}
      renderComposer={composer => strip ? <PmComposer variant="strip" {...props} /> : <PmComposer {...props} composer={{ ...composer, sendBlocked: composer.sendBlocked || pm.voice.phase === 'processing' }} />} />
  </div></ChatTextProvider>;
}

function Panel({ binding: { spec, open, close: closeLayer }, pm, strip, full }: { readonly binding: Binding; readonly pm: ReturnType<typeof usePmPanel>; readonly strip: boolean; readonly full: boolean }) {
  const [requests, setRequests] = useState(false);
  // Closing leaves « Mes demandes »: the next full panel opens on the thread.
  const close = () => { setRequests(false); closeLayer(); };
  const mentions = useTaskMentions(spec.taskMentions, spec.chatProps?.mentions, pm.text);
  const sheet = useRef<HTMLDivElement | null>(null);
  const submit = pm.sendContext;
  const { dispatch, text } = pm;
  // Plain-text sends have no context attachment, but still expand on observed native admission.
  const admitted = pm.snapshot.send.kind === 'admitted' ? pm.snapshot.send.attempt.requestId : undefined;
  const previousAdmission = useRef<string | undefined>(undefined);
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
    onPoint: () => pm.dispatch({ type: 'point' }), onReturn: pm.returnToComposer, onOpenRecorder: () => pm.dispatch({ type: 'return' }), focusInput: focusVersion > 0 && open && !strip, voice: pm.voice, meta: pm.meta };
  const chatText = chatTextFor(spec.chatProps?.locale ?? 'fr');
  const review = !full && pm.meta !== undefined;
  const transcript = pm.voice.phase === 'processing' ? <p data-testid="pm-transcribing" role="status" className="m-0 px-2">Transcription…</p> : pm.liveText && <p role="status" data-testid="pm-live-transcript" className="m-0 px-2">{pm.liveText}</p>;
  const renderEntry = pmEntries({ preset: 'touch', text, mentions, renderEntry: spec.chatProps?.renderEntry, renderRequest: spec.tasks?.renderRequest, edit });
  const header = full ? <>
    <div className="flex shrink-0 items-center gap-2.5 py-2 pr-2 pl-4">
      <div className="min-w-0 flex-1">
        <h2 data-testid="pm-title" className="m-0 truncate text-[15px] leading-tight font-pm-title">{text.title}</h2>
        <p className="m-0 truncate text-xs text-muted-foreground">{text.subtitle(spec.appName ?? spec.label ?? '')}</p>
      </div>
      <span className="flex shrink-0 [&_button]:px-0 [&_button]:text-sm [&_button]:font-semibold [&_button]:text-foreground [&_button]:underline"><Button variant="link" data-testid="pm-requests" disabled={!spec.tasks} onClick={() => setRequests(value => !value)} className="min-h-11">{text.requests}</Button></span>
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
    <ChatTextProvider value={chatText}>
      <div hidden={!strip}><PmComposer variant="strip" {...pointProps} /></div>
      <div hidden={strip} ref={sheet} data-testid="pm-sheet" className={cn('min-h-0 flex-1 flex-col rounded-t-pm-sheet bg-background', strip ? 'hidden' : 'flex', full ? 'shadow-pm-panel pt-2' : 'gap-1.5 px-3 pt-2 pb-6 shadow-pm-sheet')}>
        <Grabber wide={full} onUp={full ? undefined : () => pm.dispatch({ type: 'full' })} onDown={close} />
        {requests && full ? <>
          <div className="flex shrink-0 items-center py-1 pr-2 pl-2"><Button variant="ghost" data-testid="pm-requests-back" onClick={() => setRequests(false)} className="min-h-11">{text.back}</Button></div>
          <Separator />
          <div className="min-h-0 flex-1 overflow-auto" data-testid="pm-task-board-seam">{spec.tasks?.renderBoard({ filter: 'mine', variant: 'compact' })}</div>
        </> : header}
        {pm.problem && <p role="alert" className="m-0 px-4 text-sm">{pm.problem}</p>}
        <div hidden={requests && full} className={cn('min-h-0 flex-1 flex-col', requests && full ? 'hidden' : 'flex',
          full ? '[&_[data-boring=pi-chat]>footer]:px-4 [&_[data-boring=pi-chat]>footer]:pb-6 [&_[data-testid=transcript]]:gap-3.5 [&_[data-testid=transcript]]:text-[15px] [&_[data-testid=transcript-scroll]>div:last-child]:p-4 [&_[data-testid=transcript-history]]:min-h-0 [&_[data-testid=transcript-history]>span:not([role])]:hidden [&_[data-testid=transcript-navigation]]:pointer-events-none [&_[data-testid=transcript-navigation]]:absolute [&_[data-testid=transcript-navigation]]:inset-x-0 [&_[data-testid=transcript-navigation]]:bottom-0 [&_[data-testid=transcript-navigation]_*]:pointer-events-auto'
            : '[&_[data-testid=transcript]]:hidden [&_[data-boring=pi-chat]>.relative]:hidden [&_[data-boring=pi-chat]>footer]:p-0')}>
          <PiChat {...withChatPlugins({ ...spec.chatProps, ...(mentions ? { mentions } : {}) })} controller={spec.controller} locale={spec.chatProps?.locale ?? 'fr'} header={false} emptyLayout="docked" keyboardInset={false}
            labels={{ ...spec.chatProps?.labels, placeholder: `${text.placeholderBefore}↖${text.placeholderAfter}`, add: text.attach, send: text.send }} onFiles={spec.chatProps?.onFiles ?? imageFiles}
            sendContext={submit} renderEntry={renderEntry} renderComposer={composer => <PmComposer {...pointProps} composer={{ ...composer, sendBlocked: composer.sendBlocked || pm.voice.phase === 'processing' || pm.snapshot.send.kind === 'validating' || pm.snapshot.send.kind === 'submitting', ...(uncertain ? { text: uncertain.draft.text.split(POINT_PREFACE)[0]!.trimEnd(), disabled: true } : {}) }} transcript={transcript} />} />
        </div>
      </div>
    </ChatTextProvider>
  </section>;
}
