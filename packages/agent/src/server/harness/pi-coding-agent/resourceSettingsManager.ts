import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SettingsManager } from "@mariozechner/pi-coding-agent";
import {
  mergePiPackageSources,
  type PiPackageSource,
} from "../../piPackages.js";

function readSettingsFileIfPresent(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, "utf-8") : undefined;
}

function mergeInjectedProjectPackages(
  settingsJson: string | undefined,
  piPackages: PiPackageSource[],
  includePackage?: (source: PiPackageSource) => boolean,
): string {
  const settings = settingsJson ? JSON.parse(settingsJson) : {};
  const configuredPackages = Array.isArray(settings.packages)
    ? settings.packages
    : [];
  return JSON.stringify({
    ...settings,
    packages: mergePiPackageSources(configuredPackages, piPackages)
      .filter((source) => includePackage?.(source) ?? true),
  });
}

export function createResourceSettingsManager(
  cwd: string,
  agentDir: string,
  piPackages: PiPackageSource[],
  options: { includePackage?: (source: PiPackageSource) => boolean } = {},
): SettingsManager {
  if (piPackages.length === 0 && !options.includePackage) return SettingsManager.create(cwd, agentDir);

  const globalSettingsPath = join(agentDir, "settings.json");
  const projectSettingsPath = join(cwd, ".pi", "settings.json");
  let globalSettingsOverrideJson: string | undefined;
  let projectSettingsOverrideJson: string | undefined;

  // Host-declared Pi packages are an in-memory project overlay. Normal reads
  // still come from Pi's real settings files so `resourceLoader.reload()` sees
  // user edits; SettingsManager writes remain in-memory.
  const storage: Parameters<typeof SettingsManager.fromStorage>[0] = {
    withLock(scope, fn) {
      if (scope === "global") {
        const current = globalSettingsOverrideJson
          ?? mergeInjectedProjectPackages(readSettingsFileIfPresent(globalSettingsPath), [], options.includePackage);
        const next = fn(current);
        if (next !== undefined) globalSettingsOverrideJson = next;
        return;
      }

      const current = projectSettingsOverrideJson
        ?? mergeInjectedProjectPackages(readSettingsFileIfPresent(projectSettingsPath), piPackages, options.includePackage);
      const next = fn(current);
      if (next !== undefined) projectSettingsOverrideJson = next;
    },
  };

  return SettingsManager.fromStorage(storage);
}
