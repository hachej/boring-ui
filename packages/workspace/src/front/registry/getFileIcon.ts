import {
  FileIcon,
  FileTextIcon,
  FileCodeIcon,
  FileJsonIcon,
  ImageIcon,
  type LucideIcon,
} from "lucide-react"

const EXT_MAP: Record<string, LucideIcon> = {
  ts: FileCodeIcon,
  tsx: FileCodeIcon,
  js: FileCodeIcon,
  jsx: FileCodeIcon,
  mjs: FileCodeIcon,
  cjs: FileCodeIcon,
  py: FileCodeIcon,
  rb: FileCodeIcon,
  go: FileCodeIcon,
  rs: FileCodeIcon,
  java: FileCodeIcon,
  c: FileCodeIcon,
  cpp: FileCodeIcon,
  h: FileCodeIcon,
  cs: FileCodeIcon,
  swift: FileCodeIcon,
  kt: FileCodeIcon,
  sh: FileCodeIcon,
  bash: FileCodeIcon,
  zsh: FileCodeIcon,
  json: FileJsonIcon,
  jsonl: FileJsonIcon,
  md: FileTextIcon,
  mdx: FileTextIcon,
  txt: FileTextIcon,
  csv: FileTextIcon,
  tsv: FileTextIcon,
  yaml: FileTextIcon,
  yml: FileTextIcon,
  toml: FileTextIcon,
  ini: FileTextIcon,
  cfg: FileTextIcon,
  conf: FileTextIcon,
  env: FileTextIcon,
  png: ImageIcon,
  jpg: ImageIcon,
  jpeg: ImageIcon,
  gif: ImageIcon,
  svg: ImageIcon,
  webp: ImageIcon,
  ico: ImageIcon,
  bmp: ImageIcon,
}

export function getFileIcon(filename: string): LucideIcon {
  const ext = filename.split(".").pop()?.toLowerCase()
  if (ext && ext in EXT_MAP) return EXT_MAP[ext]
  return FileIcon
}
