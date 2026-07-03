import { constants } from 'node:fs'
import { access, chmod, copyFile, lstat, mkdir, mkdtemp, readdir, realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { FastifyRequest } from 'fastify'
import type { RuntimeFilesystemBinding, RuntimeFilesystemBindingOperations } from '@hachej/boring-agent/server'
import {
  COMPANY_CONTEXT_FILESYSTEM_ID,
  ScopedFilesystemRuntimeBindingManager,
  createReadonlyProjectionOperations,
  type BoundFilesystemContext,
  type FilesystemBinding,
  type FilesystemBindingProvider,
  type PreparedFilesystemBinding,
  type ReadonlyProjectionOperations,
} from '@hachej/boring-bash/server'
import type { GovernanceService } from './governanceService.js'
import type { GovernanceUserLike } from './policyTypes.js'

const COMPANY_CONTEXT_MOUNT_PATH = '/company_context'

interface GovernanceFilesystemBindingContext {
  request?: FastifyRequest
  workspaceId: string
  workspaceRoot: string
  sessionId?: string
  userId?: string
  userEmail?: string
  userEmailVerified?: boolean
  requestId?: string
}

interface CreateGovernanceFilesystemBindingsOptions {
  /** Override for tests or non-standard workspace layouts. Defaults to sibling workspace root by tenant companyContextWorkspaceId. */
  resolveCompanyContextRoot?: (ctx: GovernanceFilesystemBindingContext, companyContextWorkspaceId: string) => string | Promise<string>
  projectionRootParent?: string
}

interface RegexProjectionHandle {
  readonly filesystem: string
  readonly projectionRoot: string
  readonly lifecycle?: { active: boolean }
}

function normalizeCompanyPath(value: string): string {
  const normalized = value.replace(/\\/g, '/')
  if (normalized.includes('\0')) throw new Error('invalid company path')
  const withRoot = normalized.startsWith('/') ? normalized : `/${normalized}`
  const parts = withRoot.split('/').filter(Boolean)
  if (parts.some((part) => part === '.' || part === '..')) throw new Error('company path traversal is not allowed')
  return `/${parts.join('/')}`
}

async function assertInsideRoot(root: string, candidate: string): Promise<void> {
  const realRoot = await realpath(root)
  const existing = await realpath(candidate)
  const rel = path.relative(realRoot, existing)
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('path escapes company context root')
}

async function walkFiles(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true })
  const out: string[] = []
  for (const entry of entries) {
    const absolutePath = path.join(current, entry.name)
    const entryStat = await lstat(absolutePath)
    if (entryStat.isSymbolicLink()) {
      await assertInsideRoot(root, absolutePath)
      continue
    }
    if (entry.isDirectory()) out.push(...await walkFiles(root, absolutePath))
    else if (entry.isFile()) out.push(absolutePath)
  }
  return out
}

async function makeProjectionReadonly(root: string, current = root): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true })
  for (const entry of entries) {
    const absolutePath = path.join(current, entry.name)
    if (entry.isDirectory()) await makeProjectionReadonly(root, absolutePath)
    else if (entry.isFile()) await chmod(absolutePath, 0o400)
  }
  await chmod(current, 0o500)
}

async function makeProjectionRemovable(current: string): Promise<void> {
  await chmod(current, 0o700).catch(() => {})
  const entries = await readdir(current, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const absolutePath = path.join(current, entry.name)
    if (entry.isDirectory()) await makeProjectionRemovable(absolutePath)
    else await chmod(absolutePath, 0o600).catch(() => {})
  }
}

function compileRules(rules: readonly string[]): RegExp[] {
  return rules.map((rule) => new RegExp(rule))
}

function companyRootFromWorkspaceRoot(ctx: GovernanceFilesystemBindingContext, companyContextWorkspaceId: string): string {
  return path.join(path.dirname(path.resolve(ctx.workspaceRoot)), companyContextWorkspaceId)
}

function userFromContext(ctx: GovernanceFilesystemBindingContext): GovernanceUserLike | null {
  const requestUser = ctx.request?.user
  if (requestUser?.email) {
    return { id: requestUser.id, email: requestUser.email, emailVerified: requestUser.emailVerified === true }
  }
  if (!ctx.userEmail) return null
  return { id: ctx.userId, email: ctx.userEmail, emailVerified: ctx.userEmailVerified === true }
}

class RegexFilteredCompanyContextProvider implements FilesystemBindingProvider {
  constructor(
    private readonly sourceRoot: string,
    private readonly allowedRules: readonly RegExp[],
    private readonly projectionRootParent: string,
  ) {}

  async disposeBinding(prepared: PreparedFilesystemBinding): Promise<void> {
    const handle = prepared.handle as Partial<RegexProjectionHandle>
    if (handle.lifecycle) handle.lifecycle.active = false
    if (handle.projectionRoot) {
      await makeProjectionRemovable(handle.projectionRoot)
      await rm(handle.projectionRoot, { recursive: true, force: true })
    }
  }

