import { lstat, mkdir, mkdtemp, readdir, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { ErrorCode } from '@hachej/boring-agent/shared'
import { READONLY_PROJECTION_INVALID_PATH_CODE } from '@hachej/boring-bash/server'
import { createDefaultCompanyContextRootResolver, createGovernanceFilesystemBindings } from '../filesystemBindings.js'
import { createGovernanceService } from '../governanceService.js'
import { validateGovernancePolicy } from '../validatePolicy.js'

const COMPANY_CONTEXT_WORKSPACE_ID = '00000000-0000-4000-8000-000000000475'

async function seedCompanyRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'boring-company-source-'))
  await mkdir(path.join(root, 'public'), { recursive: true })
  await mkdir(path.join(root, 'finance'), { recursive: true })
  await writeFile(path.join(root, 'public', 'handbook.md'), '# Handbook\nVisible policy\n', 'utf8')
  await writeFile(path.join(root, 'finance', 'secret.md'), '# Finance\nFORBIDDEN_FINANCE_SECRET_123\n', 'utf8')
  return root
}

function serviceWithPolicy(allow: string[] = ['^/public/.*']) {
  return createGovernanceService({
    enabled: true,
    status: { state: 'active', path: '/policy.yaml', tenantId: 'company', userCount: 2 },
    policy: validateGovernancePolicy({
      tenant: {
        id: 'company',
        companyContextWorkspaceId: COMPANY_CONTEXT_WORKSPACE_ID,
        perRunHoldEur: 1,
      },
      users: [
        {
          email: 'allowed@example.com',
          role: 'user',
          companyContext: { allow },
        },
        {
          email: 'denied@example.com',
          role: 'user',
          companyContext: { allow: [] },
        },
      ],
    }),
  })
}

