#!/usr/bin/env node
// present-pr.mjs — turn a GitHub PR into ONE self-contained HTML page for owner validation.
//
//   node scripts/present-pr.mjs <pr-number> [options]
//
//   --repo <owner/name>   default: current repo (gh resolves it)
//   --context <path>      sidecar .md (first ```mermaid fence = intro diagram, rest = context
//                         summary) or .json ({ mermaid, summary, audit, ci, verdict })
//   --audit "<text>"      audit status line (overrides sidecar)
//   --out <path>          output HTML (default: pr-<n>-presentation.html)
//
// Output has no external requests (strict-CSP safe): all CSS/JS inline, mermaid emitted as
// <pre class="mermaid"> which Claude artifacts render natively.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/* ------------------------------------------------------------------ args */

function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg.startsWith('--')) out[arg.slice(2)] = argv[i + 1]?.startsWith('--') ? true : argv[++i]
    else out._.push(arg)
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const prNumber = args._[0]
if (!prNumber || !/^\d+$/.test(prNumber)) {
  console.error('usage: present-pr.mjs <pr-number> [--repo owner/name] [--context file] [--out file]')
  process.exit(2)
}

function gh(cliArgs) {
  return execFileSync('gh', cliArgs, { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 })
}
const repoArgs = args.repo ? ['--repo', args.repo] : []

/* ------------------------------------------------------------- gh fetch */

const pr = JSON.parse(
  gh([
    'pr', 'view', prNumber, ...repoArgs, '--json',
    'number,title,url,author,state,isDraft,baseRefName,headRefName,additions,deletions,changedFiles,createdAt,updatedAt,labels,reviewDecision,mergeStateStatus',
  ]),
)

let checks = []
try {
  checks = JSON.parse(gh(['pr', 'checks', prNumber, ...repoArgs, '--json', 'name,state,bucket,link']))
} catch {
  // `gh pr checks` exits non-zero when checks are failing or absent; the JSON still
  // reaches stdout on failure, but execFileSync throws — degrade to "unknown".
}

// Plain `gh pr diff` = one combined diff. `--patch` emits one patch *per commit*,
// which would list the same file several times.
const rawDiff = gh(['pr', 'diff', prNumber, ...repoArgs])

/* ------------------------------------------------------- sidecar context */

const context = { mermaid: '', summary: '', audit: '', verdict: '' }
if (args.context) {
  const raw = readFileSync(args.context, 'utf8')
  if (args.context.endsWith('.json')) Object.assign(context, JSON.parse(raw))
  else {
    const fence = raw.match(/```mermaid\n([\s\S]*?)```/)
    context.mermaid = fence ? fence[1].trim() : ''
    context.summary = raw.replace(/```mermaid\n[\s\S]*?```/, '').replace(/^#.*\n/, '').trim()
  }
}
if (typeof args.audit === 'string') context.audit = args.audit

/* -------------------------------------------------------- categorization */

const CATEGORIES = [
  { id: 'generated', label: 'Generated / lockfiles', color: 'var(--cat-generated)' },
  { id: 'config', label: 'Config / CI', color: 'var(--cat-config)' },
  { id: 'docs', label: 'Docs', color: 'var(--cat-docs)' },
  { id: 'test', label: 'Tests', color: 'var(--cat-test)' },
  { id: 'prod', label: 'Production code', color: 'var(--cat-prod)' },
]

/** Order matters: first match wins, most-specific first. */
export function categorize(file) {
  const p = file.toLowerCase()
  if (/(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|cargo\.lock|poetry\.lock|go\.sum)$/.test(p)) return 'generated'
  if (/(^|\/)(dist|build|coverage|__snapshots__|\.beads)(\/|$)/.test(p) || /\.(snap|lock)$/.test(p)) return 'generated'
  if (/(^|\/)(__tests__|__mocks__|__fixtures__|tests?|e2e|spec|fixtures)(\/|$)/.test(p)) return 'test'
  if (/\.(test|spec|e2e)\.[a-z0-9]+$/.test(p)) return 'test'
  if (/(^|\/)(docs?|documentation)(\/|$)/.test(p)) return 'docs'
  if (/\.(md|mdx|rst|adoc|txt)$/.test(p)) return 'docs'
  if (/(^|\/)\.github\//.test(p)) return 'config'
  if (/(^|\/)(\.[a-z0-9_.-]+rc(\.[a-z]+)?|[a-z0-9.-]*\.config\.[a-z]+|tsconfig[a-z0-9.-]*\.json|package\.json|dockerfile|.*\.ya?ml|.*\.toml|.*\.ini)$/.test(p)) return 'config'
  return 'prod'
}

/* -------------------------------------------------------- diff parsing */

function parseDiff(text) {
  const files = []
  let current = null
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const m = line.match(/^diff --git a\/(.+?) b\/(.+)$/)
      current = {
        path: m ? m[2] : line.slice(11),
        oldPath: m ? m[1] : '',
        status: 'modified',
        binary: false,
        additions: 0,
        deletions: 0,
        hunks: [],
      }
      files.push(current)
      continue
    }
    if (!current) continue
    if (line.startsWith('new file mode')) { current.status = 'added'; continue }
    if (line.startsWith('deleted file mode')) { current.status = 'deleted'; continue }
    if (line.startsWith('rename to ')) { current.status = 'renamed'; continue }
    if (line.startsWith('Binary files')) { current.binary = true; continue }
    if (line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ') ||
        line.startsWith('old mode') || line.startsWith('new mode') || line.startsWith('similarity index') ||
        line.startsWith('rename from ')) continue
    if (line.startsWith('@@')) {
      const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/)
      current.hunks.push({ header: line, context: m ? m[3].trim() : '', oldNo: m ? +m[1] : 0, newNo: m ? +m[2] : 0, lines: [] })
      continue
    }
    const hunk = current.hunks[current.hunks.length - 1]
    if (!hunk) continue
    if (line.startsWith('\\')) continue
    const kind = line[0] === '+' ? 'add' : line[0] === '-' ? 'del' : 'ctx'
    if (kind === 'add') current.additions += 1
    if (kind === 'del') current.deletions += 1
    hunk.lines.push({
      kind,
      text: line.slice(1),
      oldNo: kind === 'add' ? null : hunk.oldNo++,
      newNo: kind === 'del' ? null : hunk.newNo++,
    })
  }
  return files
}

