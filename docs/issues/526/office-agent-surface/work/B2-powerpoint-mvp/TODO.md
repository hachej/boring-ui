# B2 — PowerPoint MVP TODO

### B2-001 — Add PowerPoint Context And Read Tools — M

- **Goal:** Give the agent safe read context for decks and selected slides.
- **Landing repo:** `hachej/pi-for-office`.
- **Files to touch/create:**
  - `src/hosts/powerpoint/powerpoint-document-host.ts`
  - `src/hosts/powerpoint/powerpoint-context.ts`
  - `src/tools/powerpoint/get-deck-outline.ts`
  - `src/tools/powerpoint/get-selected-slide-context.ts`
  - `src/prompts/powerpoint-system-prompt.ts`
  - `tests/powerpoint-context.test.ts`
- **Steps:**
  1. Implement PowerPoint host `run` wrapper using `PowerPoint.run`.
  2. Implement deck outline read: slide count, slide ids, titles when available, and layout names when available.
  3. Implement selected-slide context: selected slide id, visible text snippets, selected shapes when available, and safe fallback when no slide is selected.
  4. Add PowerPoint system prompt text that avoids Excel concepts.
  5. Inject slide-blueprint context into the agent prompt path.
  6. Add tests for empty deck, normal deck, and no-selection fallback.
- **VERIFICATION:**
  - `cd ~/projects/pi-for-office && pnpm test -- powerpoint-context` — exits 0; read context tests pass.
  - `cd ~/projects/pi-for-office && pnpm typecheck` — exits 0.
  - `cd ~/projects/pi-for-office && pnpm build` — exits 0.
- **Acceptance criteria:**
  - PowerPoint read tools do not call Excel APIs.
  - Empty deck and no-selection states return stable, actionable messages.
  - Prompt context uses slide/deck language.
  - No mutation tools are required for this bead.
- **Estimated size:** M.

### B2-002 — Add Slide Mutation Tools — L

- **Goal:** Implement the basic slide operations within PowerPointApi 1.10 scope.
- **Landing repo:** `hachej/pi-for-office`.
- **Files to touch/create:**
  - `src/tools/powerpoint/add-slide.ts`
  - `src/tools/powerpoint/delete-slide.ts`
  - `src/tools/powerpoint/move-slide.ts`
  - `src/tools/powerpoint/apply-slide-layout.ts`
  - `src/hosts/powerpoint/powerpoint-mutation-coordinator.ts`
  - `tests/powerpoint-slide-mutations.test.ts`
- **Steps:**
  1. Implement add slide with explicit target index and optional layout.
  2. Implement delete slide by stable slide id.
  3. Implement move slide by stable slide id and target index.
  4. Implement apply layout by stable slide id and known layout name/id.
  5. Route all mutations through the PowerPoint mutation coordinator.
  6. Return stable error codes for missing slide, invalid index, invalid layout, and Office API failure.
  7. Add tests for each success and error path.
- **VERIFICATION:**
  - `cd ~/projects/pi-for-office && pnpm test -- powerpoint-slide-mutations` — exits 0; slide mutation tests pass.
  - `cd ~/projects/pi-for-office && pnpm typecheck` — exits 0.
- **Acceptance criteria:**
  - Every mutation targets slides by stable id or explicit index.
  - Every failure has a stable code.
  - Mutations do not expose workbook/cell concepts.
  - Recovery hook from B2-004 is called for every mutating path.
- **Estimated size:** L.

### B2-003 — Add Shape, Text, Image, And Table Tools — L

- **Goal:** Cover the content operations needed for useful slide drafting.
- **Landing repo:** `hachej/pi-for-office`.
- **Files to touch/create:**
  - `src/tools/powerpoint/insert-textbox.ts`
  - `src/tools/powerpoint/insert-image.ts`
  - `src/tools/powerpoint/insert-table.ts`
  - `src/tools/powerpoint/edit-text-range.ts`
  - `src/hosts/powerpoint/powerpoint-shapes.ts`
  - `tests/powerpoint-shape-tools.test.ts`
