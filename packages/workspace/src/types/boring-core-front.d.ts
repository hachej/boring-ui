declare module "@boring/core/front/top-bar-slot" {
  import type { ReactNode } from "react"

  export function TopBarSlotProvider(props: {
    children: ReactNode
    slot: ReactNode
  }): ReactNode

  export function useTopBarSlot(): ReactNode | null
}
