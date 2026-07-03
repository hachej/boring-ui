#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const args = new Map()
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i]
  if (!arg.startsWith('--')) continue
  const key = arg.slice(2)
  const next = process.argv[i + 1]
  if (next && !next.startsWith('--')) {
    args.set(key, next)
    i += 1
  } else {
    args.set(key, 'true')
  }
}

const baseRef = args.get('base') ?? process.env.DEPENDENCY_AGE_BASE_REF ?? 'origin/main'
const minAgeDays = Number(args.get('min-age-days') ?? process.env.DEPENDENCY_MIN_AGE_DAYS ?? '7')
const now = new Date(process.env.DEPENDENCY_AGE_NOW ?? new Date().toISOString())
const cutoff = new Date(now.getTime() - minAgeDays * 24 * 60 * 60 * 1000)

const dependencySections = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
]

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' })
}

function readJsonAt(ref, file) {
  try {
    return JSON.parse(git(['show', `${ref}:${file}`]))
  } catch {
    return null
  }
}

function readJsonFile(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function packageJsonFilesChanged() {
  const output = git(['diff', '--name-only', `${baseRef}...HEAD`])
  return output
    .split('\n')
    .filter(Boolean)
    .filter((file) => file === 'package.json' || file.endsWith('/package.json'))
    .filter((file) => !file.includes('/node_modules/') && !file.includes('/dist/'))
}

function parseTarget(spec) {
  if (!spec || typeof spec !== 'string') return null
  if (
    spec.startsWith('workspace:') ||
    spec.startsWith('file:') ||
    spec.startsWith('link:') ||
    spec.startsWith('catalog:') ||
    spec === '*' ||
    spec.includes('||')
  ) return null

  if (spec.startsWith('npm:')) {
    const aliasSpec = spec.slice('npm:'.length)
    const at = aliasSpec.lastIndexOf('@')
    if (at <= 0) return null
    return { packageName: aliasSpec.slice(0, at), version: aliasSpec.slice(at + 1).replace(/^[~^]/, '') }
  }

  const version = spec.replace(/^[~^]/, '')
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) return null
  return { version }
}

function npmPublishedAt(packageName, version) {
  const raw = execFileSync('npm', ['view', `${packageName}@${version}`, 'time', '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const parsed = JSON.parse(raw)
  const published = parsed?.[version]
  if (!published) throw new Error(`No npm publish time for ${packageName}@${version}`)
  return new Date(published)
}

const violations = []
const checked = []

for (const file of packageJsonFilesChanged()) {
  const before = readJsonAt(baseRef, file) ?? {}
  const after = readJsonFile(file)
  if (!after) continue

  for (const section of dependencySections) {
    const beforeDeps = before[section] ?? {}
    const afterDeps = after[section] ?? {}
    for (const [name, afterSpec] of Object.entries(afterDeps)) {
      if (beforeDeps[name] === afterSpec) continue
      const target = parseTarget(afterSpec)
      if (!target) continue
      const packageName = target.packageName ?? name
      const version = target.version
      const publishedAt = npmPublishedAt(packageName, version)
      checked.push({ file, section, name, packageName, version, publishedAt })
      if (publishedAt > cutoff) {
        violations.push({ file, section, name, packageName, version, publishedAt })
      }
    }
  }
}

if (checked.length === 0) {
  console.log('dependency-age: no direct package.json version bumps found')
  process.exit(0)
}

console.log(`dependency-age: checked ${checked.length} direct version bump(s); minimum age ${minAgeDays} days; cutoff ${cutoff.toISOString()}`)

if (violations.length > 0) {
  console.error('dependency-age: found versions that are too fresh:')
  for (const item of violations) {
    console.error(
      `  - ${item.name}@${item.version} in ${item.file} (${item.section}) published ${item.publishedAt.toISOString()}`,
    )
  }
  console.error('Wait until each version is at least 7 days old, pin to an older release, or add the deps:allow-fresh label for an explicit owner override.')
  process.exit(1)
}

console.log('dependency-age: OK')
