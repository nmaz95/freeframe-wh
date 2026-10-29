import type { SheetState } from './mobile-comment-sheet'

/**
 * Where the sheet starts. On a portrait phone it opens at `half`: the media
 * is sized from its own ratio and fills a quarter of the screen at most, so
 * a sheet parked at `peek` left the rest black, and the comments are what
 * someone opening an asset on a phone came for. Anywhere the sheet is not the
 * comment surface the value is unused, and `peek` keeps it out of the way
 * should the viewport later shrink into sheet territory.
 */
export function initialSheetState(useSheet: boolean): SheetState {
  return useSheet ? 'half' : 'peek'
}
