'use client'

import * as React from 'react'
import { Check, Copy, X } from 'lucide-react'
import { copyToClipboard } from '@/lib/utils'
import { Button, type ButtonProps } from '@/components/ui/button'

export type CopyStatus = 'idle' | 'copied' | 'failed'

/** Copies `text` on demand and reports the outcome for two or three seconds. */
export function useCopyStatus(text: string) {
  const [status, setStatus] = React.useState<CopyStatus>('idle')

  async function copy() {
    const ok = await copyToClipboard(text)
    if (ok) {
      setStatus('copied')
      setTimeout(() => setStatus('idle'), 2000)
    } else {
      setStatus('failed')
      setTimeout(() => setStatus('idle'), 3000)
    }
  }

  return { status, copy }
}

export function CopyAnnouncer({ status }: { status: CopyStatus }) {
  return (
    <div className="sr-only" aria-live="polite" role="status">
      {status === 'copied' ? 'URL copied to clipboard' : status === 'failed' ? 'Copy failed' : ''}
    </div>
  )
}

/**
 * A button that copies `text`: an icon alone, or `label` that turns into
 * "Copied!" / "Failed" for a moment. Other props go to the Button.
 */
export function CopyButton({
  text,
  label,
  variant = 'secondary',
  size = 'sm',
  ...props
}: { text: string; label?: string } & Omit<ButtonProps, 'onClick' | 'children'>) {
  const { status, copy: handleCopy } = useCopyStatus(text)

  return (
    <>
      <CopyAnnouncer status={status} />
      <Button variant={variant} size={size} onClick={handleCopy} {...props}>
        {status === 'copied' ? (
          <>
            <Check className="h-3.5 w-3.5 text-status-success" />
            {label ? 'Copied!' : ''}
          </>
        ) : status === 'failed' ? (
          <>
            <X className="h-3.5 w-3.5 text-status-error" />
            {label ? 'Failed' : ''}
          </>
        ) : (
          <>
            <Copy className="h-3.5 w-3.5" />
            {label ?? ''}
          </>
        )}
      </Button>
    </>
  )
}
