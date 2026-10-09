/** Native types are aliases, never a duplicated/narrowed Boring environment. */
import type { HarnessOptions } from '@earendil-works/pi-durable';
export type {
  FileSystem, Shell, ExecutionEnv, FileInfo, FileError, ExecutionError,
  Result, TextLineReader, ShellExecOptions, ShellExecResult, ShellSpillOptions,
} from '@earendil-works/pi-durable/env';
export type { Context } from '@earendil-works/chord';
export type { EnvTarget } from '@earendil-works/pi-durable';

/** Preserve native target/committed reads/Context, async and undefined results. */
export type EnvironmentFactory = NonNullable<HarnessOptions['env']>;
