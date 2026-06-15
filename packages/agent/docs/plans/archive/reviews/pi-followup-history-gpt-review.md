# GPT Plan Review — pi-followup-history-projection.md

## Top 5 Risks / Ambiguities

1. **Message identity + de‑duplication is underspecified**
   - `messageId: string` is mentioned, but the spec does not define *who* generates IDs (pi vs. adapter), their stability across reconnects, or how they relate to AI SDK `id`s.
   - De‑duplication rules only reference duplicate user `message_start` events; assistant duplicates, retries, or reconnections aren’t covered.

2. **User text matching for queued → consumed mapping is brittle**
   - Rule 3 relies on `find the first queued projected user with same text`. That will break for:
     - minor text normalization differences (trimming, newline handling, markdown transforms).
     - retries / resubmits with identical text.
     - future support for edited messages.
   - This is dangerous for correctness of the FIFO mapping and may cause visibly wrong pairings.

3. **Projection vs. AI SDK history boundary is fuzzy**
   - Phase 1 rendering says: "render AI SDK messages before the first projected follow-up if needed" and later "projection may be folded back into persisted history."
   - It doesn’t specify:
     - when exactly projection becomes authoritative (first follow-up queued? first `data-pi-message-*` received?).
     - how to avoid double-rendering or gaps if AI SDK reconstruction disagrees with the pi projection.
     - how persisted history is updated/merged when the page reloads.

4. **Error/reconnect and partial-stream behavior is not covered**
   - The spec does not state what happens when:
     - the HTTP stream is cut mid‑follow‑up and the browser later reconnects and reloads prior session history.
     - `pi-message-start` arrives but `pi-message-end` never does.
     - `data-pi-message-*` events arrive out of order.
   - Without explicit ordering and recovery rules, history projection can diverge from true pi session state.

5. **Follow-up execution ordering vs. UI FIFO semantics**
   - UI plans a straightforward FIFO queue (`PendingFollowUp[]`) and assumes pi will execute in the same strict order.
   - Spec doesn’t state whether pi guarantees:
     - single-threaded, in-order execution of follow-ups under all modes (direct/local/remote).
     - no cross-turn interleaving of assistant messages from different queued follow-ups.
   - If pi ever supports concurrency or partial interleaving, the current projection model will misrepresent order.

## Must-Change / Clarifying Amendments

1. **Define message ID ownership and stability**
   - Explicitly specify that `PiHistoryEvent.messageId` is generated and owned by pi, stable for a given message within a session, and monotonically ordered per turn.
   - Clarify whether the browser may assume increasing order, and how to map (or not map) these IDs to AI SDK message IDs.

2. **Replace text-based user matching with ID‑based mapping**
   - Change Rule 3 to associate queued user messages with a stable client-side `PendingFollowUp.id`, then have the server echo a `clientMessageId` (or similar) in `pi-message-start` for consumed user messages.
   - This removes dependence on text equality, supports duplicate texts, and leaves room for future message edits.

3. **Tighten the authority boundary and fold‑back rules**
   - Add precise rules for when the client switches from AI SDK `messages` to the projection tail (e.g. "after the first `data-pi-message-start` for a follow-up in this session").
   - Specify how to construct canonical history on reload (e.g. from server-side persisted pi session projection only) so the hybrid phase doesn’t create divergent views.

4. **Specify ordering, error, and reconnection semantics**
   - Document that `PiHistoryEvent`s are strictly ordered within a stream and describe the client behavior on missing `message_end` (e.g. time out to `status: 'done'` with a warning, or keep as `streaming` but visually stable).
   - Define behavior on stream interruption: whether the client should discard local projection and refetch canonical history, or attempt to reconcile.
   - Mention how to handle obviously out-of-order or duplicate events (idempotency expectations for each event type).

5. **Document execution-order guarantees (or constraints) for follow-ups**
   - If pi guarantees serial, FIFO execution of follow-ups within a session, state this explicitly so the UI projection is known-correct.
   - If not, update the projection model to support tags/parent IDs or per-follow-up threads so interleaving can be represented faithfully.

## Verdict

Concept and direction are sound: leveraging pi as the single source of truth for follow-up history while gradually layering over AI SDK is a good migration path. However, the current spec underdefines identity, ordering, and failure/reconnect behavior. Those gaps are high-risk for subtle history divergence bugs.

**Verdict: revise before implementation.** Tighten the identity/ordering/error semantics and remove text-based matching before treating this spec as implementation-complete.
