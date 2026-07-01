export interface ReadonlyProjectionConformanceSubject {
  readonly filesystem: string;
  readonly rootPath: string;
  readonly operations: ReadonlyProjectionConformanceOperations;
  readonly allowedReadPath: string;
  readonly deniedReadPath: string;
  readonly deniedDirectoryName: string;
  readonly deniedSentinel: string;
  readonly allowedFindPattern: string;
  readonly expectedAllowedFindCount: number;
  readonly expectedVisiblePaths: readonly string[];
  readonly projection: ReadonlyProjectionProbe;
}

export interface ReadonlyProjectionConformanceOperations {
  read(descriptor: { filesystem: string; path: string }): Promise<{ content: string }>;
  list(descriptor: { filesystem: string; path: string }): Promise<{ entries: readonly unknown[] }>;
  find(descriptor: { filesystem: string; path: string }, pattern: string): Promise<{ matches?: readonly unknown[]; paths?: readonly unknown[] }>;
  grep(descriptor: { filesystem: string; path: string }, pattern: string): Promise<{ matches: readonly unknown[] }>;
}

export interface ReadonlyProjectionProbe {
  listVisiblePaths(): Promise<readonly string[]>;
  writeExistingAllowedPath(): Promise<unknown>;
  writeNewAllowedPath(): Promise<unknown>;
  followSymlinkEscape(): Promise<unknown>;
}

export interface ReadonlyProjectionConformanceResult {
  readonly passed: boolean;
  readonly failures: readonly string[];
}

async function expectRejects(label: string, failures: string[], fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    failures.push(label);
  } catch {
    // Expected for negative conformance checks.
  }
}

function assertSerializedDoesNotLeak(
  label: string,
  value: unknown,
  deniedDirectoryName: string,
  deniedSentinel: string,
  failures: string[],
): void {
  const serialized = JSON.stringify(value);
  if (serialized.includes(deniedDirectoryName)) {
    failures.push(`${label} leaked denied directory name`);
  }
  if (serialized.includes(deniedSentinel)) {
    failures.push(`${label} leaked denied sentinel`);
  }
}

export async function checkReadonlyProjectionConformance(
  subject: ReadonlyProjectionConformanceSubject,
): Promise<ReadonlyProjectionConformanceResult> {
  const failures: string[] = [];
  const {
    filesystem,
    rootPath,
    operations,
    allowedReadPath,
    deniedReadPath,
    deniedDirectoryName,
    deniedSentinel,
    allowedFindPattern,
    expectedAllowedFindCount,
    expectedVisiblePaths,
    projection,
  } = subject;

  const visiblePaths = [...(await projection.listVisiblePaths())].sort();
  const expectedPaths = [...expectedVisiblePaths].sort();
  if (JSON.stringify(visiblePaths) !== JSON.stringify(expectedPaths)) {
    failures.push("visible path set/count does not match the expected policy-filtered projection");
  }
  if (visiblePaths.some((path) => path === deniedReadPath || path.startsWith(`${deniedReadPath}/`))) {
    failures.push("denied path is present in visiblePaths");
  }
  assertSerializedDoesNotLeak("visiblePaths", visiblePaths, deniedDirectoryName, deniedSentinel, failures);

  const allowed = await operations.read({ filesystem, path: allowedReadPath });
  assertSerializedDoesNotLeak("allowed read", allowed, deniedDirectoryName, deniedSentinel, failures);

  await expectRejects("denied read unexpectedly succeeded", failures, async () => {
    await operations.read({ filesystem, path: deniedReadPath });
  });

  const list = await operations.list({ filesystem, path: rootPath });
  assertSerializedDoesNotLeak("list", list, deniedDirectoryName, deniedSentinel, failures);

  const deniedFileName = deniedReadPath.split("/").at(-1) ?? deniedDirectoryName;
  const findDeniedName = await operations.find({ filesystem, path: rootPath }, deniedFileName);
  const deniedFindItems = findDeniedName.matches ?? findDeniedName.paths ?? [];
  if (deniedFindItems.length > 0) {
    failures.push("find returned denied resource matches");
  }
  assertSerializedDoesNotLeak("find denied resource", findDeniedName, deniedDirectoryName, deniedSentinel, failures);

  const findAllowed = await operations.find({ filesystem, path: rootPath }, allowedFindPattern);
  const allowedFindItems = findAllowed.matches ?? findAllowed.paths ?? [];
  if (allowedFindItems.length !== expectedAllowedFindCount) {
    failures.push("find visible count does not match expected policy-filtered results");
  }
  assertSerializedDoesNotLeak("find allowed", findAllowed, deniedDirectoryName, deniedSentinel, failures);

  const grep = await operations.grep({ filesystem, path: rootPath }, deniedSentinel);
  if (grep.matches.length > 0) {
    failures.push("grep returned denied sentinel matches");
  }
  assertSerializedDoesNotLeak("grep", grep, deniedDirectoryName, deniedSentinel, failures);

  await expectRejects("write to existing projection file unexpectedly succeeded", failures, () =>
    projection.writeExistingAllowedPath(),
  );
  await expectRejects("write to new projection file unexpectedly succeeded", failures, () =>
    projection.writeNewAllowedPath(),
  );
  await expectRejects("symlink escape unexpectedly succeeded", failures, () => projection.followSymlinkEscape());

  return { passed: failures.length === 0, failures };
}
