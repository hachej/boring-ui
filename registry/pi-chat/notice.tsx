'use client';

import type { ReactNode } from 'react';
import type { NativeChatSnapshot } from '@hachej/boring-ui-kit/native-chat';
import { Button } from '../button/button';
import { useChatText } from './labels';
import { cn } from '../utils/utils';

export function Notice({ tone = 'error', children, testid }: { readonly tone?: 'error' | 'info'; readonly children: ReactNode; readonly testid?: string }) {
  return <div role={tone === 'error' ? 'alert' : 'status'} {...(testid ? { 'data-testid': testid } : {})}
    className={cn('flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-sm', tone === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-muted/60 text-muted-foreground')}>{children}</div>;
}

/** What went wrong with sending or stopping, and the recovery for an unknown submission. Shared by every chat surface. */
export function ChatNotices({ state, error, onReconcile, onRetry }: {
  readonly state: Pick<NativeChatSnapshot, 'send' | 'stop'>;
  readonly error: string | null;
  readonly onReconcile: () => void;
  readonly onRetry: () => void;
}) {
  const { labels } = useChatText();
  return <>
    {error && <Notice testid="chat-error">{error}</Notice>}
    {state.send.kind === 'blocked' && <Notice testid="send-blocked">{state.send.reason}</Notice>}
    {state.send.kind === 'unknown' && <Notice testid="send-unknown"><span className="flex-1">{labels.sendUnknown}</span>
      <Button size="sm" variant="outline" onClick={onReconcile}>{labels.checkSubmission}</Button>
      <Button size="sm" variant="outline" onClick={onRetry}>{labels.retrySame}</Button></Notice>}
    {state.stop === 'requested' && <Notice tone="info" testid="stop-requested">{labels.stopRequested}</Notice>}
    {state.stop === 'unconfirmed' && <Notice testid="stop-unconfirmed">{labels.stopUnconfirmed}</Notice>}
  </>;
}
