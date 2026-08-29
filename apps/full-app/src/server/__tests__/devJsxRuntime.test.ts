import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Regression test for #1444: the full-app *dev* harness (tsx, launched with
// cwd=apps/full-app) crashed rendering the verification email with "React is
// not defined", even though PR #1439 (#1438) fixed the *build*. Root cause:
// tsx resolves whether a discovered tsconfig applies to a given source file
// by checking that file against the tsconfig's `include` globs — not just by
// aliasing it via `paths`. apps/full-app/tsconfig.json's `paths` map
// `@hachej/boring-core/server` etc. to `../../packages/core/src/...`, but its
// `include` only covered `src/**/*` inside apps/full-app itself. Any
// cross-package .tsx file reached through those aliases (e.g. the mail
// templates under packages/core/src/server/mail/templates) therefore fell
// outside the resolved tsconfig's scope and got esbuild's default *classic*
// JSX transform instead of the automatic runtime the whole monorepo assumes
// — hence "React is not defined" at SSR.
//
// A vitest unit test that imports the templates directly (like
// templates.test.ts in packages/core) cannot catch this: vitest applies its
// own automatic-jsx transform regardless of tsx's cwd-scoped tsconfig
// resolution. This test instead runs the exact same command the dev harness
// runs — `node --import tsx` with cwd=apps/full-app — as a real subprocess,
// so it exercises tsx's actual tsconfig-applicability check. Before the fix
// (apps/full-app/tsconfig.json's `include` not covering the aliased package
// src dirs), this reproduces the crash; after the fix it renders cleanly.

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

function renderCrossPackageTemplateViaDevTsx(): string {
  const script = `
    import('../../packages/core/src/server/mail/templates/index.ts').then(async (templates) => {
      const email = await templates.renderVerifyEmail({
        to: 'devjsx-guard@example.test',
        verifyUrl: 'https://app.test/verify?token=abc',
        appName: 'GuardTest',
        expiresInHours: 24,
      })
      process.stdout.write(email.subject)
    }).catch((error) => {
      console.error(error.stack)
      process.exit(1)
    })
  `

  return execFileSync(process.execPath, ['--import', 'tsx', '-e', script], {
    cwd: appRoot,
    encoding: 'utf8',
    timeout: 30_000,
  })
}

describe('full-app dev harness JSX resolution for cross-package sources (#1444)', () => {
  it('renders a cross-package mail template (packages/core/src/server/mail/templates) via the real dev tsx invocation, cwd=apps/full-app', () => {
    const subject = renderCrossPackageTemplateViaDevTsx()
    expect(subject).toContain('Verify your GuardTest email address')
  })
})
