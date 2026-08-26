import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Locator, Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { assertChatDomInvariants, MODEL_LABEL_ORDER, readChatDomState, type ChatDomState } from './helpers/chat-state'
import { formatLogs, spawnBackend } from './helpers/backend'
import { navigateBrowserToBackend } from './helpers/browser'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

const DEFAULT_SEED = 20260605
const DEFAULT_STEP_COUNT = 16
const PROMPTS = [
  'random baseline inspect workspace',
  'random baseline check tool state',
  'random baseline stream ordering',
  'random baseline preserve history',
] as const
const THINKING_OPTIONS = ['Off', 'Low', 'Med', 'High'] as const

type ChatAction =
  | 'submit-prompt'
  | 'queue-follow-up'
  | 'press-escape'
  | 'click-stop'
  | 'reload'
  | 'open-model-menu'
  | 'select-model'
  | 'select-thinking'
  | 'wait'

interface ActionTraceEntry {
  step: number
  action: ChatAction
  messageIds: string[]
  status: {
    connection: string | null
    workingVisible: boolean
    submitLabel: string | null
    queueText: string
    composerFocused: boolean
    composerDraftLength: number
    selectedModel: string
    thinkingLabel: string | null
  }
}

interface RunnerContext {
  page: Page
  rng: SeededRandom
  composer: Locator
  submit: Locator
  chat: Locator
  conversation: Locator
  queuePreview: Locator
  actionTrace: ActionTraceEntry[]
  previousMessageIds: string[]
  promptIndex: number
  followUpIndex: number
}

class SeededRandom {
  private state: number

  constructor(seed: number) {
    this.state = seed >>> 0
  }

  int(maxExclusive: number): number {
    if (maxExclusive <= 0) return 0
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0
    return this.state % maxExclusive
  }

  pick<T>(values: readonly T[]): T {
    return values[this.int(values.length)]!
  }
}

test.describe('Pi-native seeded random baseline', () => {
  test('keeps chat invariants true across randomized valid interaction sequences', async ({ page, workspace }, testInfo) => {
    const seed = parsePositiveInt(process.env.PI_NATIVE_RANDOM_BASELINE_SEED, DEFAULT_SEED)
    const stepCount = parsePositiveInt(process.env.PI_NATIVE_RANDOM_BASELINE_STEPS, DEFAULT_STEP_COUNT)
    test.setTimeout(30_000 + stepCount * 6_000)

    const backend = await spawnBackend({
      workspaceRoot: workspace.root,
      repoRoot,
      env: {
        BORING_AGENT_E2E_SCRIPTED_PI: '1',
        BORING_AGENT_E2E_SCRIPTED_PI_TICK_MS: '650',
      },
    })

    const ctx: RunnerContext = {
      page,
      rng: new SeededRandom(seed),
      composer: page.locator('[data-boring-agent-part="composer-input"]'),
      submit: page.locator('[data-boring-agent-part="composer-submit"]'),
      chat: page.locator('[data-boring-agent-part="chat"]'),
      conversation: page.getByLabel('Agent conversation'),
      queuePreview: page.locator('[data-boring-agent-part="composer-queue-preview"]'),
      actionTrace: [],
      previousMessageIds: [],
      promptIndex: 0,
      followUpIndex: 0,
    }

    try {
      await navigateBrowserToBackend(page, `${backend.browserUrl}?piNative=1`)
      await expect(ctx.chat).toHaveAttribute('data-pi-chat-connection', 'connected', { timeout: 10_000 })
      await assertAfter(ctx, 0, 'wait')

      for (let step = 1; step <= stepCount; step += 1) {
        const before = await readChatDomState(page)
        const action = chooseAction(before, ctx.rng)
        const performedAction = await performAction(ctx, action)
        await assertAfter(ctx, step, performedAction)
      }

      await testInfo.attach('pi-native-random-baseline.json', {
        body: Buffer.from(JSON.stringify({
          backend: 'scripted-pi-harness',
          seed,
          stepCount,
          actions: ctx.actionTrace,
        }, null, 2), 'utf8'),
        contentType: 'application/json',
      })
    } finally {
      if (ctx.actionTrace.length > 0) {
        await testInfo.attach('pi-native-random-baseline-final-trace.json', {
          body: Buffer.from(JSON.stringify({
            backend: 'scripted-pi-harness',
            seed,
            stepCount,
            actions: ctx.actionTrace,
          }, null, 2), 'utf8'),
          contentType: 'application/json',
        })
      }
      await testInfo.attach('backend-stdout.log', {
        body: Buffer.from(`${backend.logs.stdout.join('\n')}\n`, 'utf8'),
        contentType: 'text/plain',
      })
      await testInfo.attach('backend-stderr.log', {
        body: Buffer.from(`${backend.logs.stderr.join('\n')}\n`, 'utf8'),
        contentType: 'text/plain',
      })
      if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach('backend-combined.log', {
          body: Buffer.from(formatLogs(backend.logs), 'utf8'),
          contentType: 'text/plain',
        })
      }
      await backend.stop()
    }
  })
})

