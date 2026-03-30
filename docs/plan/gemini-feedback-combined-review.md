This is a highly rigorous, well-researched pair of implementation plans. The product mental model in Plan 1 ("Chat is session-scoped, Surface is workspace-persistent") is exactly the right paradigm shift. Plan 2’s discovery that `pi-coding-agent` is Node-only likely saved the team a month of wasted effort. 

However, as a Principal Engineer looking at how these two plans will collide in `main`, there are severe integration gaps, architectural traps, and phasing deadlocks that will bite us in production. 

Here is my brutally specific review.

---

### 1. CONSISTENCY: Collisions Between The Plans

**A. The "Who Owns Session State?" Contradiction**
*   **Plan 1 (Architecture B)** dictates a top-level React state: `ChatCenteredShellState` owns `chat.activeSessionId`.
*   **Plan 2 (Phase D)** dictates that session management is delegated to `pi-coding-agent` (JSONL) or IndexedDB, and the UI reads from there.
*   **The Gap:** Vercel's `useChat` manages its own internal `messages` state. If Plan 1's shell state, Plan 2's transport layer, and Vercel's `useChat` all think they own the active session, you will get infinite re-renders and race conditions when switching sessions. 
*   **Fix:** Explicitly define the unidirectional data flow. The backend/storage is the source of truth. The Shell State holds the *pointer* (`activeSessionId`). `useChat` is a *controlled* consumer that gets re-initialized (or uses the `id` prop to reset its internal state) when the pointer changes.

**B. The Tool vs. Artifact Routing Disconnect**
*   **Plan 1 (Phase 5)** says: "adapt `openFile` to create/focus `code` artifacts" via the `useSurfaceArtifacts` controller.
*   **Plan 2 (Phase E)** says: "Keep `open_file`... as custom tools. Tool results flow through the standard AI SDK tool-result rendering."
*   **The Gap:** If Vercel AI SDK is rendering the tool result in the chat timeline, how does the Surface know to open? 
*   **Fix:** Plan 2 must explicitly state that the custom React components for Vercel's `toolInvocations` (e.g., `ToolCallCard.jsx`) will fire events to Plan 1's `ArtifactController`. The AI SDK handles the *timeline rendering*, but the *side-effect* of opening the Surface must be explicitly bridged.

### 2. ARCHITECTURE: Soundness & Traps

**A. The "Dockview Inside the Surface" Trap (Plan 1, Section F)**
*   Plan 1 suggests keeping Dockview *inside* the Surface for tab management and split views to save time. 
*   **Do not do this.** Dockview relies heavily on DOM measurements, ResizeObservers, and absolute positioning. Putting it inside a floating, animated, resizable React island (the Surface) will cause severe z-index clipping, layout thrashing, and focus-trap bugs. 
*   **Fix:** You are already migrating to `shadcn/ui`. Use `react-resizable-panels` (which shadcn wraps natively) for split views, and standard React state for tabs. Rip Dockview out entirely. The "time saved" keeping it will be lost 3x over debugging resize bugs.

**B. The Browser vs. Server State Fork (Plan 2, Transport Architecture)**
*   Plan 2 correctly identifies that Server mode gets JSONL/compaction/branching, while Browser mode gets IndexedDB/no-compaction. 
*   **The Trap:** How does the `SessionDrawer` (Plan 1) display sessions if the user toggles between Browser and Server modes? Do their sessions disappear? 
*   **Fix:** You need a unified `SessionProvider` interface in the frontend that abstracts the storage mechanism. If a user switches modes, the UI must clearly indicate which workspace/storage context they are looking at, or you must build a sync mechanism.

**C. Vercel AI SDK vs. Branching (Plan 2, Phase D)**
*   Plan 2 mentions "Branching available for future `/branch` command."
*   **The Trap:** Vercel's `useChat` is strictly designed for linear, single-thread arrays of messages. It does *not* natively support tree-based branching without heavy, hacky overrides of the `setMessages` function.
*   **Fix:** Drop branching from the v1 scope of Plan 2, or acknowledge that implementing it will require bypassing `useChat`'s standard state management.

### 3. PRODUCT: UX Blindspots

**A. Streaming Artifacts**
*   Plan 1 says the Surface opens when an artifact is created. But LLMs stream code. If the agent is writing a 200-line file, does the Surface open immediately and stream the text into the editor? Or does it wait until the tool call finishes?
*   **Fix:** Define the "Pending/Streaming Artifact" UX. The Surface should open immediately, and the editor tab should show the code streaming in real-time. Vercel AI SDK supports streaming tool arguments—use this to feed the Surface renderer.

