'use client';

// The chats and their header: one PiChat per spec in a persistent host element, the slot it moves into, the layer's title row with History and Library.
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { HTMLAttributes, ReactNode, Ref } from 'react';
import { ArrowLeftIcon, ChevronDownIcon, ChevronUpIcon, HistoryIcon, LibraryIcon, XIcon } from '../_shared/icons';
import { Button } from '@/components/ui/button';
import { PiChat } from '../pi-chat/pi-chat';
import { withChatPlugins } from '../pi-chat-plugins/chat-plugins';
import { PendingVoiceBubble } from '../pi-chat-voice/voice-message';
import { chatTextFor } from '../pi-chat/locale';
import { ConversationHistory } from '../pi-chat/history';
import { ChatTextProvider } from '../pi-chat/labels';
import { NoteBubble, useComposerFeedback } from '../feedback/feedback-session';
import { feedbackLabelsFr } from '../feedback/feedback-labels';
import { sentFeedbackContent } from '../feedback/sent-content';
import { usePointing } from '../feedback/point-mode';
import { cn } from '../utils/utils';
import { useAgentBarChat } from '../agent-bar/use-agent-bar-chat';
import type { AppShellLocale, AppShellText } from './text';
import { HeaderActions } from './header-actions';
import { chatWordLabels, composerLabels, shellWords, useInternal } from './layer-context';
import type { AgentSpec, Snap, Which } from './layer-context';
import { BarMicButton, BarMicStatus, ConversationChevron, FoldedCard, SendProblem, TalkButton, useBarMic } from './agent-bar-parts';

/** The preview header's Library button, when the app gives one. */
export function LibraryButton({ open, text, testId = 'agent-preview-library' }: { readonly open: (() => void) | undefined; readonly text: AppShellText; readonly testId?: string }) {
  if (!open) return null;
  return <Button variant="ghost" size="icon" data-testid={testId} aria-label={text.library} title={text.library} onClick={open}><LibraryIcon data-icon="inline-start" aria-hidden="true" /></Button>;
}

/** « Historique » in the conversation's header, when the app gives `chatProps.conversations`: the same list PiChat's own header opens
 * (`ConversationHistory`: a card under the header on a screen, a drawer with ← on a phone), with search, rename, delete and « Nouvelle ». */
