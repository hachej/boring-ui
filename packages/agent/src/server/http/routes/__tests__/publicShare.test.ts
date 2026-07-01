import Fastify, { type FastifyInstance } from 'fastify'
import { mkdir, mkdtemp, rm, writeFile, readFile } from 'fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

import { createNodeWorkspace } from '../../../workspace/createNodeWorkspace'
import { createMarkdownReviewShare, registerPublicShareRoutes } from '../publicShare'

const tempRoots: string[] = []
const apps: FastifyInstance[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()))
  await Promise.all(tempRoots.splice(0).map(async (root) => rm(root, { recursive: true, force: true })))
})

async function createTestApp(opts: { allowEdit?: boolean } = {}) {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'boring-ui-public-share-'))
  tempRoots.push(workspaceRoot)
  await mkdir(join(workspaceRoot, 'docs', 'images'), { recursive: true })
  await writeFile(join(workspaceRoot, 'docs', 'review.md'), '# Review\n\n![Hero](images/hero.png)\n\n<img src="images/inline.png" alt="Inline image">\n', 'utf8')
  await writeFile(join(workspaceRoot, 'docs', 'images', 'hero.png'), Buffer.from([137, 80, 78, 71]), 'binary')
  await writeFile(join(workspaceRoot, 'docs', 'images', 'inline.png'), Buffer.from([137, 80, 78, 71]), 'binary')
  await writeFile(join(workspaceRoot, 'docs', 'secret.md'), 'secret', 'utf8')

  const workspace = createNodeWorkspace(workspaceRoot)
  const share = createMarkdownReviewShare({
    token: 's_test',
    entryPath: 'docs/review.md',
    markdown: await readFile(join(workspaceRoot, 'docs', 'review.md'), 'utf8'),
    includeAssets: true,
    allowEdit: opts.allowEdit,
  })
  const app = Fastify({ logger: false })
  await app.register(registerPublicShareRoutes, {
    getShare: (token: string) => token === share.token ? share : undefined,
    getWorkspace: () => workspace,
  })
  await app.ready()
  apps.push(app)
  return { app, workspaceRoot }
}

describe('public share routes', () => {
  test('renders a Markdown review page with allowed image assets', async () => {
    const { app } = await createTestApp()

    const page = await app.inject({ method: 'GET', url: '/share/s_test/' })
    expect(page.statusCode).toBe(200)
    expect(page.headers['content-type']).toContain('text/html')
    expect(page.body).toContain('<h1>Review</h1>')
    expect(page.body).toContain('/share/s_test/assets/docs/images/hero.png')
    expect(page.body).toContain('/share/s_test/assets/docs/images/inline.png')
    expect(page.body).not.toContain('&lt;img')

    const image = await app.inject({ method: 'GET', url: '/share/s_test/assets/docs/images/hero.png' })
    expect(image.statusCode).toBe(200)
    expect(image.headers['content-type']).toContain('image/png')
  })


  test('returns generic metadata and download routes for the public app dispatcher', async () => {
    const { app } = await createTestApp({ allowEdit: true })

    const meta = await app.inject({ method: 'GET', url: '/share/s_test/meta' })
    expect(meta.statusCode).toBe(200)
    const body = JSON.parse(meta.body) as { kind: string; appId: string; editable: boolean; links: { downloads: Record<string, string> }; downloads: Record<string, { href: string }> }
    expect(body.kind).toBe('markdown-review')
    expect(body.appId).toBe('markdown-review')
    expect(body.editable).toBe(true)
    expect(body.links.downloads.portableMarkdown).toBe('/share/s_test/download/portableMarkdown')
    expect(body.downloads.portableMarkdown.href).toBe('/share/s_test/portable.md')
  })

  test('exports portable Markdown and a ZIP bundle with images', async () => {
    const { app } = await createTestApp()

    const genericPortable = await app.inject({ method: 'GET', url: '/share/s_test/download/portableMarkdown', headers: { host: 'review.test' } })
    expect(genericPortable.statusCode).toBe(200)
    expect(genericPortable.body).toContain('http://review.test/share/s_test/assets/docs/images/hero.png')

    const portable = await app.inject({ method: 'GET', url: '/share/s_test/portable.md', headers: { host: 'review.test' } })
    expect(portable.statusCode).toBe(200)
    expect(portable.body).toContain('http://review.test/share/s_test/assets/docs/images/hero.png')
    expect(portable.body).toContain('http://review.test/share/s_test/assets/docs/images/inline.png')

    const zip = await app.inject({ method: 'GET', url: '/share/s_test/bundle.zip' })
    expect(zip.statusCode).toBe(200)
    expect(zip.headers['content-type']).toContain('application/zip')
    expect(zip.body).toContain('docs/review.md')
    expect(zip.body).toContain('docs/images/hero.png')
    expect(zip.body).toContain('docs/images/inline.png')
  })

  test('does not expose unlisted workspace files', async () => {
    const { app } = await createTestApp()

    const res = await app.inject({ method: 'GET', url: '/share/s_test/assets/docs/secret.md' })
    expect(res.statusCode).toBe(404)
  })

  test('returns unsupported for shares without a registered public app handler', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'boring-ui-public-share-'))
    tempRoots.push(workspaceRoot)
    await writeFile(join(workspaceRoot, 'image.png'), Buffer.from([137, 80, 78, 71]), 'binary')
    const workspace = createNodeWorkspace(workspaceRoot)
    const app = Fastify({ logger: false })
    await app.register(registerPublicShareRoutes, {
      getShare: () => ({ token: 's_image', kind: 'image-preview', appId: 'image-preview', entryPath: 'image.png', capabilities: { readFiles: ['image.png'] } }),
      getWorkspace: () => workspace,
    })
    await app.ready()
    apps.push(app)

    const res = await app.inject({ method: 'GET', url: '/share/s_image/meta' })
    expect(res.statusCode).toBe(501)

    const raw = await app.inject({ method: 'GET', url: '/share/s_image/api/v1/files/raw?path=image.png' })
    expect(raw.statusCode).toBe(501)
    const asset = await app.inject({ method: 'GET', url: '/share/s_image/assets/image.png' })
    expect(asset.statusCode).toBe(501)
  })

  test('read-only shares reject public edits', async () => {
    const { app } = await createTestApp()

    const res = await app.inject({
      method: 'POST',
      url: '/share/s_test/raw',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ content: '# Changed' }).toString(),
    })
    expect(res.statusCode).toBe(403)
  })

  test('editable shares overwrite only the entry Markdown file', async () => {
    const { app, workspaceRoot } = await createTestApp({ allowEdit: true })

    const res = await app.inject({
      method: 'POST',
      url: '/share/s_test/raw',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ content: '# Changed' }).toString(),
    })
    expect(res.statusCode).toBe(303)
    await expect(readFile(join(workspaceRoot, 'docs', 'review.md'), 'utf8')).resolves.toBe('# Changed')
    await expect(readFile(join(workspaceRoot, 'docs', 'secret.md'), 'utf8')).resolves.toBe('secret')
  })
})
