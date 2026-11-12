'use client';

// The header button that opens the agent layer (tap, or hold to talk).
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { SparklesIcon } from '../_shared/icons';
import { Button } from '@/components/ui/button';
import { useRecordingCancellation } from '../pi-chat-voice/use-hold-to-record';
import { cn } from '../utils/utils';
import { HOLD_MS, shellWords, useInternal } from './layer-context';

/** The header button that opens the layer: a tap opens half; with `agent.voice`, press and hold records and a slide off cancels. Absent without `agent`. */
export function AgentTrigger({ className, children }: { readonly className?: string; readonly children?: ReactNode }) {
  const layer = useInternal();
  const { agent, voice } = layer;
  const text = shellWords(layer.locale ?? agent?.chatProps?.locale, agent);
  const hold = useRef<{ timer: ReturnType<typeof setTimeout> | undefined; held: boolean; id: number } | null>(null);
  const voiceRef = useRef(voice);
  useLayoutEffect(() => { voiceRef.current = voice; });
  const cancelHold = useCallback(() => {
    const current = hold.current;
    hold.current = null;
    if (!current) return;
    clearTimeout(current.timer);
    if (current.held) voiceRef.current.cancel();
  }, []);
  useRecordingCancellation(cancelHold);
  const controller = agent?.controller;
  useEffect(() => () => cancelHold(), [controller, cancelHold]);
  const { triggerUntil: triggerUntilRef } = layer;
  if (!agent) return null;

  const toggle = () => {
    triggerUntilRef.current = Date.now() + 500;
    // Peek is the collapsed coach: a tap reveals it. Every other open state closes.
    if (layer.showing === 'agent' && layer.state !== 'closed' && layer.state !== 'peek') layer.close();
    else layer.open('agent', 'half');
  };
  const release = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = hold.current;
    hold.current = null;
    if (!current) return;
    clearTimeout(current.timer);
    if (event.currentTarget.hasPointerCapture?.(current.id)) event.currentTarget.releasePointerCapture(current.id);
    if (current.held) { if (event.type === 'pointerup') voice.finish(); else voice.cancel(); }
    else if (event.type === 'pointerup') toggle();
  };
  const down = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const target = event.currentTarget;
    target.setPointerCapture?.(event.pointerId);
    const state = { timer: undefined as ReturnType<typeof setTimeout> | undefined, held: false, id: event.pointerId };
    hold.current = state;
    if (agent.voice) {
      state.timer = setTimeout(() => {
        state.held = true;
        if (layer.snap === 'closed') layer.setSnap('peek');
        layer.showAgent();
        voice.start();
      }, HOLD_MS);
    }
  };
  const move = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = hold.current;
    if (!current?.held) return;
    const box = event.currentTarget.getBoundingClientRect();
    const slack = 24;
    if (event.clientX < box.left - slack || event.clientX > box.right + slack || event.clientY < box.top - slack || event.clientY > box.bottom + slack) {
      hold.current = null;
      voice.cancel();
    }
  };
  const name = agent.label ?? text.open;
  const Icon = agent.icon;
  const exposed = layer.showing === 'agent' && (layer.state === 'half' || layer.state === 'full');
  return <Button variant="ghost" size="icon" data-agent-trigger="" data-testid="agent-trigger" aria-label={name} title={name} aria-expanded={layer.state !== 'closed'}
    // Base UI 1.9.0 markOthers (FloatingFocusManager) skips an [aria-live] element and its ancestors in its aria-hidden pass: while the agent's own sheet is
    // modal (half, full) that keeps the trigger a reachable button; "off" announces nothing. Never otherwise: another modal (a Dialog) must hide it.
    aria-live={exposed ? 'off' : undefined}
    onPointerDown={down} onPointerUp={release} onPointerCancel={release} onPointerMove={move} onContextMenu={event => event.preventDefault()}
    onClick={event => { if (event.detail === 0) toggle(); }}
    className={cn('touch-none', className)}>
    {children ?? (Icon ? <Icon className="size-5" /> : <SparklesIcon data-icon="inline-start" aria-hidden="true" />)}
  </Button>;
}