export function HistoryButton() {
  const layer = useInternal();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const chat = layer.showing === 'improve' ? undefined : layer.agent?.chatProps;
  const conversations = chat?.historyList === false || chat?.showHistory === false ? undefined : chat?.conversations;
  if (!conversations) return null;
  const text = { ...chatTextFor(layer.locale ?? chat?.locale), labels: composerLabels(layer.locale, layer.agent) };
  const close = () => { setOpen(false); requestAnimationFrame(() => button.current?.focus({ preventScroll: true })); };
  return <>
    <Button ref={button} variant="ghost" size="icon" data-testid="history-open" aria-label={text.labels.history} title={text.labels.history} aria-haspopup="dialog" aria-expanded={open}
      onClick={() => setOpen(now => !now)}><HistoryIcon data-icon="inline-start" aria-hidden="true" /></Button>
    {open && <ChatTextProvider value={text}><ConversationHistory conversations={conversations} onClose={close} /></ChatTextProvider>}
  </>;
}
/** One agent's PiChat. It stays mounted while hidden, so its scroll, focus and drafts survive a swap with the other spec. */
function SpecChat({ spec, visible, role }: { readonly spec: AgentSpec; readonly visible: boolean; readonly role: Which }) {
  const layer = useInternal();
  const locale = layer.locale ?? spec.chatProps?.locale;
  const words = shellWords(locale, layer.agent);
  // `composer: 'bar'`: the folded card and the chevron's dot read the same chat as the thread, through the agent bar's own adapter.
  const barChat = useAgentBarChat(spec.controller, { actions: spec.chatProps?.actions, toolLabels: chatTextFor(locale).labels, workingWords: spec.workingWords,
    labels: { working: words.working, done: words.done, unread: words.unread, step: (index, count) => `${index} ${words.of} ${count}` } });
  const barred = role === 'agent' && layer.bar;
  // The one composer's row (pill, chevron, attach, Dicter, edit last) wherever the field is: under the page, docked, or in the phone's drawer (AC-20).
  const oneRow = role === 'agent' && layer.bar;
  const { markRead } = barChat;
  const unfolded = barred && !layer.folded;
  useEffect(() => { if (unfolded) markRead(); }, [unfolded, markRead]);
  // Docked, the bar's field goes with the thread: nothing stays at the bottom.
  const hosted = role === 'agent' && layer.contentComposer && !(barred && layer.dockOpen);
  // A file chip opens in the app's own way when it gives one (`onOpenFile`), else in the pane's viewer when the kit can read files (`agent.files`).
  const ownOpen = spec.chatProps?.onOpenFile ?? spec.chatProps?.mentions?.open;
  const kitOpen = role === 'agent' && !ownOpen ? layer.openFile : undefined;
  const openFile = ownOpen ?? kitOpen;
  // The agent's `present` and the chat's artifact cards open in the pane too, unless the app routes artifacts itself.
  const presented = role === 'agent' && !spec.chatProps?.artifacts ? layer.presented : undefined;
  const chatProps = kitOpen || presented ? { ...spec.chatProps, ...(kitOpen ? { onOpenFile: (path: string) => kitOpen(path) } : {}), ...(presented ? { artifacts: { open: presented.open, isOpen: presented.isOpen } } : {}) } : spec.chatProps;
  const mic = useBarMic();
  const capturing = layer.voice.phase === 'starting' || layer.voice.phase === 'recording';
  const readOnly = oneRow ? spec.readOnly : undefined;
  const barProps = oneRow ? {
    ...(readOnly ? { renderComposer: () => <p data-testid="agent-read-only" className="m-0 flex min-h-14 items-center px-4 text-sm text-muted-foreground">{readOnly}</p> } : {}),
    composerLayout: 'pill' as const, composerBarActions: 'attach' as const, composerFileChips: true, composerEditLast: true, composerStart: <ConversationChevron unread={barChat.historyBadge} />,
    // While the agent's question waits, the field says so; a typed message answers it (PiChat's own rule).
    ...(barChat.question ? { labels: { ...chatWordLabels(spec.words), ...spec.chatProps?.labels, placeholder: words.answerHere } } : {}),
    ...(spec.voice ? { composerWhenEmpty: <BarMicButton mic={mic} label={words.dictate} />,
      ...(capturing ? { composerRecordingSlots: { status: <BarMicStatus mic={mic} />, stop: <BarMicButton mic={mic} label={words.dictate} />, keepField: true } } : {}) } : {}),
  } : {};
  // The app's words for the chat (`agent.words`) under the labels it passes itself; the question's placeholder above keeps its own.
  const wordLabels = role === 'agent' && !barChat.question ? chatWordLabels(spec.words) : {};
  // One annotate toggle: pins on desktop, point mode (which hides the layer while the person taps the app) on touch and compact screens.
  const feedback = useComposerFeedback(spec.feedback);
  const pointing = usePointing(spec.feedback);
  // The pin's mic uses the shell's transcription: this agent's own, else the coach's.
  const transcribe = (spec.voice ?? layer.agent?.voice)?.transcribe;
  const fr = locale === 'fr';
  return <div data-spec={role} hidden={!visible} className={cn('min-h-0 min-w-0 flex-1', visible ? 'flex flex-col' : 'hidden')}>
    <PiChat {...withChatPlugins(chatProps ?? {})} {...barProps} {...(Object.keys(wordLabels).length > 0 ? { labels: { ...wordLabels, ...spec.chatProps?.labels } } : {})} {...(locale ? { locale } : {})} controller={spec.controller} keyboardInset={false} {...(hosted ? { composerHost: layer.composerSlot, dropZone: layer.dropZone, onSent: layer.onSent } : role === 'agent' && layer.contentComposer ? { onSent: layer.onSent } : {})} placement={layer.expanded && !layer.dockFloating ? 'docked' : 'floating'} {...(feedback ? { feedback } : {})} {...(spec.feedback && !spec.chatProps?.sentContent ? { sentContent: sentFeedbackContent } : {})}
      {...(role === 'agent' && spec.voice ? { voiceMessage: { transcribe: spec.voice.transcribe, Bubble: PendingVoiceBubble }, tools: oneRow ? spec.chatProps?.tools : <>{spec.chatProps?.tools}<TalkButton /></>, composerRecording: capturing && !oneRow ? <TalkButton /> : undefined, pendingVoice: layer.voice.pending } : {})} />
    {barred && !readOnly && layer.folded && layer.cardSlot && createPortal(<><SendProblem controller={spec.controller} /><FoldedCard bar={barChat} onOpenFile={openFile} /></>, layer.cardSlot)}
    {/* The note editor of ordinary feedback lives inside the layer, in the modal's focus tree; while pointing the layer steps aside and AgentLayer renders it. */}
    {/* In the flow, inside the visible content box: the popup is transformed (a fixed element would be placed against its off-screen bottom). */}
    {spec.feedback && visible && !pointing && <div className="shrink-0 px-2 pb-2 empty:hidden">
      <NoteBubble session={spec.feedback} {...(transcribe ? { transcribe } : {})} {...(fr ? { labels: feedbackLabelsFr } : {})} /></div>}
  </div>;
}

