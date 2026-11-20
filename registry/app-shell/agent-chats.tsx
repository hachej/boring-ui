'use client';

// The chats and their header: one PiChat per spec in a persistent host element, the slot it moves into, the layer's title row with History and Library.
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { HTMLAttributes, ReactElement, ReactNode, Ref } from 'react';
import { ArrowLeftIcon, ChevronDownIcon, ChevronUpIcon, HistoryIcon, LibraryIcon, XIcon } from '../_shared/icons';
import { Button } from '@/components/ui/button';
import { InputGroup } from '@/components/ui/input-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useMessageScroller } from '@/components/ui/message-scroller';
import { PiChat } from '../pi-chat/pi-chat';
import { ReplyActionContext } from '../pi-chat/message';
import { Composer } from '../pi-chat/composer';
import type { ComposerProps } from '../pi-chat/composer';
import { withChatPlugins } from '../pi-chat-plugins/chat-plugins';
import { PendingVoiceBubble } from '../pi-chat-voice/voice-message';
import { chatTextFor } from '../pi-chat/locale';
import { ConversationHistory } from '../pi-chat/history';
import { ChatTextProvider, useChatText } from '../pi-chat/labels';
import { NoteBubble, useComposerFeedback } from '../feedback/feedback-session';
import { feedbackLabelsFr } from '../feedback/feedback-labels';
import { sentFeedbackContent } from '../feedback/sent-content';
import { useCommenting, usePointing } from '../feedback/point-mode';
import { cn } from '../utils/utils';
import { ROW_MENTION, rowMentionKind } from '../viewer-code/row-reference';
import { CITE_MENTION, citeMentionKind } from './cite-reference';
import { clearUnread, useAgentBarChat } from '../agent-bar/use-agent-bar-chat';
import type { ArtifactsConfig, PresentedArtifact } from '../pi-artifacts/artifact';
import { basename, FileChip, isCitedFile, ReplyActionButton } from './file-chip';
import type { AppShellLocale, AppShellText } from './text';
import { HeaderActions } from './header-actions';
import { configOf } from './composer-config';
import { chatWordLabels, composerLabels, shellWords, useInternal } from './layer-context';
import type { AgentSpec, Snap, Which } from './layer-context';
import { useAutoOpenTasks } from './task-present';
import { BarMicButton, BarMicCancel, BarMicStatus, ConversationChevron, FoldedCard, SendProblem, TalkButton, useBarMic } from './agent-bar-parts';

/** Whether a circle's panel steps aside for an annotating session: the pointing tool is on and the config's level while annotating (`feedback.while`) is `folded`, the default. */
export function useCircleCollapsed(): boolean {
  const layer = useInternal();
  const annotating = useCommenting(layer.agent?.feedback);
  return layer.circle && annotating && (configOf(layer)?.feedback?.while ?? 'folded') === 'folded';
}

/** The bar's icon controls expose the same words on hover and keyboard focus. */
export function HeaderHint({ label, children }: { readonly label: string; readonly children: ReactElement }) {
  const { bar } = useInternal();
  return bar ? <Tooltip><TooltipTrigger render={children} /><TooltipContent>{label}</TooltipContent></Tooltip> : children;
}

/** The preview header's Library button, when the app gives one. */
export function LibraryButton({ open, text, testId = 'agent-preview-library' }: { readonly open: (() => void) | undefined; readonly text: AppShellText; readonly testId?: string }) {
  if (!open) return null;
  return <HeaderHint label={text.library}><Button variant="ghost" size="icon" data-testid={testId} aria-label={text.library} title={text.library} onClick={open}><LibraryIcon data-icon="inline-start" aria-hidden="true" /></Button></HeaderHint>;
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
    <HeaderHint label={text.labels.history}><Button ref={button} variant="ghost" size="icon" data-testid="history-open" aria-label={text.labels.history} title={text.labels.history} aria-haspopup="dialog" aria-expanded={open}
      onClick={() => setOpen(now => !now)}><HistoryIcon data-icon="inline-start" aria-hidden="true" /></Button></HeaderHint>
    {open && <ChatTextProvider value={text}><ConversationHistory conversations={conversations} onClose={close} /></ChatTextProvider>}
  </>;
}

