'use client';

// D-2085: drives AgentBar, AgentQuestion and AgentStatus from the chat controller PiChat takes. A thin adapter: it reads the controller's own
// snapshot (`subscribe`/`getSnapshot`, no second subscription model), derives the pending `ask_user` with the kit's chat view, answers it through
// the same `actions.answer` a QuestionCard calls (`createRemoteChat().remote.answer`), stops the run with `controller.stop` and sends with `controller.send`.
// D-2198: the status says what the running tool does (the tool card's own words), a form asks each of its questions in turn, and a reply that
// came while the conversation was folded is kept (`reply`, `historyBadge`) until `markRead`.
import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { derive, formAnswer, parseQuestion, waitingPart } from '@hachej/boring-ui-kit/chat-view';
import { mentionedPaths } from '@hachej/boring-ui-kit/chat-text';
import type { ChatController } from '@hachej/boring-ui-kit/native-chat';
import type { ChatLabels } from '../pi-chat/labels';
import { frenchChatLabels } from '../pi-chat/labels-fr';
import { liveLabel, preview } from '../pi-chat/tool';
import type { AgentAnswer, AgentQuestionData } from './agent-question';

/** What the host lets the person do, as PiChat's `actions`: `answer` resolves a pending question (without it no question card is offered). */
export interface AgentBarChatActions {
  readonly answer?: ((questionId: string, answer: string) => Promise<{ readonly kind: string }>) | undefined;
}
export interface AgentBarChatWords {
  readonly working: string;
  readonly done: string;
  /** Kept for a form answered from older code; the bar now asks every question of a form. */
  readonly skipped: string;
  /** The accessible name of the unread dot (`historyBadge`). */
  readonly unread: string;
  /** A form's step line: « 1 sur 2 ». */
  readonly step: (index: number, count: number) => string;
}
export interface AgentBarChatOptions {
  readonly actions?: AgentBarChatActions | undefined;
  /** The status words (French defaults). */
  readonly labels?: Partial<AgentBarChatWords>;
  /** The words for a running tool, as the chat's `labels.toolActivity` (default: the kit's French ones, « Lecture releve.pdf »). */
  readonly toolLabels?: Pick<ChatLabels, 'toolActivity'> | undefined;
}
export interface AgentBarChatStatus { readonly state: 'working' | 'done'; readonly text: string; readonly onCancel?: () => void }
/** The agent's last reply after a run that ended: its text, what it used (file names and other hints of its tool calls) and the files it cites (`@path`). */
export interface AgentBarChatReply { readonly key: string; readonly text: string; readonly used: readonly string[]; readonly files: readonly string[] }
export interface AgentBarChat {
  /** The pending `ask_user`; undefined when none waits or no `actions.answer` was given. Pass it to `AgentBar question`. A form comes one question at a time (`step` « 1 sur 2 »). */
  readonly question: AgentQuestionData | undefined;
  /** Spread into `AgentStatus`; undefined before any work. While working its text is the running tool's words (« Lecture releve.pdf · 12 lignes sur 40 »), else « En cours ». `done` follows a run that ended and stays until the next one. */
  readonly status: AgentBarChatStatus | undefined;
  /** The reply of the run that just ended, until `markRead` (or the next run). Undefined for the history the hook found when it mounted. */
  readonly reply: AgentBarChatReply | undefined;
  /** For `AgentBar historyBadge`: the dot while `reply` is unread. */
  readonly historyBadge: { readonly label: string } | undefined;
  /** The person saw the conversation: the reply is read. */
  readonly markRead: () => void;
  /** For `AgentBar onSend`. */
  readonly onSend: (message: { readonly text: string }) => void;
}

const words: AgentBarChatWords = { working: 'En cours', done: 'Terminé', skipped: 'Pas de réponse', unread: 'Nouvelle réponse', step: (index, count) => `${index} sur ${count}` };

type Call = { readonly type: 'toolCall'; readonly id: string; readonly name: string; readonly arguments: Record<string, unknown> };
type Entry = { readonly model?: readonly { readonly role: string; readonly content?: unknown; readonly toolCallId?: string }[] };
const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/** The calls of the conversation's last turn (after the person's last message) and the ids that have a result. */
function lastTurn(entries: readonly Entry[]): { readonly calls: readonly Call[]; readonly done: ReadonlySet<string> } {
  const messages = entries.flatMap(entry => entry.model ?? []);
  const start = messages.findLastIndex(message => message.role === 'user');
  const calls: Call[] = [], done = new Set<string>();
  for (const message of messages.slice(start + 1)) {
    if (message.role === 'toolResult' && message.toolCallId) done.add(message.toolCallId);
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue;
    for (const part of message.content as unknown[]) {
      const call = record(part);
      if (call?.['type'] === 'toolCall' && typeof call['id'] === 'string' && typeof call['name'] === 'string') calls.push({ type: 'toolCall', id: call['id'], name: call['name'], arguments: record(call['arguments']) ?? {} });
    }
  }
  return { calls, done };
}
const ASK = 'ask_user';
const base = (hint: string) => hint.split('/').filter(Boolean).at(-1) ?? hint;

