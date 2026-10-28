import { create } from 'zustand'

interface Crumb {
  label: string
  href?: string
}

interface BreadcrumbStore {
  /** Map of path segments (e.g. UUID) → display label */
  labels: Record<string, string>
  /** Extra crumbs injected after the URL-based crumbs (e.g. folder path) */
  extraCrumbs: Crumb[]
  /** Where a URL-based crumb points when not its own path (e.g. the project
   *  crumb keeping a status filter), by path segment */
  hrefs: Record<string, string>
  setLabel: (segment: string, label: string) => void
  setHref: (segment: string, href: string | null) => void
  setExtraCrumbs: (crumbs: Crumb[]) => void
  clearLabels: () => void
}

export const useBreadcrumbStore = create<BreadcrumbStore>((set) => ({
  labels: {},
  extraCrumbs: [],
  hrefs: {},
  setLabel: (segment, label) =>
    set((s) => ({ labels: { ...s.labels, [segment]: label } })),
  setHref: (segment, href) =>
    set((s) => {
      const hrefs = { ...s.hrefs }
      if (href) hrefs[segment] = href
      else delete hrefs[segment]
      return { hrefs }
    }),
  setExtraCrumbs: (extraCrumbs) => set({ extraCrumbs }),
  clearLabels: () => set({ labels: {}, extraCrumbs: [], hrefs: {} }),
}))
