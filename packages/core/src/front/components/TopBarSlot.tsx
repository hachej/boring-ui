import { createContext, useContext, type ReactNode } from 'react'

const TopBarSlotContext = createContext<ReactNode | null>(null)

export function TopBarSlotProvider({
  children,
  slot,
}: {
  children: ReactNode
  slot: ReactNode
}) {
  return (
    <TopBarSlotContext.Provider value={slot}>
      {children}
    </TopBarSlotContext.Provider>
  )
}

export function useTopBarSlot(): ReactNode | null {
  return useContext(TopBarSlotContext)
}
