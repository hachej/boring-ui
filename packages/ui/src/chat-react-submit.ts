'use client';

import { useEffect, useRef, useState } from 'react';

/** What the host's `answer` callback settles with: kind `answered`, or a refusal with an optional reason of its own. */
export interface SubmitOutcome { readonly kind: string; readonly reason?: string | undefined }

export interface SubmitOutcomeOptions {
  /** Sends one answer or decision; the host's `answer` bound to the question. A rejection is shown as its message. */
  readonly send: (value: string) => Promise<SubmitOutcome>;
  /** The words for a refusal without a reason of its own (the label key stays the caller's). */
  readonly refused: (kind: string) => string;
  /** The words for a send that threw something that is not an `Error`. */
  readonly notSent: string;
}
export interface SubmitOutcomeState {
  /** The value the host accepted. Stays set; the card derives its own state from it. */
  readonly sent: string | undefined;
  /** The value being sent right now; one send at a time. */
  readonly sending: string | undefined;
  /** Why the last send did not go through; cleared when the next one starts. */
  readonly refusal: string | undefined;
  /** Sends `value` unless a send is in flight. The caller keeps its own guards (no answer callback, still being written, empty text). */
  readonly submit: (value: string) => Promise<void>;
}

/**
 * The submit state of an answer or decision card: `sent` once accepted, `sending` while in flight, `refusal` after a refused or failed
 * send. After unmount a late settle sets no `sending` state. Headless: the card owns the words and the markup.
 */
export function useSubmitOutcome({ send, refused, notSent }: SubmitOutcomeOptions): SubmitOutcomeState {
  const [sent, setSent] = useState<string | undefined>();
  const [sending, setSending] = useState<string | undefined>();
  const [refusal, setRefusal] = useState<string | undefined>();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function submit(value: string): Promise<void> {
    if (sending !== undefined) return;
    setRefusal(undefined); setSending(value);
    try {
      const outcome = await send(value);
      if (outcome.kind === 'answered') setSent(value);
      else setRefusal(outcome.reason || refused(outcome.kind));
    } catch (cause) { setRefusal(cause instanceof Error ? cause.message : notSent); }
    finally { if (mounted.current) setSending(undefined); }
  }
  return { sent, sending, refusal, submit };
}
