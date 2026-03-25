/**
 * Exec HTTP routes — short exec + long-running job lifecycle.
 *
 * Short exec: POST /exec → synchronous result
 * Long-running: POST /exec/start → jobId, GET /exec/jobs/:id → chunks,
 *               POST /exec/jobs/:id/cancel → cancelled
 */
import type { FastifyInstance, FastifyReply } from 'fastify'
import { execInSandbox } from '../adapters/bwrapImpl.js'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { startJob, readJob, cancelJob } from '../jobs/execJob.js'

const MAX_OUTPUT_BYTES = 512 * 1024 // 512KB

function truncateOutput(output: string): string {
  if (Buffer.byteLength(output) > MAX_OUTPUT_BYTES) {
    return output.slice(0, MAX_OUTPUT_BYTES) + '\n[truncated: output exceeded 512KB]'
  }
  return output
}

function hasBwrap(): boolean {
  try {
    execSync('which bwrap', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

export async function registerExecRoutes(app: FastifyInstance): Promise<void> {
  const useBwrap = hasBwrap()

  // POST /exec
  app.post('/exec', async (request, reply) => {
    const body = request.body as { command?: string; cwd?: string } | null

    if (!body?.command?.trim()) {
      return reply.code(400).send({
        error: 'validation',
        code: 'COMMAND_REQUIRED',
        message: 'command is required',
      })
    }

    const workspaceRoot = app.config.workspaceRoot

    // Validate cwd if provided
    let effectiveCwd: string | undefined
    if (body.cwd) {
      const resolvedRoot = resolve(workspaceRoot)
      const resolvedCwd = resolve(workspaceRoot, body.cwd)
      if (resolvedCwd !== resolvedRoot && !resolvedCwd.startsWith(resolvedRoot + '/')) {
        return reply.code(400).send({
          error: 'validation',
          code: 'PATH_TRAVERSAL',
          message: 'cwd must be within workspace',
        })
      }
      if (!existsSync(resolvedCwd)) {
        return reply.code(400).send({
          error: 'validation',
          code: 'CWD_NOT_FOUND',
          message: `Directory not found: ${body.cwd}`,
        })
      }
      effectiveCwd = resolvedCwd
    }

    const start = Date.now()

    if (useBwrap) {
      // Sandboxed execution
      const result = await execInSandbox(workspaceRoot, body.command, {
        cwd: effectiveCwd,
      })

      return {
        stdout: truncateOutput(result.stdout),
        stderr: truncateOutput(result.stderr),
        exit_code: result.exit_code,
        duration_ms: Date.now() - start,
      }
    } else {
      // Fallback for local dev without bwrap
      const { exec } = await import('node:child_process')
      return new Promise((resolveP) => {
        const proc = exec(
          body.command!,
          {
            cwd: effectiveCwd || workspaceRoot,
            timeout: 60000,
            maxBuffer: MAX_OUTPUT_BYTES,
            env: {
              ...process.env,
              HOME: workspaceRoot,
            },
          },
          (error, stdout, stderr) => {
            resolveP({
              stdout: truncateOutput(stdout || ''),
              stderr: truncateOutput(stderr || ''),
              exit_code: error ? (error as any).code ?? 1 : 0,
              duration_ms: Date.now() - start,
            })
          },
        )
      })
    }
  })

  // --- Long-running job routes ---

  // POST /exec/start — Start a long-running command job
  app.post('/exec/start', async (request, reply) => {
    const body = request.body as { command?: string; cwd?: string } | null

    if (!body?.command?.trim()) {
      return reply.code(400).send({
        error: 'validation',
        code: 'COMMAND_REQUIRED',
        message: 'command is required',
      })
    }

    const workspaceRoot = app.config.workspaceRoot

    try {
      const result = startJob(workspaceRoot, body.command, { cwd: body.cwd })
      return result
    } catch (err: any) {
      if (err.message?.includes('within workspace')) {
        return reply.code(400).send({
          error: 'validation',
          code: 'PATH_TRAVERSAL',
          message: 'cwd must be within workspace',
        })
      }
      throw err
    }
  })

  // GET /exec/jobs/:jobId — Read output chunks from a job
  app.get<{ Params: { jobId: string }; Querystring: { after?: string } }>(
    '/exec/jobs/:jobId',
    async (request, reply) => {
      const { jobId } = request.params
      const afterStr = (request.query as any).after
      const after = afterStr ? parseInt(afterStr, 10) : undefined

      const result = readJob(jobId, after)
      if (!result) {
        return reply.code(404).send({
          error: 'not_found',
          code: 'JOB_NOT_FOUND',
          message: `Job not found: ${jobId}`,
        })
      }

      return result
    },
  )

  // POST /exec/jobs/:jobId/cancel — Cancel a running job
  app.post<{ Params: { jobId: string } }>(
    '/exec/jobs/:jobId/cancel',
    async (request, reply) => {
      const { jobId } = request.params
      const cancelled = cancelJob(jobId)

      if (!cancelled) {
        return reply.code(404).send({
          error: 'not_found',
          code: 'JOB_NOT_FOUND',
          message: `Job not found: ${jobId}`,
        })
      }

      return { cancelled: true, job_id: jobId }
    },
  )
}
