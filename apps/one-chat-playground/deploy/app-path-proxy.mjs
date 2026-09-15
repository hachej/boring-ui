import http from 'node:http'
import { spawn } from 'node:child_process'

const listenPort = Number(process.env.ONE_CHAT_APP_PROXY_PORT ?? 5321)
const upstreamPort = Number(process.env.SAMPLE_APP_PORT ?? 5322)
const basePath = process.env.ONE_CHAT_APP_BASE ?? '/app/'
const baseWithoutSlash = basePath.slice(0, -1)

if (!Number.isInteger(listenPort) || listenPort < 1) {
  throw new Error('ONE_CHAT_APP_PROXY_PORT must be a valid port')
}
if (!Number.isInteger(upstreamPort) || upstreamPort < 1 || upstreamPort === listenPort) {
  throw new Error('SAMPLE_APP_PORT must be a valid port distinct from ONE_CHAT_APP_PROXY_PORT')
}
if (!basePath.startsWith('/') || !basePath.endsWith('/')) {
  throw new Error('ONE_CHAT_APP_BASE must start and end with /')
}

function toUpstreamPath(rawUrl = '/') {
  const url = new URL(rawUrl, 'http://one-chat.local')
  if (url.pathname !== baseWithoutSlash && !url.pathname.startsWith(basePath)) {
    url.pathname = `${baseWithoutSlash}${url.pathname}`
  }
  return `${url.pathname}${url.search}`
}

function upstreamOptions(req) {
  return {
    hostname: '127.0.0.1',
    port: upstreamPort,
    method: req.method,
    path: toUpstreamPath(req.url),
    headers: {
      ...req.headers,
      host: `127.0.0.1:${upstreamPort}`,
      'x-forwarded-host': req.headers.host ?? '',
    },
  }
}

const server = http.createServer((req, res) => {
  const proxyRequest = http.request(upstreamOptions(req), (proxyResponse) => {
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
  const proxyRequest = http.request(upstreamOptions(req))
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
console.log(`[one-chat] app path bridge http://0.0.0.0:${listenPort}${basePath} -> http://127.0.0.1:${upstreamPort}${basePath}`)

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
