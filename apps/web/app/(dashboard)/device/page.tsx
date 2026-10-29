'use client'

import * as React from 'react'
import { usePageTitle } from '@/hooks/use-page-title'
import { CopyButton } from '@/components/shared/copy-button'

interface DeviceReading {
  viewport: string
  screen: string
  scale: number
  orientation: string
  standalone: boolean
  insets: { top: number; right: number; bottom: number; left: number }
  pointer: string
  userAgent: string
}

/** Reads the four env(safe-area-inset-*) values the way CSS sees them: a
 *  probe padded by them, measured with getComputedStyle. */
function readInsets(probe: HTMLElement): DeviceReading['insets'] {
  const cs = getComputedStyle(probe)
  const px = (v: string) => Math.round(parseFloat(v) || 0)
  return { top: px(cs.paddingTop), right: px(cs.paddingRight), bottom: px(cs.paddingBottom), left: px(cs.paddingLeft) }
}

export function readDevice(probe: HTMLElement): DeviceReading {
  const landscape = window.matchMedia('(orientation: landscape)').matches
  return {
    viewport: `${window.innerWidth} × ${window.innerHeight}`,
    screen: `${window.screen.width} × ${window.screen.height}`,
    scale: window.devicePixelRatio,
    orientation: landscape ? 'landscape' : 'portrait',
    standalone:
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
    insets: readInsets(probe),
    pointer: window.matchMedia('(pointer: coarse)').matches ? 'coarse (touch)' : 'fine',
    userAgent: navigator.userAgent,
  }
}

function formatReading(r: DeviceReading): string {
  return [
    `viewport ${r.viewport} CSS px, scale ${r.scale}, ${r.orientation}`,
    `screen ${r.screen}`,
    `safe area top ${r.insets.top} right ${r.insets.right} bottom ${r.insets.bottom} left ${r.insets.left}`,
    `standalone ${r.standalone ? 'yes' : 'no'}, pointer ${r.pointer}`,
    r.userAgent,
  ].join('\n')
}

/**
 * /device: what this phone reports, for sizing the shell against real
 * numbers rather than data sheets. No link leads here; type the URL on the
 * device, screenshot it in each orientation, and read the values back. It
 * re-reads on resize and rotation.
 */
export default function DevicePage() {
  usePageTitle('Device')
  const probeRef = React.useRef<HTMLDivElement>(null)
  const [reading, setReading] = React.useState<DeviceReading | null>(null)

  React.useEffect(() => {
    const read = () => {
      if (probeRef.current) setReading(readDevice(probeRef.current))
    }
    read()
    window.addEventListener('resize', read)
    window.addEventListener('orientationchange', read)
    return () => {
      window.removeEventListener('resize', read)
      window.removeEventListener('orientationchange', read)
    }
  }, [])

  const rows: Array<[string, string]> = reading
    ? [
        ['Viewport', `${reading.viewport} CSS px`],
        ['Scale', `${reading.scale}×`],
        ['Screen', `${reading.screen}`],
        ['Orientation', reading.orientation],
        ['Safe area', `top ${reading.insets.top} · right ${reading.insets.right} · bottom ${reading.insets.bottom} · left ${reading.insets.left}`],
        ['Standalone', reading.standalone ? 'yes (installed app)' : 'no (browser tab)'],
        ['Pointer', reading.pointer],
      ]
    : []

  return (
    <div className="p-6 max-md:px-4 max-md:pt-2 max-w-xl space-y-4">
      <div
        ref={probeRef}
        aria-hidden="true"
        style={{
          position: 'absolute',
          visibility: 'hidden',
          paddingTop: 'env(safe-area-inset-top)',
          paddingRight: 'env(safe-area-inset-right)',
          paddingBottom: 'env(safe-area-inset-bottom)',
          paddingLeft: 'env(safe-area-inset-left)',
        }}
      />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">This device</h1>
          <p className="text-sm text-text-secondary mt-0.5">What the browser reports, for sizing the phone shell.</p>
        </div>
        {reading && <CopyButton text={formatReading(reading)} label="Copy" />}
      </div>
      <dl data-testid="device-readings" className="rounded-xl border border-border bg-bg-secondary divide-y divide-border">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-4 px-4 py-3">
            <dt className="text-sm text-text-secondary">{k}</dt>
            <dd className="text-sm font-medium text-text-primary text-right tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      {reading && (
        <p className="text-xs text-text-tertiary break-all">{reading.userAgent}</p>
      )}
    </div>
  )
}
