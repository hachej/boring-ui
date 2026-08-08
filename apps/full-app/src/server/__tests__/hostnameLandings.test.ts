import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'

import {
  HOSTNAME_LANDING_ENV,
  createHostnameLandingRootHandler,
  parseHostnameLandings,
  type HostnameLandingMap,
} from '../hostnameLandings.js'

const SPA_SHELL = '<!doctype html><p>spa shell</p>'

const twoAgentDemo: HostnameLandingMap = parseHostnameLandings(JSON.stringify({
  'insurance.example.test': { title: 'Insurance Agent', summary: 'Compare policies.', ctaLabel: 'Start' },
  'travel.example.test': { title: 'Travel Agent', summary: 'Plan trips.' },
}))

let app: FastifyInstance | undefined
afterEach(async () => {
  await app?.close()
  app = undefined
})

async function build(landings: HostnameLandingMap = twoAgentDemo): Promise<FastifyInstance> {
  const instance = Fastify()
  instance.decorateRequest('user')
  instance.addHook('onRequest', async (request) => {
    ;(request as { user?: unknown }).user = request.headers.authorization
      ? { id: 'user', email: 'user@example.test' }
      : null
  })
  const root = createHostnameLandingRootHandler(landings)
  instance.get('/', async (request, reply) => {
    if (await root(request, reply)) return reply
    return reply.type('text/html; charset=utf-8').send(SPA_SHELL)
  })
  await instance.ready()
  return instance
}

describe('parseHostnameLandings', () => {
  it('returns an empty map for missing or blank config', () => {
    expect(parseHostnameLandings(undefined).size).toBe(0)
    expect(parseHostnameLandings('  ').size).toBe(0)
  })

  it('accepts multiple exact hostnames served from one process', () => {
    expect([...twoAgentDemo.keys()].sort()).toEqual(['insurance.example.test', 'travel.example.test'])
  })

  it.each([
    ['invalid JSON', 'not json'],
    ['non-object root', '["x"]'],
    ['wildcard hostname', JSON.stringify({ '*.example.test': { title: 'T', summary: 'S' } })],
    ['hostname with port', JSON.stringify({ 'a.example.test:443': { title: 'T', summary: 'S' } })],
    ['uppercase hostname', JSON.stringify({ 'A.example.test': { title: 'T', summary: 'S' } })],
    ['title over 120', JSON.stringify({ 'a.example.test': { title: 'T'.repeat(121), summary: 'S' } })],
    ['summary over 500', JSON.stringify({ 'a.example.test': { title: 'T', summary: 'S'.repeat(501) } })],
    ['cta over 80', JSON.stringify({ 'a.example.test': { title: 'T', summary: 'S', ctaLabel: 'C'.repeat(81) } })],
    ['empty title', JSON.stringify({ 'a.example.test': { title: '', summary: 'S' } })],
    ['control character', JSON.stringify({ 'a.example.test': { title: 'Bad\nTitle', summary: 'S' } })],
    ['unknown key', JSON.stringify({ 'a.example.test': { title: 'T', summary: 'S', workspaceId: 'w' } })],
  ])('fails fast on %s', (_name, raw) => {
    expect(() => parseHostnameLandings(raw)).toThrow(HOSTNAME_LANDING_ENV)
  })

  it('accepts the exact text bounds', () => {
    const map = parseHostnameLandings(JSON.stringify({
      'a.example.test': { title: 'T'.repeat(120), summary: 'S'.repeat(500), ctaLabel: 'C'.repeat(80) },
    }))
    expect(map.size).toBe(1)
  })
})

