'use client';

// Host presentation over the app's borrowed chat controller, not a feedback report or a second Pi lifecycle.
import { createPortal } from 'react-dom';
import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { EntryRecord, JsonObject, Submission } from '@earendil-works/pi-durable';
import type { NativeChatController } from '@hachej/boring-ui-kit/native-chat';
import { appendToDraft } from '@hachej/boring-ui-kit/chat-text';
import { createPicker, createPrivacyPolicy, isExcluded } from '@hachej/boring-feedback/page';
import type { Picker } from '@hachej/boring-feedback/page';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Message, MessageContent } from '@/components/ui/message';
import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { useAgentLayer } from '../app-shell/agent-layer';
import { ScreenActiveContext } from '../app-shell/agent-context';
import { useDictation } from '../app-shell/use-dictation';
import { useVisualViewport } from '../app-shell/use-visual-viewport';
import { object } from '../pi-chat/rows';
import { agentTargetLabels } from './agent-target-labels';
import type { AgentTargetLabels } from './agent-target-labels';

export interface AgentTargetResult { readonly target: JsonObject; readonly reply: string; readonly ok: boolean }
export interface AgentTargetModeProps {
  readonly enabled: boolean;
  readonly transcribe: (audio: Blob, signal: AbortSignal) => Promise<string>;
  readonly onSettled: (result: AgentTargetResult) => void;
  readonly attribute?: string;
  readonly labels?: Partial<AgentTargetLabels> | undefined;
}
type Stage = 'dictating' | 'sending' | 'observing' | 'settled' | 'cancelled';
interface Session {
  readonly target: JsonObject;
  readonly block: string;
  readonly element: Element;
  readonly controller: NativeChatController;
  readonly abort: AbortController;
  readonly onSettled: AgentTargetModeProps['onSettled'];
  readonly labels: AgentTargetLabels;
  stage: Stage;
}
interface Presentation { readonly element: Element; readonly stage: Stage; readonly reply: string; readonly problem?: string }

function freeze(value: unknown): void {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
}
function contextOf(element: Element, attribute: string, labels: AgentTargetLabels): { readonly target: JsonObject; readonly block: string } {
  const raw = element.getAttribute(attribute) ?? '';
  if (new TextEncoder().encode(raw).length > 1024) throw new Error(labels.contextTooLarge);
  let target: unknown;
  try { target = JSON.parse(raw); } catch { throw new Error(labels.invalidContext); }
  if (!target || typeof target !== 'object' || Array.isArray(target)) throw new Error(labels.invalidContext);
  const json = JSON.stringify(target).replace(/</g, '\\u003c');
  if (new TextEncoder().encode(json).length > 1024) throw new Error(labels.contextTooLarge);
  freeze(target);
  return { target: target as JsonObject, block: `<target>${json}</target>` };
}
const textOf = (entries: readonly EntryRecord[]): string => entries.flatMap(entry => (entry.model ?? []).flatMap(message => message.role === 'assistant'
  ? message.content.flatMap(part => part.type === 'text' ? [part.text] : []) : [])).filter(Boolean).join('\n\n');

/** A local observation only. Stream attribution uses native run inputs; settlement uses the native submission's exact answer entry. */
function observe(session: Session, submission: Submission, show: (reply: string) => void, settle: (reply: string, ok: boolean, problem?: string) => void): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const { controller, abort } = session;
  const stream = () => {
    if (abort.signal.aborted || session.stage !== 'observing') return;
    const view = controller.getSnapshot().view;
    const live = object(view?.docs['pi.live']), run = object(live?.['run']);
    if (!Array.isArray(run?.['inputs']) || !run['inputs'].includes(submission.id)) return;
    const generation = object(live?.['generation']), message = object(generation?.['message']);
    const partial = Array.isArray(message?.['content']) ? message['content'].map(object).flatMap(part => part?.['type'] === 'text' && typeof part['text'] === 'string' ? [part['text']] : []).join('\n') : '';
    show([textOf((view?.entries ?? []).filter(entry => entry.byTaskId === run['taskId'])), partial].filter(Boolean).join('\n\n'));
  };
  const unsubscribe = controller.subscribe(stream);
  const stop = () => { clearTimeout(timer); unsubscribe(); abort.signal.removeEventListener('abort', stop); };
  abort.signal.addEventListener('abort', stop, { once: true });
  const poll = async () => {
    try {
      const record = await controller.submissionStatus(submission);
      if (abort.signal.aborted) return;
      stream();
      if (record.status === 'unanswered') { stop(); settle('', false, session.labels.unanswered); return; }
      if (record.status === 'done' && record.type === 'input') {
        const view = controller.getSnapshot().view;
        const answer = view?.entries.find(entry => entry.id === record.answer);
        if (answer) {
          const entries = answer.byTaskId === undefined ? [answer] : view!.entries.filter(entry => entry.byTaskId === answer.byTaskId);
          stop(); settle(textOf(entries), true); return;
        }
        // A coalesced watch may arrive after status. An unavailable answer stays unconfirmed, never guessed from neighbouring text.
      }
      if (!abort.signal.aborted) timer = setTimeout(() => { void poll(); }, 150);
    } catch {
      stop();
      if (!abort.signal.aborted) settle('', false, session.labels.observationFailed);
    }
  };
  stream();
  void poll();
}

