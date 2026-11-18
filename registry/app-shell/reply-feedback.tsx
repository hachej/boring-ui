'use client';

// `FloatingComposer onFeedback`: thumbs up and down under each finished reply (`chatProps.replyFooter`). Pressing the chosen thumb again takes the rating back (`value` is `null`).
import { useState } from 'react';
import type { ReactNode } from 'react';
import { ThumbsDownIcon, ThumbsUpIcon } from '../_shared/icons';
import { Button } from '@/components/ui/button';
import type { ReplyRef } from '../pi-chat/config';
import type { AppShellText } from './text';

export type ReplyFeedbackHandler = (reply: { readonly key: string; readonly text: string }, value: 'up' | 'down' | null) => void;

function Thumbs({ reply, onFeedback, text }: { readonly reply: ReplyRef; readonly onFeedback: ReplyFeedbackHandler; readonly text: Pick<AppShellText, 'goodResponse' | 'badResponse'> }) {
  const [value, setValue] = useState<'up' | 'down' | null>(null);
  return <div data-testid="reply-feedback" className="-ml-2 flex items-center gap-0.5 pointer-coarse:gap-1">
    {(['up', 'down'] as const).map(which => {
      const label = which === 'up' ? text.goodResponse : text.badResponse;
      const Icon = which === 'up' ? ThumbsUpIcon : ThumbsDownIcon;
      return <Button key={which} variant={value === which ? 'secondary' : 'ghost'} size="icon-sm" data-testid={`feedback-${which}`} aria-label={label} title={label} aria-pressed={value === which}
        onClick={() => { const next = value === which ? null : which; setValue(next); onFeedback({ key: reply.key, text: reply.text }, next); }}><Icon data-icon="inline-start" aria-hidden="true" /></Button>;
    })}
  </div>;
}

/** The reply footer with the thumbs, followed by the host's own footer when it has one. */
export function withReplyFeedback(onFeedback: ReplyFeedbackHandler | undefined, text: Pick<AppShellText, 'goodResponse' | 'badResponse'>, host?: (reply: ReplyRef) => ReactNode): ((reply: ReplyRef) => ReactNode) | undefined {
  if (!onFeedback) return host;
  return reply => <>
    <Thumbs reply={reply} onFeedback={onFeedback} text={text} />
    {host?.(reply)}
  </>;
}
