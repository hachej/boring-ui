export interface Workspace {
  readonly root: string
  readFile(relPath: string): Promise<string>
  writeFile(relPath: string, data: string): Promise<void>
  unlink(relPath: string): Promise<void>
  readdir(relPath: string): Promise<Entry[]>
  stat(relPath: string): Promise<Stat>
  mkdir(relPath: string, opts?: { recursive?: boolean }): Promise<void>
  rename(fromRelPath: string, toRelPath: string): Promise<void>
}

export interface Entry {
  name: string
  kind: 'file' | 'dir'
}

export interface Stat {
  size: number
  mtimeMs: number
  kind: 'file' | 'dir'
}
