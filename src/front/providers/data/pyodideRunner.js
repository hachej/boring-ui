const PYODIDE_VERSION = '0.27.5'
const PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`
const PY_WORKSPACE_ROOT = '/workspace'

let pyodidePromise = null

const normalizeAbsPath = (value) => {
  const trimmed = String(value || '').trim()
  if (!trimmed || trimmed === '.') return '/'
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

const toWorkspacePath = (value) => {
  const normalized = normalizeAbsPath(value)
  const relative = normalized.replace(/^\/+/, '')
  return relative ? `${PY_WORKSPACE_ROOT}/${relative}` : PY_WORKSPACE_ROOT
}

const isDirMode = (fsApi, mode) => {
  if (typeof fsApi.isDir === 'function') return fsApi.isDir(mode)
  return (mode & 0o170000) === 0o040000
}

const ensurePyDir = (fsApi, dirPath) => {
  const segments = String(dirPath || '').split('/').filter(Boolean)
  let current = ''
  for (const segment of segments) {
    current += `/${segment}`
    if (!fsApi.analyzePath(current).exists) {
      fsApi.mkdir(current)
    }
  }
}

const clearPyDir = (fsApi, dirPath) => {
  if (!fsApi.analyzePath(dirPath).exists) return

  const entries = fsApi.readdir(dirPath)
  for (const entry of entries) {
    if (entry === '.' || entry === '..') continue
    const child = dirPath === '/' ? `/${entry}` : `${dirPath}/${entry}`
    const stat = fsApi.stat(child)
    if (isDirMode(fsApi, stat.mode)) {
      clearPyDir(fsApi, child)
      fsApi.rmdir(child)
    } else {
      fsApi.unlink(child)
    }
  }
}

const ensureSourceDir = async (sourceFs, dirPath) => {
  const segments = String(dirPath || '').split('/').filter(Boolean)
  let current = ''
  for (const segment of segments) {
    current += `/${segment}`
    try {
      await sourceFs.stat(current)
    } catch {
      await sourceFs.mkdir(current)
    }
  }
}

const syncFsToPyodide = async (sourceFs, pyodide, sourceDir = '/', destDir = PY_WORKSPACE_ROOT) => {
  const src = normalizeAbsPath(sourceDir)
  ensurePyDir(pyodide.FS, destDir)

  const names = await sourceFs.readdir(src)
  for (const name of names) {
    if (name === '.' || name === '..') continue
    const sourcePath = src === '/' ? `/${name}` : `${src}/${name}`
    const destinationPath = destDir === '/' ? `/${name}` : `${destDir}/${name}`
    const stat = await sourceFs.stat(sourcePath)

    if (stat.isDirectory()) {
      ensurePyDir(pyodide.FS, destinationPath)
      await syncFsToPyodide(sourceFs, pyodide, sourcePath, destinationPath)
      continue
    }

    const content = await sourceFs.readFile(sourcePath)
    ensurePyDir(pyodide.FS, destinationPath.slice(0, destinationPath.lastIndexOf('/')) || '/')
    pyodide.FS.writeFile(destinationPath, content)
  }
}

const syncPyodideToFs = async (pyodide, sourceFs, sourceDir = PY_WORKSPACE_ROOT, destDir = '/') => {
  const src = normalizeAbsPath(sourceDir)
  const dst = normalizeAbsPath(destDir)

  const names = pyodide.FS.readdir(src)
  for (const name of names) {
    if (name === '.' || name === '..') continue

    const sourcePath = src === '/' ? `/${name}` : `${src}/${name}`
    const destinationPath = dst === '/' ? `/${name}` : `${dst}/${name}`
    const stat = pyodide.FS.stat(sourcePath)

    if (isDirMode(pyodide.FS, stat.mode)) {
      await ensureSourceDir(sourceFs, destinationPath)
      await syncPyodideToFs(pyodide, sourceFs, sourcePath, destinationPath)
      continue
    }

    await ensureSourceDir(sourceFs, destinationPath.slice(0, destinationPath.lastIndexOf('/')) || '/')
    const content = pyodide.FS.readFile(sourcePath)
    await sourceFs.writeFile(destinationPath, content)
  }
}

const unwrapPythonResult = (value) => {
  if (!value) return value
  if (typeof value.toJs === 'function') {
    const result = value.toJs({ dict_converter: Object.fromEntries })
    if (typeof value.destroy === 'function') value.destroy()
    return result
  }
  return value
}

const PYTHON_EXEC_SNIPPET = `
import io
import os
import runpy
import sys
import traceback

