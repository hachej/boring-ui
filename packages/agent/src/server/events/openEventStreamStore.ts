import { join } from 'node:path'
import { SqliteEventStreamStore, type EventStreamStore } from './eventStreamStore'
import { openDatabase, type OpenDatabaseResult } from './sqlStorage'

export interface EventStreamStoreHandle {
  store: EventStreamStore
  close(): void
}

export function openEventStreamStore(rootDir: string): EventStreamStoreHandle {
  const database: OpenDatabaseResult = openDatabase(join(rootDir, 'events.db'))
  return {
    store: new SqliteEventStreamStore(database.sql, database.runTransaction),
    close() {
      database.db.close()
    },
  }
}
