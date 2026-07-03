import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type { FilesystemId } from "../shared/index";

export const READONLY_PROJECTION_MUTATION_CODE = "READONLY_PROJECTION_READONLY";
export const READONLY_PROJECTION_INVALID_PATH_CODE = "READONLY_PROJECTION_INVALID_PATH";
export const READONLY_PROJECTION_BINDING_NOT_FOUND_CODE = "READONLY_PROJECTION_BINDING_NOT_FOUND";

export interface FilesystemPathDescriptor {
  readonly filesystem: FilesystemId;
  readonly path: string;
}

export interface ReadonlyProjectionOperationMetadata {
  readonly filesystem: FilesystemId;
  readonly path: string;
  readonly operation: string;
}

export class ReadonlyProjectionOperationError extends Error {
  readonly code: string;
  readonly metadata: ReadonlyProjectionOperationMetadata;

  constructor(code: string, message: string, metadata: ReadonlyProjectionOperationMetadata) {
    super(message);
    this.name = "ReadonlyProjectionOperationError";
    this.code = code;
    this.metadata = metadata;
  }
}

export interface ReadonlyProjectionSearchOptions {
  readonly offset?: number;
  readonly limit?: number;
}

export interface ReadonlyProjectionOperations {
  read(descriptor: FilesystemPathDescriptor): Promise<{ content: string; metadata: ReadonlyProjectionOperationMetadata }>;
  list(descriptor: FilesystemPathDescriptor): Promise<{ entries: string[]; metadata: ReadonlyProjectionOperationMetadata }>;
  find(descriptor: FilesystemPathDescriptor, pattern: string, options?: ReadonlyProjectionSearchOptions): Promise<{ paths: string[]; metadata: ReadonlyProjectionOperationMetadata }>;
  grep(descriptor: FilesystemPathDescriptor, pattern: string, options?: ReadonlyProjectionSearchOptions): Promise<{ matches: Array<{ path: string; line: number; text: string }>; metadata: ReadonlyProjectionOperationMetadata }>;
  stat(descriptor: FilesystemPathDescriptor): Promise<{ isDirectory: boolean; metadata: ReadonlyProjectionOperationMetadata }>;
  rejectMutation(operation: string, descriptor: FilesystemPathDescriptor): never;
}

function normalizeProjectionPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  if (normalized.includes("\0")) throw new Error("null byte in projection path");
  if (normalized.includes(":/")) throw new Error("filesystem prefixes are not valid path strings");
  if (normalized === "") return "/";
  const withRoot = normalized.startsWith("/") ? normalized : `/${normalized}`;
  const parts = withRoot.split("/").filter(Boolean);
  if (parts.some((part) => part === ".." || part === ".")) {
    throw new Error("path traversal is not allowed");
  }
  return `/${parts.join("/")}`;
}

function unreadableProjectionPathError(metadata: ReadonlyProjectionOperationMetadata): ReadonlyProjectionOperationError {
  return new ReadonlyProjectionOperationError(
    READONLY_PROJECTION_INVALID_PATH_CODE,
    "projection path is not readable",
    { ...metadata, path: "not_found_or_denied" },
  );
}

function assertProjectionDescriptor(
  descriptor: FilesystemPathDescriptor,
  operation: string,
  expectedFilesystem: FilesystemId,
): ReadonlyProjectionOperationMetadata {
  if (descriptor.filesystem !== expectedFilesystem) {
    throw new ReadonlyProjectionOperationError(
      READONLY_PROJECTION_BINDING_NOT_FOUND_CODE,
      `No readonly binding for filesystem ${descriptor.filesystem}`,
      { filesystem: descriptor.filesystem, path: descriptor.path, operation },
    );
  }
  try {
    return { filesystem: descriptor.filesystem, path: normalizeProjectionPath(descriptor.path), operation };
  } catch (err) {
    throw new ReadonlyProjectionOperationError(
      READONLY_PROJECTION_INVALID_PATH_CODE,
      (err as Error).message,
      { filesystem: descriptor.filesystem, path: "invalid_path", operation },
    );
  }
}

function projectionPath(handle: ReadonlyProjectionHandle, path: string): string {
  const normalized = normalizeProjectionPath(path);
  return join(handle.projectionRoot, ...normalized.slice(1).split("/"));
}

