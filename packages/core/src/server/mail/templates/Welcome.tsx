import { Button, Section, Text } from '@react-email/components'
import { Layout } from './Layout'

interface WelcomeProps {
  appName: string
  getStartedUrl: string
}

export function Welcome({ appName, getStartedUrl }: WelcomeProps) {
  return (
    <Layout preview={`Welcome to ${appName}`} appName={appName}>
      <Section style={content}>
        <Text style={heading}>Welcome to {appName}</Text>
        <Text style={paragraph}>
          Your account is ready. Click below to get started.
        </Text>
        <Button style={button} href={getStartedUrl}>
          Get started
        </Button>
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
