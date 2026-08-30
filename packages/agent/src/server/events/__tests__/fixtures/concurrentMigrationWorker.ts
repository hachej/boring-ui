import { parentPort, workerData } from 'node:worker_threads'
import { tsImport } from 'tsx/esm/api'

const { SqliteEventStreamStore } = await tsImport('../../eventStreamStore.ts', import.meta.url) as typeof import('../../eventStreamStore')
const { openDatabase } = await tsImport('../../sqlStorage.ts', import.meta.url) as typeof import('../../sqlStorage')

const { dbPath, sharedBuf } = workerData as {
  dbPath: string
  sharedBuf: SharedArrayBuffer
}
const sync = new Int32Array(sharedBuf)
Atomics.add(sync, 0, 1)
Atomics.notify(sync, 0)
Atomics.wait(sync, 1, 0)
const opened = openDatabase(dbPath)

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
