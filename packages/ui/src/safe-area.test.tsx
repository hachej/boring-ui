// @vitest-environment jsdom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { AlertDialog, AlertDialogContent } from './alert-dialog'
import { Dialog, DialogContent } from './dialog'
import { Sheet, SheetContent } from './sheet'
import { Toaster } from './toast'

// These primitives only render through a portal once mounted, so assertions run against
// the live document rather than a server-rendered string.
function mount(node: React.ReactNode): () => void {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    root.render(node)
  })
  return () => {
    act(() => {
      root.unmount()
    })
    host.remove()
  }
}

function classesOf(selector: string): string {
  const el = document.querySelector(selector)
  if (!el) throw new Error(`missing element: ${selector}`)
  return el.className
}

describe('safe-area and keyboard insets', () => {
  it('pads sheet content away from the notch and home indicator on every side', () => {
    const sides = ['top', 'right', 'bottom', 'left'] as const
    const expected: Record<(typeof sides)[number], string[]> = {
      top: ['pt-[env(safe-area-inset-top,0px)]', 'pl-[env(safe-area-inset-left,0px)]'],
      right: ['pt-[env(safe-area-inset-top,0px)]', 'pr-[env(safe-area-inset-right,0px)]', 'pb-[env(safe-area-inset-bottom,0px)]'],
      bottom: ['pb-[calc(1rem+env(safe-area-inset-bottom,0px))]', 'pr-[env(safe-area-inset-right,0px)]', 'pl-[env(safe-area-inset-left,0px)]'],
      left: ['pt-[env(safe-area-inset-top,0px)]', 'pl-[env(safe-area-inset-left,0px)]', 'pb-[env(safe-area-inset-bottom,0px)]'],
    }

    for (const side of sides) {
      const unmount = mount(
        <Sheet open>
          <SheetContent side={side}>content</SheetContent>
        </Sheet>,
      )
      const className = classesOf('[data-slot="sheet-content"]')
      for (const cls of expected[side]) expect(className, side).toContain(cls)
      // The background/border must still bleed to the physical edge: insets are padding,
      // never margin or an offset from the anchored edge.
      expect(className, side).toContain('bg-background')
      unmount()
    }
  })

  it('top-aligns dialogs on compact viewports and re-centres from sm up', () => {
    const unmount = mount(
      <Dialog open>
        <DialogContent>body</DialogContent>
      </Dialog>,
    )
    const className = classesOf('[data-slot="dialog-content"]')
    expect(className).toContain('top-[max(1rem,env(safe-area-inset-top,0px))]')
    expect(className).toContain('translate-y-0')
    expect(className).toContain('sm:top-[50%]')
    expect(className).toContain('sm:translate-y-[-50%]')
    // Height cap only subtracts the keyboard inset, so full-bleed h-[100dvh] consumers
    // are unaffected while a raised keyboard shrinks the dialog instead of hiding it.
    expect(className).toContain('max-h-[calc(100dvh-var(--keyboard-inset,0px))]')
    unmount()
  })

  it('gives alert dialogs the same compact top-anchor and keyboard height cap as dialogs', () => {
    const unmount = mount(
      <AlertDialog open>
        <AlertDialogContent>confirm</AlertDialogContent>
      </AlertDialog>,
    )
    const className = classesOf('[data-slot="alert-dialog-content"]')
    expect(className).toContain('top-[max(1rem,env(safe-area-inset-top,0px))]')
    expect(className).toContain('translate-y-0')
    expect(className).toContain('sm:top-[50%]')
    expect(className).toContain('sm:translate-y-[-50%]')
    expect(className).toContain('max-h-[calc(100dvh-var(--keyboard-inset,0px))]')
    unmount()
  })

  it('keeps toasts out of the home-indicator gesture strip in every position', () => {
    const positions = {
      'bottom-right': ['bottom-[calc(1rem+env(safe-area-inset-bottom,0px))]', 'right-[calc(1rem+env(safe-area-inset-right,0px))]'],
      'bottom-left': ['bottom-[calc(1rem+env(safe-area-inset-bottom,0px))]', 'left-[calc(1rem+env(safe-area-inset-left,0px))]'],
      'top-right': ['top-[calc(1rem+env(safe-area-inset-top,0px))]', 'right-[calc(1rem+env(safe-area-inset-right,0px))]'],
      'top-left': ['top-[calc(1rem+env(safe-area-inset-top,0px))]', 'left-[calc(1rem+env(safe-area-inset-left,0px))]'],
    } as const

    for (const [position, expected] of Object.entries(positions)) {
      const unmount = mount(<Toaster position={position as keyof typeof positions} />)
      const className = classesOf('[data-testid="toaster"]')
      for (const cls of expected) expect(className, position).toContain(cls)
      unmount()
    }
  })
})
