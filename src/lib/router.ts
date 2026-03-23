import type { ClaimToken, JWTHeader, JWTPayload } from '../constants'

export type Route = { route: 'landing'; token: null } | { route: 'room'; token: ClaimToken }

function decodeBase64url(str: string): string {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '=')
  return atob(padded)
}

function parseClaimToken(raw: string): ClaimToken | null {
  const parts = raw.split('.')
  if (parts.length !== 3) return null
  try {
    const header = JSON.parse(decodeBase64url(parts[0])) as JWTHeader
    const payload = JSON.parse(decodeBase64url(parts[1])) as JWTPayload
    const signature = parts[2]
    return { header, payload, signature, raw }
  } catch {
    return null
  }
}

/**
 * Parses the URL fragment.
 * Format: #token=<jwt>
 * Public keys are NEVER in the URL — DTLS WebRTC only.
 */
export function parseFragment(): Route {
  const hash = window.location.hash.slice(1)
  if (!hash) return { route: 'landing', token: null }
  const params = new URLSearchParams(hash)
  const raw = params.get('token')
  if (!raw) return { route: 'landing', token: null }
  const token = parseClaimToken(raw)
  if (!token) return { route: 'landing', token: null }
  return { route: 'room', token }
}

export function navigateToRoom(token: ClaimToken): void {
  const params = new URLSearchParams()
  params.set('token', token.raw)
  window.location.hash = params.toString()
}

export function buildInviteURL(token: ClaimToken): string {
  const params = new URLSearchParams()
  params.set('token', token.raw)
  return `${window.location.origin}${window.location.pathname}#${params.toString()}`
}
