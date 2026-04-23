export interface FileSearch {
  search(glob: string, limit?: number): Promise<string[]>
}
