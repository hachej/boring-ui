'use client';

import type { ComponentPropsWithRef, PropsWithChildren } from 'react';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';

function EditorAction({ 'aria-pressed': pressed, value, ...props }: ComponentPropsWithRef<'button'>) {
  return pressed === undefined
    ? <Button variant="ghost" size="sm" value={value} {...props} />
    : <Toggle size="sm" pressed={pressed === true || pressed === 'true'} value={value === undefined ? undefined : String(value)} {...props} />;
}

function EditorBubble({ children }: PropsWithChildren) {
  return <Card size="sm"><CardContent className="flex items-center gap-1">{children}</CardContent></Card>;
}

/** Maps native editor action/input props to the consumer's unchanged shadcn controls. */
export const editorControls = { button: EditorAction, input: Input, textarea: Textarea, bubble: EditorBubble };
