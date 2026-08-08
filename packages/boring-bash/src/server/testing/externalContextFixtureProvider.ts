import { constants } from "node:fs";
import { access, chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type {
  BoundFilesystemContext,
  FilesystemBinding,
  FilesystemBindingProvider,
  FilesystemId,
  FilesystemProjection,
  PreparedFilesystemBinding,
} from "../../shared/index";

export interface ExternalContextFixtureFile {
  path: string;
  content: string;
}

export interface ExternalContextFixtureProjectionPolicy {
  readonly allowedPathPrefixes: readonly string[];
  readonly grantManagementBinding?: boolean;
}

export interface ExternalContextFixtureProviderOptions {
  readonly filesystemId: FilesystemId;
  readonly sourceRoot: string;
  readonly projectionRootParent?: string;
  readonly resolvePolicy: (ctx: BoundFilesystemContext) => ExternalContextFixtureProjectionPolicy | Promise<ExternalContextFixtureProjectionPolicy>;
}

export interface ExternalContextFixturePreparedLifecycle {
  active: boolean;
}

export interface ExternalContextFixturePreparedHandle {
  readonly kind: "external-context-fixture-projection";
  /** Logical filesystem identity for this prepared binding; paths are scoped by this id. */
  readonly filesystem: FilesystemId;
  readonly sourceRoot: string;
  readonly projectionRoot: string;
  readonly visiblePaths: readonly string[];
  readonly access?: "readonly" | "readwrite";
  readonly projection?: FilesystemProjection;
  readonly lifecycle?: ExternalContextFixturePreparedLifecycle;
}

export type ExternalContextFixturePreparedBinding = PreparedFilesystemBinding & {
  handle: ExternalContextFixturePreparedHandle;
};

function normalizeExternalPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  if (!normalized.startsWith("/")) return `/${normalized}`;
  return normalized;
}

function assertSafeExternalPath(path: string): string {
  const normalized = normalizeExternalPath(path);
  if (normalized.includes("\0")) throw new Error(`invalid external context path: ${path}`);
  for (const part of normalized.split("/")) {
    if (part === "..") throw new Error(`invalid external context path traversal: ${path}`);
  }
  return normalized.replace(/\/+/g, "/");
}

function isAllowed(path: string, prefixes: readonly string[]): boolean {
  const normalized = assertSafeExternalPath(path);
  return prefixes.some((prefix) => {
    const normalizedPrefix = assertSafeExternalPath(prefix).replace(/\/+$/, "");
    return normalized === normalizedPrefix || normalized.startsWith(`${normalizedPrefix}/`);
  });
}

async function assertInsideRoot(root: string, candidate: string): Promise<void> {
  const realRoot = await realpath(root);
  const existing = await realpath(candidate);
  const rel = relative(realRoot, existing);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`path escapes external context root: ${candidate}`);
  }
}

async function walkFiles(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const absolutePath = join(current, entry.name);
    const entryStat = await lstat(absolutePath);
    if (entryStat.isSymbolicLink()) {
      await assertInsideRoot(root, absolutePath);
      continue;
    }
    if (entry.isDirectory()) out.push(...await walkFiles(root, absolutePath));
    else if (entry.isFile()) out.push(absolutePath);
  }
  return out;
}

async function makeProjectionReadonly(root: string, current = root): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = join(current, entry.name);
    if (entry.isDirectory()) await makeProjectionReadonly(root, absolutePath);
    else if (entry.isFile()) await chmod(absolutePath, 0o444);
  }
  await chmod(current, 0o555);
}

export async function seedExternalContextFixture(
  root: string,
  files: readonly ExternalContextFixtureFile[],
): Promise<void> {
  for (const file of files) {
    const safePath = assertSafeExternalPath(file.path);
    const target = join(root, ...safePath.slice(1).split("/"));
    await mkdir(dirname(target), { recursive: true });
    await access(dirname(target), constants.W_OK);
    await writeFile(target, file.content);
  }
}

export class FixtureExternalContextBindingProvider implements FilesystemBindingProvider {
  readonly #filesystem: FilesystemId;
  readonly #sourceRoot: string;
  readonly #projectionRootParent: string;
  readonly #resolvePolicy: ExternalContextFixtureProviderOptions["resolvePolicy"];

