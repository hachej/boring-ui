import { describe, expect, it } from 'vitest'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parse } from 'smol-toml'

const flyTomlPath = fileURLToPath(new URL('../../../deploy/fly/fly.toml', import.meta.url))
const flyFrontendAgentTomlPath = fileURLToPath(
  new URL('../../../deploy/fly/fly.frontend-agent.toml', import.meta.url),
)
const flyTsBackendTomlPath = fileURLToPath(
  new URL('../../../deploy/fly/fly.ts-backend.toml', import.meta.url),
)
const flySecretsPath = fileURLToPath(
  new URL('../../../deploy/fly/fly.secrets.sh', import.meta.url),
)

function readToml(path: string): Record<string, any> {
  return parse(readFileSync(path, 'utf-8')) as Record<string, any>
}

describe('Fly deploy config', () => {
  it('locks the core app to the legacy backend image and single-machine health contract', () => {
    const data = readToml(flyTomlPath)

    expect(data.app).toBe('boring-ui')
    expect(data.primary_region).toBe('cdg')
    expect(data.build.dockerfile).toBe('../shared/Dockerfile.backend')
    expect(data.http_service.internal_port).toBe(8000)
    expect(data.http_service.force_https).toBe(true)
    expect(data.http_service.auto_stop_machines).toBe('off')
    expect(data.http_service.min_machines_running).toBe(1)
    expect(data.http_service.checks[0].path).toBe('/health')
    expect(data.vm.cpu_kind).toBe('shared')
    expect(data.vm.cpus).toBe(1)
    expect(data.vm.memory).toBe('512mb')
  })

  it('locks the hosted frontend-agent app to the TS image and runtime contract', () => {
    const data = readToml(flyFrontendAgentTomlPath)
    const env = data.env

    expect(data.app).toBe('boring-ui-frontend-agent')
    expect(data.primary_region).toBe('cdg')
    expect(data.build.dockerfile).toBe('../shared/Dockerfile.ts-backend')
    expect(env.APP_ENV).toBe('production')
    expect(env.NODE_ENV).toBe('production')
    expect(env.AGENTS_MODE).toBe('frontend')
    expect(env.BUI_AGENTS_MODE).toBe('frontend')
    expect(env.BUI_APP_TOML).toBe('/app/boring.app.toml')
    expect(env.DEPLOY_MODE).toBe('core')
    expect(env.CONTROL_PLANE_PROVIDER).toBe('neon')
    expect(env.CONTROL_PLANE_APP_ID).toBe('boring-ui')
    expect(env.AUTH_SESSION_SECURE_COOKIE).toBe('true')
    expect(env.AUTH_DEV_LOGIN_ENABLED).toBe('false')
    expect(env.AUTH_DEV_AUTO_LOGIN).toBe('false')
    expect(env.WORKSPACE_BACKEND).toBe('bwrap')
    expect(env.BORING_UI_WORKSPACE_ROOT).toBeUndefined()
    expect(env.AGENT_RUNTIME).toBe('pi')
    expect(env.AGENT_PLACEMENT).toBe('browser')
    expect(data.http_service.internal_port).toBe(8000)
    expect(data.http_service.checks[0].path).toBe('/health')
  })

  it('keeps the legacy TS deploy alias aligned with the hosted frontend-agent config', () => {
    const canonical = readToml(flyFrontendAgentTomlPath)
    const alias = readToml(flyTsBackendTomlPath)

    expect(alias).toEqual(canonical)
  })

  it('keeps the Fly secrets script aligned with the hosted and core secret contract', () => {
    const contents = readFileSync(flySecretsPath, 'utf-8')

    for (const key of [
      'DATABASE_URL',
      'BORING_UI_SESSION_SECRET',
      'BORING_SETTINGS_KEY',
      'ANTHROPIC_API_KEY',
      'RESEND_API_KEY',
      'NEON_AUTH_BASE_URL',
      'NEON_AUTH_JWKS_URL',
      'GITHUB_APP_ID',
      'GITHUB_APP_CLIENT_ID',
      'GITHUB_APP_CLIENT_SECRET',
      'GITHUB_APP_PRIVATE_KEY',
      'GITHUB_APP_SLUG',
    ]) {
      expect(contents).toContain(`${key}=`)
    }

    expect(contents).toContain('vault kv get -field=')
    expect(contents).toContain('APP_NAME="${1:-boring-ui}"')
    expect(contents).toContain('app_toml_value_or_env "NEON_AUTH_BASE_URL" "deploy.neon.auth_url"')
    expect(contents).toContain('app_toml_value_or_env "NEON_AUTH_JWKS_URL" "deploy.neon.jwks_url"')
    expect(contents).toContain('elif [[ -x "${HOME}/.fly/bin/flyctl" ]]; then')
    expect(contents).toContain('elif [[ -x "${HOME}/.fly/bin/fly" ]]; then')
    expect(contents).toContain('case "${FLY_BIN}" in')
    expect(contents).toContain('"~/"*')
    expect(contents).toContain('"\\$HOME/"*')
    expect(contents).toContain('if [[ ! -x "${FLY_BIN}" ]]; then')
    expect(contents).toContain('if command -v "${FLY_BIN}" >/dev/null 2>&1; then')
    expect(contents).toContain('FLYCTL_BIN points to a non-executable or unknown path')
    expect(contents).toContain('retry_fly_secrets_set 5 --app "$APP_NAME"')
  })

  it('accepts a PATH-resolved fly command name via FLYCTL_BIN', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'fly-secrets-test-'))
    const fakeFlyPath = join(tempDir, 'fly')
    const logPath = join(tempDir, 'fly.log')

    writeFileSync(
      fakeFlyPath,
      `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$@" > "${logPath}"
`,
      'utf-8',
    )
    chmodSync(fakeFlyPath, 0o755)

    try {
      const result = spawnSync('bash', [flySecretsPath, 'test-app'], {
        encoding: 'utf-8',
        env: {
          ...process.env,
          PATH: `${tempDir}:${process.env.PATH || ''}`,
          FLYCTL_BIN: 'fly',
          DATABASE_URL: 'postgres://user:pass@host/db',
          BORING_UI_SESSION_SECRET: 'session-secret',
          BORING_SETTINGS_KEY: 'settings-key',
          ANTHROPIC_API_KEY: 'anthropic-key',
          RESEND_API_KEY: 'resend-key',
          NEON_AUTH_BASE_URL: 'https://auth.example.com',
          NEON_AUTH_JWKS_URL: 'https://auth.example.com/.well-known/jwks.json',
          GITHUB_APP_ID: '12345',
          GITHUB_APP_CLIENT_ID: 'client-id',
          GITHUB_APP_CLIENT_SECRET: 'client-secret',
          GITHUB_APP_PRIVATE_KEY: 'private-key',
          GITHUB_APP_SLUG: 'boring-ui-app',
        },
      })

      expect(result.status).toBe(0)

      const loggedArgs = readFileSync(logPath, 'utf-8').trim().split('\n')
      expect(loggedArgs[0]).toBe('secrets')
      expect(loggedArgs[1]).toBe('set')
      expect(loggedArgs).toContain('--app')
      expect(loggedArgs).toContain('test-app')
      expect(loggedArgs).toContain('DATABASE_URL=postgres://user:pass@host/db')
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('accepts a tilde-expanded fly path via FLYCTL_BIN', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'fly-secrets-home-test-'))
    const fakeHome = join(tempDir, 'home')
    const fakeFlyDir = join(fakeHome, '.fly', 'bin')
    const fakeFlyPath = join(fakeFlyDir, 'fly')
    const logPath = join(tempDir, 'fly-tilde.log')

    mkdirSync(fakeFlyDir, { recursive: true })
    writeFileSync(
      fakeFlyPath,
      `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$@" > "${logPath}"
`,
      'utf-8',
    )
    chmodSync(fakeFlyPath, 0o755)

    try {
      const result = spawnSync('bash', [flySecretsPath, 'tilde-app'], {
        encoding: 'utf-8',
        env: {
          ...process.env,
          HOME: fakeHome,
          FLYCTL_BIN: '~/.fly/bin/fly',
          DATABASE_URL: 'postgres://user:pass@host/db',
          BORING_UI_SESSION_SECRET: 'session-secret',
          BORING_SETTINGS_KEY: 'settings-key',
          ANTHROPIC_API_KEY: 'anthropic-key',
          RESEND_API_KEY: 'resend-key',
          NEON_AUTH_BASE_URL: 'https://auth.example.com',
          NEON_AUTH_JWKS_URL: 'https://auth.example.com/.well-known/jwks.json',
          GITHUB_APP_ID: '12345',
          GITHUB_APP_CLIENT_ID: 'client-id',
          GITHUB_APP_CLIENT_SECRET: 'client-secret',
          GITHUB_APP_PRIVATE_KEY: 'private-key',
          GITHUB_APP_SLUG: 'boring-ui-app',
        },
      })

      expect(result.status).toBe(0)

      const loggedArgs = readFileSync(logPath, 'utf-8').trim().split('\n')
      expect(loggedArgs[0]).toBe('secrets')
      expect(loggedArgs[1]).toBe('set')
      expect(loggedArgs).toContain('--app')
      expect(loggedArgs).toContain('tilde-app')
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})