/** Hidden viewports must not turn an earlier reading position into a request to follow the latest reply. */
function BarTranscriptPosition() {
  const { host, folded } = useInternal();
  const { scrollToMessage, scrollToEnd } = useMessageScroller();
  const position = useRef<{ readonly kind: 'latest' } | { readonly kind: 'reading'; readonly top: number } | null>(null);
  useLayoutEffect(() => {
    if (folded) return;
    const viewport = host?.querySelector<HTMLElement>('[data-spec=agent] [data-testid=transcript-scroll]');
    if (!viewport) return;
    const saved = position.current;
    let restored = saved === null;
    const remember = () => {
      if (!restored || viewport.clientHeight === 0) return;
      position.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 1
        ? { kind: 'latest' } : { kind: 'reading', top: viewport.scrollTop };
    };
    const restore = () => {
      if (restored || !saved || viewport.clientHeight === 0) return;
      if (saved.kind === 'latest') scrollToEnd({ behavior: 'instant' });
      else {
        const first = viewport.querySelector<HTMLElement>('[data-message-id]')?.dataset.messageId;
        if (!first || !scrollToMessage(first, { behavior: 'instant' })) return;
        viewport.scrollTop = saved.top;
      }
      restored = true;
      remember();
    };
    restore();
    remember();
    // The persistent chat host can still be detached when its new tray's layout effects run.
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(restore);
    observer?.observe(viewport);
    viewport.addEventListener('scroll', remember, { passive: true });
    return () => { observer?.disconnect(); viewport.removeEventListener('scroll', remember); };
  }, [folded, host, scrollToMessage, scrollToEnd]);
  return null;
}
/** The input row stays at the bottom while chips and earlier text lines grow the surrounding surface upward. */
function PinnedBarComposer(props: ComposerProps) {
  const { labels } = useChatText();
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = root.current;
    const form = element?.querySelector<HTMLElement>('[data-testid=composer]');
    const stack = form?.querySelector<HTMLElement>('[data-slot=composer-stack]');
    if (!element || !form || !stack) return;
    const measure = () => {
      element.style.paddingTop = `${Math.max(0, stack.offsetHeight - form.offsetHeight)}px`;
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(form);
    observer?.observe(stack);
    return () => observer?.disconnect();
  }, []);
  const pickFiles: ComposerProps['onPickFiles'] = files => {
    if (files.length) root.current?.querySelector<HTMLElement>('[data-testid=composer-input]')?.focus({ preventScroll: true });
    props.onPickFiles(files);
  };
  return <div ref={root} data-pinned-composer="" className="relative">
    <Composer {...props} onPickFiles={pickFiles} />
    <div data-bar-drop-overlay="" aria-hidden="true" className="pointer-events-none absolute inset-1 z-10 hidden items-center justify-center rounded-(--radius-3xl) border-[length:var(--border-width)] border-dashed border-primary bg-card text-sm font-medium text-card-foreground">{labels.attachFiles}</div>
  </div>;
}

