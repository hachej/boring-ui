import { Button, Section, Text } from '@react-email/components'
import { Layout } from './Layout'

interface WorkspaceInviteProps {
  acceptUrl: string
  appName: string
  inviterName: string
  workspaceName: string
  role: string
  expiresInDays: number
}

export function WorkspaceInvite({
  acceptUrl,
  appName,
  inviterName,
  workspaceName,
  role,
  expiresInDays,
}: WorkspaceInviteProps) {
  return (
    <Layout
      preview={`${inviterName} invited you to ${workspaceName}`}
      appName={appName}
    >
      <Section style={content}>
        <Text style={heading}>You&apos;ve been invited</Text>
        <Text style={paragraph}>
          {inviterName} invited you to join <strong>{workspaceName}</strong> as a{' '}
          <strong>{role}</strong>.
        </Text>
        <Button style={button} href={acceptUrl}>
          Accept invitation
        </Button>
        <Text style={hint}>
          This invitation expires in {expiresInDays}{' '}
          {expiresInDays === 1 ? 'day' : 'days'}. If you don&apos;t recognize
          this workspace, you can safely ignore this email.
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
