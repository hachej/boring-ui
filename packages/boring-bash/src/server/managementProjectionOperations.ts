import { lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type { FilesystemId } from "../shared/index";
import type { FilesystemPathDescriptor } from "./readonlyProjectionOperations";

export const MANAGEMENT_PROJECTION_BINDING_REQUIRED_CODE = "MANAGEMENT_PROJECTION_BINDING_REQUIRED";
export const MANAGEMENT_PROJECTION_INVALID_PATH_CODE = "MANAGEMENT_PROJECTION_INVALID_PATH";

export interface ManagementProjectionOperationMetadata {
  readonly filesystem: FilesystemId;
  readonly path: string;
  readonly operation: string;
}

export class ManagementProjectionOperationError extends Error {
  readonly code: string;
  readonly metadata: ManagementProjectionOperationMetadata;

  constructor(code: string, message: string, metadata: ManagementProjectionOperationMetadata) {
    super(message);
    this.name = "ManagementProjectionOperationError";
    this.code = code;
    this.metadata = metadata;
  }
}


export interface ManagementProjectionHandle {
  readonly filesystem: FilesystemId;
  readonly projectionRoot: string;
  readonly access?: "readonly" | "readwrite";
  readonly projection?: "policy-filtered" | "management";
  readonly lifecycle?: { readonly active: boolean };
}

export interface ManagementProjectionOperations {
  read(descriptor: FilesystemPathDescriptor): Promise<{ content: string; metadata: ManagementProjectionOperationMetadata }>;
  list(descriptor: FilesystemPathDescriptor): Promise<{ entries: string[]; metadata: ManagementProjectionOperationMetadata }>;
  write(descriptor: FilesystemPathDescriptor, content: string): Promise<{ metadata: ManagementProjectionOperationMetadata }>;
  edit(descriptor: FilesystemPathDescriptor, oldText: string, newText: string): Promise<{ metadata: ManagementProjectionOperationMetadata }>;
}

function normalizeProjectionPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  if (normalized.includes("\0")) throw new Error("null byte in projection path");
  if (normalized.includes(":/")) throw new Error("filesystem prefixes are not valid path strings");
  if (normalized === "") return "/";
  const withRoot = normalized.startsWith("/") ? normalized : `/${normalized}`;
  const parts = withRoot.split("/").filter(Boolean);
  if (parts.some((part) => part === ".." || part === ".")) throw new Error("path traversal is not allowed");
  return `/${parts.join("/")}`;
}

function assertManagementHandle(handle: ManagementProjectionHandle): void {
  if (handle.access !== "readwrite" || handle.projection !== "management") {
    throw new ManagementProjectionOperationError(
      MANAGEMENT_PROJECTION_BINDING_REQUIRED_CODE,
      "management operation requires a readwrite management binding",
      { filesystem: handle.filesystem, path: "management_binding_required", operation: "bind" },
    );
  }
  if (handle.lifecycle?.active === false) {
    throw new ManagementProjectionOperationError(
      MANAGEMENT_PROJECTION_BINDING_REQUIRED_CODE,
      "management binding is no longer active",
      { filesystem: handle.filesystem, path: "management_binding_inactive", operation: "bind" },
    );
  }
}

function assertProjectionDescriptor(
  descriptor: FilesystemPathDescriptor,
  operation: string,
  expectedFilesystem: FilesystemId,
): ManagementProjectionOperationMetadata {
  if (descriptor.filesystem !== expectedFilesystem) {
    throw new ManagementProjectionOperationError(
      MANAGEMENT_PROJECTION_BINDING_REQUIRED_CODE,
      `No management binding for filesystem ${descriptor.filesystem}`,
      { filesystem: descriptor.filesystem, path: descriptor.path, operation },
    );
  }
  try {
    return { filesystem: descriptor.filesystem, path: normalizeProjectionPath(descriptor.path), operation };
  } catch (err) {
    throw new ManagementProjectionOperationError(
      MANAGEMENT_PROJECTION_INVALID_PATH_CODE,
      (err as Error).message,
      { filesystem: descriptor.filesystem, path: "invalid_path", operation },
    );
  }
}

function managementPath(handle: ManagementProjectionHandle, path: string): string {
  const normalized = normalizeProjectionPath(path);
  return join(handle.projectionRoot, ...normalized.slice(1).split("/"));
}

function assertRelativeInsideRoot(root: string, candidate: string): void {
  const rel = relative(root, candidate);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("path escapes management projection root");
}

async function assertExistingPathInsideManagementRoot(handle: ManagementProjectionHandle, candidate: string): Promise<void> {
  const root = await realpath(handle.projectionRoot);
  assertRelativeInsideRoot(root, await realpath(candidate));
}

async function assertWritablePathInsideManagementRoot(handle: ManagementProjectionHandle, candidate: string): Promise<void> {
  try {
    await lstat(candidate);
    await assertExistingPathInsideManagementRoot(handle, candidate);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const root = await realpath(handle.projectionRoot);
  assertRelativeInsideRoot(root, await realpath(dirname(candidate)));
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

export function createManagementProjectionOperations(handle: ManagementProjectionHandle): ManagementProjectionOperations {
  assertManagementHandle(handle);

  return {
    async read(descriptor) {
      assertManagementHandle(handle);
      const metadata = assertProjectionDescriptor(descriptor, "read", handle.filesystem);
      const target = managementPath(handle, metadata.path);
      await assertExistingPathInsideManagementRoot(handle, target);
      return { content: await readFile(target, "utf8"), metadata };
    },
    async list(descriptor) {
      assertManagementHandle(handle);
      const metadata = assertProjectionDescriptor(descriptor, "list", handle.filesystem);
      const target = managementPath(handle, metadata.path);
      await assertExistingPathInsideManagementRoot(handle, target);
      const rootStat = await stat(target);
      const files = rootStat.isDirectory() ? await walkFiles(handle.projectionRoot, target) : [target];
      return { entries: files.map((file) => `/${relative(handle.projectionRoot, file).split(sep).join("/")}`).sort(), metadata };
    },
    async write(descriptor, content) {
      assertManagementHandle(handle);
      const metadata = assertProjectionDescriptor(descriptor, "write", handle.filesystem);
      const target = managementPath(handle, metadata.path);
      await mkdir(dirname(target), { recursive: true });
      await assertWritablePathInsideManagementRoot(handle, target);
      await writeFile(target, content, "utf8");
      return { metadata };
    },
    async edit(descriptor, oldText, newText) {
      assertManagementHandle(handle);
      const metadata = assertProjectionDescriptor(descriptor, "edit", handle.filesystem);
      const target = managementPath(handle, metadata.path);
      await assertExistingPathInsideManagementRoot(handle, target);
      const content = await readFile(target, "utf8");
      if (!content.includes(oldText)) throw new Error("oldText not found in management projection file");
      await writeFile(target, content.replace(oldText, newText), "utf8");
      return { metadata };
    },
  };
}
