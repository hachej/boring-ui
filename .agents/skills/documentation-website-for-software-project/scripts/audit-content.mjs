#!/usr/bin/env node
// audit-content.mjs — comprehensive content-quality audit against the
// Polish Bar + QUALITY-METRICS rubric.
//
// Unlike content-lint.mjs (pass/fail gate), this produces a full metrics
// snapshot that phases 4/6/7 use to decide termination.
//
// Usage:
//   audit-content.mjs <content-dir> [--out phase_metrics.json]
//
// Emits JSON to the output file and a summary to stdout.

import { readFile, readdir, writeFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import process from 'node:process'

const args = process.argv.slice(2)
const root = args[0] ?? 'content'
const outArgIdx = args.indexOf('--out')
const out = outArgIdx !== -1 ? args[outArgIdx + 1] : null

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

function stripCode(src) {
  return src.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]+`/g, '')
}

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function fleschReadingEase(text) {
  // Standard formula: 206.835 - 1.015 * (words/sentences) - 84.6 * (syllables/words)
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return 100
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0).length || 1
  const syllables = words.reduce((acc, w) => acc + countSyllables(w), 0)
  return Math.round(
    (206.835 - 1.015 * (words.length / sentences) - 84.6 * (syllables / words.length)) * 10
  ) / 10
}

function countSyllables(word) {
  // Crude heuristic — good enough for aggregate metrics
  word = word.toLowerCase().replace(/[^a-z]/g, '')
  if (!word) return 0
  if (word.length <= 3) return 1
  word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '')
  word = word.replace(/^y/, '')
  const matches = word.match(/[aeiouy]+/g)
  return matches ? matches.length : 1
}

function avgSentenceLength(text) {
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0)
  if (sentences.length === 0) return 0
  return Math.round(
    sentences.reduce((acc, s) => acc + s.trim().split(/\s+/).filter(Boolean).length, 0) /
      sentences.length * 10
  ) / 10
}

const SLOP_PATTERNS = [
  { name: "Here's why", re: /\bHere'?s why\b/gi },
  { name: "It's not X, it's Y", re: /\bit'?s not [a-z\s]+?,? it'?s\b/gi },
  { name: "Let's dive in", re: /\blet'?s dive in\b/gi },
  { name: "At its core", re: /\bAt its core\b/gi },
  { name: "It's worth noting", re: /\bIt'?s worth noting\b/gi },
  { name: "In this section/guide", re: /\bIn this (?:section|guide|article|chapter)\b/gi }
]

function checkSlop(src) {
  const violations = []
  for (const { name, re } of SLOP_PATTERNS) {
    const m = src.match(re)
    if (m && m.length > 0) violations.push({ pattern: name, count: m.length })
  }
  return violations
}

function countEmdashes(src) {
  const m = src.match(/—/g)
  return m ? m.length : 0
}

function detectOperators(src, pathRel) {
  // Heuristic detection matching OPERATOR-LIBRARY.md
  const body = stripFrontmatter(src)
  const prose = stripCode(body)

  const isOverview = /\/overview\//.test(pathRel) ||
    /\/(glossary|contributing|architecture|data-flow|index|what-is-this)\.mdx$/.test(pathRel)

  const firstPara = body.split(/\n{2,}/).find(p => {
    const t = p.trim()
    return t && !t.startsWith('#') && !t.startsWith('import ') && !t.startsWith('<') && !t.startsWith('```')
  }) || ''

  const opening = body.slice(0, 1200).toLowerCase()
  const hasWhyWord = /\b(why|because|motivated|exists to|solves|we need|problem)\b/.test(opening)

  const hasMentalModel =
    /```mermaid/.test(src) ||
    /<FileTree/.test(src) ||
    /<Cards/.test(src) ||
    /!\[.*\]\([^)]+\.(png|jpg|svg)\)/.test(src) ||
    /^```\w*\n[\s\S]*?[│├└─|─+]/m.test(src)

  const hasCodeExample = /```[a-zA-Z][\w+-]*\n/.test(src)

  const hasPitfalls =
    /<Callout\s+type=["'](warning|error|important)["']/.test(src) ||
    /^###+\s+(Gotchas?|Pitfalls?|Caveats?|Common mistakes?)/im.test(src) ||
    /> \[!(WARNING|CAUTION|IMPORTANT)\]/.test(src)

  const hasTip =
    /<Callout\s+type=["']info["']/.test(src) ||
    /^###+\s+(Tips?|Pro tip|Beyond the basics)/im.test(src) ||
    /> \[!(TIP|NOTE)\]/.test(src)

  const crossLinks = (src.match(/\]\((?!https?:|#)[^)]+\)/g) ?? []).length

  return {
    orient: wordCount(firstPara) >= 40,
    motivate: hasWhyWord,
    mental_model: hasMentalModel,
    exemplify: hasCodeExample,
    warn: isOverview || hasPitfalls,
    tip: hasTip,
    cross_link: crossLinks >= 2,
    is_overview: isOverview,
    cross_link_count: crossLinks
  }
}

async function main() {
  const pages = []
  let totalWords = 0
  let totalSlopViolations = 0
  let totalEmdashes = 0
  const forbidden = {}
  const opCoverage = { orient: 0, motivate: 0, mental_model: 0, exemplify: 0, warn: 0, tip: 0, cross_link: 0 }
  let pagesWithExample = 0
  let pagesWithMentalModel = 0
  let totalLinks = 0
  let headingSkips = 0

  for await (const path of walk(root)) {
    const src = await readFile(path, 'utf8')
    const pathRel = relative(root, path)
    const body = stripFrontmatter(src)
    const prose = stripCode(body)
    const words = wordCount(prose)
    const flesch = fleschReadingEase(prose)
    const asl = avgSentenceLength(prose)
    const slop = checkSlop(src)
    const emdashes = countEmdashes(prose)
    const ops = detectOperators(src, pathRel)

    // Heading skip detection
    const headings = [...body.matchAll(/^(#{1,6})\s/gm)].map(m => m[1].length)
    let skips = 0
    for (let i = 1; i < headings.length; i++) {
      if (headings[i] > headings[i - 1] + 1) skips++
    }
    headingSkips += skips

    for (const v of slop) {
      forbidden[v.pattern] = (forbidden[v.pattern] || 0) + v.count
      totalSlopViolations += v.count
    }
    totalWords += words
    totalEmdashes += emdashes
    if (ops.exemplify) pagesWithExample++
    if (ops.mental_model) pagesWithMentalModel++
    if (ops.orient) opCoverage.orient++
    if (ops.motivate) opCoverage.motivate++
    if (ops.mental_model) opCoverage.mental_model++
    if (ops.exemplify) opCoverage.exemplify++
    if (ops.warn) opCoverage.warn++
    if (ops.tip) opCoverage.tip++
    if (ops.cross_link) opCoverage.cross_link++
    totalLinks += ops.cross_link_count

    pages.push({
      path: pathRel,
      words,
      flesch,
      avg_sentence_length: asl,
      emdashes,
      slop_violations: slop,
      operators: {
        orient: ops.orient,
        motivate: ops.motivate,
        mental_model: ops.mental_model,
        exemplify: ops.exemplify,
        warn: ops.warn,
        tip: ops.tip,
        cross_link: ops.cross_link
      },
      heading_skips: skips
    })
  }

  const n = pages.length
  pages.sort((a, b) => a.words - b.words)
  const median = n ? pages[Math.floor(n / 2)].words : 0
  const p5 = n ? pages[Math.floor(n * 0.05)].words : 0
  const p95 = n ? pages[Math.floor(n * 0.95)].words : 0
  const underbaked = pages.filter(p => p.words < 150).length
  const toolong = pages.filter(p => p.words > 3000).length

  const avgFlesch = n ? pages.reduce((a, p) => a + p.flesch, 0) / n : 0
  const avgAsl = n ? pages.reduce((a, p) => a + p.avg_sentence_length, 0) / n : 0

  const metrics = {
    timestamp: new Date().toISOString(),
    total_pages: n,
    total_words: totalWords,
    coverage: {
      pages_with_example: `${pagesWithExample}/${n}`,
      pages_with_example_pct: n ? Math.round((pagesWithExample / n) * 100) : 0,
      pages_with_mental_model: `${pagesWithMentalModel}/${n}`,
      pages_with_mental_model_pct: n ? Math.round((pagesWithMentalModel / n) * 100) : 0
    },
    density: {
      median_words_per_page: median,
      p5_words_per_page: p5,
      p95_words_per_page: p95,
      pages_under_150_words: underbaked,
      pages_over_3000_words: toolong,
      avg_links_per_page: n ? Math.round((totalLinks / n) * 10) / 10 : 0
    },
    readability: {
      avg_flesch_reading_ease: Math.round(avgFlesch * 10) / 10,
      avg_sentence_length: Math.round(avgAsl * 10) / 10,
      pages_below_flesch_40: pages.filter(p => p.flesch < 40).length
    },
    slop: {
      total_emdashes: totalEmdashes,
      emdash_per_1000_words: totalWords ? Math.round((totalEmdashes / totalWords) * 10000) / 10 : 0,
      forbidden_pattern_totals: forbidden,
      total_slop_violations: totalSlopViolations
    },
    structural: {
      heading_skips: headingSkips
    },
    operator_coverage: {
      orient: `${opCoverage.orient}/${n}`,
      motivate: `${opCoverage.motivate}/${n}`,
      mental_model: `${opCoverage.mental_model}/${n}`,
      exemplify: `${opCoverage.exemplify}/${n}`,
      warn: `${opCoverage.warn}/${n}`,
      tip: `${opCoverage.tip}/${n}`,
      cross_link: `${opCoverage.cross_link}/${n}`
    },
    pages
  }

  if (out) {
    await writeFile(out, JSON.stringify(metrics, null, 2), 'utf8')
    console.log(`wrote ${out}`)
  }

  // Human summary
  console.log(`\n=== content audit (${n} pages, ${totalWords} words) ===`)
  console.log(`example coverage: ${metrics.coverage.pages_with_example_pct}%  (target ≥90%)`)
  console.log(`mental model:     ${metrics.coverage.pages_with_mental_model_pct}%  (target ≥30%)`)
  console.log(`median words:     ${median}  (sweet spot 300-2000)`)
  console.log(`underbaked <150w: ${underbaked}`)
  console.log(`too long >3000w:  ${toolong}`)
  console.log(`flesch (avg):     ${metrics.readability.avg_flesch_reading_ease}  (target 50-70)`)
  console.log(`emdash/1000w:     ${metrics.slop.emdash_per_1000_words}  (target ≤2)`)
  console.log(`slop patterns:    ${totalSlopViolations}  (target 0 for critical)`)
  console.log(`heading skips:    ${headingSkips}  (target 0)`)
  console.log(`links/page (avg): ${metrics.density.avg_links_per_page}  (target ≥4)`)
  console.log(`\noperator coverage:`)
  for (const [op, val] of Object.entries(metrics.operator_coverage)) {
    console.log(`  ${op.padEnd(15)} ${val}`)
  }
  if (Object.keys(forbidden).length) {
    console.log(`\nforbidden patterns:`)
    for (const [p, c] of Object.entries(forbidden)) {
      console.log(`  ${p}: ${c}`)
    }
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