async function assertInsideProjection(handle: ReadonlyProjectionHandle, candidate: string): Promise<void> {
  const root = resolve(handle.projectionRoot);
  const resolvedCandidate = resolve(candidate);
  const candidateExists = await stat(resolvedCandidate).then(() => true).catch(() => false);
  const anchor = candidateExists ? resolvedCandidate : resolve(dirname(resolvedCandidate));
  const rel = relative(root, anchor);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("path escapes readonly projection");
}

async function walkFiles(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const absolutePath = join(current, entry.name);
    if (entry.isDirectory()) out.push(...await walkFiles(root, absolutePath));
    else if (entry.isFile()) out.push(absolutePath);
  }
  return out;
}

function pageVisibleResults<T>(items: T[], options: ReadonlyProjectionSearchOptions | undefined): T[] {
  const offset = Math.max(0, Math.trunc(options?.offset ?? 0));
  const limit = options?.limit == null ? undefined : Math.max(0, Math.trunc(options.limit));
  return limit == null ? items.slice(offset) : items.slice(offset, offset + limit);
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[|\\{}()[\]^$+?.]/g, "\\$&")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped}$`);
}

export interface ReadonlyProjectionHandle {
  readonly filesystem: FilesystemId;
  readonly projectionRoot: string;
}

export function createReadonlyProjectionOperations(handle: ReadonlyProjectionHandle): ReadonlyProjectionOperations {
  const expectedFilesystem = handle.filesystem;

  async function filesUnder(path: string): Promise<string[]> {
    const root = projectionPath(handle, path);
    await assertInsideProjection(handle, root);
    const rootStat = await stat(root);
    const files = rootStat.isDirectory() ? await walkFiles(handle.projectionRoot, root) : [root];
    return files.map((file) => `/${relative(handle.projectionRoot, file).split(sep).join("/")}`).sort();
  }

  return {
    async read(descriptor) {
      const metadata = assertProjectionDescriptor(descriptor, "read", expectedFilesystem);
      const target = projectionPath(handle, metadata.path);
      await assertInsideProjection(handle, target);
      try {
        return { content: await readFile(target, "utf8"), metadata };
      } catch {
        throw unreadableProjectionPathError(metadata);
      }
    },
    async list(descriptor) {
      const metadata = assertProjectionDescriptor(descriptor, "list", expectedFilesystem);
      const target = projectionPath(handle, metadata.path);
      await assertInsideProjection(handle, target);
      try {
        const entries = (await readdir(target)).sort();
        return { entries, metadata };
      } catch {
        throw unreadableProjectionPathError(metadata);
      }
    },
    async find(descriptor, pattern, options) {
      const metadata = assertProjectionDescriptor(descriptor, "find", expectedFilesystem);
      try {
        const matcher = globToRegex(pattern);
        const paths = (await filesUnder(metadata.path)).filter((path) => matcher.test(path.slice(1)) || matcher.test(path.split("/").at(-1) ?? path));
        return { paths: pageVisibleResults(paths, options), metadata };
      } catch {
        throw unreadableProjectionPathError(metadata);
      }
    },
    async grep(descriptor, pattern, options) {
      const metadata = assertProjectionDescriptor(descriptor, "grep", expectedFilesystem);
      try {
        const matches: Array<{ path: string; line: number; text: string }> = [];
        for (const path of await filesUnder(metadata.path)) {
          const content = await readFile(projectionPath(handle, path), "utf8");
          content.split("\n").forEach((text, index) => {
            if (text.includes(pattern)) matches.push({ path, line: index + 1, text });
          });
        }
        return { matches: pageVisibleResults(matches, options), metadata };
      } catch {
        throw unreadableProjectionPathError(metadata);
      }
    },
    async stat(descriptor) {
      const metadata = assertProjectionDescriptor(descriptor, "stat", expectedFilesystem);
      const target = projectionPath(handle, metadata.path);
      await assertInsideProjection(handle, target);
      try {
        return { isDirectory: (await stat(target)).isDirectory(), metadata };
      } catch {
        throw unreadableProjectionPathError(metadata);
      }
    },
    rejectMutation(operation, descriptor): never {
      const metadata = assertProjectionDescriptor(descriptor, operation, expectedFilesystem);
      throw new ReadonlyProjectionOperationError(
        READONLY_PROJECTION_MUTATION_CODE,
        `filesystem is readonly for ${operation}`,
        { ...metadata, path: "readonly" },
      );
    },
  };
}
