import { ConfigValidationError } from '../../shared/errors.js'

export interface RenderedEmail {
  to: string
  subject: string
  html: string
  text: string
}

export interface MailTransport {
  send(email: RenderedEmail): Promise<{ id: string }>
}

export class MailDeliveryError extends Error {
  readonly statusCode?: number

  constructor(message: string, statusCode?: number) {
    super(message)
    this.name = 'MailDeliveryError'
    this.statusCode = statusCode
  }
}

type Env = 'production' | 'development' | 'test'

export function createMailTransport(
  url: string,
  from: string,
  env: Env = 'development',
): MailTransport {
  if (url.startsWith('resend://')) {
    const apiKey = url.slice('resend://'.length)
    return new ResendTransport(apiKey, from)
  }

  if (url.startsWith('smtp://') || url.startsWith('smtps://')) {
    return new SmtpTransport(url, from)
  }

  if (url.startsWith('console-capture://')) {
    if (env !== 'test') {
      throw new ConfigValidationError([
        {
          message: 'console-capture:// transport is only allowed in test env',
          path: ['auth', 'mail', 'transportUrl'],
        },
      ])
    }
    const outputPath = url.slice('console-capture://'.length) || undefined
    return new ConsoleCaptureTransport(outputPath)
  }

  if (url.startsWith('console://')) {
    if (env === 'production') {
      throw new ConfigValidationError([
        {
          message:
            'console mail transport is not allowed in production',
          path: ['auth', 'mail', 'transportUrl'],
        },
      ])
    }
    return new ConsoleTransport()
  }

  throw new ConfigValidationError([
    {
      message: `Unknown mail transport scheme: ${url.split('://')[0]}://. Expected resend://, smtp://, smtps://, console://, or console-capture://`,
      path: ['auth', 'mail', 'transportUrl'],
    },
  ])
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries = 3,
): Promise<Response> {
  const delays = [500, 1000, 2000]

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response: Response
    try {
      response = await fetch(url, init)
    } catch (err) {
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, delays[attempt]))
        continue
      }
      throw new MailDeliveryError(
        `Network error after ${maxRetries + 1} attempts: ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    if (response.ok) return response

    if (response.status >= 400 && response.status < 500) {
      const body = await response.text()
      throw new MailDeliveryError(
        `Resend API error ${response.status}: ${body}`,
        response.status,
      )
    }

    if (attempt < maxRetries) {
      await new Promise((r) => setTimeout(r, delays[attempt]))
      continue
    }

    const body = await response.text()
    throw new MailDeliveryError(
      `Resend API error ${response.status} after ${maxRetries + 1} attempts: ${body}`,
      response.status,
    )
  }

  throw new MailDeliveryError('Unreachable')
}

class ResendTransport implements MailTransport {
  constructor(
    private apiKey: string,
    private from: string,
  ) {}

  async send(email: RenderedEmail): Promise<{ id: string }> {
    const response = await fetchWithRetry(
      'https://api.resend.com/emails',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          from: this.from,
          to: email.to,
          subject: email.subject,
          html: email.html,
          text: email.text,
        }),
      },
    )

    const data = (await response.json()) as { id: string }
    return { id: data.id }
  }
}

class SmtpTransport implements MailTransport {
  private connectionUrl: string
  private from: string

  constructor(url: string, from: string) {
    this.connectionUrl = url
    this.from = from
  }

  async send(email: RenderedEmail): Promise<{ id: string }> {
    try {
      const { createTransport } = await import('nodemailer')
      const transporter = createTransport(this.connectionUrl)

      const info = await transporter.sendMail({
        from: this.from,
        to: email.to,
        subject: email.subject,
        html: email.html,
        text: email.text,
      })

      return { id: info.messageId }
    } catch (err) {
      if (err instanceof MailDeliveryError) throw err
      throw new MailDeliveryError(
        `SMTP send failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
}

let consoleCounter = 0

class ConsoleTransport implements MailTransport {
  async send(email: RenderedEmail): Promise<{ id: string }> {
    const id = `console-${++consoleCounter}-${Date.now()}`

    const logEntry = {
      type: 'mail_sent',
      id,
      to: email.to,
      subject: email.subject,
      html: email.html,
      text: email.text,
      timestamp: new Date().toISOString(),
    }

    console.info('[mail:console]', JSON.stringify(logEntry))

    return { id }
  }
}

class ConsoleCaptureTransport implements MailTransport {
  constructor(private outputPath?: string) {}

  async send(email: RenderedEmail): Promise<{ id: string }> {
    const id = `capture-${++consoleCounter}-${Date.now()}`

    const logEntry = {
      type: 'mail_sent',
      id,
      to: email.to,
      subject: email.subject,
      html: email.html,
      text: email.text,
      timestamp: new Date().toISOString(),
    }

    console.info('[mail:console-capture]', JSON.stringify(logEntry))

    const { appendFileSync } = await import('node:fs')
    const path = this.outputPath ?? `/tmp/test-mail-${process.pid}.log`
    appendFileSync(path, JSON.stringify(logEntry) + '\n')

    return { id }
  }
}
