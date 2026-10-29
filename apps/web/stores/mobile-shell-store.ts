import { create } from 'zustand'

interface MobileShellStore {
  /** How many surfaces currently want the tab bar out of the way (a selection
   *  bar standing in its place, say). Counted rather than a boolean so two
   *  claimants cannot un-hide it for each other. */
  tabBarClaims: number
  /** Takes the tab bar's place; returns the release. Pair it with an effect. */
  claimTabBar: () => () => void
}

/**
 * What the phone shell's chrome and a page need to agree on without a prop
 * chain through the layout. The tab bar lives in the dashboard layout; the
 * selection bar that replaces it while items are selected lives inside the
 * asset grid, several components down.
 */
export const useMobileShellStore = create<MobileShellStore>((set) => ({
  tabBarClaims: 0,
  claimTabBar: () => {
    set((s) => ({ tabBarClaims: s.tabBarClaims + 1 }))
    let released = false
    return () => {
      if (released) return
      released = true
      set((s) => ({ tabBarClaims: Math.max(0, s.tabBarClaims - 1) }))
    }
  },
}))