/* --------------------------------------------------- syntax highlighting */

const KEYWORDS = new Set(
  ('const let var function return if else for while switch case break continue new class extends implements interface type enum ' +
   'export import from default async await try catch finally throw typeof instanceof in of as satisfies readonly public private protected static ' +
   'null undefined true false this super void never unknown any string number boolean object symbol bigint yield delete do with package def elif ' +
   'lambda pass raise fn impl pub struct match use mod where select insert update delete_ null_').split(' '),
)

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

const TOKEN = /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b\d[\d_.eExXbBoOa-fA-F]*\b)|([A-Za-z_$][\w$]*)/g

function highlight(line, lang) {
  if (lang === 'text') return esc(line)
  let out = ''
  let last = 0
  for (const m of line.matchAll(TOKEN)) {
    out += esc(line.slice(last, m.index))
    if (m[1]) out += `<span class="t-com">${esc(m[1])}</span>`
    else if (m[2]) out += `<span class="t-str">${esc(m[2])}</span>`
    else if (m[3]) out += `<span class="t-num">${esc(m[3])}</span>`
    else if (m[4]) out += KEYWORDS.has(m[4]) ? `<span class="t-kw">${esc(m[4])}</span>` : esc(m[4])
    last = m.index + m[0].length
  }
  return out + esc(line.slice(last))
}

const langOf = (p) => (/\.(ts|tsx|js|jsx|mjs|cjs|json|java|c|h|cc|cpp|go|rs|py|rb|php|css|scss|sh|zsh|sql|swift|kt)$/.test(p) ? 'code' : 'text')

/* ---------------------------------------------------------- html render */

function renderFile(file, index) {
  const cat = categorize(file.path)
  const lang = langOf(file.path)
  const body = file.binary
    ? '<div class="empty">Binary file — no textual diff.</div>'
    : file.hunks.map((hunk) => {
        const rows = hunk.lines.map((l) => `<tr class="l-${l.kind}"><td class="ln">${l.oldNo ?? ''}</td><td class="ln">${l.newNo ?? ''}</td><td class="mk">${l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '}</td><td class="src">${highlight(l.text, lang)}</td></tr>`).join('')
        return `<tr class="hunk"><td colspan="4">${esc(hunk.header.replace(/^(@@[^@]*@@)(.*)$/, '$1'))}${hunk.context ? ` <span class="hctx">${esc(hunk.context)}</span>` : ''}</td></tr>${rows}`
      }).join('')
  const big = file.additions + file.deletions > 400
  return `<details class="file" data-cat="${cat}" data-path="${esc(file.path)}"${big || cat === 'generated' ? '' : ' open'} id="f${index}">
  <summary>
    <span class="chev" aria-hidden="true">▸</span>
    <code class="fpath">${esc(file.path)}</code>
    <span class="pill pill-${cat}">${esc(cat)}</span>
    <span class="status">${esc(file.status)}</span>
    <span class="counts"><span class="add">+${file.additions}</span> <span class="del">−${file.deletions}</span></span>
  </summary>
  <div class="diffwrap"><table class="diff">${body || '<tr><td colspan="4" class="empty">No hunks (mode/rename only).</td></tr>'}</table></div>
</details>`
}

