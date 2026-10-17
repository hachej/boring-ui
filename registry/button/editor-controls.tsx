'use client';

import type { ComponentPropsWithRef } from 'react';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

function EditorAction({ 'aria-pressed': pressed, ...props }: ComponentPropsWithRef<'button'>) {
  return pressed === undefined
    ? <Button variant="ghost" size="sm" {...props} />
    : <Toggle size="sm" pressed={pressed === true || pressed === 'true'} {...props} />;
}

/** Maps native editor action/input props to the consumer's unchanged shadcn controls. */
export const editorControls = { button: EditorAction, input: Input, textarea: Textarea };
