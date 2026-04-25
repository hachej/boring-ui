import { Button, Section, Text } from '@react-email/components'
import { Layout } from './Layout'

interface ResetPasswordProps {
  resetUrl: string
  appName: string
  expiresInHours: number
}

export function ResetPassword({
  resetUrl,
  appName,
  expiresInHours,
}: ResetPasswordProps) {
  return (
    <Layout
      preview={`Reset your ${appName} password`}
      appName={appName}
    >
      <Section style={content}>
        <Text style={heading}>Reset your password</Text>
        <Text style={paragraph}>
          We received a request to reset your {appName} password. Click the
          button below to choose a new one.
        </Text>
        <Button style={button} href={resetUrl}>
          Reset password
        </Button>
        <Text style={hint}>
          This link expires in {expiresInHours}{' '}
          {expiresInHours === 1 ? 'hour' : 'hours'}. If you didn&apos;t request
          a password reset, you can safely ignore this email.
        </Text>
      </Section>
    </Layout>
  )
}

const content = { padding: '0 48px' }

const heading = {
  fontSize: '24px',
  fontWeight: 'bold' as const,
  color: '#1a1a1a',
  margin: '0 0 16px',
}

const paragraph = {
  fontSize: '14px',
  lineHeight: '24px',
  color: '#525f7f',
  margin: '0 0 24px',
}

const button = {
  backgroundColor: '#1a1a1a',
  borderRadius: '6px',
  color: '#ffffff',
  fontSize: '14px',
  fontWeight: '600' as const,
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'block',
  padding: '12px 24px',
}

const hint = {
  fontSize: '12px',
  lineHeight: '20px',
  color: '#8898aa',
  margin: '24px 0 0',
}
