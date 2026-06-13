# xAI review — pi follow-up history projection

### Verdict: Revise

#### High Severity
- **File: packages/agent/src/front/ChatPanel.tsx**  
  **Issue: Potential race condition in follow-up posting and state updates.**  
  The `postPendingFollowUps` function is async and loops through pending items, but if `sessionId` changes mid-execution (e.g., via `useEffect` reset), it could process stale items or fail to update refs correctly. The `updatePendingMessages` callback uses `pendingMessagesRef.current`, but concurrent updates (e.g., from `onData` events) might overwrite state before the callback applies.  
  **Fix:** Add sessionId checks inside the loop in `postPendingFollowUps` to abort if session has changed. Use a more robust state update mechanism, like immer or ensuring atomicity with a lock.

- **File: packages/agent/src/front/ChatPanel.tsx**  
  **Issue: Stale logic in piMessages rebuilding and projection.**  
  `rebuildPiMessagesFromDataParts` and `mergeRebuiltPiMessages` assume data-pi-* parts are always present and correctly ordered, but if events arrive out-of-order (e.g., deltas before starts), messages could be incomplete or duplicated. The `useEffect` for rebuilding runs on every `messages` change, potentially causing excessive re-renders or loss of in-flight data.  
  **Fix:** Buffer data-pi-* parts in a ref and rebuild only on stream end (`status === 'ready'`). Add validation to skip rebuilding if parts are incomplete.

#### Medium Severity
- **File: packages/agent/src/front/ChatPanel.tsx**  
  **Issue: Inconsistent handling of projected vs. pi messages in display.**  
  `displayMessages` prioritizes `piMessages` if present, but falls back to `messages + projectedTailMessages`. If piMessages are rebuilt incorrectly, queued follow-ups might not show waiting bubbles, or statuses might mismatch (e.g., `projectedStatusById` could be stale).  
  **Fix:** Ensure `projectedFollowUps` are always merged into `piMessages` during rebuild, and clear projections only after confirmation.

- **File: packages/agent/src/server/http/routes/chat.ts**  
  **Issue: Follow-up idempotency logic may allow stale retries.**  
  The seq/nonce check in `/followup` prevents out-of-order but not concurrent duplicates if multiple requests hit simultaneously. `lastFollowUpBySession` is in-memory and not persisted, so server restarts could lose state.  
  **Fix:** Persist seq/nonce in a durable store (e.g., database) per session. Add mutex for concurrent requests.

- **File: packages/agent/src/server/harness/pi-coding-agent/createHarness.ts**  
  **Issue: Pi event emission order and seq numbering.**  
  `nextPiSeq()` increments globally per harness, but if events are interleaved across sessions, seqs might not be monotonic per message. Missing handling for tool results or reasoning if events arrive unexpectedly.  
  **Fix:** Make seq per-session or per-message. Add error handling for missing messageIds.

#### Low Severity
- **File: packages/agent/src/front/hooks/useAgentChat.ts**  
  **Issue: Persistence disable might cause data loss.**  
  With `persistMessages: false`, localStorage and server saves are skipped, but manual persistence in ChatPanel assumes piMessages are always rebuilt correctly. If rebuild fails, history is lost.  
  **Fix:** Add fallback to persist raw `messages` if piMessages rebuild fails.

- **File: packages/agent/src/front/ChatPanel.tsx**  
  **Issue: Timer and ref cleanup on session change.**  
  The `useEffect` for sessionId resets refs, but if `postPendingFollowUps` is in-flight, it might not abort cleanly, leading to stale posts.  
  **Fix:** Add an abort signal to `postPendingFollowUps` tied to sessionId.

No critical blockers (e.g., crashes), but races and staleness could cause UI inconsistencies or lost follow-ups. Revise to address high/medium issues before shipping.
