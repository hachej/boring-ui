'use client';

import type { ReactNode } from 'react';
import type { ChatSnapshot } from '@hachej/boring-ui-kit/native-chat';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { useChatText } from './labels';

export function Notice({ tone = 'error', children, testid }: { readonly tone?: 'error' | 'info'; readonly children: ReactNode; readonly testid?: string }) {
  return <Alert variant={tone === 'error' ? 'destructive' : 'default'} role={tone === 'error' ? 'alert' : 'status'} {...(testid ? { 'data-testid': testid } : {})}
    className="flex flex-wrap items-center gap-2">{children}</Alert>;
}

/** What went wrong with sending or stopping, and the recovery for an unknown submission. Shared by every chat surface. */
export function ChatNotices({ state, error, onReconcile, onRetry }: {
  readonly state: Pick<ChatSnapshot, 'send' | 'stop'>;
  readonly error: string | null;
  readonly onReconcile: () => void;
  readonly onRetry: () => void;
}) {
  const { labels } = useChatText();
  return <>
    {error && <Notice testid="chat-error">{error}</Notice>}
    {state.send.kind === 'blocked' && <Notice testid="send-blocked">{state.send.reason}</Notice>}
    {state.send.kind === 'unknown' && <Notice testid="send-unknown"><span className="flex-1">{'reason' in state.send ? state.send.reason : labels.sendUnknown}</span>
      <Button size="sm" variant="outline" onClick={onReconcile}>{labels.checkSubmission}</Button>
      {(!('retryable' in state.send) || state.send.retryable) && <Button size="sm" variant="outline" onClick={onRetry}>{labels.retrySame}</Button>}</Notice>}
    {state.stop === 'requested' && <Notice tone="info" testid="stop-requested">{labels.stopRequested}</Notice>}
    {state.stop === 'unconfirmed' && <Notice testid="stop-unconfirmed">{labels.stopUnconfirmed}</Notice>}
  </>;
}
