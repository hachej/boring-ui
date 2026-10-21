'use client';

import type { ReactNode } from 'react';
import type { ChatSnapshot } from '@hachej/boring-ui-kit/native-chat';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Shimmer } from './shimmer';
import { useChatText } from './labels';

export function Notice({ tone = 'error', children, testid }: { readonly tone?: 'error' | 'info'; readonly children: ReactNode; readonly testid?: string }) {
  return <Alert variant={tone === 'error' ? 'destructive' : 'default'} role={tone === 'error' ? 'alert' : 'status'} {...(testid ? { 'data-testid': testid } : {})}
    className="flex flex-wrap items-center gap-2">{children}</Alert>;
}

/** What went wrong with sending or stopping, and the recovery for an unknown submission. Shared by every chat surface. */
export function ChatNotices({ state, error, onReconcile, onRetry, natural = false }: {
  readonly state: Pick<ChatSnapshot, 'send' | 'stop'>;
  readonly error: string | null;
  readonly onReconcile: () => void;
  readonly onRetry: () => void;
  /** `presentation="natural"`: a blocked send shows a plain label, not the controller's reason. */
  readonly natural?: boolean;
}) {
  const { labels } = useChatText();
  return <>
    {error && <Notice testid="chat-error">{error}</Notice>}
    {state.send.kind === 'blocked' && <Notice testid="send-blocked">{natural ? labels.sendUnavailable : state.send.reason}</Notice>}
    {state.send.kind === 'unknown' && <Notice testid="send-unknown"><span className="flex-1">{'reason' in state.send ? state.send.reason : labels.sendUnknown}</span>
      <Button size="sm" variant="outline" onClick={onReconcile}>{labels.checkSubmission}</Button>
      {(!('retryable' in state.send) || state.send.retryable) && <Button size="sm" variant="outline" onClick={onRetry}>{labels.retrySame}</Button>}</Notice>}
    {state.stop === 'requested' && <Notice tone="info" testid="stop-requested">{labels.stopRequested}</Notice>}
    {state.stop === 'unconfirmed' && <Notice testid="stop-unconfirmed">{labels.stopUnconfirmed}</Notice>}
  </>;
}

/** `presentation="natural"`: whether the one "preparing" status shows. Any work (a run, a retry, a compaction) counts, except a confirmed stop with no run left; a question waiting for the person does not. */
export function preparing(input: { readonly natural: boolean; readonly waitingForAnswer: boolean; readonly run: unknown; readonly retry: unknown; readonly compacting: boolean; readonly stop: ChatSnapshot['stop'] }): boolean {
  const { natural, waitingForAnswer, run, retry, compacting, stop } = input;
  return natural && !waitingForAnswer && Boolean(run || retry || compacting) && !(stop === 'confirmed' && !run);
}

/** The one status line of natural presentation. */
export function PreparingStatus({ children }: { readonly children?: ReactNode }) {
  const { labels } = useChatText();
  return <p role="status" data-testid="preparing" className="m-0 flex items-center gap-2 px-1 text-xs text-muted-foreground"><Shimmer>{children ?? labels.preparing}</Shimmer></p>;
}
