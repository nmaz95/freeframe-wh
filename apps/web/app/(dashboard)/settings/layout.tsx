'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { User, Bell, Shield, Palette } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

interface SettingsNavItem {
  href: string
  label: string
  icon: React.ElementType
  adminOnly?: boolean
}

const settingsNavItems: SettingsNavItem[] = [
  { href: '/settings/profile', label: 'Profile', icon: User },
  { href: '/settings/appearance', label: 'Appearance', icon: Palette },
  { href: '/settings/notifications', label: 'Notifications', icon: Bell },
  { href: '/settings/admin', label: 'Admin', icon: Shield, adminOnly: true },
]

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const { user, isSuperAdmin } = useAuthStore()

  return (
    <div className="flex h-full max-md:flex-col">
      {/* The same tabs as a row of chips on the phone, where a 224px column
          would leave no room for the page. */}
      <nav aria-label="Settings" className="md:hidden flex gap-2 overflow-x-auto px-4 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {settingsNavItems.map((item) => {
          if (item.adminOnly && !isSuperAdmin) return null
          const isActive = pathname === item.href || pathname?.startsWith(item.href + '/')
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'inline-flex h-[34px] shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium whitespace-nowrap',
                isActive ? 'border-accent/50 bg-accent/20 text-text-primary' : 'border-white/10 bg-white/[0.06] text-text-secondary',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {item.label}
            </Link>
          )
        })}
      </nav>
      {/* Settings Sidebar */}
      <aside className="w-56 border-r border-border bg-bg-secondary shrink-0 max-md:hidden">
        <div className="p-4 border-b border-border">
          <h2 className="text-sm font-semibold text-text-primary">Settings</h2>
          <p className="text-xs text-text-tertiary mt-0.5">
            {user?.name ?? 'User'}
          </p>
        </div>

        <nav className="p-2 space-y-0.5">
          {settingsNavItems.map((item) => {
            // Hide admin-only items from non-admins
            if (item.adminOnly && !isSuperAdmin) return null

            const isActive = pathname === item.href || pathname?.startsWith(item.href + '/')
            const Icon = item.icon

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
                  isActive
                    ? 'bg-bg-hover text-text-primary font-medium'
                    : 'text-text-secondary hover:bg-bg-hover/70 hover:text-text-primary',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </Link>
            )
          })}
        </nav>
      </aside>

      {/* Settings Content */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  )
}
