/**
 * TDD tests for bd-igyv2: Dockerfile validation for the TS server.
 *
 * Validates that the Dockerfile includes all required system packages,
 * build steps, and runtime configuration.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const DOCKERFILE_PATH = resolve(__dirname, '../../../deploy/ts/Dockerfile')

function getDockerfileContent(): string {
  if (!existsSync(DOCKERFILE_PATH)) {
    throw new Error(`Dockerfile not found at ${DOCKERFILE_PATH}`)
  }
  return readFileSync(DOCKERFILE_PATH, 'utf-8')
}

describe('TS server Dockerfile', () => {
  it('exists at deploy/ts/Dockerfile', () => {
    expect(existsSync(DOCKERFILE_PATH)).toBe(true)
  })
})

describe('Base image', () => {
  it('uses node:20-slim as build base', () => {
    const content = getDockerfileContent()
    expect(content).toMatch(/FROM\s+node:20-slim/)
  })
})

describe('Required system packages', () => {
  const requiredPackages = [
    'bubblewrap',
    'python3',
    'python3-venv',
    'git',
    'jq',
    'ripgrep',
    'tree',
    'curl',
  ]

  for (const pkg of requiredPackages) {
    it(`installs ${pkg}`, () => {
      const content = getDockerfileContent()
      expect(content).toContain(pkg)
    })
  }
})

describe('Build steps', () => {
  it('runs npm ci for dependency installation', () => {
    const content = getDockerfileContent()
    expect(content).toMatch(/npm ci/)
  })

  it('builds the frontend with vite', () => {
    const content = getDockerfileContent()
    expect(content).toMatch(/vite build/)
  })

  it('copies server source', () => {
    const content = getDockerfileContent()
    expect(content).toMatch(/COPY.*src\/server/)
  })

  it('copies shared source', () => {
    const content = getDockerfileContent()
    expect(content).toMatch(/COPY.*src\/shared/)
  })

  it('copies frontend dist from build stage', () => {
    const content = getDockerfileContent()
    expect(content).toMatch(/COPY\s+--from=.*dist/)
  })
})

describe('Runtime configuration', () => {
  it('sets BORING_UI_STATIC_DIR', () => {
    const content = getDockerfileContent()
    expect(content).toContain('BORING_UI_STATIC_DIR')
  })

  it('exposes port 8000', () => {
    const content = getDockerfileContent()
    expect(content).toMatch(/EXPOSE\s+8000/)
  })

  it('uses tsx to start the server', () => {
    const content = getDockerfileContent()
    expect(content).toMatch(/CMD.*tsx.*src\/server/)
  })

  it('includes WORKDIR', () => {
    const content = getDockerfileContent()
    expect(content).toMatch(/WORKDIR\s+\/app/)
  })
})

describe('Image labels', () => {
  it('includes a label for git SHA', () => {
    const content = getDockerfileContent()
    // ARG or LABEL for git commit SHA
    expect(content).toMatch(/(?:ARG|LABEL).*(?:GIT_SHA|git_sha|commit)/)
  })
})
