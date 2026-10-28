'use client';

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDownIcon, ChevronUpIcon, XIcon } from 'lucide-react';
import * as NativeDrawer from '@base-ui/react/drawer';
import { Drawer, DrawerSwipeHandle, DrawerTitle } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PiChat } from '../pi-chat/pi-chat';
import { ChatTextProvider } from '../pi-chat/labels';
import { chatTextFor } from '../pi-chat/locale';
import { withChatPlugins } from '../pi-chat-plugins/chat-plugins';
import { PmComposer } from './pm-composer';
import { usePmPanel } from './use-pm-panel';
import { POINT_PREFACE, pointMessage } from './point-message';
import { useTaskMentions } from './task-mentions';
import type { ImproveSpec } from './use-pm-panel';
import { cn } from '../utils/utils';

export { PmComposer } from './pm-composer';
export { usePmPanel } from './use-pm-panel';
export type { PmComposerProps } from './pm-composer';
export { useTaskMentions } from './task-mentions';
export type { TaskMention, TaskMentionSource } from './task-mentions';
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
const SelectingContext = createContext(false);
export const usePmSelecting = () => useContext(SelectingContext);

export function PmPanelProvider({ spec, open, close, children }: { readonly spec?: ImproveSpec | undefined; readonly open: boolean; readonly close: () => void; readonly children: ReactNode }) {
  const value = useMemo(() => spec ? { spec, open, close } : null, [spec, open, close]);
  return <PmContext.Provider value={value}>{children}</PmContext.Provider>;
}

/** The app's content and tab bar remain in flow. The PM takes space, never a viewport overlay. */
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
  const strip = current.mode === 'point' || current.mode === 'navigate';
  return <SelectingContext.Provider value={Boolean(binding?.open && current.show)}><div data-pm-layout="" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
    <div ref={setPage} data-pm-page="" data-pm-screen={screen} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
    {binding && <PanelSession key={instance.sequence} binding={binding} page={page} screen={screen} report={report} />}
    <div data-pm-navigation="" hidden={Boolean(binding?.open && !strip)} className="shrink-0">{navigation}</div>
  </div></SelectingContext.Provider>;
}

function PanelSession({ binding, page, screen, report }: { readonly binding: Binding; readonly page: HTMLElement | null; readonly screen: string | undefined; readonly report: (controller: ImproveSpec['controller'], mode: string, show: boolean) => void }) {
  const pm = usePmPanel(binding.spec, binding.open, page, screen);
  const { mode, show } = pm.state;
  useLayoutEffect(() => { report(binding.spec.controller, mode, show); }, [binding.spec.controller, mode, show, report]);
  return <Panel binding={binding} pm={pm} strip={mode === 'point' || mode === 'navigate'} full={mode === 'full'} />;
}

