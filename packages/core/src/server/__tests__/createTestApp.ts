import type { CoreConfig } from '../../shared/index.js'
import type { RenderedEmail } from '../mail/index.js'

export interface TestMailbox {
  readonly messages: ReadonlyArray<RenderedEmail>
  clear(): void
}

export interface CreateTestAppOptions {
  configOverrides?: Partial<CoreConfig>
}

export interface TestAppHarness {
  app: { close(): Promise<void> }
  store: 'local'
  mailbox: TestMailbox
  sendMail(email: RenderedEmail): Promise<{ id: string }>
}

export function createTestCoreConfig(
  overrides: Partial<CoreConfig> = {},
): CoreConfig {
  return {
    appId: 'boring-ui-v2-test',
    appName: 'Boring Test',
    appLogo: null,
    port: 0,
    host: '127.0.0.1',
    staticDir: null,
    databaseUrl: null,
    stores: 'local',
    cors: {
      origins: ['http://localhost:5173'],
      credentials: true,
    },
    bodyLimit: 16 * 1024 * 1024,
    logLevel: 'info',
    encryption: {
      workspaceSettingsKey:
        '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
    },
    auth: {
      secret: 'test-secret',
      url: 'http://localhost:3000',
      sessionTtlSeconds: 60 * 60 * 24 * 30,
      sessionCookieSecure: false,
      mail: {
        from: 'noreply@test.dev',
        transportUrl: 'console://',
      },
    },
    features: {
      githubOauth: false,
      invitesEnabled: true,
      sendWelcomeEmail: true,
    },
    ...overrides,
  }
}

export async function createTestApp(
  options: CreateTestAppOptions = {},
): Promise<TestAppHarness> {
  const mailbox: RenderedEmail[] = []
  void createTestCoreConfig(options.configOverrides)

  return {
    app: {
      async close() {
        // Placeholder until createCoreApp lands in M2.
      },
    },
    store: 'local',
    mailbox: {
      get messages() {
        return mailbox
      },
      clear() {
        mailbox.length = 0
      },
    },
    async sendMail(email: RenderedEmail): Promise<{ id: string }> {
      mailbox.push(email)
      return { id: `mail-${mailbox.length}` }
    },
  }
}
