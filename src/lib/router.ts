import type { JWTToken } from '../constants'

export type Route =
  | { route: 'landing'; token: null }
  | { route: 'room';    token: JWTToken }

/**
 * Parses the URL fragment.
 * Format: #token=<jwt>
 * Public keys are NEVER in the URL — DTLS WebRTC only.
 */
export function parseFragment(): Route {
  const hash = window.location.hash.slice(1)
  if (!hash) return { route: 'landing', token: null }
  const params = new URLSearchParams(hash)
  const token  = params.get('token')
  if (!token) return { route: 'landing', token: null }
  return { route: 'room', token: token as JWTToken }
}

export function navigateToRoom(token: JWTToken): void {
  const params = new URLSearchParams()
  params.set('token', token)
  window.location.hash = params.toString()
}

export function buildInviteURL(token: JWTToken): string {
  const params = new URLSearchParams()
  params.set('token', token)
  return `${window.location.origin}${window.location.pathname}#${params.toString()}`
}