export function useAgentBarChat(controller: ChatController, options: AgentBarChatOptions = {}): AgentBarChat {
  const { actions, labels, toolLabels } = options;
  const text = { ...words, ...labels };
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const derived = useMemo(() => derive(state.view, { mode: 'expert', presentation: 'natural', renderEntry: undefined, renderTool: undefined, groupTool: undefined }), [state.view]);
  const turn = useMemo(() => lastTurn((state.view?.entries ?? []) as unknown as readonly Entry[]), [state.view]);
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

  // A form is asked one question at a time; its answers are kept here and sent together, as PiChat's form sends them. None is ever skipped.
  const [form, setForm] = useState<{ readonly id: string | undefined; readonly answers: readonly string[] }>({ id: undefined, answers: [] });
  const { step: stepWords, skipped } = text;
  const question = useMemo<AgentQuestionData | undefined>(() => {
    if (!asked || !answer || questionId === undefined || settled === questionId) return undefined;
    const parsed = parseQuestion(asked.call);
    if (parsed.items.length > 0) {
      const answers = form.id === questionId ? form.answers : [];
      const index = Math.min(answers.length, parsed.items.length - 1);
      const item = parsed.items[index]!;
      const step = stepWords(index + 1, parsed.items.length);
      return { title: item.question, step: parsed.question ? `${parsed.question} · ${step}` : step, choices: item.options, submit: null,
        ...(index > 0 ? { answered: answers[index - 1]! } : {}),
        onAnswer: ({ text: value }) => {
          const all = [...answers, value];
          if (all.length < parsed.items.length) { setForm({ id: questionId, answers: all }); return; }
          setForm({ id: undefined, answers: [] });
          onAnswer({ text: formAnswer(parsed.items, all, skipped), source: 'choice' });
        } };
    }
    return { title: parsed.question, choices: parsed.options, submit: null, onAnswer };
  }, [asked, answer, questionId, settled, onAnswer, form, stepWords, skipped]);

  // `done` after work ends, until the next work starts.
  // Derived while rendering (React's "adjust state on a prop change"), so no effect sets state.
  const [track, setTrack] = useState({ was: false, finished: false });
  const finished = working ? false : track.was && !asked ? true : track.finished;
  const was = working || (track.was && Boolean(asked));
  if (finished !== track.finished || was !== track.was) setTrack({ was, finished });

  // While working: the words of the tool that runs (the last call of this turn without a result), with what it published as `details.progress`.
  const running = working ? turn.calls.findLast(call => call.name !== ASK && !turn.done.has(call.id)) : undefined;
  const slot = running ? (Array.isArray(record(state.view?.docs['pi.live'])?.['tools']) ? record(state.view?.docs['pi.live'])!['tools'] as unknown[] : []).map(record).find(item => item?.['callId'] === running.id) : undefined;
  const progress = record(slot?.['details'])?.['progress'];
  const stage = typeof derived.stageStatus === 'string' ? derived.stageStatus : undefined;
  const doing = running ? `${liveLabel(running, toolLabels ?? frenchChatLabels)}${typeof progress === 'string' && progress.trim() ? ` · ${progress.trim()}` : ''}` : stage ?? text.working;

  // The reply of the run that just ended: kept until read. History found at mount is not a new reply (`finished` needs work seen here).
  const lastReply = derived.rows.findLast(row => row.type === 'assistant');
  const [read, setRead] = useState<string | undefined>();
  const reply = useMemo<AgentBarChatReply | undefined>(() => {
    if (!finished || lastReply?.type !== 'assistant' || !lastReply.text.trim() || lastReply.key === read) return undefined;
    const used = [...new Set(turn.calls.filter(call => call.name !== ASK).map(call => base(preview(call.arguments))).filter(Boolean))];
    return { key: lastReply.key, text: lastReply.text.trim(), used, files: mentionedPaths(lastReply.text) };
  }, [finished, lastReply, read, turn]);
  const replyKey = reply?.key;
  const markRead = useCallback(() => { if (replyKey !== undefined) setRead(replyKey); }, [replyKey]);

  const onCancel = useCallback(() => { void latest.current.controller.stop().catch(() => {}); }, []);
  const onSend = useCallback(({ text: value }: { readonly text: string }) => {
    const live = latest.current.controller;
    if (live.getSnapshot().disposed || !value.trim()) return;
    void live.send('followUp', { text: value, attachments: [], restore: { text: value, attachments: [] } }).catch(() => {});
  }, []);

  const status = working ? { state: 'working' as const, text: doing, onCancel }
    : finished ? { state: 'done' as const, text: text.done } : undefined;
  return { question, status, reply, historyBadge: reply ? { label: text.unread } : undefined, markRead, onSend };
}