const files = parseDiff(rawDiff)
files.forEach((f) => { f.cat = categorize(f.path) })

const totals = {}
for (const c of CATEGORIES) totals[c.id] = { files: 0, additions: 0, deletions: 0 }
for (const f of files) {
  const t = totals[f.cat]
  t.files += 1; t.additions += f.additions; t.deletions += f.deletions
}

const checkSummary = checks.reduce((acc, c) => {
  const b = (c.bucket || c.state || '').toLowerCase()
  if (b === 'pass' || b === 'success') acc.pass += 1
  else if (b === 'fail' || b === 'failure') acc.fail += 1
  else if (b === 'skipping' || b === 'skipped' || b === 'cancel') acc.skip += 1
  else acc.pending += 1
  return acc
}, { pass: 0, fail: 0, pending: 0, skip: 0 })

const ciLabel = checks.length === 0
  ? (context.ci || 'no checks reported')
  : `${checkSummary.pass} passed · ${checkSummary.fail} failed · ${checkSummary.pending} pending${checkSummary.skip ? ` · ${checkSummary.skip} skipped` : ''}`
const ciTone = checkSummary.fail > 0 ? 'bad' : checkSummary.pending > 0 ? 'warn' : checks.length ? 'good' : 'neutral'

function paragraphs(text) {
  if (!text) return '<p class="muted">No context summary supplied. Pass <code>--context &lt;file.md&gt;</code>.</p>'
  return String(text).split(/\n{2,}/).map((p) => `<p>${esc(p.trim()).replace(/\n/g, ' ').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')}</p>`).join('\n')
}

const orderedCats = CATEGORIES.slice().reverse() // prod first
const filterChips = orderedCats.map((c) => {
  const t = totals[c.id]
  return `<label class="chip chip-${c.id}${t.files ? '' : ' chip-empty'}">
    <input type="checkbox" data-cat="${c.id}" ${c.id === 'generated' ? '' : 'checked'}${t.files ? '' : ' disabled'} />
    <span class="swatch"></span>${esc(c.label)}
    <span class="chipcount">${t.files} · <span class="add">+${t.additions}</span> <span class="del">−${t.deletions}</span></span>
  </label>`
}).join('\n')

