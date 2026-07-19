import type { UiCriticReport, UiHardGateReport, UiReviewManifest } from "./contracts"

export function renderUiReviewHtml(input: {
  manifest: UiReviewManifest
  hardGates: UiHardGateReport
  critic: UiCriticReport
}): string {
  const { manifest, hardGates, critic } = input
  const failed = hardGates.results.filter((result) => !result.passed)
  const stateCards = manifest.states.map((state) => {
    const src = safeScreenshotPath(state.screenshotPath)
    return `<article class="state"><img src="${escapeHtml(src)}" alt="${escapeHtml(`${state.viewport.name} ${state.checkpoint}`)}"><div><strong>${escapeHtml(state.checkpoint)}</strong><span>${escapeHtml(state.viewport.name)} · ${state.viewport.width}×${state.viewport.height}</span><code>${escapeHtml(state.id)}</code></div></article>`
  }).join("")
  const gateRows = hardGates.results.map((result) => (
    `<li class="${result.passed ? "pass" : "fail"}"><strong>${result.passed ? "PASS" : "FAIL"} ${escapeHtml(result.id)}</strong><code>${escapeHtml(result.stateId)}</code><span>${escapeHtml(result.evidence)}</span></li>`
  )).join("")
  const dimensionRows = Object.entries(critic.candidate.dimensions).map(([name, score]) => (
    `<li><strong>${escapeHtml(name)}</strong><span>${score.toFixed(1)}/10</span></li>`
  )).join("")
  const findings = critic.visualFindings.map((finding) => (
    `<li><strong>${escapeHtml(finding.severity)}</strong><span>${escapeHtml(finding.evidence)}</span><code>${escapeHtml(finding.stateIds.join(", "))}</code></li>`
  )).join("") || "<li>None</li>"
  const fixes = critic.topFixes.map((fix) => (
    `<li><strong>${escapeHtml(fix.problem)}</strong><span>${escapeHtml(fix.recommendation)}</span><code>${escapeHtml(fix.stateIds.join(", "))}</code></li>`
  )).join("") || "<li>None</li>"

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'">
<title>${escapeHtml(`UI review · ${manifest.scenarioId}`)}</title>
<style>
:root{color-scheme:dark;font-family:ui-sans-serif,system-ui,sans-serif;background:#0b0c0f;color:#e8e9ed}body{max-width:1180px;margin:0 auto;padding:32px}h1,h2{letter-spacing:-.02em}header,.summary{display:flex;gap:16px;align-items:baseline;flex-wrap:wrap}.pill{border:1px solid #30333a;border-radius:999px;padding:4px 10px;color:#aeb3bd}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}.state{border:1px solid #292c33;border-radius:14px;overflow:hidden;background:#111318}.state img{display:block;width:100%;height:auto;background:#08090b}.state div{display:grid;gap:5px;padding:12px}.state span,code{color:#9ca3af;font-size:12px;overflow-wrap:anywhere}ul{display:grid;gap:8px;padding:0;list-style:none}li{display:grid;gap:4px;border:1px solid #292c33;border-radius:10px;padding:12px;background:#111318}.pass strong{color:#82d9a0}.fail strong{color:#ff9292}.score{font-size:36px;font-weight:700}section{margin-top:32px}
</style>
</head>
<body>
<header><h1>UI review · ${escapeHtml(manifest.scenarioId)}</h1><span class="pill">${escapeHtml(manifest.runId)}</span><span class="pill">${escapeHtml(manifest.resolvedModel)}</span><span class="pill">rubric ${escapeHtml(manifest.rubricVersion)}</span></header>
<div class="summary"><span class="score">${critic.candidate.overall.toFixed(1)}/10</span><span>confidence ${(critic.confidence * 100).toFixed(0)}%</span><span>${failed.length} hard-gate failure(s)</span></div>
<section><h2>Score dimensions</h2><ul>${dimensionRows}</ul></section>
<section><h2>Captured states</h2><div class="grid">${stateCards}</div></section>
<section><h2>Hard gates</h2><ul>${gateRows}</ul></section>
<section><h2>Visual findings</h2><ul>${findings}</ul></section>
<section><h2>Top fixes</h2><ul>${fixes}</ul></section>
<section><h2>Owner spot-check</h2><ol><li>Compare desktop and mobile palette spacing.</li><li>Verify keyboard hints and command mode.</li><li>Approve or request changes from the linked Inbox review.</li></ol></section>
</body>
</html>`
}

export function renderUiReviewMarkdown(input: {
  manifest: UiReviewManifest
  hardGates: UiHardGateReport
  critic: UiCriticReport
}): string {
  const failed = input.hardGates.results.filter((result) => !result.passed)
  return [
    `# UI review · ${input.manifest.scenarioId}`,
    "",
    `- Run: \`${input.manifest.runId}\``,
    `- Model: \`${input.manifest.resolvedModel}\``,
    `- Rubric: \`${input.manifest.rubricVersion}\``,
    `- Score: **${input.critic.candidate.overall.toFixed(1)}/10**`,
    ...Object.entries(input.critic.candidate.dimensions).map(([name, score]) => `  - ${name}: **${score.toFixed(1)}/10**`),
    `- Confidence: **${(input.critic.confidence * 100).toFixed(0)}%**`,
    `- Hard-gate failures: **${failed.length}**`,
    ...failed.map((result) => `  - \`${result.id}\` at \`${result.stateId}\``),
    "",
    "Open `report.html` for captured states and exact evidence.",
  ].join("\n")
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function safeScreenshotPath(value: string): string {
  if (!/^selected\/(desktop|mobile)\/[a-zA-Z0-9._-]+\.png$/.test(value)) {
    throw new Error("UI_REVIEW_REPORT_SCREENSHOT_PATH_INVALID")
  }
  return value
}
