/** A full-page navigation, kept behind a function so tests can see it happen. */
export function redirectTo(url: string): void {
  window.location.href = url
}
