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
  - `cd ~/projects/pi-for-office && npm run test:context -- tests/powerpoint-context.test.ts` — exits 0; read context tests pass.
  - `cd ~/projects/pi-for-office && npm run check` — exits 0.
  - `cd ~/projects/pi-for-office && npm run build` — exits 0.
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
  6. Expose a typed pre/post mutation checkpoint extension point; B2-004 owns hook enforcement.
  7. Return stable error codes for missing slide, invalid index, invalid layout, and Office API failure.
  8. Add tests for each success and error path.
- **VERIFICATION:**
  - `cd ~/projects/pi-for-office && npm run test:context -- tests/powerpoint-slide-mutations.test.ts` — exits 0; slide mutation tests pass.
  - `cd ~/projects/pi-for-office && npm run check` — exits 0.
- **Acceptance criteria:**
  - Every mutation targets slides by stable id or explicit index.
  - Every failure has a stable code.
  - Mutations do not expose workbook/cell concepts.
  - PowerPoint mutation coordinator exposes a recovery-checkpoint extension point for B2-004.
- **Estimated size:** L.

### B2-003 — Add Shape, Text, And Table Tools — L

- **Goal:** Cover the non-preview content operations needed for useful slide drafting.
- **Landing repo:** `hachej/pi-for-office`.
- **Files to touch/create:**
  - `src/tools/powerpoint/insert-textbox.ts`
  - `src/tools/powerpoint/insert-table.ts`
  - `src/tools/powerpoint/edit-text-range.ts`
  - `src/hosts/powerpoint/powerpoint-shapes.ts`
  - `tests/powerpoint-shape-tools.test.ts`
- **Steps:**
  1. Implement insert textbox with slide id, bounds, and text.
  2. Implement insert table with slide id, bounds, row data, and simple header option.
  3. Implement text-range edits for replace text, append text, and basic formatting supported by the API.
  4. Defer image insertion unless the owner explicitly accepts preview-only `ShapeCollection.addPicture`.
  5. Validate bounds and content size before calling Office APIs.
  6. Add tests for success, invalid bounds, missing slide, and unsupported content.
- **VERIFICATION:**
  - `cd ~/projects/pi-for-office && npm run test:context -- tests/powerpoint-shape-tools.test.ts` — exits 0; shape/content tests pass.
  - `cd ~/projects/pi-for-office && npm run check` — exits 0.
- **Acceptance criteria:**
  - Tools can create textbox and table content on a slide.
  - Text edits are scoped to a supplied slide/shape/text range target.
  - Image insertion is documented as preview-gated/deferred, not required for MVP.
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
  3. Hook into the B2-002 mutation-coordinator extension point and add slide snapshot/export checkpoints before and after each PowerPoint mutation.
  4. Add recovery-log entries that identify slide id, operation, timestamp, and snapshot reference.
  5. Add tests for image success, image failure, checkpoint creation, and redaction.
- **VERIFICATION:**
  - `cd ~/projects/pi-for-office && npm run test:context -- tests/powerpoint-visual-recovery.test.ts` — exits 0; visual/recovery tests pass.
  - `cd ~/projects/pi-for-office && npm run check` — exits 0.
- **Acceptance criteria:**
  - Agent can request a slide image after edits.
  - Mutations write recovery checkpoints.
  - Recovery output excludes auth material and oversized image payloads.
  - Existing Excel recovery tests still pass.
- **Estimated size:** M.

### B2-005 — Generalize Connector Office Ref Saving — S

- **Goal:** Make `boring_save_cloud_ref` handle explicit Office ref kinds before PowerPoint proof.
- **Landing repo:** `hachej/boring-ui`.
- **Files to touch/create:**
  - `integrations/pi-for-excel/boring-connector.mjs`
  - `integrations/pi-for-excel/tests/cloud-ref-validator.test.ts`
  - `integrations/pi-for-excel/README.md`
- **Steps:**
  1. Add an explicit `officeKind` input with `excel` as the default and `powerpoint` as the only added value.
  2. Keep `.xlsx.cloud.json` validation unchanged for Excel refs.
  3. Allow `.pptx.cloud.json` only when `officeKind` is `powerpoint`.
  4. Validate both ref shapes against boring-sharepoint expectations.
  5. Do not add PowerPoint host-specific logic to list/read/note tools.
- **VERIFICATION:**
  - `pnpm --filter @hachej/boring-integration-pi-for-excel --fail-if-no-match run test -- cloud-ref-validator` — exits 0; Office ref validation tests pass.
  - `pnpm --filter @hachej/boring-sharepoint run test` — exits 0.
- **Acceptance criteria:**
  - Excel ref behavior is unchanged.
  - PowerPoint refs require explicit `officeKind:"powerpoint"`.
  - `.pptx.cloud.json` validates through the boring-sharepoint validator.
  - No token, cookie, OAuth artifact, preview URL, or absolute local path enters refs.
- **Estimated size:** S.

### B2-006 — Prove Connector Reuse And `.pptx.cloud.json` Validity — M

- **Goal:** Verify connector list/read/note behavior works unchanged from PowerPoint and generalized refs validate.
- **Landing repo:** `hachej/pi-for-office`, with evidence copied into boring-ui A2/A3 docs if needed.
- **Files to touch/create:**
  - `tests/powerpoint-boring-connector.test.ts`
  - `docs/powerpoint-boring-connector.md`
  - `docs/live-powerpoint-smoke.md`
- **Steps:**
  1. Load the B2-005 generalized `boring-connector.mjs` without PowerPoint-host-specific edits.
  2. Mock the PowerPoint extension runtime and assert the same four boring tools register.
  3. Prove list/read/note tool behavior is unchanged.
  4. Save a `.pptx.cloud.json` ref through the explicit `officeKind:"powerpoint"` path and validate it against boring-sharepoint schema expectations.
  5. Run a manual PowerPoint sideload smoke with the connector installed from the self-hosted URL.
  6. Record proof with redacted screenshots/transcripts.
- **VERIFICATION:**
  - `cd ~/projects/pi-for-office && npm run test:context -- tests/powerpoint-boring-connector.test.ts` — exits 0; connector reuse tests pass.
  - `cd ~/projects/pi-for-office && rg -n "pptx.cloud.json|self-host|boring-connector" docs/powerpoint-boring-connector.md docs/live-powerpoint-smoke.md` — prints all required terms.
  - Manual: connector registers the same four boring tools in PowerPoint.
- **Acceptance criteria:**
  - List/read/note behavior is unchanged.
  - PowerPoint ref saving uses the explicit Office-ref generalization, not the Excel-only path.
  - `.pptx.cloud.json` validates against the boring-sharepoint document-ref shape.
  - Manual proof excludes tokens, cookies, tenant secrets, and raw auth headers.
  - No PowerPoint host code is added to the connector.
- **Estimated size:** M.
