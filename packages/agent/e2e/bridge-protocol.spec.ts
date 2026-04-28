import { expect, test } from './fixtures'

test.describe('UI bridge ownership boundary (agent standalone)', () => {
  test('GET /api/v1/ui/state returns 404', async ({ browserPage, backend }) => {
    const res = await browserPage.request.get(`${backend.apiUrl}/api/v1/ui/state`, {
      failOnStatusCode: false,
    })
    expect(res.status()).toBe(404)
  })

  test('PUT /api/v1/ui/state returns 404', async ({ browserPage, backend }) => {
    const res = await browserPage.request.put(`${backend.apiUrl}/api/v1/ui/state`, {
      data: { state: { openFiles: ['README.md'] } },
      failOnStatusCode: false,
    })
    expect(res.status()).toBe(404)
  })

  test('POST /api/v1/ui/commands returns 404', async ({ browserPage, backend }) => {
    const res = await browserPage.request.post(`${backend.apiUrl}/api/v1/ui/commands`, {
      data: { kind: 'openFile', params: { path: 'README.md' } },
      failOnStatusCode: false,
    })
    expect(res.status()).toBe(404)
  })
})
