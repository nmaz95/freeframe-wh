'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import type { AssetStatusDef } from '@/types'

/** A status's colour as a tint that stays opaque and readable on either
 *  theme, the way the accent's muted shade is made (lib/accent.ts). */
export function statusTint(color: string): string {
  return `color-mix(in srgb, ${color} 18%, var(--bg-secondary))`
}

type DotSize = 'sm' | 'md'

const dotSize: Record<DotSize, string> = {
  sm: 'h-2 w-2',
  md: 'h-2.5 w-2.5',
}

/** The coloured dot on its own: on a card's thumbnail, in a menu, in the sidebar. */
export function StatusDot({
  color,
  size = 'sm',
  className,
  title,
}: {
  color: string
  size?: DotSize
  className?: string
  title?: string
}) {
  return (
    <span
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      aria-label={title}
      title={title}
      className={cn('inline-block shrink-0 rounded-full', dotSize[size], className)}
      style={{ backgroundColor: color }}
    />
  )
}

/** The dot and the name in a pill tinted with the status's colour. */
export function StatusBadge({
  status,
  className,
}: {
  status: Pick<AssetStatusDef, 'name' | 'color'>
  className?: string
}) {
  return (
    <span
      data-testid="status-badge"
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-2xs font-medium text-text-primary',
        className,
      )}
      style={{ backgroundColor: statusTint(status.color) }}
    >
      <StatusDot color={status.color} />
      <span className="truncate">{status.name}</span>
    </span>
  )
}
