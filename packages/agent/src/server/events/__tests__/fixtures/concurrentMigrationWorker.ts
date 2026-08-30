import { parentPort, workerData } from 'node:worker_threads'
import { tsImport } from 'tsx/esm/api'

const { SqliteEventStreamStore } = await tsImport('../../eventStreamStore.ts', import.meta.url) as typeof import('../../eventStreamStore')
const { openDatabase } = await tsImport('../../sqlStorage.ts', import.meta.url) as typeof import('../../sqlStorage')

const { dbPath, sharedBuf } = workerData as {
  dbPath: string
  sharedBuf: SharedArrayBuffer
}
const sync = new Int32Array(sharedBuf)
const opened = openDatabase(dbPath)
opened.db.exec('PRAGMA busy_timeout=5000')
Atomics.wait(sync, 0, 0)

let migrationTelemetryEvents = 0
new SqliteEventStreamStore(opened.sql, opened.runTransaction, {
  telemetry: {
    capture(event) {
      if (event.name === 'agent.event-stream.migration-v2-collision-class') {
        migrationTelemetryEvents += 1
      }
    },
  },
})

const schemaVersion = String(opened.sql.exec(
  `SELECT value FROM boring_event_stream_meta WHERE key = 'schema_version'`,
).toArray()[0]?.value)
const paths = opened.sql.exec('SELECT path FROM boring_event_streams ORDER BY path').toArray()
  .map((row) => String(row.path))
opened.db.close()
parentPort?.postMessage({ schemaVersion, paths, migrationTelemetryEvents })