- **Steps:**
  1. Implement insert textbox with slide id, bounds, and text.
  2. Implement insert image with slide id, image bytes/base64 source, bounds, and alt text.
  3. Implement insert table with slide id, bounds, row data, and simple header option.
  4. Implement text-range edits for replace text, append text, and basic formatting supported by the API.
  5. Validate bounds and content size before calling Office APIs.
  6. Add tests for success, invalid bounds, missing slide, and unsupported content.
- **VERIFICATION:**
  - `cd ~/projects/pi-for-office && pnpm test -- powerpoint-shape-tools` — exits 0; shape/content tests pass.
  - `cd ~/projects/pi-for-office && pnpm typecheck` — exits 0.
- **Acceptance criteria:**
  - Tools can create textbox, image, and table content on a slide.
  - Text edits are scoped to a supplied slide/shape/text range target.
  - Tool outputs redact image data and do not echo large base64 payloads.
  - No chart, animation, speaker-note, or calc behavior is added.
- **Estimated size:** L.

### B2-004 — Add Visual Verification And Recovery Checkpoints — M

- **Goal:** Make PowerPoint edits inspectable and recoverable.
- **Landing repo:** `hachej/pi-for-office`.
- **Files to touch/create:**
  - `src/tools/powerpoint/get-slide-image.ts`
  - `src/hosts/powerpoint/powerpoint-recovery.ts`
  - `src/workbook/recovery-log.ts`
  - `tests/powerpoint-visual-recovery.test.ts`
- **Steps:**
  1. Implement `get_slide_image` using the PowerPoint slide image API.
  2. Return image metadata and a safe image payload reference; do not dump large image bytes into logs.
  3. Add slide snapshot/export checkpoints before and after each PowerPoint mutation.
  4. Add recovery-log entries that identify slide id, operation, timestamp, and snapshot reference.
  5. Add tests for image success, image failure, checkpoint creation, and redaction.
- **VERIFICATION:**
  - `cd ~/projects/pi-for-office && pnpm test -- powerpoint-visual-recovery` — exits 0; visual/recovery tests pass.
  - `cd ~/projects/pi-for-office && pnpm typecheck` — exits 0.
- **Acceptance criteria:**
  - Agent can request a slide image after edits.
  - Mutations write recovery checkpoints.
  - Recovery output excludes auth material and oversized image payloads.
  - Existing Excel recovery tests still pass.
- **Estimated size:** M.

### B2-005 — Prove Connector Reuse And `.pptx.cloud.json` Validity — M

- **Goal:** Verify the A2 connector works unchanged from PowerPoint.
- **Landing repo:** `hachej/pi-for-office`, with evidence copied into boring-ui A2/A3 docs if needed.
- **Files to touch/create:**
  - `tests/powerpoint-boring-connector.test.ts`
  - `docs/powerpoint-boring-connector.md`
  - `docs/live-powerpoint-smoke.md`
- **Steps:**
  1. Load the A2 `boring-connector.mjs` without modifying the file.
  2. Mock the PowerPoint extension runtime and assert the same four boring tools register.
  3. Save a `.pptx.cloud.json` ref shape and validate it against boring-sharepoint schema expectations.
  4. Run a manual PowerPoint sideload smoke with the connector installed from the self-hosted URL.
  5. Record proof with redacted screenshots/transcripts.
- **VERIFICATION:**
  - `cd ~/projects/pi-for-office && pnpm test -- powerpoint-boring-connector` — exits 0; connector reuse tests pass.
  - `cd ~/projects/pi-for-office && rg -n "pptx.cloud.json|self-host|boring-connector" docs/powerpoint-boring-connector.md docs/live-powerpoint-smoke.md` — prints all required terms.
  - Manual: connector registers the same four boring tools in PowerPoint.
- **Acceptance criteria:**
  - A2 connector source is unchanged.
  - `.pptx.cloud.json` validates against the boring-sharepoint document-ref shape.
  - Manual proof excludes tokens, cookies, tenant secrets, and raw auth headers.
  - Boring-ui changes are not required for this bead.
- **Estimated size:** M.

