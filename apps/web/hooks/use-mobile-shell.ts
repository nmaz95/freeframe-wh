'use client'

import { MEDIA_MD, useMediaQuery } from '@/hooks/use-media-query'

/** A landscape viewport. Paired with the width below it tells a phone held
 *  sideways from a tablet: the room is horizontal, not vertical. */
export const MEDIA_LANDSCAPE = '(orientation: landscape)'

/**
 * The three layout classes the mobile shell knows, from the same two media
 * queries the review screen already switches on, so the shell and the
 * review page can never disagree about what a phone is:
 *
 * - `phone`: below `md` (768px). The rail and header give way to the tab bar
 *   and the capsule header; comments live in a bottom sheet.
 * - `phoneLandscape`: the same width band held sideways. Still the phone
 *   shell, but the height is scarce, so the review page keeps comments beside
 *   the media rather than under it.
 * - above `md` the desktop shell applies unchanged; a tablet, or an unfolded
 *   phone, is a small desktop here.
 *
 * SSR renders the phone shell (the hook's server snapshot is `false` for a
 * min-width query), which is the safe direction: a desktop briefly drawn
 * narrow is a flicker, a phone drawn wide is a broken first paint.
 */
export function useMobileShell(): { isPhone: boolean; isPhoneLandscape: boolean } {
  const isWide = useMediaQuery(MEDIA_MD)
  const isLandscape = useMediaQuery(MEDIA_LANDSCAPE)
  return { isPhone: !isWide, isPhoneLandscape: !isWide && isLandscape }
}
