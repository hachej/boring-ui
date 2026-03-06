/**
 * File type icons utility - maps file extensions to Lucide React icons.
 *
 * @module utils/fileIcons
 */

import {
  File,
  FileCode,
  FileJson,
  FileText,
  FileType,
  FileImage,
  FileTerminal,
  FileBox,
  FileKey,
  FileCog,
  FileSpreadsheet,
  FileVideo,
  FileAudio,
  FileArchive,
} from 'lucide-react'
import { ICON_SIZE_INLINE } from './iconTokens'

/**
 * Icon mapping for file extensions.
 * Keys are lowercase extensions without the dot.
 */
const EXTENSION_ICONS = {
  // JavaScript / TypeScript
  js: FileCode,
  jsx: FileCode,
  mjs: FileCode,
  cjs: FileCode,
  ts: FileCode,
  tsx: FileCode,
  mts: FileCode,
  cts: FileCode,

  // Python
  py: FileCode,
  pyw: FileCode,
  pyx: FileCode,
  pyi: FileCode,
  ipynb: FileCode,

  // Ruby
  rb: FileCode,
  rake: FileCode,
  gemspec: FileCode,

  // Go
  go: FileCode,
  mod: FileCode,

  // Rust
  rs: FileCode,
  toml: FileCog,

  // C / C++
  c: FileCode,
  h: FileCode,
  cpp: FileCode,
  hpp: FileCode,
  cc: FileCode,
  cxx: FileCode,

  // Java / JVM
  java: FileCode,
  kt: FileCode,
  kts: FileCode,
  scala: FileCode,
  groovy: FileCode,

  // C# / .NET
  cs: FileCode,
  fs: FileCode,
  vb: FileCode,

  // PHP
  php: FileCode,

  // Shell scripts
  sh: FileTerminal,
  bash: FileTerminal,
  zsh: FileTerminal,
  fish: FileTerminal,
  ps1: FileTerminal,
  psm1: FileTerminal,
  bat: FileTerminal,
  cmd: FileTerminal,

  // Data / Config
  json: FileJson,
  jsonl: FileJson,
  json5: FileJson,
  yaml: FileCog,
  yml: FileCog,
  xml: FileCode,
  ini: FileCog,
  cfg: FileCog,
  conf: FileCog,
  config: FileCog,

  // Environment / Secrets
  env: FileKey,
  envrc: FileKey,

  // Text / Documentation
  md: FileType,
  mdx: FileType,
  markdown: FileType,
  txt: FileText,
  text: FileText,
  rtf: FileText,
  log: FileText,
  pdf: FileBox,
  doc: FileText,
  docx: FileText,

  // HTML / Templates
  html: FileCode,
  htm: FileCode,
  xhtml: FileCode,
  vue: FileCode,
  svelte: FileCode,
  ejs: FileCode,
  hbs: FileCode,
  pug: FileCode,
  jade: FileCode,
  erb: FileCode,

  // CSS / Styles
  css: FileCode,
  scss: FileCode,
  sass: FileCode,
  less: FileCode,
  styl: FileCode,
  stylus: FileCode,

  // Images
  png: FileImage,
  jpg: FileImage,
  jpeg: FileImage,
  gif: FileImage,
  svg: FileImage,
  ico: FileImage,
  webp: FileImage,
  avif: FileImage,
  bmp: FileImage,
  tiff: FileImage,
  tif: FileImage,

  // Video
  mp4: FileVideo,
  webm: FileVideo,
  mov: FileVideo,
  avi: FileVideo,
  mkv: FileVideo,

  // Audio
  mp3: FileAudio,
  wav: FileAudio,
  ogg: FileAudio,
  flac: FileAudio,
  aac: FileAudio,
  m4a: FileAudio,

  // Archives
  zip: FileArchive,
  tar: FileArchive,
  gz: FileArchive,
  bz2: FileArchive,
  xz: FileArchive,
  '7z': FileArchive,
  rar: FileArchive,

  // Spreadsheets
  csv: FileSpreadsheet,
  tsv: FileSpreadsheet,
  xls: FileSpreadsheet,
  xlsx: FileSpreadsheet,

  // Lock files
  lock: FileCog,

  // SQL
  sql: FileCode,

  // GraphQL
  graphql: FileCode,
  gql: FileCode,

  // Prisma
  prisma: FileCode,

  // Docker
  dockerfile: FileBox,

  // Makefile (no extension but matched by name)
  makefile: FileCog,
}

/**
 * Special filename mappings (exact filename matches).
 * Takes precedence over extension matching.
 */
const FILENAME_ICONS = {
  // Config files
  '.gitignore': FileCog,
  '.gitattributes': FileCog,
  '.gitmodules': FileCog,
  '.npmrc': FileCog,
  '.nvmrc': FileCog,
  '.prettierrc': FileCog,
  '.eslintrc': FileCog,
  '.editorconfig': FileCog,
  '.babelrc': FileCog,
  '.browserslistrc': FileCog,
  '.dockerignore': FileCog,
  'dockerfile': FileBox,
  'docker-compose.yml': FileBox,
  'docker-compose.yaml': FileBox,
  'makefile': FileCog,

  // Package files
  'package.json': FileBox,
  'package-lock.json': FileCog,
  'yarn.lock': FileCog,
  'pnpm-lock.yaml': FileCog,
  'bun.lockb': FileCog,
  'composer.json': FileBox,
  'composer.lock': FileCog,
  'cargo.toml': FileBox,
  'cargo.lock': FileCog,
  'gemfile': FileBox,
  'gemfile.lock': FileCog,
  'go.mod': FileBox,
  'go.sum': FileCog,
  'requirements.txt': FileBox,
  'pyproject.toml': FileBox,
  'poetry.lock': FileCog,

  // CI/CD
  '.travis.yml': FileCog,
  'jenkinsfile': FileCog,

  // Docs
  'readme': FileType,
  'readme.md': FileType,
  'readme.txt': FileType,
  'license': FileText,
  'license.md': FileText,
  'license.txt': FileText,
  'changelog': FileType,
  'changelog.md': FileType,
}

/**
 * Default icon for unknown file types.
 */
const DEFAULT_ICON = File

/**
 * Get the appropriate icon component for a filename.
 *
 * @param {string} filename - The file name (with or without path)
 * @returns {React.ComponentType} Lucide icon component
 */
export function getFileIconComponent(filename) {
  if (!filename) return DEFAULT_ICON

  // Get just the filename (not the full path)
  const name = filename.includes('/') ? filename.split('/').pop() : filename
  const lowerName = name.toLowerCase()

  // Check exact filename matches first
  if (FILENAME_ICONS[lowerName]) {
    return FILENAME_ICONS[lowerName]
  }

  // Extract extension
  const ext = lowerName.includes('.') ? lowerName.split('.').pop() : null

  if (ext && EXTENSION_ICONS[ext]) {
    return EXTENSION_ICONS[ext]
  }

  return DEFAULT_ICON
}

/**
 * Get a rendered icon element for a filename.
 *
 * @param {string} filename - The file name
 * @param {number} [size=14] - Icon size in pixels
 * @returns {React.ReactElement} Rendered icon element
 */
export function getFileIcon(filename, size = ICON_SIZE_INLINE) {
  const IconComponent = getFileIconComponent(filename)
  return <IconComponent size={size} />
}

export { EXTENSION_ICONS, FILENAME_ICONS, DEFAULT_ICON }