  async prepareBinding(_ctx: BoundFilesystemContext, binding: FilesystemBinding): Promise<PreparedFilesystemBinding> {
    if (binding.filesystem !== COMPANY_CONTEXT_FILESYSTEM_ID) throw new Error(`unsupported filesystem binding ${binding.filesystem}`)
    if (binding.access !== 'readonly' || binding.projection !== 'policy-filtered') {
      throw new Error('company_context policy mount only supports readonly policy-filtered bindings')
    }

    await mkdir(this.sourceRoot, { recursive: true })
    await access(this.sourceRoot, constants.R_OK)
    const projectionRoot = await mkdtemp(path.join(this.projectionRootParent, 'boring-company-context-'))
    try {
      const files = await walkFiles(this.sourceRoot)

      for (const sourceFile of files) {
        await assertInsideRoot(this.sourceRoot, sourceFile)
        const rel = path.relative(this.sourceRoot, sourceFile).split(path.sep).join('/')
        const companyPath = normalizeCompanyPath(rel)
        if (!this.allowedRules.some((rule) => rule.test(companyPath))) continue
        const destination = path.join(projectionRoot, ...companyPath.slice(1).split('/'))
        await mkdir(path.dirname(destination), { recursive: true })
        await copyFile(sourceFile, destination)
      }

      await makeProjectionReadonly(projectionRoot)
      return {
        binding,
        handle: {
          filesystem: binding.filesystem,
          projectionRoot,
          lifecycle: { active: true },
        } satisfies RegexProjectionHandle,
      }
    } catch (error) {
      await makeProjectionRemovable(projectionRoot)
      await rm(projectionRoot, { recursive: true, force: true })
      throw error
    }
  }
}

function asRuntimeOperations(ops: ReadonlyProjectionOperations): RuntimeFilesystemBindingOperations {
  return {
    read: (descriptor) => ops.read(descriptor),
    list: (descriptor) => ops.list(descriptor),
    find: (descriptor, pattern, options) => ops.find(descriptor, pattern, options),
    grep: (descriptor, pattern, options) => ops.grep(descriptor, pattern, options),
    stat: (descriptor) => ops.stat(descriptor),
    rejectMutation: (operation, descriptor) => ops.rejectMutation(operation, descriptor),
  }
}

export function createGovernanceFilesystemBindings(
  service: GovernanceService,
  options: CreateGovernanceFilesystemBindingsOptions = {},
): NonNullable<import('@hachej/boring-agent/server').RegisterAgentRoutesOptions['getFilesystemBindings']> {
  return async (ctx) => {
    if (!service.isEnabled()) return undefined
    const user = userFromContext(ctx)
    if (!user?.id) return []
    const rules = service.companyContextRules(user)
    const companyContextWorkspaceId = service.companyContextWorkspaceId()
    if (!companyContextWorkspaceId || rules.length === 0) return []
    if (ctx.workspaceId === companyContextWorkspaceId) return []

    const sourceRoot = await (options.resolveCompanyContextRoot?.(ctx, companyContextWorkspaceId) ?? companyRootFromWorkspaceRoot(ctx, companyContextWorkspaceId))
    const projectionRootParent = options.projectionRootParent ?? os.tmpdir()
    const binding: FilesystemBinding = {
      filesystem: COMPANY_CONTEXT_FILESYSTEM_ID,
      access: 'readonly',
      mountPath: COMPANY_CONTEXT_MOUNT_PATH,
      projection: 'policy-filtered',
    }
    const boundCtx: BoundFilesystemContext = {
      humanUserId: user.id,
      agentId: `agent:${ctx.sessionId ?? ctx.requestId ?? 'request'}`,
      sessionId: ctx.sessionId ?? ctx.requestId ?? 'request',
      workspaceId: ctx.workspaceId,
      requestId: ctx.requestId ?? ctx.sessionId ?? 'request',
    }
    const provider = new RegexFilteredCompanyContextProvider(sourceRoot, compileRules(rules), projectionRootParent)
    const manager = new ScopedFilesystemRuntimeBindingManager({
      resolver: { resolveBindings: async () => [binding] },
      providers: { [COMPANY_CONTEXT_FILESYSTEM_ID]: provider },
    })

    async function withReadonlyOperations<T>(fn: (ops: ReadonlyProjectionOperations) => Promise<T>): Promise<T> {
      const plan = await manager.prepareRuntime(boundCtx)
      try {
        const prepared = plan.bindings.find((entry) => entry.binding.filesystem === COMPANY_CONTEXT_FILESYSTEM_ID)
        if (!prepared) throw new Error('company_context binding was not prepared')
        return await fn(createReadonlyProjectionOperations(prepared.handle as RegexProjectionHandle))
      } finally {
        await manager.disposeRuntime(boundCtx)
      }
    }

    const operations: RuntimeFilesystemBindingOperations = {
      read: (descriptor) => withReadonlyOperations((ops) => ops.read(descriptor)),
      list: (descriptor) => withReadonlyOperations((ops) => ops.list(descriptor)),
      find: (descriptor, pattern, opOptions) => withReadonlyOperations((ops) => ops.find(descriptor, pattern, opOptions)),
      grep: (descriptor, pattern, opOptions) => withReadonlyOperations((ops) => ops.grep(descriptor, pattern, opOptions)),
      stat: (descriptor) => withReadonlyOperations((ops) => ops.stat(descriptor)),
      rejectMutation(operation, descriptor): never {
        // Reuse boring-bash readonly error shape for deterministic UX. This method is synchronous by RuntimeFilesystemBindingOperations contract.
        return asRuntimeOperations(createReadonlyProjectionOperations({ filesystem: COMPANY_CONTEXT_FILESYSTEM_ID, projectionRoot: sourceRoot }))
          .rejectMutation(operation, descriptor)
      },
    }

    return [{ filesystem: COMPANY_CONTEXT_FILESYSTEM_ID, access: 'readonly', operations } satisfies RuntimeFilesystemBinding]
  }
}