describe('createGovernanceFilesystemBindings', () => {
  it('mounts readonly policy-filtered company_context only for verified granted users', async () => {
    const companyRoot = await seedCompanyRoot()
    const projectionRootParent = await mkdtemp(path.join(os.tmpdir(), 'boring-company-projections-'))
    const getBindings = createGovernanceFilesystemBindings(serviceWithPolicy(), {
      resolveCompanyContextRoot: () => companyRoot,
      projectionRootParent,
    })

    const bindings = await getBindings({
      workspaceId: 'personal-ws',
      workspaceRoot: path.join(path.dirname(companyRoot), 'personal-ws'),
      requestId: 'req-1',
      request: {
        id: 'req-1',
        user: { id: 'user-allowed', email: 'allowed@example.com', name: null, emailVerified: true },
      } as any,
    })

    expect(bindings).toHaveLength(1)
    expect(bindings?.[0]).toMatchObject({ filesystem: 'company_context', access: 'readonly' })
    await expect(bindings![0]!.operations.read({ filesystem: 'company_context', path: '/public/handbook.md' }))
      .resolves.toMatchObject({ content: expect.stringContaining('Visible policy') })
    const find = await bindings![0]!.operations.find({ filesystem: 'company_context', path: '/' }, '*.md')
    expect(find.paths).toEqual(['/public/handbook.md'])
    const grep = await bindings![0]!.operations.grep({ filesystem: 'company_context', path: '/' }, 'FORBIDDEN_FINANCE_SECRET_123')
    expect(grep.matches).toEqual([])
    expect(await readdir(projectionRootParent)).toEqual([])
    await expect(bindings![0]!.operations.read({ filesystem: 'company_context', path: '/finance/secret.md' }))
      .rejects.toMatchObject({ code: READONLY_PROJECTION_INVALID_PATH_CODE })
    expect(() => bindings![0]!.operations.rejectMutation('write', { filesystem: 'company_context', path: '/public/handbook.md' }))
      .toThrow(/readonly/)

    const denied = await getBindings({
      workspaceId: 'personal-ws',
      workspaceRoot: path.join(path.dirname(companyRoot), 'personal-ws'),
      requestId: 'req-2',
      request: {
        id: 'req-2',
        user: { id: 'user-denied', email: 'denied@example.com', name: null, emailVerified: true },
      } as any,
    })
    expect(denied).toEqual([])

    const unverified = await getBindings({
      workspaceId: 'personal-ws',
      workspaceRoot: path.join(path.dirname(companyRoot), 'personal-ws'),
      requestId: 'req-3',
      request: {
        id: 'req-3',
        user: { id: 'user-allowed', email: 'allowed@example.com', name: null, emailVerified: false },
      } as any,
    })
    expect(unverified).toEqual([])
  })

  it('omits company_context when no explicit source root resolver is configured', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'boring-company-no-source-'))
    const personalRoot = path.join(parent, 'personal-ws')
    const staleGuessedRoot = path.join(parent, COMPANY_CONTEXT_WORKSPACE_ID)
    await mkdir(path.join(personalRoot), { recursive: true })
    await mkdir(path.join(staleGuessedRoot, 'public'), { recursive: true })
    await writeFile(path.join(staleGuessedRoot, 'public', 'handbook.md'), 'stale guessed source', 'utf8')
    const logError = vi.fn()
    const getBindings = createGovernanceFilesystemBindings(serviceWithPolicy(), {
      resolveCompanyContextRoot: createDefaultCompanyContextRootResolver({ BORING_AGENT_MODE: 'vercel-sandbox' }),
    })

    const stale = await getBindings({
      workspaceId: 'personal-ws',
      workspaceRoot: personalRoot,
      requestId: 'req-no-explicit-stale',
      request: {
        id: 'req-no-explicit-stale',
        log: { error: logError },
        user: { id: 'user-allowed', email: 'allowed@example.com', name: null, emailVerified: true },
      } as any,
    })

    expect(stale).toEqual([])
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: ErrorCode.enum.CONFIG_INVALID,
        reason: 'missing_explicit_source_root_resolver',
        companyContextWorkspaceId: COMPANY_CONTEXT_WORKSPACE_ID,
      }),
      'company_context binding omitted',
    )

    const missingParent = await mkdtemp(path.join(os.tmpdir(), 'boring-company-missing-source-'))
    const missingPersonalRoot = path.join(missingParent, 'personal-ws')
    const missingGuessedRoot = path.join(missingParent, COMPANY_CONTEXT_WORKSPACE_ID)
    await mkdir(missingPersonalRoot, { recursive: true })

    const missing = await getBindings({
      workspaceId: 'personal-ws',
      workspaceRoot: missingPersonalRoot,
      requestId: 'req-no-explicit-missing',
      request: {
        id: 'req-no-explicit-missing',
        log: { error: logError },
        user: { id: 'user-allowed', email: 'allowed@example.com', name: null, emailVerified: true },
      } as any,
    })

    expect(missing).toEqual([])
    await expect(lstat(missingGuessedRoot)).rejects.toMatchObject({ code: 'ENOENT' })

    const explicitMissingRoot = path.join(missingParent, 'explicit-company-context')
    const explicitLogError = vi.fn()
    const explicitMissingBindings = createGovernanceFilesystemBindings(serviceWithPolicy(), {
      resolveCompanyContextRoot: () => explicitMissingRoot,
    })
    const explicitMissing = await explicitMissingBindings({
      workspaceId: 'personal-ws',
      workspaceRoot: missingPersonalRoot,
      requestId: 'req-explicit-missing',
      request: {
        id: 'req-explicit-missing',
        log: { error: explicitLogError },
        user: { id: 'user-allowed', email: 'allowed@example.com', name: null, emailVerified: true },
      } as any,
    })

    expect(explicitMissing).toEqual([])
    expect(explicitLogError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: ErrorCode.enum.CONFIG_INVALID,
        reason: 'source_root_unavailable',
        sourceRoot: explicitMissingRoot,
      }),
      'company_context binding omitted',
    )
    await expect(lstat(explicitMissingRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('uses tool/run context identity when no HTTP request object is available', async () => {
    const companyRoot = await seedCompanyRoot()
    const getBindings = createGovernanceFilesystemBindings(serviceWithPolicy(), {
      resolveCompanyContextRoot: () => companyRoot,
      projectionRootParent: await mkdtemp(path.join(os.tmpdir(), 'boring-company-projections-')),
    })

    const bindings = await getBindings({
      workspaceId: 'personal-ws',
      workspaceRoot: path.join(path.dirname(companyRoot), 'personal-ws'),
      sessionId: 'sess-1',
      requestId: 'req-tool',
      userId: 'user-allowed',
      userEmail: 'allowed@example.com',
      userEmailVerified: true,
    })

    expect(bindings).toHaveLength(1)
    await expect(bindings![0]!.operations.read({ filesystem: 'company_context', path: '/public/handbook.md' }))
      .resolves.toMatchObject({ content: expect.stringContaining('Visible policy') })
  })

  it('skips outside-pointing source symlinks while mounting other files', async () => {
    const companyRoot = await seedCompanyRoot()
    const outside = await mkdtemp(path.join(os.tmpdir(), 'boring-outside-company-'))
    await writeFile(path.join(outside, 'secret.md'), 'outside', 'utf8')
    await symlink(path.join(outside, 'secret.md'), path.join(companyRoot, 'public', 'outside-link.md'))
    const projectionRootParent = await mkdtemp(path.join(os.tmpdir(), 'boring-company-projections-'))
    const getBindings = createGovernanceFilesystemBindings(serviceWithPolicy(), {
      resolveCompanyContextRoot: () => companyRoot,
      projectionRootParent,
    })

    const bindings = await getBindings({
      workspaceId: 'personal-ws',
      workspaceRoot: path.join(path.dirname(companyRoot), 'personal-ws'),
      sessionId: 'sess-source-symlink',
      requestId: 'req-source-symlink',
      userId: 'user-allowed',
      userEmail: 'allowed@example.com',
      userEmailVerified: true,
    })

    await expect(bindings![0]!.operations.read({ filesystem: 'company_context', path: '/public/handbook.md' }))
      .resolves.toMatchObject({ content: expect.stringContaining('Visible policy') })
    await expect(bindings![0]!.operations.read({ filesystem: 'company_context', path: '/public/outside-link.md' }))
      .rejects.toMatchObject({ code: READONLY_PROJECTION_INVALID_PATH_CODE })
    const find = await bindings![0]!.operations.find({ filesystem: 'company_context', path: '/' }, '*.md')
    expect(find.paths).toEqual(['/public/handbook.md'])
    expect(await readdir(projectionRootParent)).toEqual([])
  })

  it('applies segment-boundary company_context rules without leaking prefix siblings', async () => {
    const companyRoot = await mkdtemp(path.join(os.tmpdir(), 'boring-company-segment-'))
    await mkdir(path.join(companyRoot, 'docs'), { recursive: true })
    await mkdir(path.join(companyRoot, 'docs-secret'), { recursive: true })
    await writeFile(path.join(companyRoot, 'docs', 'file.md'), 'visible docs', 'utf8')
    await writeFile(path.join(companyRoot, 'docs-secret', 'x.md'), 'hidden docs secret', 'utf8')
    const getBindings = createGovernanceFilesystemBindings(serviceWithPolicy(['^/docs(?:/|$)']), {
      resolveCompanyContextRoot: () => companyRoot,
      projectionRootParent: await mkdtemp(path.join(os.tmpdir(), 'boring-company-projections-')),
    })

    const bindings = await getBindings({
      workspaceId: 'personal-ws',
      workspaceRoot: path.join(path.dirname(companyRoot), 'personal-ws'),
      sessionId: 'sess-segment',
      requestId: 'req-segment',
      userId: 'user-allowed',
      userEmail: 'allowed@example.com',
      userEmailVerified: true,
    })

    await expect(bindings![0]!.operations.read({ filesystem: 'company_context', path: '/docs/file.md' }))
      .resolves.toMatchObject({ content: 'visible docs' })
    await expect(bindings![0]!.operations.read({ filesystem: 'company_context', path: '/docs-secret/x.md' }))
      .rejects.toMatchObject({ code: READONLY_PROJECTION_INVALID_PATH_CODE })
    const find = await bindings![0]!.operations.find({ filesystem: 'company_context', path: '/' }, '*.md')
    expect(find.paths).toEqual(['/docs/file.md'])
  })

  it('does not mount when governance is disabled or request is for the company workspace itself', async () => {
    const companyRoot = await seedCompanyRoot()
    const disabled = createGovernanceService({
      enabled: false,
      policy: null,
      status: { state: 'disabled', reason: 'missing-env', path: null },
    })
    const disabledBindings = createGovernanceFilesystemBindings(disabled, { resolveCompanyContextRoot: () => companyRoot })
    await expect(disabledBindings({ workspaceId: 'personal-ws', workspaceRoot: companyRoot, requestId: 'req' })).resolves.toBeUndefined()

    const enabledBindings = createGovernanceFilesystemBindings(serviceWithPolicy(), { resolveCompanyContextRoot: () => companyRoot })
    await expect(enabledBindings({
      workspaceId: COMPANY_CONTEXT_WORKSPACE_ID,
      workspaceRoot: companyRoot,
      requestId: 'req-company',
      userId: 'user-allowed',
      userEmail: 'allowed@example.com',
      userEmailVerified: true,
    })).resolves.toEqual([])
  })
})
