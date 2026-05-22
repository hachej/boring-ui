import type { FastifyInstance, FastifyRequest } from 'fastify'

import type { RuntimeBundle, RuntimeModeId } from './mode'
import type { ExecResult } from '../../shared/sandbox'
import {
  BORING_AGENT_DIR,
  BORING_AGENT_PROVISIONING_MARKER_REL_PATH,
} from '../workspace/runtimeLayout'
import { RUNTIME_PROVISIONING_VERSION } from '../workspace/provisionRuntime'

const DOCTOR_TIMEOUT_MS = 5_000
const DOCTOR_MAX_OUTPUT_BYTES = 64 * 1024
const MAX_DIAGNOSTIC_VALUE_LENGTH = 512
const MAX_PATH_ENTRIES = 8

export interface RuntimeDoctorRouteOptions {
  version: string
  runtimeMode: RuntimeModeId
  bundle?: RuntimeBundle
  getBundle?: (request: FastifyRequest) => RuntimeBundle | Promise<RuntimeBundle>
}

export interface RuntimeDoctorReport {
  status: 'ok' | 'degraded'
  version: string
  runtimeMode: RuntimeModeId
  runtimeCwd: string
  workspaceRoot: string
  sandbox: {
    id: string
    provider: string
    placement: string
  }
  artifactRoots: Record<string, string>
  env: {
    cwd?: string
    pathFirstEntries: string[]
    boringAgentWorkspaceRoot?: string
    virtualEnv?: string
  }
  python: {
    available: boolean
    executable?: string
    version?: string
    pipVersion?: string
    error?: string
  }
  provisioning: {
    expectedVersion: number
    present: boolean
    source?: 'current'
    version?: number
    fingerprint?: string
    runtimeMode?: string
    runtimeCwd?: string
    sandboxProvider?: string
    error?: string
  }
  smoke: {
    exitCode: number
    durationMs: number
    truncated: boolean
    stderr?: string
  }
}

interface ParsedSmokeOutput {
  cwd?: string
  pathFirstEntries: string[]
  boringAgentWorkspaceRoot?: string
  virtualEnv?: string
  python: RuntimeDoctorReport['python']
}

function runtimePath(runtimeCwd: string, ...parts: string[]): string {
  const normalizedRoot = runtimeCwd === '/' ? '' : runtimeCwd.replace(/\/+$/, '')
  return `${normalizedRoot}/${parts.join('/')}`
}

function buildRuntimeArtifactRoots(runtimeCwd: string): Record<string, string> {
  const root = runtimePath(runtimeCwd, BORING_AGENT_DIR)
  const node = runtimePath(runtimeCwd, BORING_AGENT_DIR, 'node')
  const venv = runtimePath(runtimeCwd, BORING_AGENT_DIR, 'venv')
  return {
    root,
    bin: runtimePath(runtimeCwd, BORING_AGENT_DIR, 'bin'),
    node,
    nodeModules: `${node}/node_modules`,
    venv,
    venvBin: `${venv}/bin`,
    sdk: runtimePath(runtimeCwd, BORING_AGENT_DIR, 'sdk'),
    state: runtimePath(runtimeCwd, BORING_AGENT_DIR, 'state'),
    cache: runtimePath(runtimeCwd, BORING_AGENT_DIR, 'cache'),
    tmp: runtimePath(runtimeCwd, BORING_AGENT_DIR, 'tmp'),
    logs: runtimePath(runtimeCwd, BORING_AGENT_DIR, 'logs'),
    provisioningMarker: runtimePath(runtimeCwd, BORING_AGENT_PROVISIONING_MARKER_REL_PATH),
  }
}

function redactsLikeSecret(value: string): boolean {
  return /(api[_-]?key|auth|bearer|credential|password|secret|token)/i.test(value)
}

function sanitizeDiagnosticValue(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  if (redactsLikeSecret(value)) return '[redacted]'
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, (char) => (char === '\n' || char === '\t' ? char : ''))
  return cleaned.length > MAX_DIAGNOSTIC_VALUE_LENGTH
    ? `${cleaned.slice(0, MAX_DIAGNOSTIC_VALUE_LENGTH)}…`
    : cleaned
}

