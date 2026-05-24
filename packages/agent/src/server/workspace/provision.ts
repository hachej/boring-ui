import { cp } from 'node:fs/promises'

export async function copyTemplate(
  templatePath: string | undefined,
  workspaceRoot: string,
): Promise<void> {
  if (!templatePath) return

  try {
    await cp(templatePath, workspaceRoot, {
      recursive: true,
      errorOnExist: false,
      force: false,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Failed to copy template from "${templatePath}" into workspace "${workspaceRoot}": ${message}`,
      { cause: error },
    )
  }
}
