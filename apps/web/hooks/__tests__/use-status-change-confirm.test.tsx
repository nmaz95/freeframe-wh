import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import * as React from 'react'
import { useStatusChangeConfirm, SKIP_STATUS_CONFIRM_KEY } from '@/hooks/use-status-change-confirm'
import type { AssetStatusDef } from '@/types'

const noStatus = { id: 's0', name: 'No Status', color: '#8b8fa3' } as AssetStatusDef
const pmReview = { id: 's1', name: 'Needs PM Review', color: '#3b82f6' } as AssetStatusDef

/** A page that asks before "changing" and records the answer. */
function Page({ onAnswer }: { onAnswer: (ok: boolean) => void }) {
  const { confirmStatusChange, statusConfirmDialog } = useStatusChangeConfirm()
  return (
    <div>
      <button onClick={async () => onAnswer(await confirmStatusChange('Spot 30s', noStatus, pmReview))}>change</button>
      <button onClick={async () => onAnswer(await confirmStatusChange({ count: 12 }, null, pmReview))}>change many</button>
      {statusConfirmDialog}
    </div>
  )
}

describe('useStatusChangeConfirm', () => {
  beforeEach(() => sessionStorage.clear())

  it('asks, names the move, and resolves true on confirm', async () => {
    const answers: boolean[] = []
    render(<Page onAnswer={(ok) => answers.push(ok)} />)
    fireEvent.click(screen.getByText('change'))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Move to Needs PM Review?')
    expect(dialog).toHaveTextContent('“Spot 30s” goes from No Status to Needs PM Review.')
    fireEvent.click(screen.getByRole('button', { name: 'Change status' }))
    await waitFor(() => expect(answers).toEqual([true]))
    expect(sessionStorage.getItem(SKIP_STATUS_CONFIRM_KEY)).toBeNull()
  })

  it('resolves false when cancelled', async () => {
    const answers: boolean[] = []
    render(<Page onAnswer={(ok) => answers.push(ok)} />)
    fireEvent.click(screen.getByText('change'))
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(answers).toEqual([false]))
  })

  it("remembers 'Don't ask again' for the session and skips the dialog afterwards", async () => {
    const answers: boolean[] = []
    render(<Page onAnswer={(ok) => answers.push(ok)} />)
    fireEvent.click(screen.getByText('change'))
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByLabelText("Don't ask again"))
    fireEvent.click(screen.getByRole('button', { name: 'Change status' }))
    await waitFor(() => expect(answers).toEqual([true]))
    expect(sessionStorage.getItem(SKIP_STATUS_CONFIRM_KEY)).toBe('1')

    await act(async () => { fireEvent.click(screen.getByText('change')) })
    await waitFor(() => expect(answers).toEqual([true, true]))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('asks once for several assets, by count', async () => {
    const answers: boolean[] = []
    render(<Page onAnswer={(ok) => answers.push(ok)} />)
    fireEvent.click(screen.getByText('change many'))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Move 12 assets to Needs PM Review?')
    expect(dialog).toHaveTextContent('12 assets go to Needs PM Review. The people this status notifies will be told once.')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(answers).toEqual([false]))
  })

  it("the session's 'Don't ask again' covers bulk moves too", async () => {
    sessionStorage.setItem(SKIP_STATUS_CONFIRM_KEY, '1')
    const answers: boolean[] = []
    render(<Page onAnswer={(ok) => answers.push(ok)} />)
    await act(async () => { fireEvent.click(screen.getByText('change many')) })
    await waitFor(() => expect(answers).toEqual([true]))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
