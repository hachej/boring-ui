'use client';

// D-2085: drives AgentBar, AgentQuestion and AgentStatus from the chat controller PiChat takes. A thin adapter: it reads the controller's own
// snapshot (`subscribe`/`getSnapshot`, no second subscription model), derives the pending `ask_user` with the kit's chat view, answers it through
// the same `actions.answer` a QuestionCard calls (`createRemoteChat().remote.answer`), stops the run with `controller.stop` and sends with `controller.send`.
import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { derive, formAnswer, parseQuestion, waitingPart } from '@hachej/boring-ui-kit/chat-view';
import type { ChatController } from '@hachej/boring-ui-kit/native-chat';
import type { AgentAnswer, AgentQuestionData } from './agent-question';

/** What the host lets the person do, as PiChat's `actions`: `answer` resolves a pending question (without it no question card is offered). */
export interface AgentBarChatActions {
  readonly answer?: ((questionId: string, answer: string) => Promise<{ readonly kind: string }>) | undefined;
}
export interface AgentBarChatOptions {
  readonly actions?: AgentBarChatActions | undefined;
  /** The status words (French defaults) and what a form's unanswered questions read. */
  readonly labels?: Partial<{ working: string; done: string; skipped: string }>;
}
export interface AgentBarChatStatus { readonly state: 'working' | 'done'; readonly text: string; readonly onCancel?: () => void }
export interface AgentBarChat {
  /** The pending `ask_user`; undefined when none waits or no `actions.answer` was given. Pass it to `AgentBar question`. */
  readonly question: AgentQuestionData | undefined;
  /** Spread into `AgentStatus`; undefined before any work. `done` follows a run that ended and stays until the next one. */
  readonly status: AgentBarChatStatus | undefined;
  /** For `AgentBar onSend`. */
  readonly onSend: (message: { readonly text: string }) => void;
}

const words = { working: 'En cours', done: 'Terminé', skipped: 'Pas de réponse' };

export function useAgentBarChat(controller: ChatController, options: AgentBarChatOptions = {}): AgentBarChat {
  const { actions, labels } = options;
  const text = { ...words, ...labels };
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const derived = useMemo(() => derive(state.view, { mode: 'expert', presentation: 'natural', renderEntry: undefined, renderTool: undefined, groupTool: undefined }), [state.view]);
  const waiting = waitingPart(derived.rows);
  const asked = waiting?.kind === 'question' ? waiting : undefined;
  const sending = Boolean(state.echo?.some(item => item.state === 'sending'));
  const working = (Boolean(derived.run) || sending) && !asked;
  const latest = useRef({ controller, actions, derived });
  useLayoutEffect(() => { latest.current = { controller, actions, derived }; });

  // Answered ids stay hidden until the controller's view shows the result, so a second tap cannot answer twice.
  const [settled, setSettled] = useState<string | undefined>();
  const answer = actions?.answer;
  const questionId = asked?.questionId;
  const onAnswer = useCallback(({ text: value }: AgentAnswer) => {
    const { controller: live, actions: current, derived: view } = latest.current;
    if (questionId === undefined || !current?.answer || live.getSnapshot().disposed) return;
    setSettled(questionId);
    void current.answer(questionId, value).then(outcome => {
      // Like PiChat: a question that refuses or does not know the answer is superseded, the run that holds it stops.
      if ((outcome.kind === 'denied' || outcome.kind === 'unknown-question') && view.run) return live.stop();
      return undefined;
    }).catch(() => { setSettled(undefined); });
  }, [questionId]);

  const question = useMemo<AgentQuestionData | undefined>(() => {
    if (!asked || !answer || questionId === undefined || settled === questionId) return undefined;
    const parsed = parseQuestion(asked.call);
    if (parsed.items.length > 0) {
      // A form answers as one text: the bar answers its first question, the others read as skipped.
      const first = parsed.items[0]!;
      return { title: first.question, step: parsed.question || undefined, choices: first.options, submit: null,
        onAnswer: ({ text: value }) => onAnswer({ text: formAnswer(parsed.items, [value], text.skipped), source: 'choice' }) };
    }
    return { title: parsed.question, choices: parsed.options, submit: null, onAnswer };
  }, [asked, answer, questionId, settled, onAnswer, text.skipped]);

  // `done` after work ends, until the next work starts.
  // Derived while rendering (React's "adjust state on a prop change"), so no effect sets state.
  const [track, setTrack] = useState({ was: false, finished: false });
  const finished = working ? false : track.was && !asked ? true : track.finished;
  const was = working || (track.was && Boolean(asked));
  if (finished !== track.finished || was !== track.was) setTrack({ was, finished });

  const onCancel = useCallback(() => { void latest.current.controller.stop().catch(() => {}); }, []);
  const onSend = useCallback(({ text: value }: { readonly text: string }) => {
    const live = latest.current.controller;
    if (live.getSnapshot().disposed || !value.trim()) return;
    void live.send('followUp', { text: value, attachments: [], restore: { text: value, attachments: [] } }).catch(() => {});
  }, []);

  const status = working ? { state: 'working' as const, text: text.working, onCancel }
    : finished ? { state: 'done' as const, text: text.done } : undefined;
  return { question, status, onSend };
}
