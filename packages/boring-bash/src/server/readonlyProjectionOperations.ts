import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { posix } from "node:path";

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
  read(descriptor: FilesystemPathDescriptor): Promise<{ content: string; metadata: ReadonlyProjectionOperationMetadata; mtimeMs?: number }>;
  list(descriptor: FilesystemPathDescriptor): Promise<{ entries: string[]; metadata: ReadonlyProjectionOperationMetadata }>;
  find(descriptor: FilesystemPathDescriptor, pattern: string, options?: ReadonlyProjectionSearchOptions): Promise<{ paths: string[]; metadata: ReadonlyProjectionOperationMetadata }>;
  grep(descriptor: FilesystemPathDescriptor, pattern: string, options?: ReadonlyProjectionSearchOptions): Promise<{ matches: Array<{ path: string; line: number; text: string }>; metadata: ReadonlyProjectionOperationMetadata }>;
  stat(descriptor: FilesystemPathDescriptor): Promise<{ isDirectory: boolean; metadata: ReadonlyProjectionOperationMetadata }>;
  rejectMutation(operation: string, descriptor: FilesystemPathDescriptor): never;
}

export interface ReadonlyProjectionHandle {
  readonly filesystem: FilesystemId;
  readonly projectionRoot: string;
}

export interface ReadonlyProjectionMount {
  /** Normalized logical path without a leading slash. Empty mounts the filesystem root. */
  readonly logicalRoot: string;
  /** Canonical host root admitted by the caller. */
  readonly sourceRoot: string;
}

export interface ReadonlyMultiRootProjectionHandle {
  readonly filesystem: FilesystemId;
  readonly mounts: readonly ReadonlyProjectionMount[];
  readonly pathStyle: "absolute" | "relative";
  readonly symlinks: "reject" | "confined";
}

interface RoutedPath {
  readonly mount: ReadonlyProjectionMount;
  readonly logicalPath: string;
  readonly remainder: string;
}

function normalizeLogicalPath(path: string, style: "absolute" | "relative"): string {
  if (style === "relative" && (path.includes("\\") || /%(?:2e|2f|5c)/i.test(path) || /^[a-z][a-z0-9+.-]*:/i.test(path))) {
    throw new Error("invalid path");
  }
  const normalizedSeparators = path.replace(/\\/g, "/");
  if (normalizedSeparators.includes("\0") || normalizedSeparators.includes(":/")) throw new Error("invalid path");
  if (style === "relative" && (normalizedSeparators === "" || normalizedSeparators.startsWith("/"))) throw new Error("invalid path");
  const parts = normalizedSeparators.split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) throw new Error("path traversal is not allowed");
  const logical = parts.join("/");
  if (style === "relative" && posix.normalize(logical) !== logical) throw new Error("invalid path");
  return logical;
}

