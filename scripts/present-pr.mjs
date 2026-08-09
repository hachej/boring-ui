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

const context = { mermaid: '', summary: '', audit: '', verdict: '', keyFiles: [] }
if (args.context) {
  const raw = readFileSync(args.context, 'utf8')
  if (args.context.endsWith('.json')) Object.assign(context, JSON.parse(raw))
  else {
    const fence = raw.match(/```mermaid\n([\s\S]*?)```/)
    context.mermaid = fence ? fence[1].trim() : ''
    // `## Key files` pins the reading order explicitly, overriding the heuristic.
    // Sectioning is done by splitting rather than one greedy regex: `$` under
    // /m/ ends at the first newline, so a lazy "until the next heading" match
    // silently captures nothing.
    const lines = raw.replace(/```mermaid\n[\s\S]*?```/, '').split('\n')
    const keep = []
    let inKeyFiles = false
    for (const line of lines) {
      if (/^##+\s/.test(line)) inKeyFiles = /^##+\s*key files\s*$/i.test(line.trim())
      if (!inKeyFiles) { keep.push(line); continue }
      const item = line.match(/^\s*[-*]\s+`?([^`\s]+)`?/)
      if (item) context.keyFiles.push(item[1])
    }
    context.summary = keep.join('\n').replace(/^#.*\n/, '').trim()
  }
}
context.keyFiles = Array.isArray(context.keyFiles) ? context.keyFiles : []
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
  // Only the top two diffs open on load — an all-expanded page is the same
  // undifferentiated wall the GitHub files tab already gives you.
  const open = file.rank <= 2
  return `<details class="file" data-cat="${cat}" data-path="${esc(file.path)}" data-rank="${file.rank}"${open ? ' open' : ''} id="f${index}">
  <summary>
    <span class="rank">${file.rank}</span>
    <span class="chev" aria-hidden="true">▸</span>
    <code class="fpath">${esc(file.path)}</code>
    ${file.rank === 1 ? '<span class="starthere">start here</span>' : ''}
    ${file.pinned ? '<span class="pinned" title="pinned by the context sidecar">pinned</span>' : ''}
    <span class="pill pill-${cat}">${esc(cat)}</span>
    <span class="status">${esc(file.status)}</span>
    <span class="counts"><span class="add">+${file.additions}</span> <span class="del">−${file.deletions}</span></span>
  </summary>
  <div class="diffwrap"><table class="diff">${body || '<tr><td colspan="4" class="empty">No hunks (mode/rename only).</td></tr>'}</table></div>
</details>`
}

/**
 * Sankey level 1 — the first question a reviewer asks: *what kind of thing*
 * does this PR touch? Product packages, deployed apps, plugins, tooling, docs.
 */
const AREA_ROOTS = new Set(['packages', 'apps', 'plugins', 'services', 'libs', 'tools', 'scripts', 'docs', 'examples', 'e2e'])
function areaOf(filePath) {
  const parts = filePath.split('/').filter(Boolean)
  if (parts.length < 2) return 'root'
  return AREA_ROOTS.has(parts[0]) ? parts[0] : 'other'
}

/**
 * Sankey level 2 — the individual package/app. This is the scope check: a PR
 * reaching into a package it has no business in is visible here at a glance.
 */
function packageOf(filePath) {
  const parts = filePath.split('/').filter(Boolean)
  if (parts.length < 2) return '(repo root)'
  if (AREA_ROOTS.has(parts[0]) && parts.length > 2) return parts[1]
  return parts[0]
}

/**
 * Importance ranking — the second question: *which diff do I read first?*
 * Churn alone is a bad answer (a 900-line snapshot outranks a 12-line policy
 * change), so churn is damped logarithmically and then weighted by what kind
 * of surface the file is. Contract surfaces — shared types, barrel exports,
 * schemas, routes — move first because they are what other code must agree with.
 */
const CATEGORY_IMPORTANCE = { prod: 1, test: 0.45, config: 0.4, docs: 0.3, generated: 0.08 }

function surfaceBoost(filePath) {
  const p = filePath.toLowerCase()
  let boost = 1
  if (/(^|\/)src\/shared\//.test(p)) boost *= 1.6
  if (/(^|\/)(types|schema|contract|error-codes)\.[a-z]+$/.test(p) || /\.(types|schema)\.[a-z]+$/.test(p)) boost *= 1.4
  if (/(^|\/)(routes|api|server)\//.test(p)) boost *= 1.25
  if (/(^|\/)index\.[a-z]+$/.test(p)) boost *= 1.2
  return boost
}

function importance(file, keyFiles) {
  const pinned = keyFiles.findIndex((k) => file.path === k || file.path.endsWith(`/${k}`) || file.path.includes(k))
  if (pinned >= 0) return { score: 1e6 - pinned, pinned: true }
  const churn = Math.log2(file.additions + file.deletions + 1)
  const isNew = file.status === 'added' ? 1.15 : 1
  return { score: churn * (CATEGORY_IMPORTANCE[file.cat] ?? 0.5) * surfaceBoost(file.path) * isNew, pinned: false }
}

const files = parseDiff(rawDiff)
files.forEach((f) => {
  f.cat = categorize(f.path)
  f.area = areaOf(f.path)
  f.pkg = packageOf(f.path)
  const rank = importance(f, context.keyFiles ?? [])
  f.score = rank.score
  f.pinned = rank.pinned
})
// Default order is importance, not path: the reviewer should land on the diff
// that decides the review, not on whatever sorts first alphabetically.
files.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
files.forEach((f, i) => { f.rank = i + 1 })

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
.rank { font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; min-width: 18px; text-align: right; opacity: 0.75; }
.starthere { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.07em; font-weight: 600; color: var(--bg); background: var(--accent); border-radius: 999px; padding: 2px 9px; }
.pinned { font-size: 10.5px; color: var(--accent); border: 1px solid var(--accent); border-radius: 999px; padding: 1px 8px; }
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

/* --- sankey navigation --- */
.sankey { padding: 12px 6px 6px; margin-bottom: 14px; }
.sankeyhead { display: flex; align-items: center; gap: 12px; margin: 0 10px 8px; }
.sankey .hint { margin: 0; font-size: 12px; color: var(--muted); }
.sankeyhead .btn { margin-left: auto; white-space: nowrap; }
.listhead { display: flex; align-items: center; gap: 12px; margin: 0 0 12px; font-size: 12.5px; }
.listhead p { margin: 0; }
.sortwrap { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.btn.seg { border-radius: 0; margin-left: -1px; }
.sortwrap .btn.seg:first-of-type { border-radius: 8px 0 0 8px; margin-left: 0; }
.sortwrap .btn.seg:last-of-type { border-radius: 0 8px 8px 0; }
.btn.seg.on { background: var(--accent); color: #fff; border-color: var(--accent); }
.sankeyscroll { overflow-x: auto; }
.sankeyscroll svg { display: block; }
.sk-el { transition: opacity 0.12s ease; }
.sk-el.dim { opacity: 0.13; }
.sk-rib { cursor: pointer; }
.sk-node { cursor: pointer; }
.sk-label { font: 11px ui-sans-serif, system-ui, sans-serif; fill: var(--fg); pointer-events: none; }
.sk-label.sub { fill: var(--muted); font-size: 10px; }
.sk-label.strong { font-size: 12px; font-weight: 600; }
.sk-hit { fill: transparent; cursor: pointer; }
.sk-col { font: 10px ui-sans-serif, system-ui, sans-serif; fill: var(--muted); letter-spacing: 0.08em; text-transform: uppercase; }
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
  ${files.length >= 4 ? `<div class="card sankey" id="sankey">
    <div class="sankeyhead">
      <p class="hint">What is touched — area → package → file. Ribbon width is changed lines, colour is the file category. Click any node to jump to its diff.</p>
      <button class="btn" id="toggle-files" data-on="${files.length <= 24 ? '1' : '0'}">${files.length <= 24 ? 'Hide file level' : 'Show file level'}</button>
    </div>
    <div class="sankeyscroll"><svg id="sankey-svg" role="img" aria-label="Diff flow from area to package to file"></svg></div>
  </div>` : ''}
  <div class="listhead">
    <p class="muted" id="visible-summary"></p>
    <div class="sortwrap">
      <span class="muted">order</span>
      <button class="btn seg on" id="sort-importance">importance</button><button class="btn seg" id="sort-path">path</button>
    </div>
  </div>
  <div id="files">
${files.map(renderFile).join('\n')}
  </div>

  <p class="footer">Generated by <code>scripts/present-pr.mjs</code> · ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC · diff fetched via <code>gh pr diff ${pr.number}</code>.</p>
</div>

<script>
var SANKEY_DATA = ${JSON.stringify(files.map((f, i) => ({
  id: `f${i}`, path: f.path, name: f.path.split('/').pop(), cat: f.cat, area: f.area, pkg: f.pkg,
  add: f.additions, del: f.deletions, rank: f.rank,
})))};
</script>
<script>
(function () {
  var fileEls = Array.prototype.slice.call(document.querySelectorAll('.file'));
  var boxes = Array.prototype.slice.call(document.querySelectorAll('.chip input'));
  var summary = document.getElementById('visible-summary');
  var svg = document.getElementById('sankey-svg');
  var NS = 'http://www.w3.org/2000/svg';

  var BAR = 10, GAP = 7, TOP = 30, BOT = 12, MAX_FILE_NODES = 26;
  var showFiles = SANKEY_DATA.length <= 24;

  function el(name, attrs) {
    var node = document.createElementNS(NS, name);
    for (var k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) node.setAttribute(k, attrs[k]);
    return node;
  }
  function weight(n) { return Math.max(1, n.add + n.del); }
  function trunc(text, max) { return text.length <= max ? text : text.slice(0, Math.max(1, max - 1)) + '…'; }
  function title(node, text) {
    var t = document.createElementNS(NS, 'title');
    t.textContent = text;
    node.appendChild(t);
    return node;
  }

  /* Level 1 = area (packages / apps / plugins / tools / docs), level 2 = the
     individual package, level 3 = files. That is the reviewer's own order of
     questions: what kind of thing is touched, then is the package scope right,
     then which diff matters. Each column is ordered by its parent's position
     and then by churn, so ribbons stay monotonic and never cross — the same
     barycentre intent as the workspace PR-tracker sankey, free here because
     the hierarchy is a strict tree.
     A node's dominant category colours it, keeping the chip colour language. */
  function dominant(counts) {
    var best = null;
    for (var c in counts) if (best === null || counts[c] > counts[best]) best = c;
    return best || 'prod';
  }

  function build(rows) {
    var areas = {}, pkgs = {}, filesCol = [];
    rows.forEach(function (r) {
      var ak = 'a:' + r.area;
      var pk = ak + '>p:' + r.pkg;
      var fk = pk + '>f:' + r.id;
      areas[ak] = areas[ak] || { key: ak, chain: ak, label: r.area, mix: {}, add: 0, del: 0, files: 0, kind: 'area', best: r };
      pkgs[pk] = pkgs[pk] || { key: pk, chain: pk, parent: ak, label: r.pkg, mix: {}, add: 0, del: 0, files: 0, kind: 'pkg', best: r };
      areas[ak].add += r.add; areas[ak].del += r.del; areas[ak].files += 1;
      areas[ak].mix[r.cat] = (areas[ak].mix[r.cat] || 0) + r.add + r.del;
      pkgs[pk].add += r.add; pkgs[pk].del += r.del; pkgs[pk].files += 1;
      pkgs[pk].mix[r.cat] = (pkgs[pk].mix[r.cat] || 0) + r.add + r.del;
      if (r.rank < pkgs[pk].best.rank) pkgs[pk].best = r;
      if (r.rank < areas[ak].best.rank) areas[ak].best = r;
      filesCol.push({ key: fk, chain: fk, parent: pk, label: r.name, sub: r.path, cat: r.cat, add: r.add, del: r.del, files: 1, kind: 'file', id: r.id });
    });
    Object.keys(areas).forEach(function (k) { areas[k].cat = dominant(areas[k].mix); });
    Object.keys(pkgs).forEach(function (k) { pkgs[k].cat = dominant(pkgs[k].mix); });
    var cats = areas, groups = pkgs;
    if (!showFiles) filesCol = [];

    // Cap the file column by folding each group's long tail into an honest
    // "N more" node rather than dropping files silently.
    if (filesCol.length > MAX_FILE_NODES) {
      var ranked = filesCol.slice().sort(function (a, b) { return weight(b) - weight(a); });
      var keep = {};
      ranked.slice(0, MAX_FILE_NODES - 1).forEach(function (n) { keep[n.key] = true; });
      var folded = {};
      var kept = [];
      filesCol.forEach(function (n) {
        if (keep[n.key]) { kept.push(n); return; }
        var ok = n.parent + '>f:more';
        folded[ok] = folded[ok] || { key: ok, chain: ok, parent: n.parent, label: '', cat: n.cat, add: 0, del: 0, files: 0, kind: 'more' };
        folded[ok].add += n.add; folded[ok].del += n.del; folded[ok].files += 1;
      });
      for (var ok in folded) { folded[ok].label = folded[ok].files + ' more'; kept.push(folded[ok]); }
      filesCol = kept;
    }

    var catList = Object.keys(cats).map(function (k) { return cats[k]; }).sort(function (a, b) { return weight(b) - weight(a); });
    var catIndex = {}; catList.forEach(function (n, i) { catIndex[n.key] = i; });
    var groupList = Object.keys(groups).map(function (k) { return groups[k]; }).sort(function (a, b) {
      var d = catIndex[a.parent] - catIndex[b.parent];
      return d || weight(b) - weight(a) || a.label.localeCompare(b.label);
    });
    var groupIndex = {}; groupList.forEach(function (n, i) { groupIndex[n.key] = i; });
    filesCol.sort(function (a, b) {
      var d = groupIndex[a.parent] - groupIndex[b.parent];
      if (d) return d;
      if ((a.kind === 'more') !== (b.kind === 'more')) return a.kind === 'more' ? 1 : -1;
      return weight(b) - weight(a) || a.label.localeCompare(b.label);
    });
    return [catList, groupList, filesCol].filter(function (column) { return column.length > 0; });
  }

  function render() {
    if (!svg) return;
    var on = {};
    boxes.forEach(function (b) { on[b.dataset.cat] = b.checked; });
    var rows = SANKEY_DATA.filter(function (r) { return on[r.cat]; });
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (rows.length === 0) { svg.setAttribute('height', 0); return; }

    var columns = build(rows);
    var host = svg.parentNode;
    var width = Math.max(760, (host && host.clientWidth ? host.clientWidth : 900) - 4);
    var slot = width / columns.length;
    var maxRows = columns.reduce(function (m, c) { return Math.max(m, c.length); }, 1);
    var height = Math.max(240, TOP + BOT + maxRows * 22);

    columns.forEach(function (column, ci) {
      var total = column.reduce(function (sum, n) { return sum + weight(n); }, 0) || 1;
      var avail = height - TOP - BOT - Math.max(0, column.length - 1) * GAP;
      var y = TOP;
      column.forEach(function (n) {
        n.x = 10 + ci * slot;
        n.h = Math.max(9, weight(n) / total * avail);
        n.y = y;
        y += n.h + GAP;
      });
      height = Math.max(height, y - GAP + BOT);
    });

    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);

    ['area', 'package', 'file'].slice(0, columns.length).forEach(function (name, ci) {
      var label = el('text', { x: 10 + ci * slot, y: 14, class: 'sk-col' });
      label.textContent = name;
      svg.appendChild(label);
    });

    // Ribbons first so node bars sit on top of them.
    var byKey = {};
    columns.forEach(function (column) { column.forEach(function (n) { byKey[n.key] = n; }); });
    var out = {}, into = {};
    columns.slice(1).forEach(function (column) {
      column.forEach(function (target) {
        var source = byKey[target.parent];
        if (!source) return;
        var oy = source.y + (out[source.key] || 0);
        var iy = target.y + (into[target.key] || 0);
        var share = weight(target) / Math.max(1, weight(source));
        var h1 = Math.max(1.2, source.h * share);
        var h2 = target.h;
        out[source.key] = (out[source.key] || 0) + h1;
        into[target.key] = (into[target.key] || 0) + h2;
        var x1 = source.x + BAR, x2 = target.x, mid = (x1 + x2) / 2;
        var d = 'M ' + x1 + ' ' + oy + ' C ' + mid + ' ' + oy + ', ' + mid + ' ' + iy + ', ' + x2 + ' ' + iy +
          ' L ' + x2 + ' ' + (iy + h2) + ' C ' + mid + ' ' + (iy + h2) + ', ' + mid + ' ' + (oy + h1) + ', ' + x1 + ' ' + (oy + h1) + ' Z';
        var ribbon = el('path', { d: d, class: 'sk-el sk-rib', 'data-chain': target.chain, 'data-act': target.kind === 'file' ? target.id : '' });
        ribbon.style.fill = 'var(--cat-' + target.cat + ')';
        ribbon.style.opacity = '0.26';
        svg.appendChild(title(ribbon, source.label + ' → ' + target.label + '  +' + target.add + ' −' + target.del));
      });
    });

    var maxChars = Math.max(6, Math.floor((slot - BAR - 34) / 6.1));
    columns.forEach(function (column, ci) {
      column.forEach(function (n) {
        var act = n.kind === 'file' ? n.id : (n.best ? n.best.id : '');
        var bar = n.kind === 'pkg' ? BAR + 5 : BAR;
        var group = el('g', { class: 'sk-el sk-node', 'data-chain': n.chain, 'data-kind': n.kind, 'data-cat': n.cat, 'data-act': act });
        if (n.kind === 'area') {
          var solid = el('rect', { x: n.x, y: n.y, width: bar, height: n.h, rx: 2 });
          solid.style.fill = 'var(--cat-' + n.cat + ')';
          group.appendChild(solid);
        } else {
          // Split the bar add/green over del/red, in proportion — the same
          // encoding the diff rows use, so the two read as one language.
          var w = weight(n);
          var addH = n.add > 0 ? Math.max(1.5, n.add / w * n.h) : 0;
          var delH = Math.max(0, n.h - addH);
          if (addH > 0) {
            var a = el('rect', { x: n.x, y: n.y, width: bar, height: addH, rx: 2 });
            a.style.fill = 'var(--add-fg)';
            group.appendChild(a);
          }
          if (delH > 0.5) {
            var dRect = el('rect', { x: n.x, y: n.y + addH, width: bar, height: delH, rx: 2 });
            dRect.style.fill = 'var(--del-fg)';
            group.appendChild(dRect);
          }
        }
        // Packages carry a second line with their own ±counts: the scope check
        // ("why is this PR in that package at all?") is read here, not in the diff.
        var twoLine = n.kind === 'pkg' && n.h >= 22;
        var text = el('text', {
          x: n.x + bar + 6,
          y: n.y + n.h / 2 + (twoLine ? -1 : 3.5),
          class: 'sk-label' + (n.kind === 'more' ? ' sub' : '') + (n.kind === 'pkg' ? ' strong' : ''),
        });
        text.textContent = trunc(n.label, maxChars);
        group.appendChild(text);
        if (n.kind === 'pkg') {
          var counts = el('text', { x: n.x + bar + 6, y: n.y + n.h / 2 + (twoLine ? 11 : 3.5) + (twoLine ? 0 : 0), class: 'sk-label sub' });
          if (!twoLine) counts.setAttribute('x', n.x + bar + 12 + trunc(n.label, maxChars).length * 6.1);
          var addSpan = el('tspan', {}); addSpan.style.fill = 'var(--add-fg)'; addSpan.textContent = '+' + n.add;
          var delSpan = el('tspan', {}); delSpan.style.fill = 'var(--del-fg)'; delSpan.textContent = ' −' + n.del;
          var fileSpan = el('tspan', {}); fileSpan.textContent = '  ' + n.files + 'f';
          counts.appendChild(addSpan); counts.appendChild(delSpan); counts.appendChild(fileSpan);
          group.appendChild(counts);
        }
        group.appendChild(el('rect', { x: n.x, y: n.y, width: slot - 14, height: n.h, class: 'sk-hit' }));
        var hint = n.kind === 'more' ? '' : '  (click to open the most important diff here)';
        svg.appendChild(title(group, (n.sub || n.label) + '  ' + n.files + ' file' + (n.files === 1 ? '' : 's') + '  +' + n.add + ' −' + n.del + hint));
      });
    });
  }

  /* Chains are '>'-joined ancestor paths, so "is this element on the hovered
     element's branch?" is a prefix test in either direction. */
  function focusChain(chain) {
    var all = svg ? svg.querySelectorAll('.sk-el') : [];
    for (var i = 0; i < all.length; i += 1) {
      var own = all[i].getAttribute('data-chain') || '';
      var related = !chain || own.indexOf(chain) === 0 || chain.indexOf(own) === 0;
      all[i].classList.toggle('dim', !related);
    }
  }

  function openFile(id) {
    var target = document.getElementById(id);
    if (!target || target.hidden) return;
    target.open = true;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  if (svg) {
    svg.addEventListener('mouseover', function (event) {
      var node = event.target.closest('.sk-el');
      if (node) focusChain(node.getAttribute('data-chain'));
    });
    svg.addEventListener('mouseleave', function () { focusChain(null); });
    svg.addEventListener('click', function (event) {
      var node = event.target.closest('.sk-el');
      if (!node) return;
      // Area and package nodes carry the id of their most important file, so a
      // click anywhere in the flow lands on the diff worth reading there.
      var act = node.getAttribute('data-act');
      if (act) openFile(act);
    });
    window.addEventListener('resize', function () { render(); });
  }

  var filesToggle = document.getElementById('toggle-files');
  if (filesToggle) {
    filesToggle.addEventListener('click', function () {
      showFiles = !showFiles;
      filesToggle.textContent = showFiles ? 'Hide file level' : 'Show file level';
      render();
    });
  }

  var byImportance = fileEls.slice().sort(function (a, b) { return +a.dataset.rank - +b.dataset.rank; });
  var byPath = fileEls.slice().sort(function (a, b) { return a.dataset.path.localeCompare(b.dataset.path); });
  var list = document.getElementById('files');
  var sortButtons = { importance: document.getElementById('sort-importance'), path: document.getElementById('sort-path') };
  function sortBy(mode) {
    (mode === 'path' ? byPath : byImportance).forEach(function (elm) { list.appendChild(elm); });
    sortButtons.importance.classList.toggle('on', mode !== 'path');
    sortButtons.path.classList.toggle('on', mode === 'path');
  }
  sortButtons.importance.addEventListener('click', function () { sortBy('importance'); });
  sortButtons.path.addEventListener('click', function () { sortBy('path'); });

  function apply() {
    var on = {};
    boxes.forEach(function (b) { on[b.dataset.cat] = b.checked; });
    var n = 0;
    fileEls.forEach(function (elm) {
      var show = !!on[elm.dataset.cat];
      elm.hidden = !show;
      if (show) n += 1;
    });
    summary.textContent = n + ' of ' + fileEls.length + ' files shown';
    render();
  }
  boxes.forEach(function (b) { b.addEventListener('change', apply); });
  document.getElementById('expand').addEventListener('click', function () {
    fileEls.forEach(function (elm) { if (!elm.hidden) elm.open = true; });
  });
  document.getElementById('collapse').addEventListener('click', function () {
    fileEls.forEach(function (elm) { elm.open = false; });
  });
  apply();
})();
</script>
`

const outPath = path.resolve(args.out || `pr-${pr.number}-presentation.html`)
writeFileSync(outPath, html)
console.log(`${outPath}\n${files.length} files · ${CATEGORIES.map((c) => `${c.id}=${totals[c.id].files}`).join(' ')}`)
