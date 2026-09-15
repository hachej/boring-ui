import http from 'node:http'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const listenPort = Number(process.env.ONE_CHAT_APP_PROXY_PORT ?? 5321)
const appsRoot = path.resolve(process.env.ONE_CHAT_APPS_ROOT ?? '/data/one-chat/apps')
const registryPath = path.join(appsRoot, 'apps.json')
const basePattern = process.env.ONE_CHAT_APP_BASE ?? '/app/{slug}/'
const basePrefix = basePattern.slice(0, basePattern.indexOf('{slug}'))

if (!Number.isInteger(listenPort) || listenPort < 1) {
  throw new Error('ONE_CHAT_APP_PROXY_PORT must be a valid port')
}
if (!basePattern.startsWith('/') || !basePattern.endsWith('/') || !basePattern.includes('{slug}')) {
  throw new Error('ONE_CHAT_APP_BASE must start and end with / and include {slug}')
}

function registryApps() {
  try {
    const parsed = JSON.parse(readFileSync(registryPath, 'utf8'))
    return Array.isArray(parsed.apps) ? parsed.apps : []
  } catch {
    return []
  }
}

function resolveUpstream(rawUrl = '/') {
  const url = new URL(rawUrl, 'http://one-chat.local')
  let incoming = url.pathname
  // Production Caddy strips /app before forwarding. Accept the unstripped
  // shape too so this bridge is directly testable.
  if (basePrefix !== '/' && incoming.startsWith(basePrefix)) incoming = `/${incoming.slice(basePrefix.length)}`
  const [slugFromPath, ...rest] = incoming.split('/').filter(Boolean)
  const apps = registryApps()
  const app = apps.find((candidate) => candidate.slug === slugFromPath)
    ?? (!slugFromPath ? apps.find((candidate) => candidate.slug === 'default') ?? apps[0] : undefined)
  if (!app || !Number.isInteger(app.port)) return undefined
  const slug = encodeURIComponent(app.slug)
  const appBase = basePattern.replaceAll('{slug}', slug).replaceAll('{port}', String(app.port))
  const suffix = app.slug === slugFromPath ? rest.join('/') : ''
  url.pathname = `${appBase}${suffix}`
  return {
    app,
    path: `${url.pathname}${url.search}`,
  }
}

function upstreamOptions(req, upstream) {
  return {
    hostname: '127.0.0.1',
    port: upstream.app.port,
    method: req.method,
    path: upstream.path,
    headers: {
      ...req.headers,
      host: `127.0.0.1:${upstream.app.port}`,
      'x-forwarded-host': req.headers.host ?? '',
    },
  }
}

const server = http.createServer((req, res) => {
  const upstream = resolveUpstream(req.url)
  if (!upstream) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('Unknown app\n')
    return
  }
  const proxyRequest = http.request(upstreamOptions(req, upstream), (proxyResponse) => {
    res.writeHead(proxyResponse.statusCode ?? 502, proxyResponse.headers)
    proxyResponse.pipe(res)
  })
  proxyRequest.on('error', (error) => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(`Editable app unavailable: ${error.message}\n`)
  })
  req.pipe(proxyRequest)
})

server.on('upgrade', (req, socket, head) => {
  const upstream = resolveUpstream(req.url)
  if (!upstream) {
    socket.destroy()
    return
  }
  const proxyRequest = http.request(upstreamOptions(req, upstream))
  proxyRequest.on('upgrade', (proxyResponse, proxySocket, proxyHead) => {
    const status = `HTTP/1.1 ${proxyResponse.statusCode ?? 101} ${proxyResponse.statusMessage ?? 'Switching Protocols'}`
    const headers = []
    for (let index = 0; index < proxyResponse.rawHeaders.length; index += 2) {
      headers.push(`${proxyResponse.rawHeaders[index]}: ${proxyResponse.rawHeaders[index + 1]}`)
    }
    socket.write(`${status}\r\n${headers.join('\r\n')}\r\n\r\n`)
    if (proxyHead.length) socket.write(proxyHead)
    if (head.length) proxySocket.write(head)
    proxySocket.pipe(socket)
    socket.pipe(proxySocket)
  })
  proxyRequest.on('response', () => socket.destroy())
  proxyRequest.on('error', () => socket.destroy())
  proxyRequest.end()
})

await new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(listenPort, '0.0.0.0', resolve)
})
console.log(`[one-chat] app path bridge http://0.0.0.0:${listenPort}${basePrefix}* -> ports in ${registryPath}`)

const [command, ...args] = process.argv.slice(2)
if (!command) throw new Error('No One Chat command was provided')

const app = spawn(command, args, { env: process.env, stdio: 'inherit' })
let stopping = false
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    stopping = true
    app.kill(signal)
  })
}

app.once('error', (error) => {
  console.error(`[one-chat] failed to start ${command}: ${error.message}`)
  server.close(() => process.exit(1))
})
app.once('exit', (code, signal) => {
  if (!stopping && signal) console.error(`[one-chat] ${command} exited on ${signal}`)
  server.close(() => process.exit(code ?? (signal ? 1 : 0)))
})