const html = `<title>PR #${pr.number} — ${esc(pr.title)}</title>
<style>
:root {
  color-scheme: light dark;
  --bg: #ffffff; --panel: #f7f8fa; --panel-2: #eef0f4; --fg: #14161a; --muted: #5b6270;
  --border: #dfe3ea; --accent: #3b5bdb;
  --add-bg: #e6ffec; --add-fg: #0a6b2e; --del-bg: #ffebe9; --del-fg: #9b1c1c; --hunk-bg: #eef1f7;
  --t-kw: #8250df; --t-str: #0a6b2e; --t-num: #0550ae; --t-com: #6e7781;
  --cat-prod: #3b5bdb; --cat-test: #2f9e44; --cat-docs: #f08c00; --cat-config: #7048e8; --cat-generated: #868e96;
  --good: #2f9e44; --warn: #f08c00; --bad: #e03131;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0d1117; --panel: #12161d; --panel-2: #1b212b; --fg: #e6edf3; --muted: #9aa4b2;
    --border: #262d38; --accent: #7d94ff;
    --add-bg: #0f2f1c; --add-fg: #6fdc8c; --del-bg: #3a1417; --del-fg: #ff8f8f; --hunk-bg: #182029;
    --t-kw: #d2a8ff; --t-str: #7ee787; --t-num: #79c0ff; --t-com: #8b949e;
    --cat-prod: #7d94ff; --cat-test: #6fdc8c; --cat-docs: #ffc078; --cat-config: #d2a8ff; --cat-generated: #8b949e;
    --good: #6fdc8c; --warn: #ffc078; --bad: #ff8f8f;
  }
}
:root[data-theme="dark"] {
  --bg: #0d1117; --panel: #12161d; --panel-2: #1b212b; --fg: #e6edf3; --muted: #9aa4b2;
  --border: #262d38; --accent: #7d94ff;
  --add-bg: #0f2f1c; --add-fg: #6fdc8c; --del-bg: #3a1417; --del-fg: #ff8f8f; --hunk-bg: #182029;
  --t-kw: #d2a8ff; --t-str: #7ee787; --t-num: #79c0ff; --t-com: #8b949e;
  --cat-prod: #7d94ff; --cat-test: #6fdc8c; --cat-docs: #ffc078; --cat-config: #d2a8ff; --cat-generated: #8b949e;
  --good: #6fdc8c; --warn: #ffc078; --bad: #ff8f8f;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; overflow-x: hidden; }
.wrap { max-width: 1180px; margin: 0 auto; padding: 32px 20px 96px; }
h1 { font-size: 24px; line-height: 1.3; margin: 0 0 6px; letter-spacing: -0.01em; }
h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.09em; color: var(--muted); margin: 40px 0 12px; font-weight: 600; }
a { color: var(--accent); }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.9em; }
.muted { color: var(--muted); }

.head { border: 1px solid var(--border); border-radius: 12px; padding: 20px 22px; background: var(--panel); }
.meta { display: flex; flex-wrap: wrap; gap: 8px 18px; color: var(--muted); font-size: 13px; margin-top: 8px; }
.badges { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
.badge { display: inline-flex; align-items: center; gap: 7px; border: 1px solid var(--border); background: var(--bg); border-radius: 999px; padding: 4px 12px; font-size: 12.5px; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
.dot.good { background: var(--good); } .dot.warn { background: var(--warn); } .dot.bad { background: var(--bad); }

.card { border: 1px solid var(--border); border-radius: 12px; background: var(--panel); padding: 18px 22px; }
.diagram { overflow-x: auto; }
.diagram pre.mermaid { background: transparent; margin: 0; text-align: center; }
.diagram > pre:not(.mermaid) { white-space: pre; font-size: 12px; color: var(--muted); }

.filters { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 14px; }
.chip { display: inline-flex; align-items: center; gap: 8px; border: 1px solid var(--border); border-radius: 999px; padding: 6px 13px; font-size: 12.5px; cursor: pointer; background: var(--panel); user-select: none; }
.chip input { margin: 0; accent-color: var(--accent); }
.chip-empty { opacity: 0.45; cursor: default; }
.chipcount { color: var(--muted); font-variant-numeric: tabular-nums; }
.swatch { width: 9px; height: 9px; border-radius: 2px; }
.chip-prod .swatch { background: var(--cat-prod); } .chip-test .swatch { background: var(--cat-test); }
.chip-docs .swatch { background: var(--cat-docs); } .chip-config .swatch { background: var(--cat-config); }
.chip-generated .swatch { background: var(--cat-generated); }
.tools { margin-left: auto; display: flex; gap: 8px; }
.btn { border: 1px solid var(--border); background: var(--panel); color: var(--fg); border-radius: 8px; padding: 6px 12px; font-size: 12.5px; cursor: pointer; font-family: inherit; }
.btn:hover { background: var(--panel-2); }

.file { border: 1px solid var(--border); border-radius: 10px; margin-bottom: 10px; background: var(--panel); overflow: hidden; }
.file[hidden] { display: none; }
.file > summary { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 10px 14px; cursor: pointer; list-style: none; background: var(--panel-2); }
.file > summary::-webkit-details-marker { display: none; }
.chev { color: var(--muted); transition: transform 0.12s ease; display: inline-block; }
.file[open] > summary .chev { transform: rotate(90deg); }
.fpath { font-size: 12.5px; word-break: break-all; }
.pill { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; padding: 2px 8px; border-radius: 999px; color: var(--bg); font-weight: 600; }
.pill-prod { background: var(--cat-prod); } .pill-test { background: var(--cat-test); } .pill-docs { background: var(--cat-docs); }
.pill-config { background: var(--cat-config); } .pill-generated { background: var(--cat-generated); }
.status { font-size: 11.5px; color: var(--muted); }
.counts { margin-left: auto; font-variant-numeric: tabular-nums; font-size: 12.5px; }
.add { color: var(--add-fg); } .del { color: var(--del-fg); }

.diffwrap { overflow-x: auto; background: var(--bg); }
table.diff { border-collapse: collapse; width: 100%; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; line-height: 1.55; }
table.diff td { padding: 0 6px; vertical-align: top; white-space: pre; }
td.ln { width: 1%; min-width: 44px; text-align: right; color: var(--muted); user-select: none; opacity: 0.7; }
td.mk { width: 1%; color: var(--muted); user-select: none; }
td.src { width: 100%; }
tr.l-add { background: var(--add-bg); } tr.l-del { background: var(--del-bg); }
tr.hunk td { background: var(--hunk-bg); color: var(--muted); padding: 4px 10px; font-size: 11.5px; }
.hctx { opacity: 0.8; }
.empty { padding: 14px; color: var(--muted); font-family: inherit; white-space: normal; }
.t-kw { color: var(--t-kw); } .t-str { color: var(--t-str); } .t-num { color: var(--t-num); } .t-com { color: var(--t-com); font-style: italic; }
.footer { margin-top: 40px; color: var(--muted); font-size: 12.5px; }
</style>

<div class="wrap">
  <header class="head">
    <h1>PR #${pr.number} — ${esc(pr.title)}</h1>
    <div class="meta">
      <span>${esc(pr.author?.login ?? 'unknown')}</span>
      <span><code>${esc(pr.headRefName)}</code> → <code>${esc(pr.baseRefName)}</code></span>
      <span>${pr.changedFiles} files · <span class="add">+${pr.additions}</span> <span class="del">−${pr.deletions}</span></span>
      <span><a href="${esc(pr.url)}">view on GitHub ↗</a></span>
    </div>
    <div class="badges">
      <span class="badge"><span class="dot ${pr.state === 'OPEN' ? 'good' : 'neutral'}"></span>${esc(pr.state)}${pr.isDraft ? ' (draft)' : ''}</span>
      <span class="badge"><span class="dot ${ciTone}"></span>CI: ${esc(ciLabel)}</span>
      <span class="badge"><span class="dot ${context.audit ? 'good' : 'warn'}"></span>Audit: ${esc(context.audit || 'not recorded')}</span>
      ${context.verdict ? `<span class="badge"><span class="dot warn"></span>${esc(context.verdict)}</span>` : ''}
    </div>
  </header>

  <h2>1 · What this touches</h2>
  <div class="card diagram">
    ${context.mermaid ? `<pre class="mermaid">\n${esc(context.mermaid)}\n</pre>` : '<p class="muted">No intro diagram supplied. Put a <code>```mermaid</code> fence in the context sidecar.</p>'}
  </div>
  <div class="card" style="margin-top:12px">${paragraphs(context.summary)}</div>

  <h2>2 · Changes</h2>
  <div class="filters">
    ${filterChips}
    <div class="tools">
      <button class="btn" id="expand">Expand all</button>
      <button class="btn" id="collapse">Collapse all</button>
    </div>
  </div>
  <p class="muted" id="visible-summary" style="font-size:12.5px;margin:0 0 12px"></p>
  <div id="files">
