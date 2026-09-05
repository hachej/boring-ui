// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Toaster, clearToasts, useToast, type ToastEventInput } from '@hachej/boring-ui-kit'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CreateWorkspaceDialog } from '../components/CreateWorkspaceDialog'
import { useMswHandler } from './_setup'

afterEach(() => clearToasts())

describe('toast delivery through the public UI kit', () => {
  it('shows a workspace creation rejection in the mounted Toaster and keeps the form open', async () => {
    const onOpenChange = vi.fn()
    const onCreated = vi.fn()
    useMswHandler((input, init) => {
      if (String(input).endsWith('/api/v1/workspaces') && init?.method === 'POST') {
        return new Response(JSON.stringify({ code: 'forbidden', message: 'Workspace limit reached' }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        })
      }
      return undefined
    })
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CreateWorkspaceDialog open onOpenChange={onOpenChange} onCreated={onCreated} />
        <Toaster />
      </QueryClientProvider>,
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Demo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }))

    const notification = await screen.findByTestId('toast')
    expect(notification).toBeVisible()
    expect(notification).toHaveTextContent('Unable to create workspace')
    expect(notification).toHaveTextContent('Workspace limit reached')
    expect(notification).toHaveAttribute('data-variant', 'error')
    expect(screen.getByRole('dialog')).toBeVisible()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(onCreated).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create workspace' })).toBeEnabled())
  })

  it.each<[ToastEventInput, string]>([
    ['Saved', 'info'],
    [{ title: 'Saved', variant: 'default' }, 'info'],
    [{ title: 'Saved', variant: 'warning' }, 'info'],
    [{ title: 'Saved', variant: 'success' }, 'success'],
    [{ title: 'Saved', variant: 'error' }, 'error'],
  ])('delivers legacy input %j with a supported display variant', (input, variant) => {
    function Notify() {
      const { toast } = useToast()
      return <button onClick={() => toast(input)}>Notify</button>
    }
    render(<><Notify /><Toaster /></>)
    fireEvent.click(screen.getByRole('button', { name: 'Notify' }))
    const notification = screen.getByRole('status')
    expect(notification).toHaveTextContent('Saved')
    expect(notification).toHaveAttribute('data-variant', variant)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('status')).toBeNull()
  })
})
