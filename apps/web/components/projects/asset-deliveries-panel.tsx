'use client'

import * as React from 'react'
import useSWR from 'swr'
import { CloudUpload, ExternalLink, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import { cn, formatRelativeTime } from '@/lib/utils'
import type { DriveDelivery } from '@/types'

export function deliveriesKey(assetId: string) {
  return `/assets/${assetId}/deliveries`
}

/** The copies of an asset sent to Google Drive, newest first. */
export function AssetDeliveriesPanel({
  assetId,
  onSend,
  compact,
}: {
  assetId: string
  /** Offered as a button when present (editor and up, with Drive configured). */
  onSend?: () => void
  compact?: boolean
}) {
  const key = deliveriesKey(assetId)
  const { data, error } = useSWR<DriveDelivery[]>(key, (k: string) => api.get<DriveDelivery[]>(k), {
    // A copy in flight moves without a reload even when the event stream is quiet.
    refreshInterval: (latest) => (latest?.some((d) => d.status === 'queued' || d.status === 'uploading') ? 4000 : 0),
  })
  const rows = data ?? []

  return (
    <div className={cn('space-y-2', compact ? 'text-xs' : 'text-sm')} data-testid="deliveries-panel">
      {error && <p role="alert" className="text-xs text-status-error">Could not load deliveries.</p>}
      {data && rows.length === 0 && <p className="text-xs text-text-tertiary">Not sent to Google Drive yet.</p>}
      <ul className="divide-y divide-border">
        {rows.map((d) => (
          <li key={d.id} className="flex items-start gap-2 py-2 first:pt-0">
            <div className="min-w-0 flex-1">
              <p className="truncate text-text-primary">
                {d.folder_name} · <span className="text-text-secondary">{d.file_name}</span>
              </p>
              <p className="text-2xs text-text-tertiary">
                {d.user_name ?? 'Someone'} · {formatRelativeTime(d.created_at)}
                {d.version_number ? ` · v${d.version_number}` : ''}
                {d.status === 'failed' && d.error ? ` · ${d.error}` : ''}
              </p>
              {d.status === 'uploading' && (
                <div className="mt-1 h-1 w-full overflow-hidden rounded bg-bg-tertiary" role="progressbar" aria-valuenow={d.progress_percent} aria-valuemin={0} aria-valuemax={100} aria-label="Copy progress">
                  <div className="h-full bg-accent" style={{ width: `${d.progress_percent}%` }} />
                </div>
              )}
            </div>
            {d.status === 'done' && d.web_view_link && (
              <a
                href={d.web_view_link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-status-success/40 px-2 py-0.5 text-2xs text-status-success hover:bg-status-success/10"
              >
                Open <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {(d.status === 'queued' || d.status === 'uploading') && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-accent/40 px-2 py-0.5 text-2xs text-accent">
                <Loader2 className="h-3 w-3 animate-spin" /> {d.status === 'queued' ? 'Queued' : `${d.progress_percent}%`}
              </span>
            )}
            {d.status === 'failed' && (
              <span className="inline-flex shrink-0 items-center rounded-full border border-status-error/40 px-2 py-0.5 text-2xs text-status-error">Failed</span>
            )}
          </li>
        ))}
      </ul>
      {onSend && (
        <button
          type="button"
          onClick={onSend}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-text-primary hover:border-border-focus transition-colors"
        >
          <CloudUpload className="h-3.5 w-3.5" />
          Send to Google Drive…
        </button>
      )}
    </div>
  )
}