function sanitizePathEntries(entries: string[]): string[] {
  return entries
    .slice(0, MAX_PATH_ENTRIES)
    .map((entry) => sanitizeDiagnosticValue(entry) ?? '')
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}

function parseDoctorLine(line: string): [string, string] | null {
  if (!line.startsWith('__boring_doctor_')) return null
  const equalsIndex = line.indexOf('=')
  if (equalsIndex < 0) return null
  return [line.slice('__boring_doctor_'.length, equalsIndex), line.slice(equalsIndex + 1)]
}

function parseSmokeOutput(stdout: string): ParsedSmokeOutput {
  const pathEntries: string[] = []
  let cwd: string | undefined
  let boringAgentWorkspaceRoot: string | undefined
  let virtualEnv: string | undefined
  let pythonExecutable: string | undefined
  let pythonVersion: string | undefined
  let pipVersion: string | undefined
  let pythonError: string | undefined

  for (const rawLine of stdout.split(/\r?\n/)) {
    const parsed = parseDoctorLine(rawLine)
    if (!parsed) continue
    const [key, value] = parsed
    if (key === 'cwd') cwd = value
    else if (key === 'boring_root') boringAgentWorkspaceRoot = value
    else if (key === 'virtual_env') virtualEnv = value
    else if (key === 'path_entry') pathEntries.push(value)
    else if (key === 'python_executable') pythonExecutable = value
    else if (key === 'python_version') pythonVersion = value
    else if (key === 'pip_version') pipVersion = value
    else if (key === 'python_error') pythonError = value
  }

  return {
    cwd: sanitizeDiagnosticValue(cwd),
    boringAgentWorkspaceRoot: sanitizeDiagnosticValue(boringAgentWorkspaceRoot),
    virtualEnv: sanitizeDiagnosticValue(virtualEnv),
    pathFirstEntries: sanitizePathEntries(pathEntries),
    python: {
      available: !!pythonExecutable,
      executable: sanitizeDiagnosticValue(pythonExecutable),
      version: sanitizeDiagnosticValue(pythonVersion),
      pipVersion: sanitizeDiagnosticValue(pipVersion),
      error: sanitizeDiagnosticValue(pythonError),
    },
  }
}

function doctorSmokeCommand(maxPathEntries: number): string {
  return `set +e
printf '__boring_doctor_cwd=%s\n' "$PWD"
printf '__boring_doctor_boring_root=%s\n' "\${BORING_AGENT_WORKSPACE_ROOT-}"
printf '__boring_doctor_virtual_env=%s\n' "\${VIRTUAL_ENV-}"
_i=0
_old_ifs=$IFS
IFS=:
for _entry in \${PATH-}; do
  printf '__boring_doctor_path_entry=%s\n' "$_entry"
  _i=$((_i + 1))
  if [ "$_i" -ge ${maxPathEntries} ]; then break; fi
done
IFS=$_old_ifs
_python=""
if command -v python >/dev/null 2>&1; then
  _python=$(command -v python)
elif command -v python3 >/dev/null 2>&1; then
  _python=$(command -v python3)
fi
if [ -n "$_python" ]; then
  printf '__boring_doctor_python_executable=%s\n' "$_python"
  "$_python" --version 2>&1 | sed 's/^/__boring_doctor_python_version=/'
  "$_python" -m pip --version 2>&1 | sed 's/^/__boring_doctor_pip_version=/'
else
  printf '__boring_doctor_python_error=%s\n' 'python not found on PATH'
fi
`
}

function emptySmokeResult(error: unknown): RuntimeDoctorReport['smoke'] {
  return {
    exitCode: 1,
    durationMs: 0,
    truncated: false,
    stderr: sanitizeDiagnosticValue(error instanceof Error ? error.message : String(error)),
  }
}

