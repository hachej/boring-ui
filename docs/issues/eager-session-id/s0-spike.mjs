import { SessionManager } from '/home/ubuntu/projects/boring-ui-v2/.worktrees/fix-775-regressions/node_modules/@mariozechner/pi-coding-agent/dist/core/session-manager.js'
import { mkdtempSync, existsSync, readdirSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const dir = mkdtempSync(join(tmpdir(), 's0-'))
const CTX = { workspaceId: 'ws-1', userId: 'u-1' }
const ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
let fail = 0
const check = (name, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) fail++ }

// 1. create with our id, inject the pin before any flush
const mgr = SessionManager.create(process.cwd(), dir, { id: ID })
check('id honoured', mgr.getSessionId() === ID)
const header = mgr.getHeader()
header.boringSessionCtx = CTX
check('no file yet (lazy)', readdirSync(dir).length === 0)

// 2. user message alone must still not flush
mgr.appendMessage({ role: 'user', content: 'hello' })
check('user message does not flush', readdirSync(dir).length === 0)

// 3. assistant reply flushes
mgr.appendMessage({ role: 'assistant', content: 'hi there' })
const files = readdirSync(dir)
check('flushed after assistant', files.length === 1)
const path = join(dir, files[0])
const lines = readFileSync(path, 'utf-8').trim().split('\n').map(l => JSON.parse(l))
check('pin survived the flush', JSON.stringify(lines[0].boringSessionCtx) === JSON.stringify(CTX))
check('header id is ours', lines[0].id === ID)
check('filename contains our id', files[0].includes(ID))

// 4. reopen: does pi preserve the pin?
const re = SessionManager.open(path)
check('reopen id', re.getSessionId() === ID)
check('reopen pin intact', JSON.stringify(re.getHeader().boringSessionCtx) === JSON.stringify(CTX))
re.appendMessage({ role: 'user', content: 'again' })
re.appendMessage({ role: 'assistant', content: 'ok' })
const after = readFileSync(path, 'utf-8').trim().split('\n').map(l => JSON.parse(l))
check('pin survives append-after-reopen', JSON.stringify(after[0].boringSessionCtx) === JSON.stringify(CTX))

// 5. listAll sees it
const all = await SessionManager.listAll(dir)
check('listAll finds it', all.length === 1 && all[0].id === ID)
console.log(fail ? `\n${fail} FAILURE(S)` : '\nS0 MECHANISM (a) VIABLE')
process.exit(fail ? 1 : 0)
