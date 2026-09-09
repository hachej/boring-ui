import { homedir } from 'node:os'
import { join } from 'node:path'

import { FileHandleStore } from '../vercel-sandbox/FileHandleStore'

/** Standalone Blaxel handles have their own namespace and never collide with Vercel. */
export class BlaxelFileHandleStore extends FileHandleStore {
  constructor(storePath = join(homedir(), '.config', 'boring-agent', 'blaxel-sandboxes.json')) {
    super({ storePath })
  }
}
