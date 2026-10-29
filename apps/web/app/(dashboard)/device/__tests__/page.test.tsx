/**
 * /device reports what the browser says about the screen: viewport, scale,
 * orientation, safe-area insets and whether the app runs standalone.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/hooks/use-page-title', () => ({ usePageTitle: () => {} }))
vi.mock('@/components/shared/copy-button', () => ({
  CopyButton: ({ text }: { text: string }) => <button data-testid="copy" data-text={text}>Copy</button>,
}))

import DevicePage, { readDevice } from '../page'

describe('readDevice', () => {
  it('reads the insets from the probe’s padding and the viewport from the window', () => {
    const probe = document.createElement('div')
    probe.style.paddingTop = '59px'
    probe.style.paddingBottom = '34px'
    document.body.appendChild(probe)
    const r = readDevice(probe)
    expect(r.insets).toEqual({ top: 59, right: 0, bottom: 34, left: 0 })
    expect(r.viewport).toBe(`${window.innerWidth} × ${window.innerHeight}`)
    expect(r.standalone).toBe(false)
    probe.remove()
  })
})

describe('DevicePage', () => {
  it('lists the readings and offers them as text to copy', () => {
    render(<DevicePage />)
    const list = screen.getByTestId('device-readings')
    expect(list).toHaveTextContent('Viewport')
    expect(list).toHaveTextContent('Safe area')
    expect(list).toHaveTextContent('Standalone')
    expect(screen.getByTestId('copy').getAttribute('data-text')).toContain('safe area top')
  })
})