async function performAction(ctx: RunnerContext, action: ChatAction): Promise<ChatAction> {
  switch (action) {
    case 'submit-prompt':
      await submitPrompt(ctx)
      return action
    case 'queue-follow-up':
      return queueFollowUp(ctx)
    case 'press-escape':
      return pressEscape(ctx)
    case 'click-stop':
      return clickStop(ctx)
    case 'reload':
      await reload(ctx)
      return action
    case 'open-model-menu':
      await openModelMenu(ctx)
      return action
    case 'select-model':
      await selectModel(ctx)
      return action
    case 'select-thinking':
      await selectThinking(ctx)
      return action
    case 'wait':
      await ctx.page.waitForTimeout(150 + ctx.rng.int(500))
      return action
  }
}

function chooseAction(state: ChatDomState, rng: SeededRandom): ChatAction {
  const actions: Array<[number, ChatAction]> = [
    [2, 'reload'],
    [3, 'wait'],
  ]

  if (state.workingVisible) {
    if (state.queueText.length === 0) actions.push([5, 'queue-follow-up'])
    actions.push([4, 'press-escape'], [3, 'click-stop'])
  } else {
    actions.push(
      [6, 'submit-prompt'],
      [2, 'open-model-menu'],
      [2, 'select-model'],
      [2, 'select-thinking'],
    )
  }

  const total = actions.reduce((sum, [weight]) => sum + weight, 0)
  let roll = rng.int(total)
  for (const [weight, action] of actions) {
    if (roll < weight) return action
    roll -= weight
  }
  return 'wait'
}

async function submitPrompt(ctx: RunnerContext): Promise<void> {
  ctx.promptIndex += 1
  const prompt = `${ctx.rng.pick(PROMPTS)} ${ctx.promptIndex}`
  await ctx.composer.fill(prompt)
  await ctx.submit.click()
  await expect.poll(async () => {
    const state = await readChatDomState(ctx.page)
    return state.workingVisible || state.messages.some((message) => message.role === 'user' && message.text.includes(prompt))
  }, {
    message: `expected prompt "${prompt}" to be accepted`,
    timeout: 10_000,
  }).toBe(true)
}

