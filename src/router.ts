export type Route = { route: 'landing'; token: null } | { route: 'room'; token: string }

/**
 * Parses the URL fragment.
 * Format: #token=<jwt>
 * Public keys are NEVER in the URL — DTLS WebRTC only.
 */
export function parseFragment(): Route {
  const hash = window.location.hash.slice(1)
  if (!hash) return { route: 'landing', token: null }
  const params = new URLSearchParams(hash)
  const token = params.get('token')
  if (!token) return { route: 'landing', token: null }
  return { route: 'room', token }
}
