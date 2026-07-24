# authenticated-ui-smoke

- Declared operator model: mac/qwen3.6-35b-a3b (not attested by the capture runner)
- URL: http://127.0.0.1:5173/workspace/3c5c457e-d1af-4d0b-ba8e-c4559cdca86b
- Results: 6 PASS, 0 FAIL, 0 BLOCKED
- Console errors: 0
- HTTP/network errors: 4
- Duplicate screenshot groups: 0
- Video: `videos/run.webm`

## Results

- **PASS — Authentication:** {"assertionVisible":true,"absentTextSatisfied":true,"url":"http://127.0.0.1:5173/workspace/3c5c457e-d1af-4d0b-ba8e-c4559cdca86b"}
- **PASS — Authenticated workspace:** Expected DOM state visible
- **PASS — Model picker:** Expected DOM state visible
- **PASS — Thinking picker:** Expected DOM state visible
- **PASS — Workbench:** Expected DOM state visible
- **PASS — Automations:** Expected DOM state visible

## Orchestrated review disposition

- Runtime-attested operator: requested/resolved `mac/qwen3.6-35b-a3b`.
- Independent critic: requested/resolved `openai-codex/gpt-5.6-sol`.
- Hard gates: **BLOCKED** by 4 scenario-phase network failures; see `gate-summary.json`.
- Orchestration compliance: **BLOCKED** because the operator widened the scenario, used generic implementation acceptance, and the critic did not receive a launch-time read allowlist.
- Critic: **blocked**, 6.5/10, confidence 0.99; no material high-confidence product fix.
- Product, skill, and policy code were not modified. No execution packet or `/exec` run was justified.
- Stop condition: `workflow-hard-gates-or-orchestration-compliance-failed-and-no-material-high-confidence-product-fix`.