async function queueFollowUp(ctx: RunnerContext): Promise<ChatAction> {
  if (!(await readChatDomState(ctx.page)).workingVisible) {
    await ctx.page.waitForTimeout(100)
    return 'wait'
  }
  ctx.followUpIndex += 1
  const followUp = `random queued follow-up ${ctx.followUpIndex}`
  await ctx.composer.fill(followUp)
  await ctx.composer.press('Enter')
  const acceptedAs = await expect.poll(async () => {
    const state = await readChatDomState(ctx.page)
    if (state.queueText.includes(followUp)) return 'queued'
    if (state.messages.some((message) => message.role === 'user' && message.text.includes(followUp))) return 'submitted'
    return 'pending'
  }, {
    message: `expected follow-up "${followUp}" to either queue or become the next accepted prompt`,
    timeout: 10_000,
  }).not.toBe('pending').then(async () => {
    const state = await readChatDomState(ctx.page)
    return state.queueText.includes(followUp) ? 'queued' : 'submitted'
  })
  return acceptedAs === 'queued' ? 'queue-follow-up' : 'submit-prompt'
}

async function pressEscape(ctx: RunnerContext): Promise<ChatAction> {
  const before = await readChatDomState(ctx.page)
  if (!before.workingVisible) {
    await ctx.page.waitForTimeout(100)
    return 'wait'
  }
  await ctx.composer.focus()
  await ctx.page.keyboard.press('Escape')

  const knownQueued = extractKnownQueuedText(before.queueText)
  if (knownQueued) {
    await expect(ctx.conversation.getByText(knownQueued)).toBeVisible({ timeout: 10_000 })
  } else {
    await expect(ctx.page.getByTestId('chat-working')).toHaveCount(0, { timeout: 10_000 })
  }
  return 'press-escape'
}

async function clickStop(ctx: RunnerContext): Promise<ChatAction> {
  const before = await readChatDomState(ctx.page)
  if (!before.workingVisible) {
    await ctx.page.waitForTimeout(100)
    return 'wait'
  }
  const stopButton = ctx.submit
  if (!(await stopButton.isVisible()) || await stopButton.getAttribute('aria-label') !== 'Stop') {
    await ctx.page.waitForTimeout(100)
    return 'wait'
  }
  try {
    await stopButton.click({ timeout: 1_000 })
  } catch {
    await ctx.page.waitForTimeout(100)
    return 'wait'
  }
  await expect(ctx.queuePreview).toHaveCount(0, { timeout: 10_000 })

  const knownQueued = extractKnownQueuedText(before.queueText)
  if (knownQueued) {
    await expect.poll(async () => queuedTextState(ctx.page, knownQueued), {
      message: `expected queued follow-up "${knownQueued}" to either clear or become a submitted turn after Stop`,
      timeout: 10_000,
    }).not.toBe('queued')
  }
  return 'click-stop'
}

async function reload(ctx: RunnerContext): Promise<void> {
  const before = await readChatDomState(ctx.page)
  const beforeCanonicalIds = before.messages
    .map((message) => message.id)
    .filter((id): id is string => Boolean(id) && !id.startsWith('optimistic:'))
  await ctx.page.reload({ waitUntil: 'domcontentloaded' })
  await expect(ctx.chat).toHaveAttribute('data-pi-chat-connection', /connected|connecting/, { timeout: 10_000 })
  if (beforeCanonicalIds.length > 0) {
    await expect.poll(async () => (await readChatDomState(ctx.page)).messages.length, {
      message: 'expected reload to preserve a non-empty canonical transcript',
      timeout: 10_000,
    }).toBeGreaterThan(0)
    await expect.poll(async () => {
      const after = await readChatDomState(ctx.page)
      const afterIds = new Set(after.messages.map((message) => message.id).filter((id): id is string => Boolean(id)))
      return beforeCanonicalIds.some((id) => afterIds.has(id))
    }, {
      message: 'expected reload to preserve at least one existing canonical message id',
      timeout: 10_000,
    }).toBe(true)
  }
}

async function openModelMenu(ctx: RunnerContext): Promise<void> {
  const modelSelect = ctx.page.locator('[data-boring-agent-part="model-select"]')
  if (!(await modelSelect.isEnabled())) {
    await ctx.page.waitForTimeout(100)
    return
  }
  await modelSelect.click()
  await expect(ctx.page.locator('[cmdk-item]').first()).toBeVisible({ timeout: 10_000 })
  const modelLabels = await readVisibleModelLabels(ctx.page)
  if (modelLabels.length === MODEL_LABEL_ORDER.length) expect(modelLabels).toEqual([...MODEL_LABEL_ORDER])
  await ctx.page.keyboard.press('Escape')
}

