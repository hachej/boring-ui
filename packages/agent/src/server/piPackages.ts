import type { PackageSource } from "@mariozechner/pi-coding-agent";

export type PiPackageSource = PackageSource;

export const PI_PACKAGE_RESOURCE_FILTERS = [
  "extensions",
  "skills",
  "prompts",
  "themes",
] as const;

type PiPackageResourceFilter = (typeof PI_PACKAGE_RESOURCE_FILTERS)[number];

function sortedFilterValues(source: Exclude<PiPackageSource, string>) {
  return Object.fromEntries(
    PI_PACKAGE_RESOURCE_FILTERS.map((filter) => {
      const value = source[filter];
      return [filter, value ? [...value].sort() : value];
    }),
  ) as Record<PiPackageResourceFilter, string[] | undefined>;
}

function hasResourceFilters(source: Exclude<PiPackageSource, string>): boolean {
  return PI_PACKAGE_RESOURCE_FILTERS.some((filter) => source[filter] !== undefined);
}

export function piPackageSourceKey(source: PiPackageSource): string {
  if (typeof source === "string") return JSON.stringify({ source });
  if (!hasResourceFilters(source)) return JSON.stringify({ source: source.source });
  return JSON.stringify({
    source: source.source,
    ...sortedFilterValues(source),
  });
}

export function compactPiPackages(
  sources: Array<PiPackageSource | undefined>,
): PiPackageSource[] {
  const seen = new Set<string>();
  const result: PiPackageSource[] = [];
  for (const source of sources) {
    if (!source) continue;
    const key = piPackageSourceKey(source);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(source);
  }
  return result;
}

export function mergePiPackageSources(
  base: PiPackageSource[] = [],
  additional: PiPackageSource[] = [],
): PiPackageSource[] {
  return compactPiPackages([...base, ...additional]);
}
