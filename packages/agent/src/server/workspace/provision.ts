import { cp, mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const PROVISION_MARKER_REL_PATH = '.boring-agent/provisioned'

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath)
    return true
  } catch (error: unknown) {
    if ((error as { code?: string }).code === 'ENOENT') {
      return false
    }
    throw error
  }
}

export async function copyTemplate(
  templatePath: string | undefined,
  workspaceRoot: string,
): Promise<void> {
  if (!templatePath) return

  const markerPath = join(workspaceRoot, PROVISION_MARKER_REL_PATH)
  if (await fileExists(markerPath)) return

  try {
    await cp(templatePath, workspaceRoot, {
      recursive: true,
      errorOnExist: false,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Failed to copy template from "${templatePath}" into workspace "${workspaceRoot}": ${message}`,
      { cause: error },
    )
  }

  await mkdir(dirname(markerPath), { recursive: true })
  await writeFile(markerPath, new Date().toISOString(), 'utf-8')
}
