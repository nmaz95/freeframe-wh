import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { DriveDelivery } from '@/types'

const h = vi.hoisted(() => ({ rows: [] as DriveDelivery[] }))
vi.mock('swr', () => ({ default: () => ({ data: h.rows, mutate: vi.fn() }), mutate: vi.fn() }))
vi.mock('@/lib/api', () => ({ api: { get: vi.fn() } }))

import { AssetDeliveriesPanel } from '../asset-deliveries-panel'

function row(over: Partial<DriveDelivery>): DriveDelivery {
  return {
    id: 'd', asset_id: 'a1', version_id: 'v1', version_number: 3, user_id: 'u', user_name: 'Nicolò Mazzurco',
    folder_id: 'f', folder_name: 'Consegne / Barilla', file_name: 'Spot 30s v3.mov', status: 'done', progress_percent: 100,
    drive_file_id: 'x', web_view_link: 'https://drive.google.com/file/d/x/view', error: null,
    created_at: new Date().toISOString(), updated_at: null, ...over,
  }
}

describe('AssetDeliveriesPanel', () => {
  beforeEach(() => { h.rows = [] })

  it('says when nothing was sent yet and offers to send', () => {
    const onSend = vi.fn()
    render(<AssetDeliveriesPanel assetId="a1" onSend={onSend} />)
    expect(screen.getByText('Not sent to Google Drive yet.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /send to google drive/i }))
    expect(onSend).toHaveBeenCalled()
  })

  it('lists each copy with where it went, who sent it, and how it ended', () => {
    h.rows = [
      row({ id: 'd1' }),
      row({ id: 'd2', status: 'uploading', progress_percent: 40, web_view_link: null }),
      row({ id: 'd3', status: 'failed', error: 'Google account disconnected', web_view_link: null }),
    ]
    render(<AssetDeliveriesPanel assetId="a1" />)
    expect(screen.getAllByText(/Consegne \/ Barilla/)).toHaveLength(3)
    expect(screen.getByRole('link', { name: /open/i })).toHaveAttribute('href', 'https://drive.google.com/file/d/x/view')
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40')
    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByText(/Google account disconnected/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /send to google drive/i })).not.toBeInTheDocument()
  })
})