function displayPath(path: string, style: "absolute" | "relative"): string {
  return style === "absolute" ? `/${path}` : path;
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function isNotFoundError(error: unknown): boolean {
  return (error as { code?: unknown })?.code === "ENOENT";
}

function page<T>(items: readonly T[], options: ReadonlyProjectionSearchOptions | undefined): T[] {
  const offset = Math.max(0, Math.trunc(options?.offset ?? 0));
  const limit = options?.limit == null ? undefined : Math.max(0, Math.trunc(options.limit));
  return limit == null ? items.slice(offset) : items.slice(offset, offset + limit);
}

function glob(pattern: string): RegExp {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        source += ".*";
        index += 1;
      } else {
        source += "[^/]*";
      }
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    if (char === "[") {
      const closing = pattern.indexOf("]", index + 1);
      if (closing > index + 1) {
        const content = pattern.slice(index + 1, closing);
        const negated = content.startsWith("!") ? `^${content.slice(1)}` : content;
        source += `[${negated.replace(/\\/g, "\\\\")}]`;
        index = closing;
        continue;
      }
    }
    source += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

function invalidPath(metadata: ReadonlyProjectionOperationMetadata): ReadonlyProjectionOperationError {
  return new ReadonlyProjectionOperationError(
    READONLY_PROJECTION_INVALID_PATH_CODE,
    "projection path is not readable",
    { ...metadata, path: "not_found_or_denied" },
  );
}

function assertDescriptor(
  descriptor: FilesystemPathDescriptor,
  operation: string,
  handle: ReadonlyMultiRootProjectionHandle,
): { metadata: ReadonlyProjectionOperationMetadata; logicalPath: string } {
  if (descriptor.filesystem !== handle.filesystem) {
    throw new ReadonlyProjectionOperationError(
      READONLY_PROJECTION_BINDING_NOT_FOUND_CODE,
      "readonly binding is unavailable",
      { filesystem: descriptor.filesystem, path: "not_found_or_denied", operation },
    );
  }
  try {
    const logicalPath = normalizeLogicalPath(descriptor.path, handle.pathStyle);
    return {
      logicalPath,
      metadata: {
        filesystem: descriptor.filesystem,
        path: displayPath(logicalPath, handle.pathStyle),
        operation,
      },
    };
  } catch (error) {
    throw new ReadonlyProjectionOperationError(
      READONLY_PROJECTION_INVALID_PATH_CODE,
      (error as Error).message,
      { filesystem: descriptor.filesystem, path: "invalid_path", operation },
    );
  }
}

function routePath(handle: ReadonlyMultiRootProjectionHandle, logicalPath: string): RoutedPath {
  for (const mount of handle.mounts) {
    if (mount.logicalRoot === "") return { mount, logicalPath, remainder: logicalPath };
    if (logicalPath === mount.logicalRoot) return { mount, logicalPath, remainder: "" };
    if (logicalPath.startsWith(`${mount.logicalRoot}/`)) {
      return { mount, logicalPath, remainder: logicalPath.slice(mount.logicalRoot.length + 1) };
    }
  }
  throw new Error("path has no readonly mount");
}

/**
 * Named filesystems are always addressable from their absolute root ("/") —
 * main's catalog/search/tree routes call every binding at path "/"
 * unconditionally. A multi-root binding has no single directory backing that
 * root, so route it as the union of every admitted mount instead of failing.
 */
function routeAllMounts(handle: ReadonlyMultiRootProjectionHandle, logicalPath: string): RoutedPath[] {
  if (logicalPath !== "") return [routePath(handle, logicalPath)];
  return handle.mounts.map((mount) => ({ mount, logicalPath, remainder: "" }));
}

async function rejectSymlinks(root: string, candidate: string): Promise<void> {
  if ((await lstat(root)).isSymbolicLink()) throw new Error("readonly projection root must not be a symlink");
  const rel = relative(root, candidate);
  if (!rel) return;
  let current = root;
  for (const part of rel.split(sep).filter(Boolean)) {
    current = join(current, part);
    const currentStat = await lstat(current).catch((error) => {
      if (isNotFoundError(error)) return null;
      throw error;
    });
    if (!currentStat) return;
    if (currentStat.isSymbolicLink()) throw new Error("symlinks are not readable in readonly projections");
  }
}

async function confinedTarget(
  handle: ReadonlyMultiRootProjectionHandle,
  routed: RoutedPath,
): Promise<string> {
  const lexical = resolve(routed.mount.sourceRoot, ...routed.remainder.split("/").filter(Boolean));
  if (!isInside(routed.mount.sourceRoot, lexical)) throw new Error("path escapes readonly projection");
  if (handle.symlinks === "reject") await rejectSymlinks(routed.mount.sourceRoot, lexical);
  const canonical = await realpath(lexical);
  if (!isInside(routed.mount.sourceRoot, canonical)) throw new Error("path escapes readonly projection");
  return canonical;
}

async function walkFiles(
  handle: ReadonlyMultiRootProjectionHandle,
  routed: RoutedPath,
  visited = new Set<string>(),
): Promise<Array<{ logicalPath: string; target: string }>> {
  const target = await confinedTarget(handle, routed);
  const targetStat = await stat(target);
  if (targetStat.isFile()) return [{ logicalPath: routed.logicalPath, target }];
  if (!targetStat.isDirectory() || visited.has(target)) return [];
  visited.add(target);

  const files: Array<{ logicalPath: string; target: string }> = [];
  for (const entry of await readdir(target, { withFileTypes: true })) {
    if (handle.symlinks === "reject" && entry.isSymbolicLink()) continue;
    const logicalPath = routed.logicalPath ? `${routed.logicalPath}/${entry.name}` : entry.name;
    files.push(...await walkFiles(handle, routePath(handle, logicalPath), visited));
  }
  return files;
}

function assertMounts(handle: ReadonlyMultiRootProjectionHandle): void {
  const roots = new Set<string>();
  for (const mount of handle.mounts) {
    const normalized = mount.logicalRoot === "" ? "" : normalizeLogicalPath(mount.logicalRoot, "relative");
    if (normalized !== mount.logicalRoot || roots.has(normalized) || !isAbsolute(mount.sourceRoot)) throw new Error("invalid readonly mount");
    for (const root of roots) {
      if (root === "" || normalized.startsWith(`${root}/`) || root.startsWith(`${normalized}/`)) {
        throw new Error("readonly mounts overlap");
      }
    }
    roots.add(normalized);
  }
}

export function createReadonlyMultiRootProjectionOperations(
  handle: ReadonlyMultiRootProjectionHandle,
): ReadonlyProjectionOperations {
  assertMounts(handle);

  async function protectedOperation<T>(
    metadata: ReadonlyProjectionOperationMetadata,
    run: () => Promise<T>,
  ): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof ReadonlyProjectionOperationError) throw error;
      throw invalidPath(metadata);
    }
  }

  return {
    async read(descriptor) {
      const { metadata, logicalPath } = assertDescriptor(descriptor, "read", handle);
      return protectedOperation(metadata, async () => {
        const target = await confinedTarget(handle, routePath(handle, logicalPath));
        const targetStat = await stat(target);
        if (!targetStat.isFile()) throw new Error("not a file");
        return { content: await readFile(target, "utf8"), mtimeMs: targetStat.mtimeMs, metadata };
      });
    },
    async list(descriptor) {
      const { metadata, logicalPath } = assertDescriptor(descriptor, "list", handle);
      return protectedOperation(metadata, async () => {
        if (
          logicalPath === "" &&
          handle.mounts.length > 0 &&
          !handle.mounts.some((mount) => mount.logicalRoot === "")
        ) {
          // No single mount owns the root of a multi-root binding — surface
          // each mount's top-level logical segment as a synthetic directory
          // entry so root listing never hard-fails.
          const topSegments = new Set(handle.mounts.map((mount) => mount.logicalRoot.split("/")[0]));
          return { entries: [...topSegments].sort(), metadata };
        }
        const target = await confinedTarget(handle, routePath(handle, logicalPath));
        if (!(await stat(target)).isDirectory()) throw new Error("not a directory");
        const entries = await readdir(target, { withFileTypes: true });
        if (handle.symlinks === "reject" && entries.some((entry) => entry.isSymbolicLink())) {
          throw new Error("symlinks are not readable in readonly projections");
        }
        for (const entry of entries) {
          await confinedTarget(handle, routePath(handle, logicalPath ? `${logicalPath}/${entry.name}` : entry.name));
        }
        return { entries: entries.map((entry) => entry.name).sort(), metadata };
      });
    },
    async find(descriptor, pattern, options) {
      const { metadata, logicalPath } = assertDescriptor(descriptor, "find", handle);
      return protectedOperation(metadata, async () => {
        const matcher = glob(pattern);
        const routed = routeAllMounts(handle, logicalPath);
        const found: Array<{ logicalPath: string; target: string }> = [];
        for (const entry of routed) found.push(...await walkFiles(handle, entry));
        const paths = found
          .map((entry) => displayPath(entry.logicalPath, handle.pathStyle))
          .filter((path) => matcher.test(path.replace(/^\//, "")) || matcher.test(posix.basename(path)))
          .sort();
        return { paths: page(paths, options), metadata };
      });
    },
    async grep(descriptor, pattern, options) {
      const { metadata, logicalPath } = assertDescriptor(descriptor, "grep", handle);
      return protectedOperation(metadata, async () => {
        const matches: Array<{ path: string; line: number; text: string }> = [];
        const routed = routeAllMounts(handle, logicalPath);
        const found: Array<{ logicalPath: string; target: string }> = [];
        for (const entry of routed) found.push(...await walkFiles(handle, entry));
        for (const entry of found) {
          const content = await readFile(entry.target, "utf8");
          content.split("\n").forEach((text, index) => {
            if (text.includes(pattern)) matches.push({
              path: displayPath(entry.logicalPath, handle.pathStyle),
              line: index + 1,
              text,
            });
          });
        }
        return { matches: page(matches, options), metadata };
      });
    },
    async stat(descriptor) {
      const { metadata, logicalPath } = assertDescriptor(descriptor, "stat", handle);
      return protectedOperation(metadata, async () => ({
        isDirectory: (await stat(await confinedTarget(handle, routePath(handle, logicalPath)))).isDirectory(),
        metadata,
      }));
    },
    rejectMutation(operation, descriptor): never {
      const { metadata, logicalPath } = assertDescriptor(descriptor, operation, handle);
      try {
        routePath(handle, logicalPath);
      } catch {
        throw invalidPath(metadata);
      }
      throw new ReadonlyProjectionOperationError(
        READONLY_PROJECTION_MUTATION_CODE,
        `filesystem is readonly for ${operation}`,
        { ...metadata, path: "readonly" },
      );
    },
  };
}

export function createReadonlyProjectionOperations(handle: ReadonlyProjectionHandle): ReadonlyProjectionOperations {
  return createReadonlyMultiRootProjectionOperations({
    filesystem: handle.filesystem,
    mounts: [{ logicalRoot: "", sourceRoot: resolve(handle.projectionRoot) }],
    pathStyle: "absolute",
    symlinks: "reject",
  });
}