/** One agent's PiChat. It stays mounted while hidden, so its scroll, focus and drafts survive a swap with the other spec. */
function SpecChat({ spec, visible, role }: { readonly spec: AgentSpec; readonly visible: boolean; readonly role: Which }) {
  const layer = useInternal();
  const locale = layer.locale ?? spec.chatProps?.locale;
  const words = shellWords(locale, layer.agent);
  // `composer: 'bar'`: the folded card and the chevron's dot read the same chat as the thread, through the agent bar's own adapter.
  const barChat = useAgentBarChat(spec.controller, { actions: spec.chatProps?.actions, toolLabels: chatTextFor(locale).labels, plainTools: spec.chatProps?.toolDetails === 'none', workingWords: spec.workingWords,
    labels: { working: words.working, done: words.done, unread: words.unread, step: (index, count) => `${index} ${words.of} ${count}` } });
  const barred = role === 'agent' && layer.bar;
  // `composer="explore"`: the closed toggle shows the same two signals as the icon: what is unread and a decision that waits.
  const exploring = role === 'agent' && layer.explore;
  // The one composer's row (pill, chevron, attach, Dicter, edit last) wherever the field is: under the page, docked, or in the phone's drawer (AC-20).
  const oneRow = role === 'agent' && layer.bar;
  const readStop = () => spec.controller.getSnapshot().stop;
  const stop = useSyncExternalStore(spec.controller.subscribe, readStop, readStop);
  const { markRead } = barChat;
  // The icon the composer folds into shows what the conversation holds: what is unread, and a decision that waits.
  const { setSignals } = layer;
  const unreadLabel = barChat.historyBadge?.label, unreadCount = barChat.historyBadge?.count, needsYou = Boolean(barChat.question || barChat.approval);
  const readRun = () => Boolean(spec.controller.getSnapshot().view?.docs['pi.live']?.['run']);
  const running = useSyncExternalStore(spec.controller.subscribe, readRun, readRun);
  const working = (running && stop !== 'confirmed') || barChat.status?.state === 'working';
  // A circle shows the same signals, and the notes taken while annotating (`useComposerFeedback`'s count).
  const circling = role === 'agent' && layer.circle;
  const feedback = useComposerFeedback(spec.feedback);
  const notes = circling ? feedback?.count ?? 0 : 0;
  useEffect(() => { if (barred || exploring || circling) setSignals({ unread: unreadLabel === undefined ? undefined : { label: unreadLabel, count: unreadCount }, needsYou, working, ...(circling ? { notes } : {}) }); }, [barred, exploring, circling, setSignals, unreadLabel, unreadCount, needsYou, working, notes]);
  const collapsed = useCircleCollapsed();
  const unfolded = (barred && !layer.folded) || (exploring && layer.showing === 'agent') || (circling && layer.snap !== 'closed' && layer.showing === 'agent' && !collapsed);
  useEffect(() => { if (unfolded) markRead(); }, [unfolded, markRead]);
  // The full page is on show (`suspended`): what arrives meanwhile is read there.
  const suspended = circling && layer.suspended;
  useEffect(() => { if (suspended) clearUnread(spec.controller); }, [suspended, unreadCount, spec.controller]);
  // Docked, the bar's field goes with the thread: nothing stays at the bottom.
  const hosted = role === 'agent' && layer.contentComposer && !(barred && layer.dockOpen);
  // A file chip opens in the app's own way when it gives one (`onOpenFile`), else in the pane's viewer when the kit can read files (`agent.files`).
  const ownOpen = spec.chatProps?.onOpenFile ?? spec.chatProps?.mentions?.open;
  const kitOpen = role === 'agent' && !ownOpen ? layer.openFile : undefined;
  const openFile = ownOpen ?? kitOpen;
  // The agent's `present` and the chat's artifact cards open in the pane too, unless the app routes artifacts itself.
  const hostArtifacts = spec.chatProps?.artifacts as ArtifactsConfig | undefined;
  // Artifact cards: the pane draws them (the kit's file viewer, or the host's `artifactPanel`); a host that routes artifacts itself (`chatProps.artifacts`) keeps its `open` and gets the viewer's reports from the layer.
  const presented = role === 'agent' ? layer.presented : undefined;
  useAutoOpenTasks(spec.controller, role === 'agent' && !spec.artifactPanel ? hostArtifacts : undefined, presented && { onShown: presented.shown, onFailed: presented.failed });
  // An app with `@` mentions also takes the table row reference (`row`): the pane's row action puts a `row` mention in the field, and it shows as a chip.
  const mentions = role === 'agent' ? spec.chatProps?.mentions : undefined;
  const openLabel = chatTextFor(locale).labels.openFile;
  const citeWord = words.citation;
  // A cited file in a reply is a chip that opens the way the card's chip does (`openFile`); a file the workspace does not have stays text.
  const fileChip = useCallback((path: string, text?: string) => !openFile || !isCitedFile(path) ? undefined
    : <FileChip path={path} files={spec.files} kinds={spec.fileKinds} onOpen={target => openFile(target)} label={openLabel(basename(path))} inline testid="message-mention" {...(text ? { text } : {})} />, [openFile, spec.files, spec.fileKinds, openLabel]);
  const shellMentions = useMemo(() => mentions ? {
    ...mentions,
    kinds: { ...(mentions.kinds?.[ROW_MENTION] ? {} : { [ROW_MENTION]: rowMentionKind }), ...(mentions.kinds?.[CITE_MENTION] ? {} : { [CITE_MENTION]: citeMentionKind(citeWord) }), ...mentions.kinds },
    render: (path: string) => mentions.render?.(path) ?? fileChip(path),
    ...(mentions.renderSent ? { renderSent: (path: string) => mentions.renderSent?.(path) ?? fileChip(path) } : {}),
  } : undefined, [mentions, fileChip, citeWord]);
  const artifactKinds = spec.fileKinds?.filter(kind => kind.label) as ArtifactsConfig['kinds'];
  const routed: ArtifactsConfig | undefined = !presented ? undefined : hostArtifacts ? { ...hostArtifacts,
    open: (artifact, reports) => artifact.type === 'task' || !spec.artifactPanel ? hostArtifacts.open(artifact, reports ?? { onShown: presented.shown, onFailed: presented.failed }) : presented.open(artifact),
    ...(spec.artifactPanel ? { isOpen: (artifact: PresentedArtifact) => artifact.type === 'task' ? hostArtifacts.isOpen?.(artifact) ?? false : presented.isOpen(artifact) } : {}) }
    : { open: presented.open, isOpen: presented.isOpen, ...(artifactKinds?.length ? { kinds: artifactKinds } : {}) };
  const chatProps = kitOpen || presented || shellMentions ? { ...spec.chatProps, ...(shellMentions ? { mentions: shellMentions } : {}), ...(kitOpen ? { onOpenFile: (path: string) => kitOpen(path) } : {}), ...(routed ? { artifacts: routed } : {}) } : spec.chatProps;
  const mic = useBarMic();
  const capturing = layer.voice.phase === 'starting' || layer.voice.phase === 'recording';
  const readOnly = oneRow ? spec.readOnly : undefined;
  const barProps = oneRow ? {
    renderComposer: (props: ComposerProps) => {
      // Stop confirmation can arrive before the run view catches up, as it does for the folded card.
      const composer = stop === 'confirmed' ? { ...props, working: false } : props;
      return <><BarTranscriptPosition />{readOnly
        ? <InputGroup className="h-auto"><p data-testid="agent-read-only" className="m-0 flex min-h-[var(--control-h,2.75rem)] w-full min-w-0 items-center px-2 text-sm wrap-anywhere text-muted-foreground">{readOnly}</p></InputGroup>
        : spec.chatProps?.renderComposer ? spec.chatProps.renderComposer(composer) : <PinnedBarComposer {...composer} />}</>;
    },
    composerLayout: spec.chatProps?.composerLayout ?? 'pill' as const, composerBarActions: 'attach' as const, composerFileChips: true, composerEditLast: true, composerStart: capturing ? <BarMicCancel mic={mic} /> : <ConversationChevron unread={barChat.historyBadge} />,
    // While the agent's question waits, the field says so; a typed message answers it (PiChat's own rule).
    labels: {
      // « / » is only mentioned when the app has slash actions, and only in the two languages the kit has words for; any other app or locale keeps the chat's own default.
      ...(spec.chatProps?.slash && (locale === 'fr' || locale === 'en' || locale === undefined) ? { emptyDescription: locale === 'fr' ? 'Écrivez votre demande ci-dessous, ou « / » pour choisir une action.' : 'Write your request below, or type “/” to choose an action.' } : {}),
      ...chatWordLabels(spec.words), ...spec.chatProps?.labels,
      ...(barChat.question ? { placeholder: words.answerHere } : layer.fieldStatus ? { placeholder: layer.fieldStatus } : {}),
    },
    ...(spec.voice ? { composerWhenEmpty: <BarMicButton mic={mic} label={words.dictate} />,
      ...(capturing ? { composerRecordingSlots: { status: <BarMicStatus mic={mic} />, stop: <BarMicButton mic={mic} label={words.dictate} />, keepField: true } } : {}) } : {}),
  } : {};
  // The app's words for the chat (`agent.words`) under the labels it passes itself; the question's placeholder above keeps its own.
  const wordLabels = role === 'agent' && !oneRow ? chatWordLabels(spec.words) : {};
  // One annotate toggle: pins on desktop, point mode (which hides the layer while the person taps the app) on touch and compact screens.
  const pointing = usePointing(spec.feedback) || collapsed;
  // The pin's mic uses the shell's transcription: this agent's own, else the coach's.
  const transcribe = (spec.voice ?? layer.agent?.voice)?.transcribe;
  const replyAction = barred ? spec.replyAction : undefined;
  const fr = locale === 'fr';
  return <div data-spec={role} hidden={!visible} className={cn('min-h-0 min-w-0 flex-1', visible ? 'flex flex-col' : 'hidden')}>
    <ReplyActionContext.Provider value={replyAction ? <ReplyActionButton action={replyAction} testid="agent-reply-action" /> : null}>
    <PiChat {...withChatPlugins(chatProps ?? {})} {...barProps} {...(Object.keys(wordLabels).length > 0 ? { labels: { ...wordLabels, ...spec.chatProps?.labels } } : {})} {...(locale ? { locale } : {})} controller={spec.controller} keyboardInset={false} {...(hosted ? { composerHost: layer.composerSlot, dropZone: layer.dropZone, onSent: layer.onSent } : role === 'agent' && layer.contentComposer ? { onSent: layer.onSent } : {})} placement={layer.expanded && !layer.dockFloating && !layer.circle ? 'docked' : 'floating'} {...(feedback ? { feedback } : {})} {...(spec.feedback && !spec.chatProps?.sentContent ? { sentContent: sentFeedbackContent } : {})}
      {...(role === 'agent' && spec.voice ? { voiceMessage: { transcribe: spec.voice.transcribe, Bubble: PendingVoiceBubble }, tools: oneRow ? spec.chatProps?.tools : <>{spec.chatProps?.tools}<TalkButton /></>, composerRecording: capturing && !oneRow ? <TalkButton /> : undefined, pendingVoice: layer.voice.pending } : {})} />
    </ReplyActionContext.Provider>
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

/** The host's own controls in a title row (the layer's header, the floating window's): its `headerTools`, then its `headerActions` (two shown, the rest in « … »). Not for the product manager. */
export function HeaderExtras({ text, compact }: { readonly text: AppShellText; readonly compact: boolean }) {
  const layer = useInternal();
  if (layer.showing === 'improve') return null;
  const actions = layer.agent?.headerActions ?? [];
  return <>
    {layer.agent?.headerTools}
    {actions.length > 0 && <HeaderActions actions={actions} compact={compact} text={text} prefix="agent-layer" run={id => actions.find(action => action.id === id)?.onSelect()} />}
  </>;
}

/** Title row: « ← » when the improve view has an agent to go back to, the title, then Expand or Collapse (compact only), the dock controls (expanded only) and Close. */
export function Header({ text, title, compactSnap, closeRef, controls, className, ...rest }: { readonly text: AppShellText; readonly title: string; readonly compactSnap?: Snap; readonly closeRef?: Ref<HTMLButtonElement>; readonly controls?: ReactNode } & Omit<HTMLAttributes<HTMLDivElement>, 'title'>) {
  const layer = useInternal();
  const back = layer.showing === 'improve' && layer.agent;
  const library = layer.bar && layer.showing === 'agent' ? layer.openLibrary : undefined;
  return <div data-testid="agent-layer-header" {...rest} className={cn('flex h-13 shrink-0 items-center gap-1.5 px-2 md:px-3', className)}>
    {back && <Button variant="ghost" size="icon" data-testid="agent-layer-back" aria-label={text.back} title={text.back} onClick={layer.showAgent}><ArrowLeftIcon data-icon="inline-start" aria-hidden="true" /></Button>}
    <h2 data-testid="agent-layer-title" className="m-0 min-w-0 flex-1 truncate text-sm leading-5 font-semibold tracking-tight">{title}</h2>
    <HistoryButton />
    <LibraryButton open={library} text={text} testId="agent-layer-library" />
    <HeaderExtras text={text} compact={compactSnap !== undefined} />
    {!layer.bar && !layer.circle && compactSnap === 'half' && <HeaderHint label={text.expand}><Button variant="ghost" size="icon" data-testid="agent-layer-expand" aria-label={text.expand} title={text.expand} onClick={() => layer.setSnap('full')}><ChevronUpIcon data-icon="inline-start" aria-hidden="true" /></Button></HeaderHint>}
    {!layer.bar && !layer.circle && compactSnap === 'full' && <HeaderHint label={text.collapse}><Button variant="ghost" size="icon" data-testid="agent-layer-collapse" aria-label={text.collapse} title={text.collapse} onClick={() => layer.setSnap('half')}><ChevronDownIcon data-icon="inline-start" aria-hidden="true" /></Button></HeaderHint>}
    {controls}
    {(!layer.bar || compactSnap !== undefined) && <Button variant="ghost" size="icon" ref={closeRef} data-testid="agent-layer-close" aria-label={text.close} title={text.close} onClick={layer.close}><XIcon data-icon="inline-start" aria-hidden="true" /></Button>}
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