/** Tap only explicitly marked app data, dictate once and show its native answer without opening the app's chat. */
export function AgentTargetMode({ enabled, transcribe, onSettled, labels, attribute = 'data-agent-target' }: AgentTargetModeProps) {
  const words = { ...agentTargetLabels, ...labels };
  const { agent } = useAgentLayer();
  const active = useContext(ScreenActiveContext);
  const viewport = useVisualViewport();
  const session = useRef<Session | null>(null);
  const picker = useRef<Picker | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const latest = useRef({ onSettled, words });
  useLayoutEffect(() => { latest.current = { onSettled, words }; });
  const [shown, setShown] = useState<Presentation | null>(null);
  const [place, setPlace] = useState<CSSProperties>();
  const settle = (selected: Session, reply: string, ok: boolean, problem?: string) => {
    if (session.current !== selected || selected.abort.signal.aborted || selected.stage === 'settled') return;
    selected.stage = 'settled';
    setShown({ element: selected.element, stage: 'settled', reply, ...(problem ? { problem } : {}) });
    selected.onSettled({ target: selected.target, reply, ok });
  };
  const dictation = useDictation({ transcribe, labels: words, onText: async spoken => {
    const selected = session.current;
    if (!selected || selected.stage !== 'dictating') return;
    selected.stage = 'sending';
    setShown({ element: selected.element, stage: 'sending', reply: '' });
    let submission: Submission | undefined;
    try {
      await selected.controller.connect();
      if (selected.abort.signal.aborted || session.current !== selected) return;
      submission = await selected.controller.send('followUp', { text: `${selected.block}\n\n${spoken}`, restore: { text: spoken } });
    }
    catch {
      if (selected.abort.signal.aborted || session.current !== selected) return;
      const snapshot = selected.controller.getSnapshot();
      if (!snapshot.disposed) {
        const draft = snapshot.draft.text;
        selected.controller.setText(appendToDraft(draft, spoken));
      }
      settle(selected, '', false, snapshot.disposed ? selected.labels.unavailable : selected.labels.sendFailed);
      return;
    }
    if (selected.abort.signal.aborted || session.current !== selected) return;
    if (!submission) { settle(selected, '', false, selected.labels.unconfirmed); return; }
    selected.stage = 'observing';
    setShown({ element: selected.element, stage: 'observing', reply: '' });
    observe(selected, submission, reply => {
      if (session.current === selected && !selected.abort.signal.aborted) setShown({ element: selected.element, stage: 'observing', reply });
    }, (reply, ok, problem) => settle(selected, reply, ok, problem));
  } });
  const { start, cancel: cancelDictation } = dictation;
  const cancel = useCallback(() => {
    const old = session.current;
    session.current = null;
    if (old) { old.stage = 'cancelled'; old.abort.abort(); }
    cancelDictation();
    picker.current?.suspend(true);
    setShown(null);
  }, [cancelDictation]);

  useEffect(() => {
    if (!enabled || !active || !agent) return;
    if (!/^data-[a-z][a-z0-9-]*$/.test(attribute)) throw new TypeError('Agent target attribute must be a data-* attribute name');
    const selector = `[${attribute}]`;
    let pickedGesture: Element | null = null;
    const marked = (element: Element | null) => element && !isExcluded(element) ? element.closest(selector) : null;
    const gate = (event: Event) => {
      const element = event.target instanceof Element ? event.target : null;
      if (event.type === 'pointerdown') pickedGesture = null;
      if (element && box.current?.contains(element)) return;
      if (session.current || box.current) { if (event.type === 'pointerdown') cancel(); return; }
      if (element && isExcluded(element)) { picker.current?.suspend(true); return; }
      picker.current?.suspend(!marked(element));
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && (session.current || box.current || picker.current?.state().suspended === false)) { event.preventDefault(); event.stopImmediatePropagation(); cancel(); }
    };
    const click = (event: MouseEvent) => {
      // Suspending the picker on touch pointerup removes its touchend listener. Consume only that tap's compatibility click.
      if (pickedGesture && event.target instanceof Node && pickedGesture.contains(event.target)) { pickedGesture = null; event.preventDefault(); event.stopImmediatePropagation(); }
    };
    // Registered before the picker: unmarked actions remain ordinary app actions, not consumed empty picks.
    window.addEventListener('pointerdown', gate, true);
    window.addEventListener('pointermove', gate, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('click', click, true);
    const created = createPicker({ root: document.body, policy: createPrivacyPolicy(), tap: 'pick', wheel: false, keys: 'outside-ignored',
      hitTest: (x, y) => {
        const top = document.elementsFromPoint(x, y).find(element => !isExcluded(element));
        const target = marked(top ?? null);
        return target ? [target] : [];
      },
      onPick: element => {
        const target = marked(element);
        if (!target || session.current) return;
        pickedGesture = target;
        created.suspend(true);
        try {
          const context = contextOf(target, attribute, latest.current.words);
          session.current = { ...context, element: target, controller: agent, abort: new AbortController(), onSettled: latest.current.onSettled, labels: latest.current.words, stage: 'dictating' };
          setShown({ element: target, stage: 'dictating', reply: '' });
          start();
        } catch (error) { setShown({ element: target, stage: 'settled', reply: '', problem: error instanceof Error ? error.message : latest.current.words.invalidContext }); }
      },
    });
    picker.current = created;
    void created.start();
    created.suspend(true);
    return () => {
      window.removeEventListener('pointerdown', gate, true);
      window.removeEventListener('pointermove', gate, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('click', click, true);
      cancel();
      created.dispose();
      if (picker.current === created) picker.current = null;
    };
  }, [enabled, active, agent, attribute, start, cancel]);

  useEffect(() => {
    const selected = session.current;
    if (dictation.problem && selected?.stage === 'dictating') settle(selected, '', false, dictation.problem);
  }, [dictation.problem]);
  useLayoutEffect(() => {
    if (!shown || !box.current) return;
    const node = box.current;
    const measure = () => {
      const rect = shown.element.getBoundingClientRect();
      const topEdge = (viewport?.top ?? 0) + 8, bottom = (viewport ? viewport.top + viewport.height : window.innerHeight) - 8;
      const height = Math.min(node.getBoundingClientRect().height, Math.max(0, bottom - topEdge));
      const lowest = Math.max(topEdge, bottom - height);
      const top = Math.max(topEdge, Math.min(rect.bottom + 8 + height <= bottom ? rect.bottom + 8 : rect.top - height - 8 >= topEdge ? rect.top - height - 8 : lowest, lowest));
      const width = Math.min(Math.max(240, rect.width), window.innerWidth - 16);
      const next = { position: 'fixed' as const, top, left: Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8)), width, maxHeight: Math.max(0, bottom - top), overflowY: 'auto' as const };
      setPlace(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(node);
    return () => { window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); observer?.disconnect(); };
  }, [shown, viewport]);

  if (!enabled || !active || !shown || typeof document === 'undefined') return null;
  const phase = shown.stage === 'dictating' ? dictation.phase : shown.stage;
  return createPortal(<Card ref={box} size="sm" data-feedback-ignore="" data-boring="agent-target" data-testid="agent-target-bar" data-phase={phase}
    role="region" aria-label={words.title} className="app-shell fixed z-50" style={place}>
    <CardHeader><CardTitle>{words.title}</CardTitle></CardHeader>
    <CardContent>
      {shown.problem ? <p role="alert" data-testid="agent-target-problem">{shown.problem}</p>
        : shown.reply ? <Message align="start"><MessageContent><Bubble variant="secondary"><BubbleContent data-testid="agent-target-reply" className="whitespace-pre-wrap">{shown.reply}</BubbleContent></Bubble></MessageContent></Message>
          : <p role="status">{phase === 'starting' ? words.opening : phase === 'recording' ? words.listening(dictation.seconds) : phase === 'transcribing' ? words.transcribing : phase === 'settled' ? words.answered : words.waiting}</p>}
    </CardContent>
    <CardFooter className="flex gap-2">
      {shown.stage === 'dictating' && <Button data-testid="agent-target-stop" className="min-h-11 min-w-11" disabled={phase !== 'recording'} onClick={dictation.finish}>{words.stop}</Button>}
      <Button variant="ghost" data-testid="agent-target-close" className="min-h-11 min-w-11" onClick={cancel}>{shown.stage === 'settled' ? words.close : words.cancel}</Button>
    </CardFooter>
  </Card>, document.body);
}