/** Where the chats show: the persistent host element is moved in once, when the drawer or panel mounts. */
export function ChatSlot({ live = true }: { readonly live?: boolean }) {
  const { host } = useInternal();
  const slot = useRef<HTMLDivElement | null>(null);
  const place = useCallback((element: HTMLDivElement | null) => { slot.current = element; if (element && host) element.appendChild(host); }, [host]);
  // A slot that was mounted while the chats were shown elsewhere (the dock beside a tray) takes them back when it goes live.
  useLayoutEffect(() => { if (live && slot.current && host && host.parentElement !== slot.current) slot.current.appendChild(host); }, [live, host]);
  // Coarse pointers: the chat's own transcript buttons (copy, show earlier) get the layer's 44px rule from here, without touching pi-chat.
  return <div ref={place} className="flex min-h-0 flex-1 flex-col [&_[data-testid=transcript]_button]:pointer-coarse:min-h-11 [&_[data-testid=transcript]_button]:pointer-coarse:min-w-11" />;
}

/** Both specs, each mounted once it has been shown. */
export function Chats({ showing }: { readonly showing: Which }) {
  const { agent, contentComposer } = useInternal();
  const seen = useRef(new Set<Which>());
  // eslint-disable-next-line react-hooks/refs -- a monotonic "ever shown" set filled during render: no setState, no re-render
  seen.current.add(showing);
  // With the field under the page (`composer: 'content'`, wide) the agent's chat is mounted at rest even while the PM is the view shown: its composer is portaled into the slot, its thread stays hidden (D-2026).
  // eslint-disable-next-line react-hooks/refs -- reads the "ever shown" set filled above in this same render
  const seenAgent = seen.current.has('agent') || contentComposer;
  return <>
    {agent && seenAgent && <SpecChat spec={agent} visible={showing === 'agent'} role="agent" />}
  </>;
}

/** Title row: « ← » when the improve view has an agent to go back to, the title, then Expand or Collapse (compact only), the dock controls (expanded only) and Close. */
export function Header({ text, title, compactSnap, closeRef, controls, className, ...rest }: { readonly text: AppShellText; readonly title: string; readonly compactSnap?: Snap; readonly closeRef?: Ref<HTMLButtonElement>; readonly controls?: ReactNode } & Omit<HTMLAttributes<HTMLDivElement>, 'title'>) {
  const layer = useInternal();
  const back = layer.showing === 'improve' && layer.agent;
  const actions = layer.showing === 'improve' ? [] : layer.agent?.headerActions ?? [];
  const library = layer.bar && layer.showing === 'agent' ? layer.openLibrary : undefined;
  return <div data-testid="agent-layer-header" {...rest} className={cn('flex shrink-0 items-center gap-1 px-2 pb-1', className)}>
    {back && <Button variant="ghost" size="icon" data-testid="agent-layer-back" aria-label={text.back} title={text.back} onClick={layer.showAgent}><ArrowLeftIcon data-icon="inline-start" aria-hidden="true" /></Button>}
    <h2 data-testid="agent-layer-title" className="m-0 min-w-0 flex-1 truncate px-1 text-sm font-semibold">{title}</h2>
    <HistoryButton />
    <LibraryButton open={library} text={text} testId="agent-layer-library" />
    {actions.length > 0 && <HeaderActions actions={actions} compact={compactSnap !== undefined} text={text} prefix="agent-layer" run={id => actions.find(action => action.id === id)?.onSelect()} />}
    {compactSnap === 'half' && <Button variant="ghost" size="icon" data-testid="agent-layer-expand" aria-label={text.expand} title={text.expand} onClick={() => layer.setSnap('full')}><ChevronUpIcon data-icon="inline-start" aria-hidden="true" /></Button>}
    {compactSnap === 'full' && <Button variant="ghost" size="icon" data-testid="agent-layer-collapse" aria-label={text.collapse} title={text.collapse} onClick={() => layer.setSnap('half')}><ChevronDownIcon data-icon="inline-start" aria-hidden="true" /></Button>}
    {controls}
    <Button variant="ghost" size="icon" ref={closeRef} data-testid="agent-layer-close" aria-label={text.close} title={text.close} onClick={layer.close}><XIcon data-icon="inline-start" aria-hidden="true" /></Button>
  </div>;
}

export function useTitle(): { text: AppShellText; title: string } {
  const layer = useInternal();
  const improve = layer.showing === 'improve' ? layer.improve : undefined;
  const spec = improve ? undefined : layer.agent;
  const text = shellWords(layer.locale ?? (improve ? (improve.locale as AppShellLocale | undefined) : undefined) ?? layer.agent?.chatProps?.locale, layer.agent);
  const title = improve ? improve.label ?? text.improve : (spec?.chatProps?.labels?.title ?? text.assistant);
  return { text, title };
}
