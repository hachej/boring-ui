/**
 * End-to-end test for the composer attachments flow.
 *
 * Scenarios covered:
 *   1. Dropping / picking a file → the composer shows a chip.
 *   2. Submitting the message persists the attachment with a *data URL*
 *      (not a transient blob: URL) so it survives a page reload.
 *   3. After reload, the user message bubble still shows the file chip
 *      (filename + preview) with no broken links.
 *   4. The outgoing POST body carries a data URL too, so the server /
 *      agent can consume the attachment.
 *
 * Run: pnpm --filter @boring/example-with-shadcn e2e
 */
import { test, expect } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'

const FIXTURES = resolve(tmpdir(), 'boring-shadcn-attachments')
mkdirSync(FIXTURES, { recursive: true })

const TEXT_FILE = resolve(FIXTURES, 'note.txt')
writeFileSync(TEXT_FILE, 'Hello from an attached text file.\nLine two.\n')

const TEXT_FILE_2 = resolve(FIXTURES, 'report.md')
writeFileSync(TEXT_FILE_2, '# Report\n\n- point one\n- point two\n')

// 8x8 red PNG — smallest valid PNG we can embed. Generated once, written as
// a real file so the browser's file chooser accepts it. AttachmentPreview
// renders an <img> for image/* media, so asserting on the img tag proves
// the preview path works.
const PNG_FILE = resolve(FIXTURES, 'red-pixel.png')
writeFileSync(
  PNG_FILE,
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEX/AAD///9BHTQRAAAADElEQVQI12NgoBMAAABpAAFEI8ARAAAAAElFTkSuQmCC',
    'base64',
  ),
)