function Panel({ binding: { spec, open, close }, pm, strip, full }: { readonly binding: Binding; readonly pm: ReturnType<typeof usePmPanel>; readonly strip: boolean; readonly full: boolean }) {
  const [requests, setRequests] = useState(false);
  const mentions = useTaskMentions(spec.taskMentions, spec.chatProps?.mentions);
  const sheet = useRef<HTMLDivElement | null>(null);
  const [portal, setPortal] = useState<HTMLDivElement | null>(null);
  const submit = pm.sendContext;
  const { dispatch } = pm;
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
  const show = (value: boolean) => pm.dispatch({ type: 'show', value });
  const pointProps = { selections: pm.state.chips, onRemove: pm.remove, show: pm.state.show, onShow: show, onReturn: pm.returnToComposer,
    onOpenRecorder: () => pm.dispatch({ type: 'return' }), focusInput: focusVersion > 0 && open && !strip, voice: pm.voice };
  const text = chatTextFor(spec.chatProps?.locale ?? 'fr');
  const transcript = pm.voice.phase === 'processing' ? <p data-testid="pm-transcribing" role="status" className="m-0 px-2">Transcription…</p> : pm.liveText && <p role="status" data-testid="pm-live-transcript" className="m-0 px-2">{pm.liveText}</p>;
  return <section hidden={!open} data-feedback-ignore="" data-testid="pm-panel" data-mode={pm.state.mode} className={cn('min-h-0 shrink-0', open && !strip && (full ? 'flex h-[min(65dvh,42rem)] flex-col' : 'flex max-h-[55dvh] flex-col'))}>
    <ChatTextProvider value={text}>
      <div hidden={!strip}><PmComposer variant="strip" {...pointProps} /></div>
      {/* The native portal targets an in-flow host, never the viewport/body overlay. */}
      <div hidden={strip} ref={setPortal} className="min-h-0 flex-1">
        {portal && <Drawer open={open && !strip} modal={false} showSwipeHandle onOpenChange={(next, details) => {
          if (next || !open || strip) return;
          if (details.reason === 'swipe') pm.dispatch({ type: 'show', value: true });
          else if (details.reason === 'escape-key') close();
        }}>
          <NativeDrawer.Drawer.Portal container={portal} keepMounted className="flex h-full min-h-0 flex-col"><NativeDrawer.Drawer.Viewport className="flex h-full min-h-0 flex-col"><NativeDrawer.Drawer.Popup render={<Card />} ref={sheet} initialFocus={false} finalFocus={false} data-testid="pm-sheet" data-swipe-axis="y" data-swipe-direction="down" className="group/drawer-popup flex h-full min-h-0 flex-col gap-0 overflow-hidden py-0">
            <DrawerSwipeHandle />
            <div className="flex min-h-11 shrink-0 items-center gap-1 px-3">
              <DrawerTitle className="min-w-0 flex-1">Améliorer l’app</DrawerTitle>
              {full && <Button variant="link" data-testid="pm-requests" disabled={!spec.tasks} onClick={() => setRequests(value => !value)}>Mes demandes</Button>}
              <Button variant="ghost" size="icon" aria-label={full ? 'Réduire' : 'Ouvrir le panneau'} data-testid="pm-expand" onClick={() => pm.dispatch({ type: full ? 'collapse' : 'full' })}>{full ? <ChevronDownIcon data-icon="inline-start" /> : <ChevronUpIcon data-icon="inline-start" />}</Button>
              <Button variant="ghost" size="icon" aria-label="Fermer" data-testid="pm-close" onClick={close}><XIcon data-icon="inline-start" /></Button>
            </div>
            <NativeDrawer.Drawer.Content data-base-ui-swipe-ignore="" className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {pm.problem && <p role="alert" className="m-0 px-4">{pm.problem}</p>}
              {full && requests && spec.tasks && <div className="min-h-0 flex-1 overflow-auto" data-testid="pm-task-board-seam">{spec.tasks.renderBoard({ filter: 'mine', variant: 'full' })}</div>}
              <div className={cn('min-h-0 flex-1', full && requests ? 'hidden' : 'flex flex-col', !full && '[&_[data-testid=transcript]]:hidden [&_[data-boring=pi-chat]>.relative]:hidden [&_[data-boring=pi-chat]>footer]:pt-0')}>
                <PiChat {...withChatPlugins({ ...spec.chatProps, ...(mentions ? { mentions } : {}) })} controller={spec.controller} locale={spec.chatProps?.locale ?? 'fr'} header={false} emptyLayout="docked" keyboardInset={false}
                  labels={{ ...spec.chatProps?.labels, placeholder: 'Décrivez le problème, ou ↖ pour me le montrer.' }} onFiles={spec.chatProps?.onFiles ?? imageFiles}
                  sendContext={submit} renderEntry={entry => pointMessage(entry, mentions) ?? spec.chatProps?.renderEntry?.(entry)} renderComposer={composer => <PmComposer {...pointProps} composer={{ ...composer, sendBlocked: composer.sendBlocked || pm.voice.phase === 'processing' || pm.snapshot.send.kind === 'validating' || pm.snapshot.send.kind === 'submitting', ...(uncertain ? { text: uncertain.draft.text.split(POINT_PREFACE)[0]!.trimEnd(), disabled: true } : {}) }} transcript={transcript} />}
                  belowComposer={full ? <>{spec.tasks?.renderRequest?.()}{spec.tasks?.renderBoard({ filter: 'mine', limit: 2, variant: 'compact' })}</> : undefined} />
              </div>
            </NativeDrawer.Drawer.Content>
          </NativeDrawer.Drawer.Popup></NativeDrawer.Drawer.Viewport></NativeDrawer.Drawer.Portal>
        </Drawer>}
      </div>
    </ChatTextProvider>
  </section>;
}
