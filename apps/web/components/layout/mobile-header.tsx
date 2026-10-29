'use client'

import * as React from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronLeft, Search } from 'lucide-react'
import { useBreadcrumbStore } from '@/stores/breadcrumb-store'
import { buildBreadcrumbs } from '@/lib/breadcrumbs'

interface MobileHeaderProps {
  onSearchOpen: () => void
}

/** Where a page's own row (the project page's folder and status chips) lands
 *  inside the capsule, so the screen carries one floating slab, not two. */
const SLOT_ID = 'ff-mobile-header-slot'

/**
 * Renders its children inside the phone header's capsule, under the title
 * row. A portal rather than a prop: the header lives in the dashboard layout
 * and the chips in a page several components down. Nothing renders until the
 * capsule is in the document, and nothing renders on the server.
 */
export function MobileHeaderSlot({ children }: { children: React.ReactNode }) {
  // The document is the external system here: null on the server and during
  // hydration, the capsule's slot once the client renders on its own.
  const target = React.useSyncExternalStore(subscribeNever, getSlot, getNoSlot)
  if (!target) return null
  return createPortal(children, target)
}

function subscribeNever() {
  return () => {}
}
function getSlot(): HTMLElement | null {
  return document.getElementById(SLOT_ID)
}
function getNoSlot(): HTMLElement | null {
  return null
}

/** The capsule's height in px, used by pages to pad their content below it. */
export const MOBILE_HEADER_PX = 52

/**
 * The phone shell's header: one floating capsule over the page with where
 * you are (the last breadcrumb), the way back (the crumb before it), and
 * search. It carries the same breadcrumb data as the desktop header, so a
 * page that registers a label for its UUID segment is titled here too.
 *
 * Positioned by the dashboard layout, which keeps the page scrolling under it
 * and pads the page's top by the capsule's height plus the status-bar inset.
 */
export function MobileHeader({ onSearchOpen }: MobileHeaderProps) {
  const pathname = usePathname()
  const { labels, extraCrumbs, hrefs } = useBreadcrumbStore()
  const crumbs = [
    ...buildBreadcrumbs(pathname, labels, hrefs),
    ...extraCrumbs.map((c) => ({ label: c.label, href: c.href ?? '' })),
  ]
  const current = crumbs[crumbs.length - 1]
  // The way back is the nearest earlier crumb that is a page. A section crumb
  // with no href (Settings) is skipped: from Settings › Profile the arrow goes
  // to Projects, not to a redirect that lands on the Admin tab.
  const parent = crumbs.length > 1 ? (crumbs.slice(0, -1).reverse().find((c) => c.href) ?? { label: 'Projects', href: '/projects' }) : null
  const trail = crumbs.length > 2 ? crumbs.slice(0, -1).map((c) => c.label).join(' › ') : null

  return (
    <header
      data-testid="mobile-header"
      className="ff-glass pointer-events-auto flex flex-col rounded-[26px] border border-white/10 px-1.5 pb-1.5"
    >
      <div className="flex h-[52px] items-center gap-0.5">
        {parent ? (
          <Link
            href={parent.href}
            aria-label={`Back to ${parent.label}`}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-text-primary active:bg-bg-hover"
          >
            <ChevronLeft className="h-6 w-6" />
          </Link>
        ) : (
          <span className="w-3 shrink-0" aria-hidden="true" />
        )}
        <div className="flex min-w-0 flex-1 flex-col justify-center">
          <h1 className="truncate text-[15px] font-semibold leading-tight text-text-primary">
            {current?.label ?? ''}
          </h1>
          {trail && (
            <span className="truncate text-[11px] leading-tight tracking-[0.01em] text-text-secondary">
              {trail}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onSearchOpen}
          aria-label="Search"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-text-primary active:bg-bg-hover"
        >
          <Search className="h-[21px] w-[21px]" />
        </button>
      </div>
      <div id={SLOT_ID} className="empty:hidden" />
    </header>
  )
}
