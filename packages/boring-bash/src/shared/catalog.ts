/**
 * Filesystem catalog contract shared by the server route that produces it
 * (`server/routes/filesystems.ts`) and the browser client that parses it
 * (workspace's filesystemPlugin fetchClient). Kept here — not in either
 * consumer — so validation of catalog strings/entries only happens once.
 * Browser-safe: no `node:*` imports.
 */

export const CATALOG_STRING_MAX_LENGTH = 128;
export const CATALOG_ROOT_DIR_MAX_LENGTH = 512;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/** Validates a single catalog string field (filesystem id, label, rootDir). */
export function isValidCatalogString(value: unknown, maxLength: number): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maxLength
    && value.trim() === value
    && !CONTROL_CHARACTERS.test(value);
}

export const FILESYSTEM_CATALOG_CAPABILITIES = [
  "read",
  "list",
  "search",
  "write",
  "delete",
  "move",
  "mkdir",
] as const;

export type FilesystemCatalogCapabilityKey = (typeof FILESYSTEM_CATALOG_CAPABILITIES)[number];

export type FilesystemCatalogCapabilities = Record<FilesystemCatalogCapabilityKey, boolean>;

export type LogicalFilesystemRoot = "." | `/${string}`;

export interface FilesystemCatalogEntry {
  filesystem: string;
  label: string;
  rootDir: LogicalFilesystemRoot;
  access: "readonly" | "readwrite";
  /** Present when the binding was contributed by a definition-shaped source (e.g. an agent package's knowledge/). */
  provenance?: "agent-definition";
  capabilities: FilesystemCatalogCapabilities;
}

export interface FilesystemCatalogResponse {
  filesystems: FilesystemCatalogEntry[];
}

export function isFilesystemCatalogCapabilities(value: unknown): value is FilesystemCatalogCapabilities {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const capabilities = value as Record<string, unknown>;
  return FILESYSTEM_CATALOG_CAPABILITIES.every((capability) => typeof capabilities[capability] === "boolean");
}

/** Parses and validates an untrusted `{ filesystems: [...] }` payload into
 * catalog entries, dropping any entry that fails the contract rather than
 * throwing — callers treat the catalog as best-effort. */
export function parseFilesystemCatalog(value: unknown): FilesystemCatalogEntry[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as { filesystems?: unknown }).filesystems)) {
    return [];
  }
  const seen = new Set<string>();
  const entries: FilesystemCatalogEntry[] = [];
  for (const candidate of (value as { filesystems: unknown[] }).filesystems) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const entry = candidate as Record<string, unknown>;
    if (!isValidCatalogString(entry.filesystem, CATALOG_STRING_MAX_LENGTH) || seen.has(entry.filesystem)) continue;
    if (!isValidCatalogString(entry.label, CATALOG_STRING_MAX_LENGTH)) continue;
    if (!isValidCatalogString(entry.rootDir, CATALOG_ROOT_DIR_MAX_LENGTH)) continue;
    if (entry.access !== "readonly" && entry.access !== "readwrite") continue;
    if (!isFilesystemCatalogCapabilities(entry.capabilities)) continue;
    const capabilities = entry.capabilities;
    seen.add(entry.filesystem);
    entries.push({
      filesystem: entry.filesystem,
      label: entry.label,
      rootDir: entry.rootDir as LogicalFilesystemRoot,
      access: entry.access,
      ...(entry.provenance === "agent-definition" ? { provenance: entry.provenance } : {}),
      capabilities: Object.fromEntries(
        FILESYSTEM_CATALOG_CAPABILITIES.map((capability) => [capability, capabilities[capability]]),
      ) as unknown as FilesystemCatalogCapabilities,
    });
  }
  return entries;
}
