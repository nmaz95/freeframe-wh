'use client'

import * as React from 'react'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { StatusDot } from '@/components/shared/status-badge'
import type { AssetStatusDef } from '@/types'

/** Set for the browser session once "Don't ask again" was ticked. */
export const SKIP_STATUS_CONFIRM_KEY = 'ff-skip-status-confirm'

function skipWanted(): boolean {
  try {
    return sessionStorage.getItem(SKIP_STATUS_CONFIRM_KEY) === '1'
  } catch {
    return false
  }
}

function rememberSkip() {
  try {
    sessionStorage.setItem(SKIP_STATUS_CONFIRM_KEY, '1')
  } catch {
    // no storage: ask every time
  }
}

interface Pending {
  /** One asset by name, or several by count. */
  assetName?: string
  count?: number
  from: AssetStatusDef | null
  to: AssetStatusDef
  resolve: (ok: boolean) => void
}

/** What is being moved: an asset's name, or how many of them. */
export type StatusChangeSubject = string | { count: number }

/**
 * A confirmation before an asset's status changes, since the change tells
 * people. `confirmStatusChange` resolves true to go ahead; mount
 * `statusConfirmDialog` once on the page. Ticking "Don't ask again" skips the
 * dialog for the rest of the browser session, for single and bulk moves
 * alike: it is one question, "are you sure you want to tell people".
 */
export function useStatusChangeConfirm() {
  const [pending, setPending] = React.useState<Pending | null>(null)
  const [skip, setSkip] = React.useState(false)

  const confirmStatusChange = React.useCallback(
    (subject: StatusChangeSubject, from: AssetStatusDef | null, to: AssetStatusDef): Promise<boolean> => {
      if (skipWanted()) return Promise.resolve(true)
      return new Promise((resolve) => {
        setSkip(false)
        if (typeof subject === 'string') setPending({ assetName: subject, from, to, resolve })
        else setPending({ count: subject.count, from, to, resolve })
      })
    },
    [],
  )

  const close = (ok: boolean) => {
    pending?.resolve(ok)
    setPending(null)
  }

  const statusConfirmDialog = (
    <ConfirmDialog
      open={pending !== null}
      onOpenChange={(open) => { if (!open) close(false) }}
      title={pending ? (pending.count ? `Move ${pending.count} assets to ${pending.to.name}?` : `Move to ${pending.to.name}?`) : ''}
      description={
        pending
          ? pending.count
            ? `${pending.count} assets go to ${pending.to.name}. The people this status notifies will be told once.`
            : `“${pending.assetName}” goes${pending.from ? ` from ${pending.from.name}` : ''} to ${pending.to.name}. The people this status notifies will be told.`
          : undefined
      }
      confirmLabel="Change status"
      onConfirm={() => {
        if (skip) rememberSkip()
        close(true)
      }}
    >
      {pending && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            {pending.from && (
              <>
                <StatusDot color={pending.from.color} /> {pending.from.name}
                <span className="text-text-tertiary">→</span>
              </>
            )}
            <StatusDot color={pending.to.color} /> <span className="text-text-primary">{pending.to.name}</span>
          </div>
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} />
            Don&apos;t ask again
          </label>
        </div>
      )}
    </ConfirmDialog>
  )

  return { confirmStatusChange, statusConfirmDialog }
}