test.describe('composer attachments', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForTimeout(800)
  })

  test('attachment survives page reload with a data URL (not a blob URL)', async ({ page }) => {
    // 1. Attach a file via the paperclip button.
    const fileChooserPromise = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Attach files' }).click()
    const chooser = await fileChooserPromise
    await chooser.setFiles(TEXT_FILE)
    // Chip should appear in the composer.
    await expect(page.getByText('note.txt').first()).toBeVisible({ timeout: 3000 })

    // 2. Intercept the outgoing POST so we can assert on its body.
    const requestPromise = page.waitForRequest(
      (req) => req.url().includes('/api/v1/agent/chat') && req.method() === 'POST',
      { timeout: 10_000 },
    )
    const textarea = page.getByPlaceholder('Ask anything…')
    await textarea.fill('read my note')
    await page.keyboard.press('Enter')
    const request = await requestPromise
    const postBody = JSON.parse(request.postData() ?? '{}')

    // 3. Outgoing attachment must be a data URL — not a blob: URL that dies on reload.
    const sentAttachment = postBody.attachments?.[0]
    expect(sentAttachment, 'attachments array missing from request body').toBeTruthy()
    expect(sentAttachment.url, 'attachment url should be a data URL').toMatch(/^data:/)
    expect(sentAttachment.filename).toBe('note.txt')

    // 4. localStorage cache should also end up with a data URL (so the
    //    post-reload hydration can render the chip).
    await page.waitForTimeout(2000) // let useChat's save-to-cache effect run
    const stored = await page.evaluate(() => {
      const sid = localStorage.getItem('boring-shadcn-example:active-session') ?? 'demo'
      const raw = localStorage.getItem(`boring-agent:messages:${sid}`)
      if (!raw) return null
      const msgs = JSON.parse(raw) as Array<{ role: string; parts: Array<{ type: string; url?: string; filename?: string }> }>
      const user = msgs.find((m) => m.role === 'user')
      const file = user?.parts.find((p) => p.type === 'file')
      return file ? { url: file.url?.slice(0, 32), isDataUrl: file.url?.startsWith('data:') } : null
    })
    expect(stored, 'no file part in localStorage').not.toBeNull()
    expect(stored!.isDataUrl, `stored url should be data: but was ${stored!.url}`).toBe(true)

    // 5. Reload and verify the chip survives.
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForTimeout(2500)
    await expect(page.getByText('note.txt').first()).toBeVisible({ timeout: 4000 })
  })

  test('multiple attachments each persist with a data URL and appear in the POST body', async ({ page }) => {
    // Attach two files in one go.
    const chooserPromise = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Attach files' }).click()
    const chooser = await chooserPromise
    await chooser.setFiles([TEXT_FILE, TEXT_FILE_2])

    // Both chips must be visible in the composer before send.
    await expect(page.getByText('note.txt').first()).toBeVisible({ timeout: 3000 })
    await expect(page.getByText('report.md').first()).toBeVisible({ timeout: 3000 })

    // Intercept outgoing POST to verify both attachments land in the body.
    const requestPromise = page.waitForRequest(
      (req) => req.url().includes('/api/v1/agent/chat') && req.method() === 'POST',
      { timeout: 10_000 },
    )
    await page.getByPlaceholder('Ask anything…').fill('pair review')
    await page.keyboard.press('Enter')
    const request = await requestPromise
    const body = JSON.parse(request.postData() ?? '{}')

    expect(Array.isArray(body.attachments), 'attachments array missing').toBe(true)
    expect(body.attachments).toHaveLength(2)
    for (const a of body.attachments as Array<{ filename?: string; url?: string }>) {
      expect(a.url, `${a.filename} url should be data: URL`).toMatch(/^data:/)
    }
    const filenames = (body.attachments as Array<{ filename?: string }>).map((a) => a.filename).sort()
    expect(filenames).toEqual(['note.txt', 'report.md'])

    // Server-side inlined content should include both filenames.
    expect(body.message).toContain('note.txt')
    expect(body.message).toContain('report.md')

    // Both chips should also survive a reload.
    await page.waitForTimeout(2000)
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForTimeout(2500)
    await expect(page.getByText('note.txt').first()).toBeVisible({ timeout: 4000 })
    await expect(page.getByText('report.md').first()).toBeVisible({ timeout: 4000 })
  })

  test('image attachment renders a live <img> preview (data URL)', async ({ page }) => {
    const chooserPromise = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Attach files' }).click()
    const chooser = await chooserPromise
    await chooser.setFiles(PNG_FILE)

    // Filename chip present.
    await expect(page.getByText('red-pixel.png').first()).toBeVisible({ timeout: 3000 })

    // Composer chip should already have an <img> rendering the blob URL.
    const composerPreview = page.locator('form img[alt*="red-pixel"], form img[src^="blob:"], form img[src^="data:image"]')
    await expect(composerPreview.first()).toBeVisible({ timeout: 3000 })

    // Submit the message and intercept the request.
    const requestPromise = page.waitForRequest(
      (req) => req.url().includes('/api/v1/agent/chat') && req.method() === 'POST',
      { timeout: 10_000 },
    )
    await page.getByPlaceholder('Ask anything…').fill('look at this image')
    await page.keyboard.press('Enter')
    const request = await requestPromise
    const body = JSON.parse(request.postData() ?? '{}')
    const imgAttach = (body.attachments as Array<{ filename?: string; url?: string; mediaType?: string }>)?.[0]
    expect(imgAttach?.filename).toBe('red-pixel.png')
    expect(imgAttach?.mediaType).toBe('image/png')
    expect(imgAttach?.url).toMatch(/^data:image\/png;base64,/)

    // After streaming completes, reload and confirm the message bubble's
    // preview <img> now points to a data URL (never a dead blob URL).
    await page.waitForTimeout(2500)
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForTimeout(2500)

    const bubbleImg = page.locator('.is-user img').first()
    await expect(bubbleImg).toBeVisible({ timeout: 4000 })
    const src = await bubbleImg.getAttribute('src')
    expect(src, 'image preview src should be a data URL after reload').toMatch(/^data:image\//)

    // The image must actually have loaded (non-zero dimensions — not a broken image).
    const { naturalWidth, naturalHeight } = await bubbleImg.evaluate((el) => ({
      naturalWidth: (el as HTMLImageElement).naturalWidth,
      naturalHeight: (el as HTMLImageElement).naturalHeight,
    }))
    expect(naturalWidth, 'image failed to load (0 naturalWidth)').toBeGreaterThan(0)
    expect(naturalHeight, 'image failed to load (0 naturalHeight)').toBeGreaterThan(0)
  })

  test('composer clears attachment chips immediately after submit (does not wait for stream)', async ({ page }) => {
    const chooserPromise = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Attach files' }).click()
    const chooser = await chooserPromise
    await chooser.setFiles(PNG_FILE)

    // Before submit: chip is inside the composer form.
    const form = page.locator('form').first()
    await expect(form.getByText('red-pixel.png').first()).toBeVisible({ timeout: 3000 })

    await page.getByPlaceholder('Ask anything…').fill('what is this?')
    await page.keyboard.press('Enter')

    // The user bubble will acquire its own `red-pixel.png` label once the
    // send lands; we only care that the *composer form* no longer shows a
    // lingering chip. Use a scoped locator and allow a generous 5s — the
    // stream is still running in the background, so the textarea may or may
    // not be enabled, but the chips must be gone.
    await expect(form.getByText('red-pixel.png')).toHaveCount(0, { timeout: 5000 })
    // And the composer textarea should be empty again.
    const textarea = page.getByPlaceholder('Ask anything…')
    await expect(textarea).toHaveValue('', { timeout: 5000 })
  })

  test('submitting with Enter after attaching an image clears the composer promptly', async ({ page }) => {
    // Separate test from the one above to guard against regressions where
    // the chip disappears but the text input still carries the message.
    const chooserPromise = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Attach files' }).click()
    const chooser = await chooserPromise
    await chooser.setFiles(PNG_FILE)

    const textarea = page.getByPlaceholder('Ask anything…')
    await textarea.fill('describe the image')
    await page.keyboard.press('Enter')

    // Within 3s, the composer text + chips should both be gone — independent
    // of whether the agent response has finished streaming.
    await expect(textarea).toHaveValue('', { timeout: 3000 })
    const form = page.locator('form').first()
    await expect(form.getByText('red-pixel.png')).toHaveCount(0, { timeout: 3000 })
  })

  test('empty submit is blocked client-side (never hits the server)', async ({ page }) => {
    // No text, no attachments. Pressing Enter with focus in the textarea
    // must NOT issue a POST — the client-side guard returns early.
    let postSeen = false
    page.on('request', (req) => {
      if (req.url().includes('/api/v1/agent/chat') && req.method() === 'POST') {
        postSeen = true
      }
    })
    await page.getByPlaceholder('Ask anything…').click()
    await page.keyboard.press('Enter')
    await page.waitForTimeout(1500)
    expect(postSeen, 'empty submit should not hit /api/v1/agent/chat').toBe(false)

    // A structured server validation error should therefore also not appear.
    const alert = page.locator('[role=alert]')
    await expect(alert).toHaveCount(0, { timeout: 500 })
  })

  test('submit button flips to Stop while streaming and aborts the turn on click', async ({ page }) => {
    // Kick off a request that will stream. While in flight the submit button
    // must expose aria-label="Stop". Clicking it should stop the turn —
    // status returns to ready and the button returns to Submit.
    await page.getByPlaceholder('Ask anything…').fill('count slowly from 1 to 20, one number per line')
    await page.keyboard.press('Enter')

    const stopBtn = page.getByRole('button', { name: 'Stop' })
    await expect(stopBtn).toBeVisible({ timeout: 8000 })
    await stopBtn.click()

    // Within 3s the button should be the Submit affordance again.
    await expect(page.getByRole('button', { name: 'Submit' })).toBeVisible({ timeout: 3000 })
  })

  test('user bubble does NOT include the inlined `[attached: …]` marker', async ({ page }) => {
    const fileChooserPromise = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Attach files' }).click()
    const chooser = await fileChooserPromise
    await chooser.setFiles(TEXT_FILE)
    await page.waitForTimeout(500)
    await page.getByPlaceholder('Ask anything…').fill('hi')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(2500)

    // The visible user message should be exactly "hi" with no junk suffix.
    // The Message primitive tags user messages with the `.is-user` class.
    const userBubble = page.locator('.is-user').first()
    await expect(userBubble).toBeVisible({ timeout: 4000 })
    const bubbleText = (await userBubble.textContent()) ?? ''
    expect(bubbleText, 'attachment serialization leaked into user bubble').not.toMatch(/\[attached:/)
    expect(bubbleText.includes('hi')).toBe(true)
  })
})
