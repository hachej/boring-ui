// Candidate (a): boring-files' SQLite file system over pi's own queued adapter. `openSqliteFileSystem` takes a `SqliteConnection`
// (synchronous), `DurableObjectSqliteDatabase` is asynchronous. Written with public seams only and no change to `SqliteConnection`,
// this is the whole of what (a) would need to be; `tsc --noEmit` says whether it type checks.
import { DurableObjectSqliteDatabase, type DurableObjectSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/cloudflare';
import type { SqliteConnection } from '@hachej/boring-files/sqlite';

export const connectionOver = (storage: DurableObjectSqliteStorage): SqliteConnection => new DurableObjectSqliteDatabase(storage);
