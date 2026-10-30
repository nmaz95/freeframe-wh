'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Bell, Layers, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import { useNotificationStore } from '@/stores/notification-store'
import { useMobileShellStore } from '@/stores/mobile-shell-store'
import { Avatar } from '@/components/shared/avatar'

/** The bar's height in px, without the home-indicator inset below it. Pages
 *  that scroll under it pad by this much (see `.pb-tabbar` in globals.css). */
export const TAB_BAR_PX = 64

/** The stops, left to right. Projects is the centre, raised, in the accent. */
export type TabStop = 'search' | 'projects' | 'notifications' | 'profile'
const STOPS: TabStop[] = ['search', 'projects', 'notifications', 'profile']

/** Which stop a route belongs to; `null` for a route outside all of them. */
export function activeStopFor(pathname: string, searchOpen: boolean): TabStop | null {
  if (searchOpen) return 'search'
  if (pathname === '/notifications' || pathname.startsWith('/notifications/')) return 'notifications'
  if (pathname.startsWith('/settings')) return 'profile'
  if (pathname === '/projects' || pathname.startsWith('/projects/')) return 'projects'
  return null
}

interface MobileTabBarProps {
  onSearchOpen: () => void
  /** Whether the command palette is open: the Search stop reads as current. */
  searchOpen?: boolean
}

/**
 * The phone shell's navigation along the bottom edge, where a thumb reaches:
 * Search (the command palette), Projects (the centre, raised), Notifications
 * (a page on the phone, not the rail's drawer) and Profile. One pill slides
 * behind the current stop as the route changes, so moving between screens
 * reads as the same bar following you rather than a new bar each time.
 *
 * It yields its place while something else claims the bottom edge (the
 * selection bar of the asset grid, through the mobile shell store), so two
 * bars never stack. A `nav` landmark with the current page marked.
 */
export function MobileTabBar({ onSearchOpen, searchOpen = false }: MobileTabBarProps) {
  const pathname = usePathname()
  const user = useAuthStore((s) => s.user)
  const { unreadCount, fetchNotifications } = useNotificationStore()
  const claimed = useMobileShellStore((s) => s.tabBarClaims > 0)

  React.useEffect(() => {
    fetchNotifications()
  }, [fetchNotifications])

  const active = activeStopFor(pathname, searchOpen)
  const activeIndex = active ? STOPS.indexOf(active) : -1

  return (
    <nav
      aria-label="Main"
      data-testid="mobile-tab-bar"
      data-active={active ?? 'none'}
      className={cn(
        'ff-glass border border-white/10 fixed left-3 right-3 bottom-safe [--ff-bottom:0.625rem] z-30 h-16 rounded-full px-2 transition-[opacity,transform] duration-200',
        claimed && 'pointer-events-none translate-y-4 opacity-0',
      )}
      aria-hidden={claimed || undefined}
    >
      <div className="relative flex h-full items-center">
        {/* The sliding pill. Its width is one stop; translateX moves it by
            whole stops, so a route change animates it across the bar. Hidden
            (not moved) when no stop is current. */}
        <span
          aria-hidden="true"
          data-testid="tab-indicator"
          className={cn(
            'pointer-events-none absolute inset-y-1 left-0 w-1/4 rounded-full bg-white/[0.09] motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-spring',
            activeIndex < 0 && 'opacity-0',
          )}
          style={{ transform: `translateX(${Math.max(activeIndex, 0) * 100}%)` }}
        />
        <TabButton label="Search" onClick={onSearchOpen} active={active === 'search'}>
          <Search className="h-6 w-6" strokeWidth={active === 'search' ? 2 : 1.6} />
        </TabButton>
        {/* The centre stop, raised and tinted: where every session starts and
            where the way back always leads. */}
        <Link
          href="/projects"
          aria-current={active === 'projects' ? 'page' : undefined}
          className={cn(stopClass, 'gap-0', active === 'projects' ? 'text-text-primary' : 'text-text-secondary')}
        >
          <span
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-full transition-[transform,background-color] duration-200',
              active === 'projects'
                ? 'bg-accent text-text-inverse shadow-[0_6px_18px_rgba(0,0,0,.35),inset_0_1px_0_rgba(255,255,255,.35)]'
                : 'bg-white/[0.08] text-text-primary',
            )}
          >
            <Layers className="h-5 w-5" strokeWidth={2} />
          </span>
          <span>Projects</span>
        </Link>
        <TabLink
          href="/notifications"
          label="Notifications"
          active={active === 'notifications'}
          badge={unreadCount}
          ariaLabel={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        >
          <Bell className="h-6 w-6" strokeWidth={active === 'notifications' ? 2 : 1.6} />
        </TabLink>
        <TabLink href="/settings/profile" label="Profile" active={active === 'profile'}>
          <Avatar src={user?.avatar_url} name={user?.name ?? '?'} color={user?.avatar_color} size="sm" className="h-6 w-6 text-[9px]" />
        </TabLink>
      </div>
    </nav>
  )
}

const stopClass =
  'relative z-10 flex h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-full text-[10px] font-medium transition-colors active:scale-[0.97]'

function TabLink({
  href,
  label,
  active,
  badge = 0,
  ariaLabel,
  children,
}: {
  href: string
  label: string
  active: boolean
  badge?: number
  ariaLabel?: string
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      aria-current={active ? 'page' : undefined}
      className={cn(stopClass, active ? 'text-text-primary' : 'text-text-secondary')}
    >
      {children}
      <span>{label}</span>
      {badge > 0 && (
        <span className="absolute top-1.5 left-1/2 ml-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-status-error px-1 text-[11px] font-bold text-white">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </Link>
  )
}

function TabButton({
  label,
  onClick,
  active,
  children,
}: {
  label: string
  onClick: () => void
  active: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active || undefined}
      className={cn(stopClass, active ? 'text-text-primary' : 'text-text-secondary')}
    >
      {children}
      <span>{label}</span>
    </button>
  )
}
