// List every Vercel sandbox snapshot on the team; DELETE=1 deletes them all (the Factory rebuilds per-epic snapshots on demand, ~4 min).
import { Snapshot } from '@vercel/sandbox'
const creds = { token: process.env.VERCEL_TOKEN!, teamId: process.env.VERCEL_TEAM_ID!, projectId: process.env.VERCEL_PROJECT_ID! }
const items: any[] = []
let cursor: string | undefined
for (let i = 0; i < 40; i++) {
  const page: any = await Snapshot.list({ ...creds, limit: 50, ...(cursor ? { cursor } : {}) } as any)
  const chunk: any[] = page?.snapshots ?? []
  items.push(...chunk)
  const next = page?.pagination?.next
  if (!next || chunk.length === 0) break
  cursor = String(next)
}
console.log('snapshots:', items.length, 'keys:', Object.keys(items[0] ?? {}).join(','))
for (const s of items) console.log(' ', s.id, s.status, new Date(s.createdAt).toISOString().slice(0, 16), s.sizeBytes ?? s.size ?? '', s.expiration ? new Date(s.expiration).toISOString().slice(0, 10) : '')
if (process.env.DELETE !== '1') { console.log('dry run; set DELETE=1 to delete'); process.exit(0) }
let deleted = 0, failed = 0
for (const s of items) {
  if (s.status === 'deleted') continue
  try { const snap = await Snapshot.get({ ...creds, snapshotId: s.id } as any); await snap.delete(); deleted++; console.log('deleted', s.id) }
  catch (e: any) { failed++; console.log('failed', s.id, String(e?.message ?? e).slice(0, 120)) }
}
console.log(`deleted=${deleted} failed=${failed}`)
