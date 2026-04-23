import { readdir, stat, readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import type { AgentTool } from "../../../shared/tool.js";

const VALID_EXTENSIONS = new Set([".js", ".mjs"]);
const GLOBAL_DIR = join(homedir(), ".pi", "agent", "extensions");
const LOCAL_DIR = ".pi/extensions";
const EXTENSIONS_JSON = ".pi/extensions.json";

export type ImportFn = (url: string) => Promise<Record<string, unknown>>;

export interface PluginLoaderOptions {
  cwd: string;
  skipGlobal?: boolean;
  importFn?: ImportFn;
}

export interface LoadedPlugin {
  source: "global" | "local" | "npm" | "git";
  path: string;
  tools: AgentTool[];
}

export interface PluginLoadResult {
  plugins: LoadedPlugin[];
  errors: Array<{ source: string; error: string }>;
}

async function dirExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}

async function discoverFromDir(
  dir: string,
  source: "global" | "local",
): Promise<{ path: string; source: "global" | "local" }[]> {
  if (!(await dirExists(dir))) return [];
  const entries = await readdir(dir);
  return entries
    .filter((e) => VALID_EXTENSIONS.has(extname(e)))
    .map((e) => ({ path: join(dir, e), source }));
}

export function validateTool(tool: unknown): AgentTool | null {
  if (typeof tool !== "object" || tool === null) return null;
  const t = tool as Record<string, unknown>;
  if (typeof t.name !== "string" || t.name.length === 0) return null;
  if (typeof t.description !== "string") return null;
  if (typeof t.parameters !== "object" || t.parameters === null) return null;
  if (typeof t.execute !== "function") return null;
  return t as unknown as AgentTool;
}

export function extractTools(mod: Record<string, unknown>): AgentTool[] {
  const tools: AgentTool[] = [];

  if (mod.default) {
    const defaultExport = mod.default;
    if (Array.isArray(defaultExport)) {
      for (const item of defaultExport) {
        const valid = validateTool(item);
        if (valid) tools.push(valid);
      }
    } else {
      const valid = validateTool(defaultExport);
      if (valid) tools.push(valid);
    }
  }

  if (mod.tools && Array.isArray(mod.tools)) {
    for (const item of mod.tools) {
      const valid = validateTool(item);
      if (valid) tools.push(valid);
    }
  }

  return tools;
}

async function loadModule(
  filePath: string,
  importFn: ImportFn,
): Promise<AgentTool[]> {
  const url = pathToFileURL(filePath).href;
  const mod = await importFn(url);
  return extractTools(mod);
}

async function discoverNpmPlugins(cwd: string): Promise<string[]> {
  const nodeModulesDir = join(cwd, "node_modules");
  if (!(await dirExists(nodeModulesDir))) return [];

  try {
    const entries = await readdir(nodeModulesDir);
    return entries
      .filter((e) => e.startsWith("pi-plugin-"))
      .map((e) => join(nodeModulesDir, e));
  } catch {
    return [];
  }
}

async function loadNpmPlugin(
  pkgDir: string,
  importFn: ImportFn,
): Promise<AgentTool[]> {
  const pkgJsonPath = join(pkgDir, "package.json");
  if (!(await fileExists(pkgJsonPath))) return [];

  const pkgJson = JSON.parse(await readFile(pkgJsonPath, "utf-8"));
  const main = pkgJson.main ?? "index.js";
  return loadModule(join(pkgDir, main), importFn);
}

interface ExtensionsConfig {
  npm?: string[];
  git?: string[];
}

async function loadExtensionsJson(
  cwd: string,
): Promise<ExtensionsConfig | null> {
  const configPath = join(cwd, EXTENSIONS_JSON);
  if (!(await fileExists(configPath))) return null;
  try {
    const raw = await readFile(configPath, "utf-8");
    return JSON.parse(raw) as ExtensionsConfig;
  } catch {
    return null;
  }
}

const defaultImport: ImportFn = (url: string) => import(url);

export async function loadPlugins(
  options: PluginLoaderOptions,
): Promise<PluginLoadResult> {
  const result: PluginLoadResult = { plugins: [], errors: [] };
  const importFn = options.importFn ?? defaultImport;

  const candidates: Array<{
    path: string;
    source: "global" | "local" | "npm" | "git";
  }> = [];

  if (!options.skipGlobal) {
    const globals = await discoverFromDir(GLOBAL_DIR, "global");
    candidates.push(...globals);
  }

  const localDir = join(options.cwd, LOCAL_DIR);
  const locals = await discoverFromDir(localDir, "local");
  candidates.push(...locals);

  const npmDirs = await discoverNpmPlugins(options.cwd);
  for (const dir of npmDirs) {
    candidates.push({ path: dir, source: "npm" });
  }

  const config = await loadExtensionsJson(options.cwd);
  if (config?.npm) {
    for (const pkg of config.npm) {
      const pkgDir = join(options.cwd, "node_modules", pkg);
      if (await dirExists(pkgDir)) {
        const already = candidates.some((c) => c.path === pkgDir);
        if (!already) {
          candidates.push({ path: pkgDir, source: "npm" });
        }
      }
    }
  }
  if (config?.git?.length) {
    for (const url of config.git) {
      result.errors.push({
        source: url,
        error: "git URL extensions are not yet supported",
      });
    }
  }

  for (const candidate of candidates) {
    try {
      const tools =
        candidate.source === "npm"
          ? await loadNpmPlugin(candidate.path, importFn)
          : await loadModule(candidate.path, importFn);

      if (tools.length > 0) {
        result.plugins.push({
          source: candidate.source,
          path: candidate.path,
          tools,
        });
      }
    } catch (err) {
      result.errors.push({
        source: candidate.path,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

export function flattenPluginTools(result: PluginLoadResult): AgentTool[] {
  return result.plugins.flatMap((p) => p.tools);
}