describe('hostname landing root handler', () => {
  it('renders escaped bounded landing text with the fixed same-origin sign-in target', async () => {
    app = await build(parseHostnameLandings(JSON.stringify({
      'insurance.example.test': {
        title: `Policies & <quotes> " ' é`,
        summary: '<script>safe Unicode ø</script>',
        ctaLabel: 'Compare & go',
      },
    })))
    const response = await app.inject({
      method: 'GET',
      url: '/?redirect=https://evil.example',
      headers: { host: 'insurance.example.test' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.headers['content-type']).toBe('text/html; charset=utf-8')
    expect(response.body).toContain('Policies &amp; &lt;quotes&gt; &quot; &#39; é')
    expect(response.body).toContain('&lt;script&gt;safe Unicode ø&lt;/script&gt;')
    expect(response.body).toContain('<a href="/auth/signin?redirect=%2F">Compare &amp; go</a>')
    expect(response.body).not.toContain('evil.example')
    expect(response.body).not.toMatch(/<script|style=/)
  })

  it('serves distinct landings for two hostnames from one process', async () => {
    app = await build()
    const insurance = await app.inject({ method: 'GET', url: '/', headers: { host: 'insurance.example.test' } })
    const travel = await app.inject({ method: 'GET', url: '/', headers: { host: 'travel.example.test:8443' } })
    expect(insurance.body).toContain('<h1>Insurance Agent</h1>')
    expect(insurance.body).toContain('>Start</a>')
    expect(travel.body).toContain('<h1>Travel Agent</h1>')
    expect(travel.body).toContain('>Sign in</a>')
  })

  it('matches hosts exactly, never by wildcard/suffix/prefix', async () => {
    app = await build()
    for (const host of [
      'sub.insurance.example.test',
      'insurance.example.test.evil.example',
      'xinsurance.example.test',
      'other.example.test',
    ]) {
      const response = await app.inject({ method: 'GET', url: '/', headers: { host } })
      expect(response.body, host).toBe(SPA_SHELL)
    }
  })

  it('leaves unknown hosts untouched', async () => {
    app = await build()
    const response = await app.inject({ method: 'GET', url: '/', headers: { host: 'app.example.test' } })
    expect(response.statusCode).toBe(200)
    expect(response.body).toBe(SPA_SHELL)
  })

  it('leaves authenticated requests untouched even on a landing host', async () => {
    app = await build()
    const response = await app.inject({
      method: 'GET',
      url: '/',
      headers: { host: 'insurance.example.test', authorization: 'session' },
    })
    expect(response.body).toBe(SPA_SHELL)
  })

  it('falls through untouched when no landings are configured', async () => {
    app = await build(parseHostnameLandings(undefined))
    const response = await app.inject({ method: 'GET', url: '/', headers: { host: 'insurance.example.test' } })
    expect(response.body).toBe(SPA_SHELL)
  })
})

describe('presentation-only invariant (Decision 28: zero authority)', () => {
  it('reads nothing from the request beyond user and headers.host', async () => {
    const handler = createHostnameLandingRootHandler(twoAgentDemo)
    const touched: string[] = []
    const request = new Proxy({} as Record<string, unknown>, {
      get(_target, property) {
        touched.push(String(property))
        if (property === 'user') return null
        if (property === 'headers') return { host: 'insurance.example.test' }
        throw new Error(`landing handler must not read request.${String(property)}`)
      },
    })
    const sent: string[] = []
    const reply = {
      status: () => reply,
      header: () => reply,
      type: () => reply,
      send: (html: string) => {
        sent.push(html)
        return reply
      },
    }
    const handled = await handler(request as never, reply as never)
    expect(handled).toBe(true)
    expect(sent).toHaveLength(1)
    expect(touched.sort()).toEqual(['headers', 'user'])
  })

  it('performs no workspace/membership/session/db reads or writes (module has no such imports)', async () => {
    const here = path.dirname(fileURLToPath(import.meta.url))
    const source = await readFile(path.resolve(here, '../hostnameLandings.ts'), 'utf8')
    const imports = [...source.matchAll(/^import[^\n]*from\s+'([^']+)'/gm)].map((match) => match[1])
    // Type-only import of the core seam signature is the sole allowed import.
    expect(imports).toEqual(['@hachej/boring-core/app/server'])
    expect(source).toMatch(/^import type \{ CoreFrontendRootHandler \}/m)
    expect(imports.join('\n')).not.toMatch(/workspace|membership|session|deployment|db|drizzle|node:/i)
  })
})