**B. Race Conditions on the Workbench**
*   What happens if the user is typing in a Surface code artifact, and the agent simultaneously decides to execute an `edit_file` tool on the same file?
*   **Fix:** The Artifact Controller (Plan 1, Architecture C) needs a `lock` or `isAgentEditing` boolean. If the agent is writing, the Surface viewer goes into a read-only "Agent is typing..." state to prevent cursor collisions.

### 4. PHASING: Execution Deadlocks

The phases across the two plans are currently deadlocked. Plan 1 Phase 3 requires Plan 2 Phase C. But Plan 2 Phase C requires the shell from Plan 1 Phase 1. 

**Here is the optimal, unified execution order:**

1.  **Headless Transport (Plan 2: A, B):** Build the `PiCodingAgentTransport` and `PiAgentCoreTransport` in isolation. Unit test the event mapping.
2.  **The Empty Shell (Plan 1: 0, 1, 2):** Build the Chat-Centered shell, Nav Rail, and Artifact Controller behind a feature flag. *No chat yet.*
3.  **Mount Chat (Plan 1: 3 + Plan 2: C, D):** Drop Vercel `useChat` into the new shell. Wire it to the headless transports. Wire the session list.
4.  **The Surface (Plan 1: 4, 5 + Plan 2: E):** Build the Surface. Wire the Vercel AI SDK tool invocations to trigger the Artifact Controller.
5.  **Browse & Parity (Plan 1: 6 + Plan 2: G):** Build the Browse Drawer. Add the Model Selector and File Attachments.
6.  **Hardening (Plan 2: F, H):** XSS sanitization, DOMPurify, Telemetry.
7.  **Polish & Rollout (Plan 1: 7-10 + Plan 2: I, J):** Persistence, CSS polish, baseline tests, and flag flip.

### 5. MISSING: Production Biters

*   **Token Limit Crashes in Browser Mode:** Plan 2 notes browser mode has no compaction. If a user opens 5 large files in the Surface, and the Artifact Controller blindly feeds them into the `pi-agent-core` context, the browser will hit the token limit and silently fail. **Fix:** Implement a hard token-estimation guardrail in the UI for Browser mode that prevents adding artifacts to context if it exceeds the window.
*   **IndexedDB Quota Blowouts:** Plan 2 lists IndexedDB quota as a "Low" risk. If you implement File Attachments (Plan 2 Phase G) and users upload PDFs or images in Browser mode, Base64 encoding them into IndexedDB will blow the 50MB quota instantly. **Fix:** Store files in the Origin Private File System (OPFS) or standard Cache API, not IndexedDB.
*   **Unmounting Heavy Renderers:** Plan 1 says "Surface open/close animations should not trigger layout thrash." If you use standard React conditional rendering (`{isOpen && <Surface/>}`), you will unmount the Monaco editor/charts every time the user toggles the Surface, destroying local state. **Fix:** The Surface must be `display: none` or translated off-screen when closed, *not* unmounted.

### 6. WHAT'S GREAT: What most teams miss

*   **The Mental Model (Plan 1):** Separating the chat timeline (session-scoped) from the artifact workbench (workspace-persistent) is a masterstroke. Most teams just shove everything into the chat timeline, which becomes an unusable scrolling nightmare. This is a world-class product decision.
*   **The Node.js Catch (Plan 2):** Catching that `pi-coding-agent` relies on Node built-ins *before* writing code is exactly why we do technical design. You saved the company weeks of refactoring.
*   **Canonical Key Deduplication (Plan 1):** Using `canonicalKey` to deduplicate artifacts rather than relying on panel IDs or message IDs is incredibly robust. It ensures the UI reflects the actual state of the workspace, not the history of the conversation.

---

### Prioritized Action List for the Team

1.  **Update Plan 1, Section F:** Explicitly ban Dockview from the new shell. Mandate `react-resizable-panels` for Surface splits.
2.  **Merge the Timelines:** Rewrite the Execution Plan sections of both documents into a single, unified critical path (as outlined in section 4 above) so frontend and backend engineers aren't blocking each other.
3.  **Define the Tool -> Artifact Bridge:** Add a specific section detailing exactly how a Vercel `useChat` tool invocation triggers the `useSurfaceArtifacts` state hook.
4.  **Add Streaming & Locking UX:** Define the visual state for an artifact that is currently being streamed/edited by the agent.
5.  **Update Storage Strategy:** Move file attachment storage out of IndexedDB to prevent quota crashes in browser mode.