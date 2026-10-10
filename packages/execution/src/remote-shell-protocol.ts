import { ExecutionError, ok, err } from '@earendil-works/pi-durable/env';
import type { Shell, ShellExecOptions, ShellOutputSkip, ExecutionErrorCode } from '@earendil-works/pi-durable/env';
import type { WorkspaceIdentity } from './contracts.js';

export const schema = 'boring.remote-shell';
export const version = 2;
export const nativeVersion = 'pi-durable@1.1.0';
export const contentType = 'application/x-ndjson';
export type WireOptions = Omit<ShellExecOptions, 'onOutput'>;
export type ShellResult = Awaited<ReturnType<Shell['exec']>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error('Expected an object');
  return value;
}
function keys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Unexpected protocol field');
}
function string(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Expected a string');
  return value;
}
export function identity(value: unknown): WorkspaceIdentity {
  const data = record(value);
  keys(data, ['providerId', 'instanceId', 'incarnation', 'viewId']);
  const result = { providerId: string(data['providerId']), instanceId: string(data['instanceId']), incarnation: string(data['incarnation']), viewId: string(data['viewId']) };
  if (Object.values(result).some(value => !value || /[\x00-\x1f]/.test(value))) throw new Error('Invalid workspace identity');
  return Object.freeze(result);
}
export function sameIdentity(left: WorkspaceIdentity, right: WorkspaceIdentity): boolean {
  return left.providerId === right.providerId && left.instanceId === right.instanceId && left.incarnation === right.incarnation && left.viewId === right.viewId;
}
export function wireOptions(value: unknown): WireOptions {
  const data = record(value);
  keys(data, ['cwd', 'env', 'inheritEnv', 'timeout', 'spill', 'window']);
  const result: WireOptions = {};
  if (data['cwd'] !== undefined) result.cwd = string(data['cwd']);
  if (data['env'] !== undefined) {
    const entries: [string, string][] = [];
    for (const [key, value] of Object.entries(record(data['env']))) entries.push([key, string(value)]);
    result.env = Object.fromEntries(entries);
  }
  if (data['inheritEnv'] !== undefined) {
    if (typeof data['inheritEnv'] !== 'boolean') throw new Error('Invalid inheritEnv');
    result.inheritEnv = data['inheritEnv'];
  }
  if (data['timeout'] !== undefined) {
    if (typeof data['timeout'] !== 'number' || (!Number.isFinite(data['timeout']) || data['timeout'] <= 0)) throw new Error('Invalid timeout');
    result.timeout = data['timeout'];
  }
  if (data['spill'] !== undefined) {
    const spill = record(data['spill']); keys(spill, ['afterBytes', 'afterLines']);
    const afterBytes = spill['afterBytes'], afterLines = spill['afterLines'];
    if (typeof afterBytes !== 'number' || !Number.isSafeInteger(afterBytes) || afterBytes < 0
      || typeof afterLines !== 'number' || !Number.isSafeInteger(afterLines) || afterLines < 0) throw new Error('Invalid spill thresholds');
    result.spill = { afterBytes, afterLines };
  }
  if (data['window'] !== undefined) {
    const window = record(data['window']); keys(window, ['maxBytes', 'maxLines', 'minIntervalMs', 'bytesPerSecond']);
    const limits: Record<string, number> = {};
    for (const key of ['maxBytes', 'maxLines', 'minIntervalMs', 'bytesPerSecond']) {
      const limit = window[key];
      if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 0) throw new Error('Invalid output window');
      limits[key] = limit;
    }
    result.window = { maxBytes: limits['maxBytes']!, maxLines: limits['maxLines']!, minIntervalMs: limits['minIntervalMs']!, bytesPerSecond: limits['bytesPerSecond']! };
  }
  return result;
}
/** Output the native environment omitted before a chunk (Pi `ShellOutputSkip`), validated off the wire. */
export function skipped(value: unknown): ShellOutputSkip {
  const data = record(value); keys(data, ['bytes', 'newlines', 'endsWithNewline']);
  const bytes = data['bytes'], newlines = data['newlines'], endsWithNewline = data['endsWithNewline'];
  if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 0 || typeof newlines !== 'number' || !Number.isSafeInteger(newlines) || newlines < 0 || typeof endsWithNewline !== 'boolean') throw new Error('Invalid skipped output');
  return { bytes, newlines, endsWithNewline };
}
export function requestInput(value: unknown) {
  const data = record(value);
  keys(data, ['schema', 'version', 'nativeVersion', 'requestId', 'identity', 'command', 'options', 'output']);
  if (data['schema'] !== schema || data['version'] !== version || data['nativeVersion'] !== nativeVersion) throw new Error('Unsupported remote shell protocol');
  const requestId = string(data['requestId']);
  if (!requestId || requestId.length > 128) throw new Error('Invalid request identity');
  if (typeof data['output'] !== 'boolean') throw new Error('Invalid output selection');
  return { requestId, identity: identity(data['identity']), command: string(data['command']), options: wireOptions(data['options']), output: data['output'] };
}
function errorCode(value: unknown): ExecutionErrorCode {
  switch (value) {
    case 'aborted': case 'timeout': case 'shell_unavailable': case 'spawn_error': case 'callback_error': case 'unknown': return value;
    default: throw new Error('Invalid native execution error');
  }
}
function result(value: unknown): ShellResult {
  const data = record(value);
  if (data['ok'] === true) {
    keys(data, ['ok', 'value']);
    const value = record(data['value']); keys(value, ['exitCode', 'spillPath']);
    const exitCode = value['exitCode'];
    if (typeof exitCode !== 'number' || !Number.isSafeInteger(exitCode)) throw new Error('Invalid exit code');
    return ok({ exitCode, ...(value['spillPath'] === undefined ? {} : { spillPath: string(value['spillPath']) }) });
  }
  if (data['ok'] === false) {
    keys(data, ['ok', 'error']);
    const value = record(data['error']); keys(value, ['code', 'message', 'spillPath']);
    const error = new ExecutionError(errorCode(value['code']), string(value['message']));
    if (value['spillPath'] !== undefined) error.spillPath = string(value['spillPath']);
    return err(error);
  }
  throw new Error('Invalid native execution result');
}
export function wireResult(value: ShellResult) {
  if (value.ok) return value;
  return { ok: false, error: { code: value.error.code, message: value.error.message, ...(value.error.spillPath === undefined ? {} : { spillPath: value.error.spillPath }) } };
}
export function frame(value: unknown, requestId: string, sequence: number) {
  const data = record(value);
  if (data['requestId'] !== requestId || data['sequence'] !== sequence) throw new Error('Remote shell frame binding mismatch');
  switch (data['type']) {
    case 'header':
      keys(data, ['type', 'requestId', 'sequence', 'schema', 'version', 'nativeVersion', 'identity']);
      if (data['schema'] !== schema || data['version'] !== version || data['nativeVersion'] !== nativeVersion) throw new Error('Unsupported remote shell protocol');
      return { type: 'header', identity: identity(data['identity']) } as const;
    case 'output':
      keys(data, ['type', 'requestId', 'sequence', 'text', 'stream', 'skipped']);
      if (data['stream'] !== 'stdout' && data['stream'] !== 'stderr') throw new Error('Invalid remote shell output stream');
      return { type: 'output', text: string(data['text']), stream: data['stream'], ...(data['skipped'] === undefined ? {} : { skipped: skipped(data['skipped']) }) } as const;
    case 'result':
      keys(data, ['type', 'requestId', 'sequence', 'result']);
      return { type: 'result', result: result(data['result']) } as const;
    default: throw new Error('Unknown remote shell frame');
  }
}
export function positiveLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError('Remote shell limits must be positive safe integers');
  return value;
}