_stdout_capture = io.StringIO()
_stderr_capture = io.StringIO()
_prev_stdout = sys.stdout
_prev_stderr = sys.stderr
_result = {
  "success": True,
  "stdout": "",
  "stderr": "",
  "error": None,
  "result": None,
}

sys.stdout = _stdout_capture
sys.stderr = _stderr_capture

try:
  if __boring_script_path:
    if not os.path.exists(__boring_script_path):
      raise FileNotFoundError(f"Python file not found: {__boring_script_path}")

    _script_dir = os.path.dirname(__boring_script_path) or "${PY_WORKSPACE_ROOT}"
    _cwd = __boring_cwd or _script_dir

    if _script_dir and _script_dir not in sys.path:
      sys.path.insert(0, _script_dir)
    if _cwd and _cwd not in sys.path:
      sys.path.insert(0, _cwd)

    _prev_cwd = os.getcwd()
    os.chdir(_cwd)
    try:
      runpy.run_path(__boring_script_path, run_name="__main__")
    finally:
      os.chdir(_prev_cwd)
  else:
    _globals = {"__name__": "__main__", "__file__": "<python_exec>"}
    exec(compile(__boring_code, "<python_exec>", "exec"), _globals, _globals)
except Exception:
  _result["success"] = False
  _result["error"] = traceback.format_exc()
finally:
  sys.stdout = _prev_stdout
  sys.stderr = _prev_stderr

_result["stdout"] = _stdout_capture.getvalue()
_result["stderr"] = _stderr_capture.getvalue()
_result
`

export async function loadPyodideRuntime() {
  if (pyodidePromise) return pyodidePromise

  pyodidePromise = (async () => {
    const { loadPyodide } = await import(/* @vite-ignore */ `${PYODIDE_INDEX_URL}pyodide.mjs`)
    return loadPyodide({ indexURL: PYODIDE_INDEX_URL })
  })().catch((error) => {
    pyodidePromise = null
    throw error
  })

  return pyodidePromise
}

export function createPyodidePythonRunner(sourceFs) {
  if (!sourceFs) {
    throw new Error('createPyodidePythonRunner requires a filesystem API')
  }

  return async (code, options = {}) => {
    const scriptPath = String(options?.path || '').trim()
    const cwdPath = String(options?.cwd || '').trim()
    const hasCode = String(code || '').trim().length > 0
    const hasPath = scriptPath.length > 0

    if (!hasCode && !hasPath) {
      return {
        success: false,
        stdout: '',
        stderr: '',
        error: 'python_exec requires either code or path',
        result: null,
      }
    }

    const pyodide = await loadPyodideRuntime()
    ensurePyDir(pyodide.FS, PY_WORKSPACE_ROOT)
    clearPyDir(pyodide.FS, PY_WORKSPACE_ROOT)
    await syncFsToPyodide(sourceFs, pyodide, '/', PY_WORKSPACE_ROOT)

    const pyScriptPath = hasPath ? toWorkspacePath(scriptPath) : ''
    const pyCwdPath = cwdPath
      ? toWorkspacePath(cwdPath)
      : (pyScriptPath ? pyScriptPath.slice(0, pyScriptPath.lastIndexOf('/')) || PY_WORKSPACE_ROOT : PY_WORKSPACE_ROOT)

    pyodide.globals.set('__boring_code', String(code || ''))
    pyodide.globals.set('__boring_script_path', pyScriptPath || null)
    pyodide.globals.set('__boring_cwd', pyCwdPath || PY_WORKSPACE_ROOT)

    let result = null
    let runError = null
    let syncError = null

    try {
      result = unwrapPythonResult(await pyodide.runPythonAsync(PYTHON_EXEC_SNIPPET))
    } catch (error) {
      runError = error
    } finally {
      pyodide.globals.delete('__boring_code')
      pyodide.globals.delete('__boring_script_path')
      pyodide.globals.delete('__boring_cwd')
      try {
        await syncPyodideToFs(pyodide, sourceFs, PY_WORKSPACE_ROOT, '/')
      } catch (error) {
        syncError = error
      }
    }

    if (runError) {
      if (syncError) {
        throw new Error(
          `${runError?.message || String(runError)} (filesystem sync failed: ${syncError?.message || String(syncError)})`,
        )
      }
      throw runError
    }

    if (syncError) {
      return {
        success: false,
        stdout: typeof result?.stdout === 'string' ? result.stdout : '',
        stderr: typeof result?.stderr === 'string' ? result.stderr : '',
        error: `Python execution completed but syncing filesystem failed: ${syncError?.message || String(syncError)}`,
        result: result?.result ?? null,
      }
    }

    return result
  }
}