${files.map(renderFile).join('\n')}
  </div>

  <p class="footer">Generated by <code>scripts/present-pr.mjs</code> · ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC · diff fetched via <code>gh pr diff ${pr.number}</code>.</p>
</div>

<script>
(function () {
  var fileEls = Array.prototype.slice.call(document.querySelectorAll('.file'));
  var boxes = Array.prototype.slice.call(document.querySelectorAll('.chip input'));
  var summary = document.getElementById('visible-summary');
  function apply() {
    var on = {};
    boxes.forEach(function (b) { on[b.dataset.cat] = b.checked; });
    var n = 0;
    fileEls.forEach(function (el) {
      var show = !!on[el.dataset.cat];
      el.hidden = !show;
      if (show) n += 1;
    });
    summary.textContent = n + ' of ' + fileEls.length + ' files shown';
  }
  boxes.forEach(function (b) { b.addEventListener('change', apply); });
  document.getElementById('expand').addEventListener('click', function () {
    fileEls.forEach(function (el) { if (!el.hidden) el.open = true; });
  });
  document.getElementById('collapse').addEventListener('click', function () {
    fileEls.forEach(function (el) { el.open = false; });
  });
  apply();
})();
</script>
`

const outPath = path.resolve(args.out || `pr-${pr.number}-presentation.html`)
writeFileSync(outPath, html)
console.log(`${outPath}\n${files.length} files · ${CATEGORIES.map((c) => `${c.id}=${totals[c.id].files}`).join(' ')}`)
