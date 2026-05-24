import { basename, join as joinPath } from 'node:path'
import { posix } from 'node:path'
import { readdir, stat } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

import type { ProvisionWorkspaceRuntimeOptions, RuntimeTemplateContribution, WorkspaceProvisioningAdapter } from './types'

export interface SeedWorkspaceFilesResult {
  changed: boolean
}

interface TemplateWorkItem {
  hostSourcePath: string
  source: string | URL
  targetRel: string
  kind: 'file' | 'directory'
}

function sourceToPath(source: string | URL): string {
  return source instanceof URL ? fileURLToPath(source) : source
}

function toWorkspaceRel(...parts: string[]): string {
  return posix.normalize(parts.filter(Boolean).join('/'))
}

function sourceForChild(rootSource: string | URL, childPath: string): string | URL {
  return rootSource instanceof URL ? pathToFileURL(childPath) : childPath
}

async function collectTemplateWorkItems(
  template: RuntimeTemplateContribution,
): Promise<TemplateWorkItem[]> {
  const sourcePath = sourceToPath(template.path)
  const sourceStat = await stat(sourcePath)
  const targetPrefix = template.target ?? ''

  if (!sourceStat.isDirectory()) {
    const targetRel = toWorkspaceRel(targetPrefix || basename(sourcePath))
    return [{
      hostSourcePath: sourcePath,
      source: template.path,
      targetRel,
      kind: 'file',
    }]
  }

  const items: TemplateWorkItem[] = []

  async function walk(dir: string, rel: string): Promise<void> {
    const targetRel = toWorkspaceRel(targetPrefix, rel)
    if (rel !== '') {
      items.push({
        hostSourcePath: dir,
        source: sourceForChild(template.path, dir),
        targetRel,
        kind: 'directory',
      })
    } else if (targetPrefix) {
      items.push({
        hostSourcePath: dir,
        source: sourceForChild(template.path, dir),
        targetRel: toWorkspaceRel(targetPrefix),
        kind: 'directory',
      })
    }

    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const childPath = joinPath(dir, entry.name)
      const childRel = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        await walk(childPath, childRel)
      } else if (entry.isFile()) {
        items.push({
          hostSourcePath: childPath,
          source: sourceForChild(template.path, childPath),
          targetRel: toWorkspaceRel(targetPrefix, childRel),
          kind: 'file',
        })
      }
    }
  }

  await walk(sourcePath, '')
  return items
}

async function seedTemplate(options: {
  adapter: WorkspaceProvisioningAdapter
  pluginId: string
  template: RuntimeTemplateContribution
}): Promise<boolean> {
  const items = await collectTemplateWorkItems(options.template)
  let changed = false

  for (const item of items) {
    let exists: boolean
    try {
      exists = await options.adapter.workspaceFs.exists(item.targetRel)
      if (exists) continue

      if (item.kind === 'directory') {
        await options.adapter.workspaceFs.mkdir(item.targetRel)
      } else {
        await options.adapter.workspaceFs.copyFromHost(item.source, item.targetRel)
      }
      changed = true
    } catch (error: unknown) {
      throw new Error(
        `Failed to seed workspace template file (plugin=${options.pluginId}, template=${options.template.id}, source=${item.hostSourcePath}, targetRel=${item.targetRel}): ${(error as Error).message}`,
        { cause: error },
      )
    }
  }

  return changed
}

export async function seedWorkspaceFiles(options: {
  plugins: ProvisionWorkspaceRuntimeOptions['plugins']
  adapter: WorkspaceProvisioningAdapter
}): Promise<SeedWorkspaceFilesResult> {
  let changed = false

  for (const plugin of options.plugins) {
    for (const template of plugin.provisioning?.templateDirs ?? []) {
      const templateChanged = await seedTemplate({
        adapter: options.adapter,
        pluginId: plugin.id,
        template,
      })
      changed = changed || templateChanged
    }
  }

  return { changed }
}