async function selectModel(ctx: RunnerContext): Promise<void> {
  const modelSelect = ctx.page.locator('[data-boring-agent-part="model-select"]')
  if (!(await modelSelect.isEnabled())) {
    await ctx.page.waitForTimeout(100)
    return
  }
  await modelSelect.click()
  const options = ctx.page.getByRole('option')
  await expect(options.first()).toBeVisible({ timeout: 10_000 })
  await options.nth(ctx.rng.int(Math.min(await options.count(), 25))).click()
  await expect(modelSelect).not.toHaveAttribute('aria-expanded', 'true')
}

async function selectThinking(ctx: RunnerContext): Promise<void> {
  const thinkingSelect = ctx.page.locator('[data-boring-agent-part="thinking-select"]')
  if (!(await thinkingSelect.isEnabled())) {
    await ctx.page.waitForTimeout(100)
    return
  }
  const label = ctx.rng.pick(THINKING_OPTIONS)
  await thinkingSelect.click()
  await ctx.page.getByRole('option', { name: label }).click()
  await expect(thinkingSelect).toHaveAttribute('aria-label', `Thinking level: ${label}`)
}

async function assertAfter(ctx: RunnerContext, step: number, action: ChatAction): Promise<void> {
  const state = await readChatDomState(ctx.page)
  assertChatDomInvariants(state)

  const messageIds = state.messages.map((message) => message.id).filter((id): id is string => Boolean(id))
  expectSurvivingMessageOrder(ctx.previousMessageIds, messageIds)
  ctx.previousMessageIds = messageIds
  ctx.actionTrace.push({
    step,
    action,
    messageIds,
    status: {
      connection: state.connection,
      workingVisible: state.workingVisible,
      submitLabel: state.submitLabel,
      queueText: state.queueText,
      composerFocused: state.composerFocused,
      composerDraftLength: state.composerValue.length,
      selectedModel: state.selectedModel,
      thinkingLabel: state.thinkingLabel,
    },
  })
}

function expectSurvivingMessageOrder(previousIds: string[], nextIds: string[]): void {
  const nextIndexById = new Map(nextIds.map((id, index) => [id, index]))
  const survivingIndexes = previousIds
    .map((id) => nextIndexById.get(id))
    .filter((index): index is number => index !== undefined)

  const sorted = [...survivingIndexes].sort((left, right) => left - right)
  expect(survivingIndexes, 'surviving message ids must not reorder across actions').toEqual(sorted)
}

function extractKnownQueuedText(queueText: string): string | null {
  const match = queueText.match(/random queued follow-up \d+/u)
  return match?.[0] ?? null
}

async function queuedTextState(page: Page, text: string): Promise<'cleared' | 'queued' | 'submitted'> {
  const state = await readChatDomState(page)
  if (state.queueText.includes(text)) return 'queued'
  const matchingMessages = state.messages.filter((message) => message.text.includes(text))
  if (matchingMessages.some((message) => message.waitingFollowUp || message.status === 'pending')) return 'queued'
  return matchingMessages.length > 0 ? 'submitted' : 'cleared'
}

async function readVisibleModelLabels(page: Page): Promise<string[]> {
  const itemTexts = await page.locator('[cmdk-item]').evaluateAll((nodes) =>
    nodes.map((node) => node.textContent?.replace(/\s+/g, ' ').trim() ?? ''),
  )
  return itemTexts
    .map((text) => MODEL_LABEL_ORDER.find((label) => text.includes(label)) ?? null)
    .filter((label): label is typeof MODEL_LABEL_ORDER[number] => label !== null)
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}
