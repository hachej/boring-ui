# Staged fictional triage notes

This host example composes native Pi tasks and the kit's additive chat render seams. It is not a kit workflow or medical application. Every note is fictional and deliberately contains no dosing recommendation.

```sh
npm ci
npm run build
npm run staged-chat
# In another terminal, with CHROMIUM pointing to a headless Chromium binary:
npm run staged-chat:journey
```

Two conversations, **Questions** and **Senior**, use independent controllers on one page. Send `Quelle dose pour un adulte ?` in Questions. The local scripted provider asks for stages 1, 2 and 3 sequentially. Each native tool starts a native task; that task creates a task-owned conversation, generates and validates its result, then atomically appends its validated native assistant message, stage entry and terminal outcome. Earlier validated text is not rewritten. A native context edit omits each published stage message from the coordinator's model context, while retaining it in the raw transcript for display; otherwise it would look like the coordinator's final assistant round and end the sequence early. The coordinator receives the ordinary tool result instead. Pi owns execution, waiting, cancellation and recovery; this trusted host owns the stage sequence and validation rule. No agent-written code is imported into the host.

The host's `fictional.triage.stage` entries supply an inline card and the single natural status. The host projects each task's latest state onto its first entry's stable display key, so one badge changes in place; repeated stage numbers in different questions remain distinct. Raw native entries are never rewritten or deleted. `durationMs` is copied from the generated native message; the kit sums all displayed merged model rounds, including the tool-only and empty rounds of the requesting agent. The fixture opts into `createScriptedModel({ timed: true })`: current message timestamps let Pi's public event stream measure its native per-round `durationMs`; default deterministic fixtures remain untimed. The footer hides absent/zero timing and formats recorded values with `Intl.NumberFormat` under the plain “Durée” label (for example `1,6 s`). This is model generation time, **not** end-to-end stage latency. A host that prefers its stage metric can read the stage entry's `data.durationMs` and override the displayed value in `replyFooter` without changing native state.

## Rendering contract

- `hideLine={line => line.startsWith('::meta ')}` is this host's marker grammar, not a trusted control protocol. It filters assistant text in current and paged history before rendering, copy, message actions and footers. User text and native state are unchanged. With filtering enabled, an unterminated **live** trailing line waits for a newline or message settlement; settlement makes its final line complete. The predicate receives the line without LF/CRLF. This intentionally delays ordinary incomplete prose too, so a split marker cannot flash while it is still arriving. It is presentation filtering, not transport or storage redaction.
- `renderEntry` returns `{ inline: true, content, status }`. Inline entries survive expert/natural presentation, stay in order inside a growing answer and do not break its merge. `status` supplies wording for the existing single natural status while native work is active; the latest supplied value wins, and `null` clears host wording. A stale stage label cannot manufacture an active run. A terminal failure leaves a plain failure note and earlier text. Required cards retain their existing independent pinning.
- `displayLimit={24}` bounds the initial **display rows**, not stored native entries, messages or nested card DOM. An explicit display limit uses **Show earlier** rather than automatic intersection paging, so mounting a transcript cannot immediately expand past the cap. Nothing is deleted. The default remains 60 rows; native paging and host retention are unchanged.
- `historicalMessageActions` opts paged historical answers into `messageActions`. Default history remains action-free. Fork, question decisions, command execution and ambient feedback are not revived by this option. The host must reauthorize its offer at action time.
- `replyError(reply)` supplies the message inside the single native response-error notice. Null/undefined keeps its default; the native error state, round durations and reply identity are unchanged. Here the host uses the failed stage to distinguish an empty first-stage failure from a later failure that retains a note.
- `unread(reply)` is a host-rendered slot aligned with its reply. The host keys seen state on `reply.entryId ?? reply.key`; rendering or scrolling never marks it seen. Here a named button writes the host's seen key into a native conversation document. The offer counter is also host-owned application state in that document, not a second transcript. Both survive browser reload. The counter uses locale label functions and `Intl.PluralRules`; `?lang=en` exercises the English labels.

## Failure controls

The two demo controls select failure state while sending the person's unadorned question, with `send(..., { restore: { text: question } })`. The existing remote `requestContext` carries that demo choice to the loopback host. A native conversation decorator attaches it to Pi's public `InputSubmissionDraft.entry.data`; the tool reads the latest native user entry's metadata. Neither the visible question nor its model text contains a synthetic test trigger. This is fictional host input policy, not a new transport or scheduler.

- **Échec étape 1:** validation refuses the first task. The requesting native generation settles in error without answer text. `createNativeChatController({ restoreOnError: true, ... })` puts the question back before any later typing, retaining attachments and request identity. It never resubmits automatically.
- **Échec étape 2:** stage 1 has already been published. Its native text stays; stage 2's refused text never appears. The composer is not restored.

`restoreOnError` is off by default and local to the live controller. It observes the original native submission and scans a bounded native entry range for any assistant text; even hidden marker text counts. A later, unrelated answer does not suppress restoration of an earlier empty error. It restores only native `model_error`, `no_model` or `faulted` unanswered settlements with a placed input and no observed/retained text. Cancellation, unknown admission, disconnection, missing history and failed observation are not proof of an empty failed answer. `reconcile` continues to use the original request, without replay. Disposal cancels only this controller's observation, never native execution. Hosts using projected transports must make the required authorized settlement/history evidence available; otherwise restoration conservatively remains unavailable.

## Qualification and boundaries

The server is a loopback-only, unauthenticated fictional fixture. It seeds synthetic history directly into native entries so Show earlier can be exercised. `MemoryStorage` survives browser reload while the server runs, **not** process restart; production storage, authentication, revocation, retention and recovery qualification belong to the host. The native tasks checkpoint their own progress; no second scheduler or transcript store is introduced.

- `test/contracts/pi-chat-staged.test.mjs`: public PiChat/AmbientChat happy-dom rendering seams and independence.
- `test/contracts/staged-chat-demo.test.mjs`: actual recipe DOM, stable task markers, one tailored failure notice, localized labels/timing, a single heading and clean submitted questions.
- `test/packages/ui-native-chat.test.mjs`: actual native restoration and existing admission/lifecycle behavior.
- `test/examples/staged-chat.test.mjs`: actual sequential native tasks, stage validation and both failures.
- `test/ui/pi-chat-stick-to-bottom.test.mjs`: modelled layout and stage-append scroll preservation.
- `examples/staged-chat/journey.mjs`: separate real phone/desktop browser proof. Screenshots/results go to `.cache/evidence/D72/`.

These are scripted fictional-model plumbing checks, not real-model judgment, medical validation, deployment approval or full product qualification.
