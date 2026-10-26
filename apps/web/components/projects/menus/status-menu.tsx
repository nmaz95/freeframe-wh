'use client'

import * as React from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronDown, ChevronRight, CircleDot } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  MenuItem, MenuSub, MenuSubContent, MenuSubTrigger, menuContentClass, menuItemClass,
  useAfterClose, useAfterCloseScheduler,
} from '@/components/shared/item-menu'
import { StatusDot } from '@/components/shared/status-badge'
import type { AssetStatusDef } from '@/types'

function StatusItems({
  statuses,
  currentId,
  onPick,
}: {
  statuses: AssetStatusDef[]
  currentId: string | null
  onPick: (status: AssetStatusDef) => void
}) {
  // A pick may open a confirmation, which must wait for the menu to close.
  const afterClose = useAfterCloseScheduler()
  return (
    <>
      {statuses.map((s) => {
        const active = s.id === currentId
        return (
          <MenuItem
            key={s.id}
            onSelect={() => {
              if (active) return
              if (afterClose) afterClose(() => onPick(s))
              else onPick(s)
            }}
            className={cn(menuItemClass, active && 'text-text-primary')}
            aria-checked={active}
            role="menuitemradio"
          >
            <StatusDot color={s.color} size="md" />
            <span className="flex-1 truncate">{s.name}</span>
            {active && <Check className="h-3.5 w-3.5 text-accent" />}
          </MenuItem>
        )
      })}
    </>
  )
}

/** "Set status ▸" inside an asset's ⋯ or right-click menu. */
export function StatusSubmenu({
  statuses,
  currentId,
  onPick,
}: {
  statuses: AssetStatusDef[]
  currentId: string | null
  onPick: (status: AssetStatusDef) => void
}) {
  if (statuses.length === 0) return null
  return (
    <MenuSub>
      <MenuSubTrigger className={cn(menuItemClass, 'data-[state=open]:bg-bg-hover data-[state=open]:text-text-primary')}>
        <CircleDot className="h-3.5 w-3.5 text-text-tertiary" />
        <span className="flex-1">Set status</span>
        <ChevronRight className="h-3.5 w-3.5 text-text-tertiary" />
      </MenuSubTrigger>
      <MenuSubContent sideOffset={6} className={menuContentClass} onClick={(e) => e.stopPropagation()}>
        <StatusItems statuses={statuses} currentId={currentId} onPick={onPick} />
      </MenuSubContent>
    </MenuSub>
  )
}

/**
 * The current status as a pill that opens the list, for the review header.
 * Read-only (no chevron, no menu) when the viewer may not change it.
 */
export function StatusDropdown({
  statuses,
  current,
  onPick,
  disabled,
  className,
}: {
  statuses: AssetStatusDef[]
  current: AssetStatusDef | null
  onPick: (status: AssetStatusDef) => void
  disabled?: boolean
  className?: string
}) {
  const { schedule, onCloseAutoFocus } = useAfterClose()
  if (!current) return null
  const pill = (
    <button
      type="button"
      aria-label={`Status: ${current.name}`}
      disabled={disabled}
      className={cn(
        'inline-flex max-w-[220px] items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-text-primary transition-colors outline-none',
        !disabled && 'hover:border-border-focus focus-visible:ring-2 focus-visible:ring-accent',
        disabled && 'cursor-default',
        className,
      )}
      style={{ backgroundColor: `color-mix(in srgb, ${current.color} 18%, var(--bg-secondary))` }}
    >
      <StatusDot color={current.color} />
      <span className="truncate">{current.name}</span>
      {!disabled && <ChevronDown className="h-3 w-3 opacity-70" />}
    </button>
  )
  if (disabled) return pill
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{pill}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className={menuContentClass}
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <StatusItems statuses={statuses} currentId={current.id} onPick={(s) => schedule(() => onPick(s))} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
