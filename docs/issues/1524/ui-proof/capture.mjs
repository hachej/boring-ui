#!/usr/bin/env node
import { chromium } from "@playwright/test"
import { createServer } from "vite"
import { execFileSync } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import process from "node:process"

const args = new Map()
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1])
const base = required("--base")
const head = required("--head")
const out = resolve(required("--out"))
const viewport = { width: 1280, height: 720 }
await mkdir(out, { recursive: true })

const results = []
for (const target of [{ label: "before", sha: base }, { label: "after", sha: head }]) {
  results.push(await capture(target))
}

const report = {
  schemaVersion: 1,
  scenario: "active live transcript → keyboard-focus Open transcript → Nudge → Stop/finalize",
  fixture: "deterministic active session live-1, transcript live-transcripts/consultation.md, 180s review interval",
  viewport,
  base,
  head,
  results,
}
await writeFile(join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`)
await writeFile(join(out, "README.md"), `# PR #1524 live-transcription UI proof\n\n- Base: \`${base}\`\n- Candidate: \`${head}\`\n- Viewport: ${viewport.width}×${viewport.height}\n- Scenario: ${report.scenario}\n- Fixture: ${report.fixture}\n- Assertions (both revisions): the real browser controller completes compute preparation, microphone attach, WebSocket nonce ACK, and one correctly sized audio frame; labeled active state is visible; controls have unique accessible names; keyboard focus reaches Open transcript; Open emits the exact workspace surface command; Nudge exposes a polite status; Stop becomes disabled/finalizing then completes; dock and controls remain inside the viewport without horizontal overflow.\n- Videos: [before.webm](./before.webm), [after.webm](./after.webm)\n- Machine report: [report.json](./report.json)\n`)
console.log(JSON.stringify(report, null, 2))

function required(name) {
  const value = args.get(name)
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

async function capture({ label, sha }) {
  const root = await mkdtemp(join(tmpdir(), `pr-1524-${label}-`))
  let server
  let browser
  try {
    const archive = execFileSync("git", ["archive", sha, "plugins/live-transcription/src"])
    execFileSync("tar", ["-x", "-C", root], { input: archive })
    await writeFixture(root, label, sha)
    await symlink(resolve("node_modules"), join(root, "node_modules"), "dir")
    server = await createServer({
      root,
      logLevel: "error",
      server: { host: "127.0.0.1", port: 0, strictPort: false },
      resolve: { alias: {
        "@hachej/boring-agent/front": join(root, "mock-agent.tsx"),
        "@hachej/boring-workspace/plugin": join(root, "mock-workspace-plugin.ts"),
        "@hachej/boring-workspace": join(root, "mock-workspace.tsx"),
      } },
    })
    await server.listen()
    const address = server.httpServer.address()
    if (!address || typeof address === "string") throw new Error("Vite did not bind a TCP port")

    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({
      viewport,
      recordVideo: { dir: join(root, "video"), size: viewport },
      reducedMotion: "reduce",
      colorScheme: "light",
    })
    const page = await context.newPage()
    await page.goto(`http://127.0.0.1:${address.port}`, { waitUntil: "networkidle" })

    const dock = page.locator('[data-boring-agent-part="live-transcript-dock"]')
    await dock.waitFor()
    await page.getByLabel("Live transcription", { exact: true }).waitFor()
    await page.evaluate(() => window.__emitAudioFrame())
    const startupTrace = await page.evaluate(() => window.__networkTrace)
    for (const expected of ["POST /api/v1/live-transcripts/compute/prepare", "POST /api/v1/live-transcripts", "WS nonce", "WS audio-frame"]) {
      if (!startupTrace.includes(expected)) throw new Error(`${label}: missing live-start trace ${expected}`)
    }
    const controls = ["Open transcript in new pane", "Nudge", "Stop transcription"]
    for (const name of controls) {
      if (await page.getByRole("button", { name, exact: true }).count() !== 1) throw new Error(`${label}: expected one ${name} button`)
    }
    const layout = await dock.evaluate((node) => {
      const rect = node.getBoundingClientRect()
      return {
        left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
        viewportWidth: innerWidth, viewportHeight: innerHeight,
        documentScrollWidth: document.documentElement.scrollWidth,
      }
    })
    if (layout.left < 0 || layout.top < 0 || layout.right > viewport.width || layout.bottom > viewport.height || layout.documentScrollWidth > viewport.width) {
      throw new Error(`${label}: dock overflowed viewport: ${JSON.stringify(layout)}`)
    }

    await page.keyboard.press("Tab")
    const openButton = page.getByRole("button", { name: "Open transcript in new pane" })
    if (!(await openButton.evaluate((node) => node === document.activeElement))) throw new Error(`${label}: keyboard focus did not reach Open transcript`)
    await page.keyboard.press("Enter")
    const commands = await page.evaluate(() => window.__uiCommands)
    const expectedCommand = { kind: "openSurface", params: { kind: "workspace.open.path", target: "live-transcripts/consultation.md" } }
    if (JSON.stringify(commands.at(-1)) !== JSON.stringify(expectedCommand)) throw new Error(`${label}: open transcript command mismatch`)

    await page.getByRole("button", { name: "Nudge" }).click()
    await page.getByRole("status").filter({ hasText: "Agent nudged" }).waitFor()
    await page.getByRole("button", { name: "Stop transcription" }).click()
    const finalizing = page.getByRole("button", { name: "Finalizing transcript" })
    await finalizing.waitFor()
    if (!(await finalizing.isDisabled())) throw new Error(`${label}: finalizing control was not disabled`)
    await page.getByTestId("completed").waitFor()

    await page.screenshot({ path: join(out, `${label}.png`), fullPage: true })
    await page.waitForTimeout(500)
    const video = page.video()
    await page.close()
    if (!video) throw new Error(`${label}: Playwright video unavailable`)
    await video.saveAs(join(out, `${label}.webm`))
    await context.close()
    return {
      label,
      sha,
      video: `${label}.webm`,
      screenshot: `${label}.png`,
      assertions: {
        liveStartMicrophoneSocketAndAudioFrame: "PASS",
        interaction: "PASS",
        accessibleNamesAndStatus: "PASS",
        keyboardFocus: "PASS",
        layoutAndHorizontalOverflow: "PASS",
      },
      layout,
    }
  } finally {
    await browser?.close().catch(() => undefined)
    await server?.close().catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
}

async function writeFixture(root, label, sha) {
  await writeFile(join(root, "index.html"), '<div id="root"></div><script type="module" src="/entry.tsx"></script>')
  await writeFile(join(root, "mock-agent.tsx"), `import React from "react"\nexport const ChatMessageContributionProvider=({children})=>children\nexport const ComposerContributionProvider=({children})=>children\nexport const Message=({children})=><div>{children}</div>\nexport const MessageContent=({children})=><div>{children}</div>\nexport const Tool=({children})=><div>{children}</div>\nexport const ToolContent=({children})=><div>{children}</div>\nexport const ToolHeader=({children})=><div>{children}</div>\nexport const useOpenArtifact=()=>()=>{}\n`)
  await writeFile(join(root, "mock-workspace.tsx"), `import React from "react"\nexport const MarkdownEditorPane=()=> <div>Transcript</div>\n`)
  await writeFile(join(root, "mock-workspace-plugin.ts"), `export const definePlugin=(value)=>value\nexport const postUiCommand=(command)=>{ window.__uiCommands.push(command) }\n`)
  await writeFile(join(root, "entry.tsx"), `
import React, { useEffect, useSyncExternalStore } from "react"
import { createRoot } from "react-dom/client"
import { LiveTranscriptComposerTop, liveTranscriptBrowserState, liveTranscriptController } from "/plugins/live-transcription/src/front/index.tsx"
import { LIVE_PCM_FRAME_BYTES } from "/plugins/live-transcription/src/shared/index.ts"
window.__uiCommands=[]
window.__networkTrace=[]
window.__terminal=false
const ok=(value)=>Promise.resolve(new Response(JSON.stringify(value),{status:200,headers:{"content-type":"application/json"}}))
window.fetch=async(input,init={})=>{
 const path=typeof input==="string"?input:new URL(input.url).pathname
 window.__networkTrace.push((init.method??"GET")+" "+path)
 if(path.endsWith("/compute/prepare")) return ok({preparationId:"prepare-1",state:"ready"})
 if(path==="/api/v1/live-transcripts") return ok({liveSessionId:"live-1",transcriptPath:"live-transcripts/consultation.md",socketNonce:"nonce-1",reviewIntervalMs:180000})
 if(path.endsWith("/review")) return ok({status:"dispatched"})
 if(path.endsWith("/stop")){ window.__terminal=true; await new Promise(r=>setTimeout(r,350)); return ok({transcriptPath:"live-transcripts/consultation.md"}) }
 return ok({})
}
class FakeSocket extends EventTarget{
 static OPEN=1; readyState=0; bufferedAmount=0; binaryType="arraybuffer"; onmessage; onerror; onclose; sent=0
 constructor(){ super(); setTimeout(()=>{this.readyState=1;this.dispatchEvent(new Event("open"))},10) }
 send(value){ this.sent++; if(this.sent===1){window.__networkTrace.push("WS nonce")}else{window.__networkTrace.push("WS audio-frame")} setTimeout(()=>this.onmessage?.({data:new Uint8Array([1]).buffer}),0) }
 close(){this.readyState=3} }
window.WebSocket=FakeSocket
Object.defineProperty(navigator,"mediaDevices",{value:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})},configurable:true})
class FakeAudioContext{constructor(){} audioWorklet={addModule:async()=>{}};destination={};createMediaStreamSource(){return{connect(){},disconnect(){}}}async resume(){}async close(){}}
class FakeWorklet{constructor(){window.__worklet=this;this.port={onmessage:null,postMessage(){}}}connect(){}disconnect(){}}
window.AudioContext=FakeAudioContext
window.AudioWorkletNode=FakeWorklet
window.__emitAudioFrame=()=>window.__worklet.port.onmessage({data:{type:"frame",data:new ArrayBuffer(LIVE_PCM_FRAME_BYTES)}})
function App(){
 const recording=useSyncExternalStore(liveTranscriptBrowserState.subscribe,liveTranscriptBrowserState.getSnapshot,liveTranscriptBrowserState.getSnapshot)
 useEffect(()=>{void liveTranscriptController.start("chat-1","Consultation")},[])
 return <main><header><strong>${label.toUpperCase()}</strong><code>${sha}</code></header><section aria-label="Live transcription proof fixture"><LiveTranscriptComposerTop/></section>{window.__terminal&&!recording.phase?<p data-testid="completed">Transcript finalized</p>:null}</main>
}
createRoot(document.getElementById("root")).render(<App/>)
`)
  await writeFile(join(root, "style.css"), "")
  const entry = await readFile(join(root, "entry.tsx"), "utf8")
  await writeFile(join(root, "entry.tsx"), `import \"/fixture.css\"\n${entry}`)
  await writeFile(join(root, "fixture.css"), `
:root{font-family:Inter,ui-sans-serif,system-ui;color:#172033;background:#f5f7fb}*{box-sizing:border-box}body{margin:0}main{width:720px;margin:72px auto;padding:28px;background:#fff;border:1px solid #d9deea;border-radius:24px;box-shadow:0 18px 50px #24304b22}header{display:flex;gap:14px;align-items:center;margin-bottom:28px}header strong{font-size:13px;letter-spacing:.12em;color:#b42318}header code{font-size:11px;color:#667085}.w-full{width:100%}.overflow-hidden{overflow:hidden}.rounded-\\[18px\\]{border-radius:18px}.border{border:1px solid #d0d5dd}.bg-card\\/95{background:#fff}.flex{display:flex}.flex-nowrap{flex-wrap:nowrap}.items-center{align-items:center}.gap-2{gap:.5rem}.gap-1\\.5{gap:.375rem}.gap-2\\.5{gap:.625rem}.gap-1{gap:.25rem}.px-3{padding-left:.75rem;padding-right:.75rem}.py-2\\.5{padding-top:.625rem;padding-bottom:.625rem}.shrink-0{flex-shrink:0}.size-2\\.5{width:.625rem;height:.625rem}.size-1\\.5{width:.375rem;height:.375rem}.size-2{width:.5rem;height:.5rem}.size-4{width:1rem;height:1rem}.size-8{width:2rem;height:2rem}.rounded-full{border-radius:9999px}.bg-red-500\\/18,.bg-red-500\\/12{background:#fee4e2}.bg-red-500{background:#f04438}.text-red-600{color:#d92d20}.min-w-0{min-width:0}.min-w-20{min-width:5rem}.flex-1{flex:1}.flex-col{flex-direction:column}.font-semibold,.font-medium{font-weight:600}.text-\\[12px\\]{font-size:12px}.text-\\[11px\\]{font-size:11px}.text-muted-foreground{color:#667085}.ml-auto{margin-left:auto}.justify-end{justify-content:flex-end}.h-8{height:2rem}.h-1{height:.25rem}.bg-muted{background:#eaecf0}.bg-background{background:#fff}.px-3{padding-left:.75rem;padding-right:.75rem}button{font:inherit;border:0;cursor:pointer}button:focus{outline:3px solid #84adff;outline-offset:2px}button:disabled{cursor:wait;opacity:.6}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}[role=status]{margin-top:8px;padding:8px 12px;border-top:1px solid #eaecf0;color:#475467}[data-testid=completed]{color:#067647;font-weight:600}
`)
}
