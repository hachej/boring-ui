# B1 — Host Seam Fork TODO

### B1-001 — Create Controlled Fork And Discipline Docs — M

- **Goal:** Establish `hachej/pi-for-office` with upstream merge rules.
- **Landing repo:** `hachej/pi-for-office`.
- **Files to touch/create:**
  - `docs/fork-discipline.md`
  - `README.md`
  - `.github/pull_request_template.md`
- **Steps:**
  1. Create or verify the GitHub fork `hachej/pi-for-office` from `tmustier/pi-for-excel`.
  2. Clone it to `~/projects/pi-for-office`.
  3. Set `origin` to `git@github.com:hachej/pi-for-office.git`.
  4. Add `upstream` as `https://github.com/tmustier/pi-for-excel.git`.
  5. Fetch upstream `main`.
  6. Create branch `office/526-b1-host-seam` from upstream `main`.
  7. Add `docs/fork-discipline.md` with upstream merge cadence, new-host directory rule, and shared-file edit rule.
  8. Add PR template checklist requiring upstream merge proof and shared-file justification.
- **VERIFICATION:**
  - `cd ~/projects/pi-for-office && git remote -v` — prints `origin` for `hachej/pi-for-office` and `upstream` for `tmustier/pi-for-excel`.
  - `cd ~/projects/pi-for-office && git branch --show-current` — prints `office/526-b1-host-seam`.
  - `cd ~/projects/pi-for-office && rg -n "upstream|shared-file|new hosts" docs/fork-discipline.md .github/pull_request_template.md` — prints all three rules.
- **Acceptance criteria:**
  - Fork has both remotes.
  - Branch starts from upstream `main`.
  - Fork docs make divergence control explicit.
  - No source code changes are included in this bead.
- **Estimated size:** M.

### B1-002 — Add `DocumentHost` Contract And Excel Adapter — L

- **Goal:** Route existing Excel behavior through a host seam without changing behavior.
- **Landing repo:** `hachej/pi-for-office`.
- **Files to touch/create:**
  - `src/hosts/document-host.ts`
  - `src/hosts/excel/excel-document-host.ts`
  - `src/excel/helpers.ts`
  - `src/workbook/context.ts`
  - `src/context/selection.ts`
  - `src/context/change-tracker.ts`
  - `src/workbook/coordinator.ts`
  - `src/workbook/recovery-log.ts`
  - `src/tools/mutation/finalize.ts`
  - `tests/document-host-excel.test.ts`
- **Steps:**
  1. Define `DocumentHost` with methods for `run`, document context, selection snapshot, change tracking, mutation coordination, and recovery checkpoint support.
  2. Implement `ExcelDocumentHost` by wrapping the existing Excel modules.
  3. Replace direct imports of the five host-coupled joints with calls through the Excel host adapter.
  4. Keep public tool names and prompt behavior unchanged.
  5. Add tests proving Excel host calls the same underlying behavior as before.
  6. Do not implement PowerPoint tools in this bead.
- **VERIFICATION:**
  - `cd ~/projects/pi-for-office && npm run test:context -- tests/document-host-excel.test.ts` — exits 0; Excel adapter tests pass.
  - `cd ~/projects/pi-for-office && npm run check` — exits 0.
  - `cd ~/projects/pi-for-office && npm run build` — exits 0.
- **Acceptance criteria:**
  - Existing Excel tools still pass tests.
  - Host-coupled code has one clear `DocumentHost` entrypoint.
  - Shared-file edits are limited to seam routing.
  - No PowerPoint mutation behavior exists yet.
- **Estimated size:** L.

### B1-003 — Add PowerPoint Manifest And Host Detection — M

- **Goal:** Let the fork load as a PowerPoint add-in and select a PowerPoint host stub.
- **Landing repo:** `hachej/pi-for-office`.
- **Files to touch/create:**
  - `manifest.xml`
  - `src/hosts/powerpoint/powerpoint-document-host.ts`
  - `src/hosts/detect-host.ts`
  - `src/hosts/document-host.ts`
  - `tests/host-detection.test.ts`
  - `docs/install.md`
- **Steps:**
  1. Add `Host Presentation` to the manifest while preserving `Host Workbook`.
  2. Add host detection that distinguishes Excel and PowerPoint from Office host context.
  3. Add `PowerPointDocumentHost` stub implementing document identity and explicit unsupported-tool responses.
  4. Update install docs with PowerPoint sideload notes.
  5. Add tests for Excel host detection, PowerPoint host detection, and unsupported PowerPoint tool response.
- **VERIFICATION:**
  - `cd ~/projects/pi-for-office && npm run test:context -- tests/host-detection.test.ts` — exits 0; Excel and PowerPoint detection tests pass.
  - `cd ~/projects/pi-for-office && npm run check` — exits 0.
  - `cd ~/projects/pi-for-office && rg -n "Host xsi:type=\"Presentation\"" manifest.xml` — prints the PowerPoint host declaration.
- **Acceptance criteria:**
  - Excel manifest behavior is preserved.
  - PowerPoint host can load and report unsupported tools cleanly.
  - B2 can add PowerPoint tools without redesigning host detection.
- **Estimated size:** M.

### B1-004 — Open Upstream Seam RFC — S

- **Goal:** Offer the host seam upstream without forcing upstream to accept PowerPoint ownership.
- **Landing repo:** `tmustier/pi-for-excel` issue tracker.
- **Files to touch/create:**
  - `docs/rfcs/document-host-seam.md` in `hachej/pi-for-office`
- **Steps:**
  1. Write an RFC describing the `DocumentHost` seam, affected Excel-coupled joints, and why Excel behavior is preserved.
  2. Include a compact diff summary from B1-002 and B1-003.
  3. State that PowerPoint host work remains in the fork.
  4. Open an upstream issue using the RFC text.
  5. Link the upstream issue from the fork PR.
- **VERIFICATION:**
  - `cd ~/projects/pi-for-office && rg -n "DocumentHost|Excel.run|PowerPoint|upstream" docs/rfcs/document-host-seam.md` — prints all required sections.
  - Manual: upstream issue exists and is linked from the B1 PR.
- **Acceptance criteria:**
  - RFC is narrow and does not ask upstream to own PowerPoint MVP.
  - RFC cites the exact Excel-coupled files changed by the seam.
  - Fork PR links the upstream issue.
- **Estimated size:** S.
