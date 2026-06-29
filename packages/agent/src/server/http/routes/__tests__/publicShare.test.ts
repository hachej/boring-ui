import Fastify, { type FastifyInstance } from 'fastify'
import { mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
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

  test('does not expose unlisted workspace files', async () => {
    const { app } = await createTestApp()

    const res = await app.inject({ method: 'GET', url: '/share/s_test/assets/docs/secret.md' })
    expect(res.statusCode).toBe(404)
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
