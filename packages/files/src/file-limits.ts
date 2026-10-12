// The largest file a SQLite-backed workspace stores by default: a Durable Object's SQL storage caps one row (and so one file's bytes)
// at 2 MB, so the default leaves headroom for the row's other columns. Disk and remote providers have no default limit.
import { FileError } from '@earendil-works/pi-durable/env';

export const SQLITE_MAX_FILE_BYTES = 1_900_000;

/**
 * A write above the limit. Pi's `FileErrorCode` has no size code and Pi is not patched, so this is an `invalid` error whose message
 * starts with the POSIX `EFBIG` name, like the other errors of the file system.
 */
/** A limit is a non-negative safe integer of bytes. */
export function assertLimit(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new TypeError('maxFileBytes must be a non-negative safe integer');
}

export function fileTooLarge(path: string, size: number, limit: number): FileError {
  return new FileError('invalid', `EFBIG: file_too_large: ${size} bytes exceeds the ${limit} byte limit, '${path}'`, path);
}
