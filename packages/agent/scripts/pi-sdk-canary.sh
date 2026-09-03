#!/usr/bin/env bash
# Verify the exact coordinated @earendil-works/pi-* family against npm.
# Usage: pnpm run pi-sdk:canary [--test]
# --test runs contracts against the installed pin after all latest/pin checks.
set -euo pipefail

PREFIX="[pi-canary]"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$AGENT_DIR/../.." && pwd)"
PACKAGES=(coding-agent agent-core ai client protocol telemetry tui)

log() { echo "$PREFIX $*" >&2; }

PINNED="$(node - "$ROOT_DIR" <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
const root = process.argv[2]
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const family = {
  'coding-agent': ['@mariozechner/pi-coding-agent', /^npm:@earendil-works\/pi-coding-agent@(\d+\.\d+\.\d+)$/],
  'agent-core': ['@earendil-works/pi-agent-core', /^(\d+\.\d+\.\d+)$/],
  ai: ['@earendil-works/pi-ai', /^(\d+\.\d+\.\d+)$/],
  client: ['@earendil-works/pi-client', /^(\d+\.\d+\.\d+)$/],
  protocol: ['@earendil-works/pi-protocol', /^(\d+\.\d+\.\d+)$/],
  telemetry: ['@earendil-works/pi-telemetry', /^(\d+\.\d+\.\d+)$/],
  tui: ['@earendil-works/pi-tui', /^(\d+\.\d+\.\d+)$/],
}
const versions = []
for (const [short, [name, pattern]] of Object.entries(family)) {
  const value = pkg.pnpm?.overrides?.[name]
  const match = typeof value === 'string' ? pattern.exec(value) : null
  if (!match) throw new Error(`missing exact root override for ${name}`)
  versions.push(match[1])
  process.stderr.write(`[pi-canary] root override ${short}: ${match[1]}\n`)
}
if (new Set(versions).size !== 1) throw new Error(`root Pi overrides drifted: ${versions.join(', ')}`)
const pinned = versions[0]

const installed = {
  'coding-agent': '@mariozechner/pi-coding-agent',
  'agent-core': '@earendil-works/pi-agent-core',
  ai: '@earendil-works/pi-ai',
  client: '@earendil-works/pi-client',
  protocol: '@earendil-works/pi-protocol',
  telemetry: '@earendil-works/pi-telemetry',
  tui: '@earendil-works/pi-tui',
}
for (const [short, specifier] of Object.entries(installed)) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', specifier, 'package.json'), 'utf8'))
  if (manifest.version !== pinned) throw new Error(`installed ${specifier} drifted: ${manifest.version} != ${pinned}`)
  process.stderr.write(`[pi-canary] installed ${short}: ${manifest.version}\n`)
}

const packageFiles = require('node:child_process')
  .execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files', '-z', 'package.json', '**/package.json'], { cwd: root })
  .toString('utf8').split('\0').filter(Boolean)
const piNames = new Set(Object.values(family).map(([name]) => name))
for (const file of packageFiles) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'))
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [name, value] of Object.entries(manifest[section] ?? {})) {
      if (!piNames.has(name)) continue
      const expected = name === '@mariozechner/pi-coding-agent'
        ? `npm:@earendil-works/pi-coding-agent@${pinned}`
        : pinned
      if (value !== expected) throw new Error(`${file} ${section}.${name} must be exact ${expected}; found ${value}`)
    }
  }
}
process.stdout.write(pinned)
NODE
)"

latest=""
for name in "${PACKAGES[@]}"; do
  version="$(npm info "@earendil-works/pi-$name" version 2>/dev/null || true)"
  if [[ -z "$version" ]]; then
    log "ERR: could not fetch @earendil-works/pi-$name from npm"
    exit 2
  fi
  log "@earendil-works/pi-$name latest: $version"
  if [[ -n "$latest" && "$version" != "$latest" ]]; then
    log "ERR: latest published Pi family is not coordinated ($latest vs $version)"
    exit 2
  fi
  latest="$version"
done

log "coordinated pin: $PINNED"
if [[ "$PINNED" != "$latest" ]]; then
  log "NEW COORDINATED VERSION AVAILABLE: $PINNED -> $latest"
  log "Upgrade every root override and direct dependency exactly, install it, then rerun this canary with --test."
  exit 1
fi

log "OK — root overrides, all installed manifests, publishable direct consumers, and npm latest agree"
if [[ " $* " == *" --test "* ]]; then
  log "Running contracts against installed published version $PINNED"
  pnpm --dir "$AGENT_DIR" exec vitest run src/server/models/__tests__/piPublishedPackage.contract.test.ts
fi
