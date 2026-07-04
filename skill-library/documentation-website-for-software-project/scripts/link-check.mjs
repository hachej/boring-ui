#!/usr/bin/env node
// link-check.mjs — verify every in-repo markdown link resolves. Optional
// external-link check is off by default (to avoid rate limits); pass
// --external to enable.
//
// Usage:
//   link-check.mjs <content-dir> [--external]
//
// Exits 1 if any in-repo link is broken; 0 otherwise. External brokenness
// is warn-only (always exit 0 for external issues alone).

import { readFile, readdir, stat } from 'node:fs/promises'
import { join, dirname, resolve, relative, extname } from 'node:path'
import process from 'node:process'

const args = process.argv.slice(2)
const root = args[0] ?? 'content'
const checkExternal = args.includes('--external')

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) yield* walk(p)
    else if (e.isFile() && (e.name.endsWith('.mdx') || e.name.endsWith('.md'))) yield p
  }
}

function extractLinks(src, filePath) {
  const links = []
  // Standard markdown links: [text](target) with optional title
  for (const m of src.matchAll(/\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    links.push({ text: m[1], target: m[2], filePath })
  }
  // <a href="..."> links in JSX
  for (const m of src.matchAll(/<a\s+[^>]*href=["']([^"']+)["']/g)) {
    links.push({ text: '(jsx a)', target: m[1], filePath })
  }
  // Next.js <Link href="..."> and <Cards.Card href="...">
  for (const m of src.matchAll(/href=["']([^"']+)["']/g)) {
    links.push({ text: '(jsx href)', target: m[1], filePath })
  }
  return links
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function resolveTarget(target, fromFile) {
  // Strip anchor
  const [pathPart, anchor] = target.split('#')
  if (!pathPart) return { kind: 'anchor-only', ok: true }  // in-page anchor

  // Absolute in-site (e.g., /docs/foo) — try resolving against content root
  if (pathPart.startsWith('/')) {
    // Try content + path (treating / as content root)
    const candidates = [
      join(root, pathPart),
      join(root, pathPart + '.mdx'),
      join(root, pathPart + '/index.mdx'),
      join(root, pathPart + '.md')
    ]
    for (const c of candidates) if (await exists(c)) return { kind: 'in-repo', ok: true, at: c }
    return { kind: 'in-repo', ok: false, tried: candidates }
  }

  // Relative path
  const fromDir = dirname(fromFile)
  const abs = resolve(fromDir, pathPart)
  const candidates = [
    abs,
    abs + '.mdx',
    abs + '.md',
    join(abs, 'index.mdx'),
    join(abs, 'index.md')
  ]
  for (const c of candidates) if (await exists(c)) return { kind: 'in-repo', ok: true, at: c }
  return { kind: 'in-repo', ok: false, tried: candidates }
}

async function checkExternalUrl(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(5000) })
    if (res.ok) return { ok: true, status: res.status }
    // Some servers reject HEAD; retry with GET
    const res2 = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(5000) })
    return { ok: res2.ok, status: res2.status }
  } catch (err) {
    return { ok: false, status: 0, error: err.message }
  }
}

async function main() {
  const allLinks = []
  for await (const path of walk(root)) {
    const src = await readFile(path, 'utf8')
    allLinks.push(...extractLinks(src, path))
  }

  const inRepoBroken = []
  const externalBroken = []

  for (const link of allLinks) {
    const target = link.target.trim()
    if (!target) continue
    if (target.startsWith('mailto:') || target.startsWith('#')) continue
    if (target.startsWith('http://') || target.startsWith('https://')) {
      if (checkExternal) {
        const r = await checkExternalUrl(target)
        if (!r.ok) externalBroken.push({ ...link, status: r.status, error: r.error })
      }
      continue
    }
    const r = await resolveTarget(target, link.filePath)
    if (r.kind === 'in-repo' && !r.ok) {
      inRepoBroken.push({ ...link, tried: r.tried })
    }
  }

  console.log(`\n=== link check (${allLinks.length} links in ${root}) ===`)
  if (inRepoBroken.length === 0) {
    console.log('✓ all in-repo links resolve')
  } else {
    console.log(`✗ ${inRepoBroken.length} broken in-repo links:`)
    for (const b of inRepoBroken) {
      console.log(`  ${relative('.', b.filePath)}: [${b.text}](${b.target})`)
    }
  }
  if (checkExternal) {
    if (externalBroken.length === 0) {
      console.log('✓ all external links resolve')
    } else {
      console.log(`⚠ ${externalBroken.length} broken external links (non-blocking):`)
      for (const b of externalBroken) {
        console.log(`  ${relative('.', b.filePath)}: ${b.target} (${b.status}${b.error ? ': ' + b.error : ''})`)
      }
    }
  }

  process.exit(inRepoBroken.length > 0 ? 1 : 0)
}

main().catch(err => { console.error(err); process.exit(2) })
