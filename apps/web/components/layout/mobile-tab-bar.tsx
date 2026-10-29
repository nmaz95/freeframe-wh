'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Bell, Layers, Search, Upload } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import { useNotificationStore } from '@/stores/notification-store'
import { useUploadStore, visibleFiles, isOnItsWay } from '@/stores/upload-store'
import { useMobileShellStore } from '@/stores/mobile-shell-store'
import { Avatar } from '@/components/shared/avatar'
import { NotificationDrawer } from './notification-drawer'

/** The bar's height in px, without the home-indicator inset below it. Pages
 *  that scroll under it pad by this much (see `.pb-tabbar` in globals.css). */
export const TAB_BAR_PX = 64

interface MobileTabBarProps {
  onSearchOpen: () => void
}

/**
 * The phone shell's navigation: what the rail is above `md`, laid along the
 * bottom edge where a thumb reaches. Five stops, the same five the rail has,
 * with Uploads raised in the middle as the one tinted control on the screen.
 *
 * It yields its place while something else claims the bottom edge (the
 * selection bar of the asset grid, through the mobile shell store), so two
 * bars never stack. A `nav` landmark with the current page marked, so a
 * screen reader finds it the way it finds the rail.
 */
export function MobileTabBar({ onSearchOpen }: MobileTabBarProps) {
  const pathname = usePathname()
  const user = useAuthStore((s) => s.user)
  const { unreadCount, fetchNotifications } = useNotificationStore()
  const panelOpen = useUploadStore((s) => s.panelOpen)
  const togglePanel = useUploadStore((s) => s.togglePanel)
  const activeUploads = useUploadStore((s) => visibleFiles(s).filter(isOnItsWay).length)
  const claimed = useMobileShellStore((s) => s.tabBarClaims > 0)
  const [notifOpen, setNotifOpen] = React.useState(false)

  React.useEffect(() => {
    fetchNotifications()
  }, [fetchNotifications])

  const onProjects = pathname === '/projects' || pathname.startsWith('/projects/')
  const onProfile = pathname.startsWith('/settings')

  return (
    <>
      <NotificationDrawer open={notifOpen} onClose={() => setNotifOpen(false)} railCollapsed fullWidth />
      <nav
        aria-label="Main"
        data-testid="mobile-tab-bar"
        className={cn(
          'ff-glass border border-white/10 fixed left-3 right-3 bottom-safe [--ff-bottom:0.625rem] z-30 flex h-16 items-center rounded-full px-2 transition-[opacity,transform] duration-200',
          claimed && 'pointer-events-none translate-y-4 opacity-0',
        )}
        aria-hidden={claimed || undefined}
      >
        <TabLink href="/projects" label="Projects" active={onProjects && !notifOpen}>
          <Layers className="h-6 w-6" strokeWidth={onProjects ? 2 : 1.6} />
        </TabLink>
        <TabButton label="Search" onClick={onSearchOpen}>
          <Search className="h-6 w-6" strokeWidth={1.6} />
        </TabButton>
        {/* The raised, tinted stop: the uploads panel, with the count of
            files on their way. Tinted because it is the one action here that
            changes something; everything else navigates. */}
        <button
          type="button"
          onClick={togglePanel}
          aria-label={activeUploads > 0 ? `Uploads, ${activeUploads} in progress` : 'Uploads'}
          aria-pressed={panelOpen}
          className="relative mx-1 flex h-[54px] w-[54px] shrink-0 items-center justify-center rounded-full bg-accent text-text-inverse shadow-[0_6px_18px_rgba(0,0,0,.35),inset_0_1px_0_rgba(255,255,255,.35)] transition-transform active:scale-[0.97]"
        >
          <Upload className="h-6 w-6" strokeWidth={2.2} />
          {activeUploads > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-bg-primary bg-bg-primary px-1 text-[10px] font-bold text-text-primary">
              {activeUploads}
            </span>
          )}
        </button>
        <TabButton
          label="Notifications"
          onClick={() => setNotifOpen(true)}
          active={notifOpen}
          badge={unreadCount}
          ariaLabel={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        >
          <Bell className="h-6 w-6" strokeWidth={notifOpen ? 2 : 1.6} />
        </TabButton>
        <TabLink href="/settings/profile" label="Profile" active={onProfile}>
          <Avatar src={user?.avatar_url} name={user?.name ?? '?'} color={user?.avatar_color} size="sm" className="h-6 w-6 text-[9px]" />
        </TabLink>
      </nav>
    </>
  )
}

const stopClass =
  'flex h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-full text-[10px] font-medium transition-colors active:scale-[0.97]'

function TabLink({
  href,
  label,
  active,
  children,
}: {
  href: string
  label: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(stopClass, active ? 'text-text-primary' : 'text-text-secondary')}
    >
      {children}
      <span>{label}</span>
    </Link>
  )
}

function TabButton({
  label,
  onClick,
  active = false,
  badge = 0,
  ariaLabel,
  children,
}: {
  label: string
  onClick: () => void
  active?: boolean
  badge?: number
  ariaLabel?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={active || undefined}
      className={cn(stopClass, 'relative', active ? 'text-text-primary' : 'text-text-secondary')}
    >
      {children}
      <span>{label}</span>
      {badge > 0 && (
        <span className="absolute top-1.5 left-1/2 ml-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-status-error px-1 text-[11px] font-bold text-white">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  )
}
