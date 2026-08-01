import type { Entry, Stat, Workspace } from "@hachej/boring-agent/shared"

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export class MemoryWorkspace implements Workspace {
  readonly root = "/workspace"
  readonly runtimeContext = { runtimeCwd: "/workspace", mode: "direct" as const }
  readonly files = new Map<string, { bytes: Uint8Array; mtimeMs: number }>()
  writeCount = 0
  private clock = 100

  async readFile(path: string): Promise<string> {
    const file = this.files.get(path)
    if (!file) throw new Error("not found")
    return decoder.decode(file.bytes)
  }

  async readBinaryFile(path: string): Promise<Uint8Array> {
    const file = this.files.get(path)
    if (!file) throw new Error("not found")
    return file.bytes.slice()
  }

  async writeFile(path: string, data: string): Promise<void> {
    await this.writeFileWithStat(path, data)
  }

  async writeFileWithStat(path: string, data: string): Promise<Stat> {
    const mtimeMs = ++this.clock
    this.files.set(path, { bytes: encoder.encode(data), mtimeMs })
    this.writeCount += 1
    return { size: encoder.encode(data).byteLength, mtimeMs, kind: "file" }
  }

  async writeBinaryFile(path: string, data: Uint8Array): Promise<void> {
    const mtimeMs = ++this.clock
    this.files.set(path, { bytes: data.slice(), mtimeMs })
  }

  async unlink(path: string): Promise<void> { this.files.delete(path) }
  async readdir(_path: string): Promise<Entry[]> { return [] }
  async stat(path: string): Promise<Stat> {
    const file = this.files.get(path)
    if (!file) throw new Error("not found")
    return { size: file.bytes.byteLength, mtimeMs: file.mtimeMs, kind: "file" }
  }
  async mkdir(): Promise<void> {}
  async rename(from: string, to: string): Promise<void> {
    const file = this.files.get(from)
    if (!file) throw new Error("not found")
    this.files.set(to, file)
    this.files.delete(from)
  }

  mutateExternally(path: string, text: string): void {
    this.files.set(path, { bytes: encoder.encode(text), mtimeMs: ++this.clock })
  }
}
