'use client';

import { useEffect, useRef, useState } from 'react';

/** What the host's `answer` callback settles with: kind `answered`, or a refusal with an optional reason of its own. */
export type SubmitOutcome<K extends string = string> = { readonly kind: 'answered'; readonly reason?: undefined } | { readonly kind: K; readonly reason?: string | undefined };

export interface SubmitOutcomeOptions<K extends string = string> {
  /** Sends one answer or decision; the host's `answer` bound to the question. A rejection is shown as its message. */
  readonly send: (value: string) => Promise<SubmitOutcome<K>>;
  /** The words for a refusal without a reason of its own (the label key stays the caller's); `K` is the host's own union of refusal kinds. */
  readonly refused: (kind: K) => string;
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
export function useSubmitOutcome<K extends string = string>({ send, refused, notSent }: SubmitOutcomeOptions<K>): SubmitOutcomeState {
  const [sent, setSent] = useState<string | undefined>();
  const [sending, setSending] = useState<string | undefined>();
  const [refusal, setRefusal] = useState<string | undefined>();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  // `sending` is state and updates on the next render; two calls in one tick must still admit one send.
  const inFlight = useRef(false);

  async function submit(value: string): Promise<void> {
    if (inFlight.current || sending !== undefined) return;
    inFlight.current = true;
    setRefusal(undefined); setSending(value);
    try {
      const outcome = await send(value);
      if (outcome.kind === 'answered') setSent(value);
      else setRefusal(outcome.reason || refused(outcome.kind));
    } catch (cause) { setRefusal(cause instanceof Error ? cause.message : notSent); }
    finally { inFlight.current = false; if (mounted.current) setSending(undefined); }
  }
  return { sent, sending, refusal, submit };
}