  constructor(options: ExternalContextFixtureProviderOptions) {
    this.#filesystem = options.filesystemId;
    this.#sourceRoot = resolve(options.sourceRoot);
    this.#projectionRootParent = resolve(options.projectionRootParent ?? tmpdir());
    this.#resolvePolicy = options.resolvePolicy;
  }

  async invalidateBinding(_ctx: BoundFilesystemContext, _filesystem: FilesystemId): Promise<void> {
    // Fixture/local policies are resolved on every prepareBinding call; invalidation is a lifecycle hook for callers.
  }

  async disposeBinding(prepared: PreparedFilesystemBinding): Promise<void> {
    const handle = prepared.handle as Partial<ExternalContextFixturePreparedHandle>;
    if (handle.lifecycle) handle.lifecycle.active = false;
  }

  async prepareBinding(ctx: BoundFilesystemContext, binding: FilesystemBinding): Promise<ExternalContextFixturePreparedBinding> {
    if (binding.filesystem !== this.#filesystem) {
      throw new Error(`fixture external context provider cannot prepare filesystem ${binding.filesystem}`);
    }
    if (binding.access === "readwrite" && binding.projection === "management") {
      const policy = await this.#resolvePolicy(ctx);
      if (!policy.grantManagementBinding) {
        throw new Error("fixture external context provider policy did not grant readwrite management binding");
      }
      const lifecycle = { active: true };
      return {
        binding,
        handle: {
          kind: "external-context-fixture-projection",
          filesystem: binding.filesystem,
          sourceRoot: this.#sourceRoot,
          projectionRoot: this.#sourceRoot,
          visiblePaths: await listFixtureProjectionFiles({
            kind: "external-context-fixture-projection",
            filesystem: binding.filesystem,
            sourceRoot: this.#sourceRoot,
            projectionRoot: this.#sourceRoot,
            visiblePaths: [],
            access: "readwrite",
            projection: "management",
          }),
          access: "readwrite",
          projection: "management",
          lifecycle,
        },
      };
    }
    if (binding.access !== "readonly" || binding.projection !== "policy-filtered") {
      throw new Error("fixture external context provider only prepares readonly policy-filtered or readwrite management bindings");
    }

    const policy = await this.#resolvePolicy(ctx);
    const projectionRoot = await mkdtemp(join(this.#projectionRootParent, "boring-external-context-"));
    const visiblePaths: string[] = [];
    const files = await walkFiles(this.#sourceRoot);

    for (const sourceFile of files) {
      await assertInsideRoot(this.#sourceRoot, sourceFile);
      const rel = relative(this.#sourceRoot, sourceFile).split(sep).join("/");
      const externalPath = assertSafeExternalPath(`/${rel}`);
      if (!isAllowed(externalPath, policy.allowedPathPrefixes)) continue;

      const destination = join(projectionRoot, ...externalPath.slice(1).split("/"));
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(sourceFile, destination);
      visiblePaths.push(externalPath);
    }

    visiblePaths.sort();
    await makeProjectionReadonly(projectionRoot);
    const lifecycle = { active: true };
    return {
      binding,
      handle: {
        kind: "external-context-fixture-projection",
        filesystem: binding.filesystem,
        sourceRoot: this.#sourceRoot,
        projectionRoot,
        visiblePaths,
        access: "readonly",
        projection: "policy-filtered",
        lifecycle,
      },
    };
  }
}

export async function readFixtureProjectionFile(
  handle: ExternalContextFixturePreparedHandle,
  externalPath: string,
): Promise<string> {
  const safePath = assertSafeExternalPath(externalPath);
  const target = join(handle.projectionRoot, ...safePath.slice(1).split("/"));
  await assertInsideRoot(handle.projectionRoot, target);
  return await readFile(target, "utf8");
}

export async function listFixtureProjectionFiles(handle: ExternalContextFixturePreparedHandle): Promise<string[]> {
  const files = await walkFiles(handle.projectionRoot);
  return files
    .map((file) => `/${relative(handle.projectionRoot, file).split(sep).join("/")}`)
    .sort();
}
