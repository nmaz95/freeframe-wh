/**
 * Where the comment sheet starts: open at half on a portrait phone (where it
 * is the comment surface), parked at peek anywhere it is not.
 */
import { describe, it, expect } from 'vitest'
import { initialSheetState } from '../sheet-state'
import { PEEK_PX } from '../mobile-comment-sheet'

describe('initialSheetState', () => {
  it('opens at half where the sheet is the comment surface', () => {
    expect(initialSheetState(true)).toBe('half')
  })
  it('stays at peek elsewhere', () => {
    expect(initialSheetState(false)).toBe('peek')
  })
  it('keeps the peek band the review wrappers reserve', () => {
    expect(PEEK_PX).toBe(56)
  })
})
