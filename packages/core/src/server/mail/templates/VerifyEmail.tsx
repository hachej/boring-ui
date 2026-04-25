import { Button, Section, Text } from '@react-email/components'
import { Layout } from './Layout'

interface VerifyEmailProps {
  verifyUrl: string
  appName: string
  expiresInHours: number
}

export function VerifyEmail({
  verifyUrl,
  appName,
  expiresInHours,
}: VerifyEmailProps) {
  return (
    <Layout preview={`Verify your ${appName} email address`} appName={appName}>
      <Section style={content}>
        <Text style={heading}>Verify your email address</Text>
        <Text style={paragraph}>
          Click the button below to verify your email address and activate your{' '}
          {appName} account.
        </Text>
        <Button style={button} href={verifyUrl}>
          Verify email
        </Button>
        <Text style={hint}>
          This link expires in {expiresInHours}{' '}
          {expiresInHours === 1 ? 'hour' : 'hours'}. If you didn&apos;t create
          an account, you can safely ignore this email.
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
