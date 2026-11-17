#!/usr/bin/env node
// Runs the app's app.ts with the caller's environment and file rights: run it on an app's own reviewed folder.
import { join } from 'node:path';
import { hostBuild } from './host-build.js';

const FLAGS = ['shell', 'page', 'options', 'stack'] as const;
const usage = 'usage: boring-host-build <app dir> --options <module> [--shell <module>] [--page <html file>] [--stack <module>] (the options module ends with `satisfies HostOptions`)';

try {
  const args = process.argv.slice(2), flags: Record<string, string> = {}, dirs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const name = args[i]!.startsWith('--') ? args[i]!.slice(2) : undefined;
    if (name === undefined) dirs.push(args[i]!);
    else if (!(FLAGS as readonly string[]).includes(name) || args[i + 1] === undefined) throw new Error(`${args[i]}: ${usage}`);
    else flags[name] = args[++i]!;
  }
  if (dirs.length !== 1) throw new Error(usage);
  await hostBuild(dirs[0]!, { ...flags, options: flags.options! });
  console.log(`boring-host-build: wrote ${join(dirs[0]!, '.gen')}: server.ts, assets.ts, page.tsx${flags.stack ? ', alchemy.run.ts' : ''}`);
} catch (error) {
  console.error(`boring-host-build: ${String(error instanceof Error ? error.message : error).split('\n')[0]}`);
  process.exitCode = 1;
}
