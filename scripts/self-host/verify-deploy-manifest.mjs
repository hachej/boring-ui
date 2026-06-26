#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const COMMIT_SHA_RE = /^[0-9a-f]{40}$/
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/
const TAG_RE = /^prod-[A-Za-z0-9._-]{1,120}$/
const IMAGE_RE = /^ghcr\.io\/[a-z0-9][a-z0-9_.-]*(?:\/[a-z0-9][a-z0-9_.-]*)+$/
const WORKFLOW_RUN_ID_RE = /^[0-9]+$/

function usage() {
  return `Usage: node scripts/self-host/verify-deploy-manifest.mjs --manifest <path> --repository <owner/repo> --image <ghcr.io/owner/image> [--tag <prod-tag>] [--commit <sha>] [--workflow <name>] [--verify-attestation]\n\nDefault mode is offline/read-only. --verify-attestation explicitly calls the GitHub CLI and may use gh auth/network. This script validates one deploy gate only; deployd/operator must still verify actor, protected tag policy, CI status, commit ancestry, GHCR package access, and deploy lock state before deploying.`
}

function fail(message) {
  throw new Error(message)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0
}

export function validateDeployManifest(manifest, options) {
  const errors = []
  const check = (fn) => {
    try {
      fn()
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }

  check(() => {
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) fail('manifest must be an object')
  })
  if (errors.length > 0) return { ok: false, errors }

  check(() => {
    if (manifest.schemaVersion !== 1) fail('schemaVersion must be 1')
  })

  const fields = ['repository', 'ref', 'tag', 'commit', 'workflow', 'workflowRunId', 'image', 'digest', 'target', 'role']
  for (const field of fields) {
    check(() => {
      if (!isNonEmptyString(manifest[field])) fail(`${field} must be a non-empty string`)
    })
  }

  const repository = isNonEmptyString(manifest.repository) ? manifest.repository : ''
  const ref = isNonEmptyString(manifest.ref) ? manifest.ref : ''
  const tag = isNonEmptyString(manifest.tag) ? manifest.tag : ''
  const commit = isNonEmptyString(manifest.commit) ? manifest.commit : ''
  const workflow = isNonEmptyString(manifest.workflow) ? manifest.workflow : ''
  const workflowRunId = isNonEmptyString(manifest.workflowRunId) ? manifest.workflowRunId : ''
  const image = isNonEmptyString(manifest.image) ? manifest.image : ''
  const digest = isNonEmptyString(manifest.digest) ? manifest.digest : ''
  const target = isNonEmptyString(manifest.target) ? manifest.target : ''
  const role = isNonEmptyString(manifest.role) ? manifest.role : ''

  check(() => {
    if (repository !== options.repository) fail(`repository mismatch: expected ${options.repository}`)
  })
  check(() => {
    if (!TAG_RE.test(tag)) fail('tag must match prod-* and contain only safe tag characters')
  })
  check(() => {
    if (ref !== `refs/tags/${tag}`) fail('ref must equal refs/tags/<tag>')
  })
  check(() => {
    if (options.tag && tag !== options.tag) fail(`tag mismatch: expected ${options.tag}`)
  })
  check(() => {
    if (!COMMIT_SHA_RE.test(commit)) fail('commit must be a lowercase 40-character git SHA')
  })
  check(() => {
    if (options.commit && commit !== options.commit) fail(`commit mismatch: expected ${options.commit}`)
  })
  check(() => {
    if (!WORKFLOW_RUN_ID_RE.test(workflowRunId)) fail('workflowRunId must be numeric')
  })
  check(() => {
    if (options.workflow && workflow !== options.workflow) fail(`workflow mismatch: expected ${options.workflow}`)
  })
  check(() => {
    if (image !== options.image) fail(`image mismatch: expected ${options.image}`)
  })
  check(() => {
    if (!IMAGE_RE.test(image)) fail('image must be a ghcr.io image path')
  })
  check(() => {
    if (!DIGEST_RE.test(digest)) fail('digest must be a sha256 digest')
  })
  check(() => {
    if (target !== 'web-runtime') fail('target must be web-runtime')
  })
  check(() => {
    if (role !== 'web') fail('role must be web')
  })
  check(() => {
    if (!manifest.migration || typeof manifest.migration !== 'object') fail('migration must be an object')
  })
  check(() => {
    if (manifest.migration?.rollbackCompatible !== true) fail('migration.rollbackCompatible must be true')
  })
  check(() => {
    if (typeof manifest.migration?.classification !== 'string' || manifest.migration.classification.length === 0) {
      fail('migration.classification must be a non-empty string')
    }
  })

  return errors.length === 0
    ? { ok: true, image, digest, tag, commit, repository, workflow, workflowRunId }
    : { ok: false, errors }
}

function parseArgs(argv) {
  const args = {
    verifyAttestation: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--verify-attestation') {
      args.verifyAttestation = true
      continue
    }
    if (arg === '--help' || arg === '-h') {
      args.help = true
      continue
    }
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) fail(`missing value for ${arg}`)
    if (arg === '--manifest') args.manifestPath = next
    else if (arg === '--repository') args.repository = next
    else if (arg === '--image') args.image = next
    else if (arg === '--tag') args.tag = next
    else if (arg === '--commit') args.commit = next
    else if (arg === '--workflow') args.workflow = next
    else fail(`unknown argument: ${arg}`)
    i += 1
  }
  return args
}

function verifyAttestation({ image, digest, repository }) {
  execFileSync(
    'gh',
    ['attestation', 'verify', `oci://${image}@${digest}`, '--repo', repository],
    { stdio: 'inherit' },
  )
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  if (args.help) {
    console.log(usage())
    return 0
  }
  for (const field of ['manifestPath', 'repository', 'image']) {
    if (!args[field]) fail(`required argument missing: --${field === 'manifestPath' ? 'manifest' : field}`)
  }

  const manifest = JSON.parse(readFileSync(args.manifestPath, 'utf8'))
  const result = validateDeployManifest(manifest, args)
  if (!result.ok) {
    for (const error of result.errors) console.error(`ERR ${error}`)
    return 1
  }

  if (args.verifyAttestation) {
    verifyAttestation(result)
  }

  console.log(`OK manifest verified for ${result.image}@${result.digest}`)
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main()
  } catch (error) {
    console.error(`ERR ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
