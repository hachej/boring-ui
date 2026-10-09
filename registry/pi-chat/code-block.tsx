'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckIcon, CopyIcon } from 'lucide-react';
import { Button } from '../button/button';
import { copyText, cn } from '../utils/utils';
import { useChatText } from './labels';

/** Copy button with a short "copied" confirmation. Failures stay visible as a title instead of throwing. */
export function CopyButton({ text, label: given, onCopy, className, iconOnly = false }: { readonly text: string; readonly label?: string; readonly onCopy?: (text: string) => Promise<void>; readonly className?: string; readonly iconOnly?: boolean }) {
  const { labels } = useChatText();
  const label = given ?? labels.copy;
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const settle = (next: 'copied' | 'failed') => { setState(next); clearTimeout(timer.current); timer.current = setTimeout(() => setState('idle'), 1600); };
  return <Button size="sm" className={cn('max-sm:min-w-10 pointer-coarse:min-w-10', className)} data-testid="copy" aria-label={label} title={state === 'failed' ? labels.copyFailed : label}
    onClick={() => { copyText(text, onCopy).then(() => settle('copied'), () => settle('failed')); }}>
    {state === 'copied' ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
    <span className={iconOnly ? 'sr-only' : 'sr-only md:not-sr-only'}>{state === 'copied' ? labels.copied : state === 'failed' ? labels.failed : label}</span>
  </Button>;
}

/** Fenced code: language label, copy action, horizontal scroll. Text only, never interpreted as markup. */
export function CodeBlock({ code, language, onCopy }: { readonly code: string; readonly language?: string; readonly onCopy?: (text: string) => Promise<void> }) {
  const { labels } = useChatText();
  const label = language?.trim().split(/\s+/)[0]?.slice(0, 24);
  return <div data-testid="code-block" className="my-3 overflow-hidden rounded-lg border border-border bg-muted/40 text-foreground">
    <div className="flex h-8 items-center justify-between border-b border-border bg-muted/60 pr-1 pl-3">
      <span data-testid="code-language" className="font-mono text-[11px] tracking-wide text-muted-foreground lowercase">{label || 'text'}</span>
      <CopyButton text={code} label={labels.copyCode} {...(onCopy ? { onCopy } : {})} className="h-6 text-[11px] text-muted-foreground" />
    </div>
    <pre className="m-0 overflow-x-auto p-3 font-mono text-[12.5px] leading-5"><code>{code}</code></pre>
  </div>;
}
