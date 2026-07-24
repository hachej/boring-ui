# Issue #913 independent UI-loop simulation findings

## Scope and scenario

- Explicit bounded scenario: authenticated local `/dev-login` smoke at 1440×900.
- Safe states only: prove the authenticated workspace, open the model picker, prove the Suggestions listbox, close with Escape.
- No product data mutation and no product-code edit.
- Authoritative round: `round-01-independent-baseline/`.

## Roles and model resolution

- Deterministic capture runner: `capture-visual-report.cjs`.
- Prescribed cheap L0 evidence role: `mac/qwen3.6-35b-a3b`; it independently audited the enumerated machine results and screenshots as `PASS` in `operator-audit.json`.
- Independent strong L1 critic: `openai-codex/gpt-5.6-sol` (Sol high equivalent), read-only/no-tools, verdict `clean`, confidence `0.97`, score `9.3`, no material high-confidence fix.
- The first attempt to request `google/gemini-3.1-pro-preview` through Pi resolved to Qwen and was rejected as non-independent (`critic-attempt-qwen.json`). OpenRouter Gemini was credit-blocked and Gemini CLI was credential-blocked. Their empty/raw outputs are retained for audit but excluded from the final handoff links.
- Fable remained off, as required.

## Deterministic evidence and disposition

- Scenario results: **3 PASS · 0 FAIL · 0 BLOCKED**.
- Authentication and both captured states were backed by DOM visibility assertions.
- Console errors: 0.
- HTTP/network records: 2 aborted `PUT /api/v1/ui/state` requests. The legacy runner did not record lifecycle phase or timestamps, so they cannot be deterministically classified as teardown noise. They prove no product defect, but they block the workflow bundle under the corrected gate schema.
- Video: VP8, 1440×900, 25 fps, 14.92 s, ffprobe passed.
- Screenshot duplicate groups: 0.

## Bounded decision and stop

No product fixes were selected. No execution packet was created, `/exec` was not invoked, and product code was not modified. Recapture/regrade was not justified because there was no product change and the independent strong critic found no material high-confidence product fix. Post-audit, the legacy unphased network cancellations blocked the workflow bundle from satisfying the corrected hard-gate schema.

Stop condition: `simulation-found-workflow-defects-and-no-material-product-fix`.

## Workflow ambiguities/defects observed

1. The bundle runner accepts `--operator-model` as an unauthenticated label but does not invoke or attest that model. A caller can accidentally imply model execution that did not happen. The report should distinguish deterministic runner, invoking worker, and model-based evidence audit, or cryptographically/importably record the actual provider response metadata.
2. The parent visual-review procedure specifies a complete improvement-packet contract for registered specs, while direct explicit scenarios are allowed by the subskill but lack a normative critic schema, fix-decision artifact, execution-decision artifact, and final roll-up schema.
3. The workflow says to record the resolved critic model, but self-declaration inside model output is not reliable. The requested Google critic resolved to Qwen without a machine-readable invocation record. Capture provider/model metadata outside model-authored content and fail closed on mismatch.
4. Critic fallback is underspecified when the default Gemini credential is unavailable. The Model Card permits model judgment, but the UI procedure names Gemini/Grok only. Define an ordered, auditable fallback (for example Sol high) and whether this satisfies the vision-capable tier-1 gate.
5. Context-close request aborts are collected as HTTP/network errors without lifecycle timestamps or a disposition field. Add phase/timestamp data so deterministic policy can distinguish scenario failures from teardown cancellation without relying on critic prose.
6. The subskill requires opening through `workspace.open.path`, but that capability is not always exposed. The local HTTP fallback is workable and should be explicitly equivalent for acceptance.

## Recommended skill fixes

1. Replace the free-form `--operator-model` label with captured provider/model invocation metadata, or rename it to `--declared-operator-model` and report the distinction.
2. Add a small explicit-scenario loop schema covering `gate-summary.json`, `critic.json`, bounded `fix-plan-decision.json`, `execution-decision.json`, and final HTML roll-up.
3. Fail closed when requested and resolved critic models differ; store transport metadata separately from critic-authored JSON.
4. Document an ordered strong-critic fallback and credential/credit blocker handling.
5. Annotate network errors with capture phase and treat teardown cancellation through a deterministic rule.

## Parent disposition

The PR was revised from these findings:

- `--operator-model` became `--declared-operator-model`; the capture runner marks it as unattested, while the loop schema requires separate runtime invocation records.
- Explicit scenarios now have a normative round schema for gate, critic, fix, execution, and final-handoff artifacts.
- Requested/resolved critic mismatch fails closed, with an ordered Gemini → Grok → Sol-high fallback policy.
- Browser error records now include timestamp, lifecycle phase, and deterministic disposition.
- The legacy round's two unphased cancellations remain unclassified; the authoritative gate summary is therefore workflow-blocked rather than retroactively calling them teardown noise.
