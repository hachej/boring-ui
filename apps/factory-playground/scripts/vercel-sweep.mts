// Stop every running Vercel sandbox on the team (VERCEL_TOKEN/VERCEL_TEAM_ID/VERCEL_PROJECT_ID). Stopped sandboxes are left as records.
import { Sandbox } from '@vercel/sandbox'
const creds = { token: process.env.VERCEL_TOKEN!, teamId: process.env.VERCEL_TEAM_ID!, projectId: process.env.VERCEL_PROJECT_ID! }
const items: any[] = []
let cursor: string | undefined
for (let i = 0; i < 40; i++) {
  const page: any = await Sandbox.list({ ...creds, limit: 50, ...(cursor ? { cursor } : {}) } as any)
  const chunk: any[] = page?.sandboxes ?? page?.data?.sandboxes ?? []
  items.push(...chunk)
  const next = page?.pagination?.next ?? page?.cursor ?? page?.nextCursor ?? page?.data?.pagination?.next
  if (i === 0) console.log('page keys:', Object.keys(page ?? {}).join(','))
  if (!next || chunk.length === 0) break
  cursor = String(next)
}
console.log('total listed:', items.length, 'keys:', Object.keys(items[0] ?? {}).join(','))
const byStatus: Record<string, number> = {}
for (const s of items) byStatus[s.status] = (byStatus[s.status] ?? 0) + 1
console.log('by status:', JSON.stringify(byStatus))
let stopped = 0, failed = 0
for (const s of items) {
  if (!['running', 'pending', 'snapshotting'].includes(s.status)) continue
  const id = s.sandboxId ?? s.id
  try { const sb = await Sandbox.get({ ...creds, sandboxId: id } as any); await sb.stop(); stopped++; console.log('stopped', id, s.name) }
  catch (e: any) { failed++; console.log('failed', id, s.name, String(e?.message ?? e).slice(0, 120)) }
}
console.log(`stopped=${stopped} failed=${failed}`)
