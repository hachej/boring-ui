Here is the final sign-off review of the v5 and v2 implementation plans. 

### 1. Remaining Contradictions
*   🔴 **BLOCKER: Feature Flag Strategy.** Plan 1 mandates a single flag (`features.chatCenteredShell`) for both layout and chat. Plan 2 mandates a separate flag (`features.vercelChat`). They must be unified into one flag to prevent a state where the new shell tries to render the old shadow-DOM chat, or vice versa.
*   🔴 **BLOCKER: Code Deletion Timing.** Plan 2 Phase F explicitly deletes `pi-web-ui` and its adapters. The Unified Critical Path schedules this deletion at Step 12. However, Step 18 is "Feature flag rollout." You cannot delete the fallback code before the feature flag is rolled out and validated. Deletion must be moved to a post-GA cleanup phase.

### 2. Unified Critical Path Dependency Flaws
*   🔴 **BLOCKER: Parity Feature Ordering.** Step 12 executes Plan 2 Phase F (which removes `pi-web-ui`). Step 14 builds the model selector and file attachments. You cannot remove the old UI before building the replacements. 
*   🔴 **BLOCKER: Browse Drawer Ordering.** The notes below the critical path state "step 12 must wait until step 13", but the numbered list puts 12 before 13. The sequence is broken.

### 3. Missing Acceptance Criteria
*   🔴 **BLOCKER: XSS Validation.** There is no AC verifying that malicious markdown or tool stdout (e.g., `<script>alert(1)</script>`) is safely neutralized. A build could pass with raw `dangerouslySetInnerHTML` rendering.
*   🟡 **IMPORTANT: Browser Mode Context Limit.** Plan 1 requires an 80% token warning guardrail for browser mode, but it is missing from the Acceptance Matrix. A build could pass that silently drops tokens.
*   🟡 **IMPORTANT: File Attachment Quota.** Plan 2 requires using OPFS/Cache API instead of IndexedDB for file attachments to avoid the 50MB quota. There is no AC testing large file uploads to verify IndexedDB is bypassed.

### 4. Artifact Model Completeness
*   🟡 **IMPORTANT: Missing Content/Data Field.** The `SurfaceArtifact` type definition lacks a `content`, `data`, or `value` field. It defines metadata (`id`, `status`, `dirty`) but does not define where the actual file text or chart JSON is stored.
*   🟡 **IMPORTANT: Missing Shadow Buffer.** Plan 1 states "unsaved changes are preserved in a shadow buffer" when the agent locks a file. The `SurfaceArtifact` type lacks any field (e.g., `localEdits` or `shadowBuffer`) to hold this state.

### 5. Security Mitigations
*   🔴 **BLOCKER: Dashboard Sandboxing.** Plan 1 states "dashboard renderers... should use a sandboxed iframe or DOMPurify at minimum." DOMPurify strips `<script>` tags, which will break any dashboard requiring JS execution. Dashboards *must* use a sandboxed iframe with `sandbox="allow-scripts"` (and explicitly NOT `allow-same-origin`). DOMPurify is not a valid alternative here.
*   🟢 **NICE-TO-HAVE: Blob URL Leakage.** Plan 2 mentions revoking Blob URLs after usage. React strict mode and unmount lifecycles make this prone to memory leaks. Explicitly mandate a `useEffect` cleanup pattern for Blob URL revocation.

### 6. Single Biggest Risk
*   🟡 **IMPORTANT: Session Switching During Active Streams.** Plan 2 notes that `agent.abort()` is not yet implemented. If a user switches sessions while the agent is streaming, the background stream will either cross-contaminate the newly selected session's UI or silently burn tokens. The transport layer must explicitly handle component unmounts/session changes by severing the stream if `abort()` is unavailable.

### 7. Sign-off vs. Send Back
**What I sign off on:**
*   The product direction and UX mental model (Stage + Wings).
*   The architectural choice to replace `pi-web-ui` with Vercel `useChat`.
*   The dual-transport strategy (Browser vs. Server mode).
*   The visual/CSS token integration strategy.

**What I send back for revision:**
*   Fix the Unified Critical Path: Move all code deletion (`pi-web-ui`, legacy adapters) to a new Step 20 (Post-GA Cleanup).
*   Resolve the feature flag naming contradiction.
*   Update the `SurfaceArtifact` type definition to include content and shadow buffer fields.
*   Add the missing Acceptance Criteria (XSS, Context Limits, OPFS storage).
*   Correct the dashboard security mitigation to mandate sandboxed iframes.