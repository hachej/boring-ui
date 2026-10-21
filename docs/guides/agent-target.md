# Mark app data for point and dictate

Install the `agent-target` registry item and mount `AgentTargetMode` inside the app shell's provider. The app controls `enabled`, for example from a header action. It borrows `useAgentLayer().agent`; the product manager's conversation is never substituted and chat need not be open.

```tsx
import { AgentTargetMode } from '@/components/agent-target/agent-target';
import { agentTargetLabelsFr } from '@/components/agent-target/agent-target-labels';

<Button data-agent-target={JSON.stringify({ meal: 'm-42', slot: 'lunch' })}>
  <span>Fictional lunch</span>
</Button>
<AgentTargetMode
  enabled={pointing}
  labels={agentTargetLabelsFr}
  transcribe={(audio, signal) => transcribeAudio(audio, signal)}
  onSettled={({ target }) => { if (typeof target.meal === 'string') void refetchMeal(target.meal); }}
/>
```

## Labels and presentation

All displayed words and the bar’s accessible name come from `labels?: Partial<AgentTargetLabels>`, with English defaults. Pass `agentTargetLabelsFr` for French or supply the host’s own labels, including `listening(seconds)` and microphone/error messages. The shared dictation hook also accepts label overrides. Replies use the host’s secondary Bubble variant; the bar follows the pointed item’s width and left edge, clamped to the visual viewport (a narrow target gets a readable minimum width).

## The data boundary

The nearest marked ancestor wins, including when a nested label is tapped. Set its attribute to a JSON **object**, not a selector, free-form prompt or executable code. Keep it small: both the attribute value and the serialized context must fit 1,024 UTF-8 bytes. Malformed, array, scalar and oversized values show an error before microphone access. Use `attribute="data-other-target"` only for another explicit data attribute with the same JSON contract.

Only this attribute value is captured, at the tap. Later DOM changes cannot retarget a pending transcript. There is no automatic dataset fallback: other `data-*` attributes, accessible names, element text, page snapshots and feedback privacy exceptions are not sent. Do not mark secrets or data the model provider must not receive. Target IDs are advisory input, never permission: authorize and validate every domain tool at the host.

The user message is exactly a fenced context followed by speech:

```text
<target>{"meal":"m-42","slot":"lunch"}</target>

remplace le riz par 150 g de pâtes
```

`<` inside a JSON value is escaped to keep the fence unambiguous. PiChat renders valid leading target blocks as chips while retaining the native message. This is not the volatile `requestContext` mechanism. A refused send restores only the spoken words to the existing composer, preserving other draft text.

## Lifecycle and outcomes

A marked tap starts recording from that gesture. Stop transcribes, then sends once. Unmarked taps remain normal page actions; disabled mode installs no picker. The selected bar is portaled, ignored by feedback picking and clamped inside the visual viewport above a software keyboard. Escape, outside tap, disable, screen deactivation or unmount release local media and fence late callbacks. Cancellation after sending does not withdraw or abort native work.

A streamed reply is shown only for a native run containing this submission ID. Settlement reads the native submission's exact answer entry, not a matching message string or whichever assistant spoke next. A queued identical message cannot borrow an earlier answer. If the answer is not yet visible, it remains unconfirmed; no answer is invented. Closing the bar releases observation without stopping the agent.

`onSettled({ target, reply, ok })` fires once for the captured target when an outcome is observed. The target is detached and frozen JSON. `ok: true` means the native submission was answered, **not** that an app mutation committed; the host's domain operation is still the authority. Use the callback to refetch. `ok: false` can mean capture/transcription failure, refusal, an unconfirmed send, an unanswered submission or unavailable observation. Unknown admission is not a reason to resubmit: open chat and reconcile its original request.

## Reusing dictation

`useDictation({ transcribe, onText, locale? })` from `app-shell` exposes `phase`, `seconds`, `problem`, `start`, `finish` and `cancel`. Invoke `start` synchronously from a person's gesture. It captures that attempt's callbacks, opens a fresh capture, releases tracks on stop/cancel, supplies an AbortSignal and ignores late permission/transcription after cancellation. The shell's existing push-to-talk and target bar use this same hook.

## Verification and rollout

Run `npm run app-shell:journey:target` for the fictional static meal list at 390px and desktop, with fake browser media/transcription and a scripted native reply. The actual list refetch is exercised, but no real speech provider or meal-editing tool is qualified. Screenshots and fail-first evidence belong under `.cache/evidence/D108/`.

The already-published kit 0.4.3 lacks `submissionStatus`; use the coordinated kit patch containing this change, not new registry source over that older package. The release handoff is a kit patch, followed by Factory D-87 pins/vendor/fleet sync and a build-app note about `data-agent-target`; consumer meal/slot marking is separate work. This change does not sync consumers, publish or deploy.
