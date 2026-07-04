#!/usr/bin/env node
// content-lint.mjs — enforce the Polish Bar rubric on content/*.mdx
//
// Checks every .mdx file against the rubric in references/CONTENT-TEMPLATES.md.
// Exit 0 if all pages pass; 1 if any page fails.
//
// Usage:
//   content-lint.mjs <dir>
//
// Flags each failure with a code (P1..P8) and a one-line reason.

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'

const root = process.argv[2] ?? 'content'

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name.startsWith('_')) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) yield* walk(p)
    else if (e.isFile() && e.name.endsWith('.mdx')) yield p
  }
}

function stripFrontmatter(src) {
  if (!src.startsWith('---')) return src
  const end = src.indexOf('\n---', 3)
  if (end === -1) return src
  return src.slice(end + 4).replace(/^\n+/, '')
}

function firstParagraphWords(src) {
  const body = stripFrontmatter(src)
  // Skip leading headings/imports; grab the first non-heading prose paragraph.
  const paras = body.split(/\n{2,}/).map(p => p.trim())
  for (const p of paras) {
    if (!p) continue
    if (p.startsWith('#')) continue
    if (p.startsWith('import ')) continue
    if (p.startsWith('<')) continue
    if (p.startsWith('```')) continue
    return p.split(/\s+/).filter(Boolean).length
  }
  return 0
}

function hasMentalModel(src) {
  return (
    /```mermaid/.test(src) ||
    /<FileTree/.test(src) ||
    /<Cards/.test(src) ||
    /!\[.*\]\(.*\.(png|jpg|svg)\)/.test(src) ||
    /^```\w*\n[\s\S]*?[│├└─|─+]/m.test(src) // ascii diagram in a code block
  )
}

function hasCodeExample(src) {
  return /```[a-zA-Z][\w+-]*\n/.test(src)
}

function hasPitfalls(src) {
  return (
    /<Callout\s+type=["'](warning|error|important)["']/.test(src) ||
    /^###+\s+(Gotchas?|Pitfalls?|Caveats?|Common mistakes?)/im.test(src) ||
    /> \[!(WARNING|CAUTION|IMPORTANT)\]/.test(src)
  )
}

function hasMotivationInOpening(src) {
  const opening = stripFrontmatter(src).slice(0, 1200).toLowerCase()
  return /\b(why|because|motivated|exists to|solves|we need|problem)\b/.test(opening)
}

function countCrossLinks(src) {
  const matches = src.match(/\]\((?!https?:|#)[^)]+\)/g) ?? []
  return matches.length
}

function hasPlaceholder(src) {
  return /\b(TODO|XXX|FIXME|lorem ipsum)\b/i.test(src) || /\{\{[^}]+\}\}/.test(src)
}

function endsCleanly(src) {
  const trimmed = src.replace(/\s+$/, '')
  if (!trimmed) return false
  const last = trimmed.slice(-1)
  return ['.', '!', '?', '>', ')', '`', '|', ']'].includes(last)
}

const failures = []
let checked = 0

for await (const path of walk(root)) {
  checked++
  const src = await readFile(path, 'utf8')
  const isOverview =
    /\/overview\.mdx$|\/index\.mdx$/.test(path) ||
    /\/overview\//.test(path) ||
    /\/(glossary|contributing|architecture|data-flow|faq|releases?|changelog|about|what-is-this)\.mdx$/.test(path)
  const fails = []

  if (firstParagraphWords(src) < 40) fails.push(['P1', 'intro paragraph <40 words'])
  if (!hasMotivationInOpening(src)) fails.push(['P2', 'no motivation in opening (why/because/...)'])
  if (!hasMentalModel(src)) fails.push(['P3', 'no mental model (diagram/cards/tree/image)'])
  if (!hasCodeExample(src)) fails.push(['P4', 'no fenced code example'])
  if (!isOverview && !hasPitfalls(src)) fails.push(['P5', 'no pitfalls / warning callout'])
  if (countCrossLinks(src) < 2) fails.push(['P6', 'fewer than 2 cross-links'])
  if (hasPlaceholder(src)) fails.push(['P7', 'contains TODO/placeholder'])
  if (!endsCleanly(src)) fails.push(['P8', 'ends mid-sentence or on whitespace'])

  if (fails.length) failures.push({ path, fails })
}

if (failures.length === 0) {
  console.log(`OK — ${checked} pages pass the Polish Bar`)
  process.exit(0)
}

for (const f of failures) {
  console.log(`FAIL ${f.path}`)
  for (const [code, msg] of f.fails) console.log(`  ${code}: ${msg}`)
}
console.log(`\n${failures.length} / ${checked} pages failed`)
process.exit(1)
