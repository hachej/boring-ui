'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckIcon, CopyIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Item, ItemHeader, ItemTitle } from '@/components/ui/item';
import { copyText } from '../utils/utils';
import { useChatText } from './labels';

/** Copy button with a short "copied" confirmation. Failures stay visible as a title instead of throwing. */
export function CopyButton({ text, label: given, onCopy, className, iconOnly = false }: { readonly text: string; readonly label?: string; readonly onCopy?: (text: string) => Promise<void>; readonly className?: string; readonly iconOnly?: boolean }) {
  const { labels } = useChatText();
  const label = given ?? labels.copy;
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const settle = (next: 'copied' | 'failed') => { setState(next); clearTimeout(timer.current); timer.current = setTimeout(() => setState('idle'), 1600); };
  return <Button variant="ghost" size={iconOnly ? 'icon-sm' : 'sm'} className={className} data-testid="copy" aria-label={label} title={state === 'failed' ? labels.copyFailed : label}
    onClick={() => { copyText(text, onCopy).then(() => settle('copied'), () => settle('failed')); }}>
    {state === 'copied' ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
    <span className={iconOnly ? 'sr-only' : 'sr-only md:not-sr-only'}>{state === 'copied' ? labels.copied : state === 'failed' ? labels.failed : label}</span>
  </Button>;
}

/** Fenced code: language label, copy action, horizontal scroll. Text only, never interpreted as markup. */
export function CodeBlock({ code, language, onCopy }: { readonly code: string; readonly language?: string; readonly onCopy?: (text: string) => Promise<void> }) {
  const { labels } = useChatText();
  const label = language?.trim().split(/\s+/)[0]?.slice(0, 24);
  // shadcn's own Code Block installs a syntax highlighter (shiki) this block never uses, so the frame is an outline Item.
  return <Item variant="outline" size="xs" data-testid="code-block" className="my-3 flex-col items-stretch">
    <ItemHeader>
      <ItemTitle data-testid="code-language" className="lowercase">{label || 'text'}</ItemTitle>
      <CopyButton text={code} label={labels.copyCode} {...(onCopy ? { onCopy } : {})} />
    </ItemHeader>
    <pre className="m-0 overflow-x-auto font-mono text-xs leading-5"><code>{code}</code></pre>
  </Item>;
}
