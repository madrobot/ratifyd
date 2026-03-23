import { describe, it, expect, beforeEach } from 'vitest'
import { createRoom } from './createRoom'
import { loadPeerId, loadSigningPrivateKey, loadSigningPublicKey, loadOaepPrivateKey, loadOaepPublicKeyB64, loadRoomKey } from '../crypto/storage'
import { ROLES, JWT_EXPIRY_SECONDS, STORAGE_KEYS } from '../../constants'

function parseFragment(): { token: string | null } {
  const hash = window.location.hash.slice(1)
  if (!hash) return { token: null }
  const params = new URLSearchParams(hash)
  return { token: params.get('token') }
}

function decodeJWTPayload(raw: string): Record<string, unknown> {
  const parts = raw.split('.')
  if (parts.length !== 3) throw new Error('Invalid JWT')
  const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '=')
  return JSON.parse(atob(padded)) as Record<string, unknown>
}

beforeEach(() => {
  localStorage.clear()
  window.location.hash = ''
})

describe('createRoom', () => {
  it('sets the URL fragment to #token=<jwt> with no other params', async () => {
    await createRoom()
    const hash = window.location.hash.slice(1)
    const params = new URLSearchParams(hash)
    expect(params.get('token')).not.toBeNull()
    // Ensure the only key in the fragment is "token"
    const keys = Array.from(params.keys())
    expect(keys).toEqual(['token'])
  })

  it('JWT payload has role=owner', async () => {
    await createRoom()
    const { token } = parseFragment()
    expect(token).not.toBeNull()
    const payload = decodeJWTPayload(token!)
    expect(payload.role).toBe(ROLES.OWNER)
  })

  it('JWT payload has a UUID room field', async () => {
    await createRoom()
    const { token } = parseFragment()
    const payload = decodeJWTPayload(token!)
    expect(typeof payload.room).toBe('string')
    expect((payload.room as string).length).toBeGreaterThan(0)
    // UUID format
    expect(payload.room).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
  })

  it('JWT payload iss matches the saved peerId', async () => {
    await createRoom()
    const peerId = loadPeerId()
    expect(peerId).not.toBeNull()
    const { token } = parseFragment()
    const payload = decodeJWTPayload(token!)
    expect(payload.iss).toBe(peerId)
  })

  it('JWT payload has a jti field', async () => {
    await createRoom()
    const { token } = parseFragment()
    const payload = decodeJWTPayload(token!)
    expect(typeof payload.jti).toBe('string')
    expect((payload.jti as string).length).toBeGreaterThan(0)
  })

  it('JWT payload exp - iat equals JWT_EXPIRY_SECONDS', async () => {
    await createRoom()
    const { token } = parseFragment()
    const payload = decodeJWTPayload(token!)
    expect((payload.exp as number) - (payload.iat as number)).toBe(JWT_EXPIRY_SECONDS)
  })

  it('saves signing keypair to localStorage under peerId', async () => {
    await createRoom()
    const peerId = loadPeerId()!
    const privKey = await loadSigningPrivateKey(peerId)
    const pubKey = await loadSigningPublicKey(peerId)
    expect(privKey).not.toBeNull()
    expect(pubKey).not.toBeNull()
  })

  it('saves OAEP keypair to localStorage under peerId', async () => {
    await createRoom()
    const peerId = loadPeerId()!
    const privKey = await loadOaepPrivateKey(peerId)
    const pubKeyB64 = loadOaepPublicKeyB64(peerId)
    expect(privKey).not.toBeNull()
    expect(pubKeyB64).not.toBeNull()
  })

  it('saves room key to localStorage under roomId from JWT', async () => {
    await createRoom()
    const { token } = parseFragment()
    const payload = decodeJWTPayload(token!)
    const roomId = payload.room as string
    const roomKey = await loadRoomKey(roomId)
    expect(roomKey).not.toBeNull()
  })

  it('does not put any public key in the URL', async () => {
    await createRoom()
    const hash = window.location.hash
    // Public keys are base64url-encoded SPKI blobs — they are long (>200 chars)
    // Verify no param value is a long base64url string that could be a key
    const params = new URLSearchParams(hash.slice(1))
    for (const [key, value] of params.entries()) {
      if (key !== 'token') {
        // Any non-token param with a long value is suspicious
        expect(value.length).toBeLessThan(200)
      }
    }
    // The token itself is the only thing in the URL — no separate pubkey param
    expect(params.has('signingPub')).toBe(false)
    expect(params.has('oaepPub')).toBe(false)
    expect(params.has('pubkey')).toBe(false)
  })

  it('generates distinct roomId and ownerId on each call', async () => {
    await createRoom()
    const peerId1 = loadPeerId()!
    const hash1 = window.location.hash

    localStorage.clear()
    window.location.hash = ''

    await createRoom()
    const peerId2 = loadPeerId()!
    const hash2 = window.location.hash

    expect(peerId1).not.toBe(peerId2)
    expect(hash1).not.toBe(hash2)
  })

  it('JWT is signed with the stored signing private key', async () => {
    await createRoom()
    const peerId = loadPeerId()!
    const pubKey = await loadSigningPublicKey(peerId)
    expect(pubKey).not.toBeNull()

    const { token } = parseFragment()
    const parts = token!.split('.')
    const sigB64 = parts[2].replace(/-/g, '+').replace(/_/g, '/')
    const padded = sigB64.padEnd(sigB64.length + ((4 - (sigB64.length % 4)) % 4), '=')
    const sigBuf = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))

    const verified = await crypto.subtle.verify(
      { name: 'RSASSA-PKCS1-v1_5' },
      pubKey!,
      sigBuf,
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    )
    expect(verified).toBe(true)
  })

  it('saves peerId to localStorage under the PEER_ID key', async () => {
    await createRoom()
    const peerId = localStorage.getItem(STORAGE_KEYS.PEER_ID)
    expect(peerId).not.toBeNull()
    expect(typeof peerId).toBe('string')
    expect(peerId!.length).toBeGreaterThan(0)
  })
})