async function runSmoke(bundle: RuntimeBundle): Promise<{ smoke: RuntimeDoctorReport['smoke']; parsed: ParsedSmokeOutput }> {
  try {
    const result: ExecResult = await bundle.sandbox.exec(doctorSmokeCommand(MAX_PATH_ENTRIES), {
      cwd: bundle.runtimeContext.runtimeCwd,
      timeoutMs: DOCTOR_TIMEOUT_MS,
      maxOutputBytes: DOCTOR_MAX_OUTPUT_BYTES,
    })
    const stderr = sanitizeDiagnosticValue(decodeUtf8(result.stderr).trim())
    return {
      smoke: {
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        truncated: result.truncated,
        ...(stderr ? { stderr } : {}),
      },
      parsed: parseSmokeOutput(decodeUtf8(result.stdout)),
    }
  } catch (error) {
    return {
      smoke: emptySmokeResult(error),
      parsed: {
        pathFirstEntries: [],
        python: {
          available: false,
          error: sanitizeDiagnosticValue(error instanceof Error ? error.message : String(error)),
        },
      },
    }
  }
}

async function readProvisioningMarker(bundle: RuntimeBundle): Promise<RuntimeDoctorReport['provisioning']> {
  try {
    const raw = await bundle.workspace.readFile(BORING_AGENT_PROVISIONING_MARKER_REL_PATH)
    const marker = JSON.parse(raw) as Record<string, unknown>
    return {
      expectedVersion: RUNTIME_PROVISIONING_VERSION,
      present: true,
      source: 'current',
      version: typeof marker.v === 'number' ? marker.v : undefined,
      fingerprint: typeof marker.fingerprint === 'string' ? sanitizeDiagnosticValue(marker.fingerprint) : undefined,
      runtimeMode: typeof marker.runtimeMode === 'string' ? sanitizeDiagnosticValue(marker.runtimeMode) : undefined,
      runtimeCwd: typeof marker.runtimeCwd === 'string' ? sanitizeDiagnosticValue(marker.runtimeCwd) : undefined,
      sandboxProvider: typeof marker.sandboxProvider === 'string' ? sanitizeDiagnosticValue(marker.sandboxProvider) : undefined,
    }
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code
    const status = (error as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } } | null)
    const isMissing = code === 'ENOENT' || status?.status === 404 || status?.statusCode === 404 || status?.response?.status === 404
    if (isMissing) {
      return {
        expectedVersion: RUNTIME_PROVISIONING_VERSION,
        present: false,
      }
    }
    return {
      expectedVersion: RUNTIME_PROVISIONING_VERSION,
      present: false,
      source: 'current',
      error: sanitizeDiagnosticValue(error instanceof Error ? error.message : String(error)),
    }
  }
}

export async function buildRuntimeDoctorReport(opts: {
  version: string
  runtimeMode: RuntimeModeId
  bundle: RuntimeBundle
}): Promise<RuntimeDoctorReport> {
  const { smoke, parsed } = await runSmoke(opts.bundle)
  const provisioning = await readProvisioningMarker(opts.bundle)
  const runtimeCwd = opts.bundle.runtimeContext.runtimeCwd

  return {
    status: smoke.exitCode === 0 ? 'ok' : 'degraded',
    version: opts.version,
    runtimeMode: opts.runtimeMode,
    runtimeCwd,
    workspaceRoot: opts.bundle.workspace.root,
    sandbox: {
      id: opts.bundle.sandbox.id,
      provider: opts.bundle.sandbox.provider,
      placement: opts.bundle.sandbox.placement,
    },
    artifactRoots: buildRuntimeArtifactRoots(runtimeCwd),
    env: {
      cwd: parsed.cwd,
      pathFirstEntries: parsed.pathFirstEntries,
      boringAgentWorkspaceRoot: parsed.boringAgentWorkspaceRoot,
      virtualEnv: parsed.virtualEnv,
    },
    python: parsed.python,
    provisioning,
    smoke,
  }
}

async function resolveBundle(request: FastifyRequest, opts: RuntimeDoctorRouteOptions): Promise<RuntimeBundle> {
  if (opts.getBundle) return await opts.getBundle(request)
  if (opts.bundle) return opts.bundle
  throw new Error('runtime doctor route requires bundle or getBundle')
}

export function runtimeDoctorRoutes(
  app: FastifyInstance,
  opts: RuntimeDoctorRouteOptions,
  done: (err?: Error) => void,
): void {
  app.get('/api/v1/agent/runtime/doctor', async (request) => {
    const bundle = await resolveBundle(request, opts)
    return await buildRuntimeDoctorReport({
      version: opts.version,
      runtimeMode: opts.runtimeMode,
      bundle,
    })
  })

  done()
}
