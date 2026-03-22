import { describe, it, expect, vi, afterEach } from 'vitest'
import { mintJWT, decodeJWT, verifyJWT } from './index'
import { generateSigningKeyPair, exportSigningKey, importSigningPublicKey } from '../crypto/signing'
import { ROLES } from '../../constants'
import type { JWTPayload } from '../../constants'

const makePayload = (overrides?: Partial<Omit<JWTPayload, 'iat' | 'exp'>>) => ({
  room: 'test-room',
  role: ROLES.OWNER,
  iss: 'peer-123',
  jti: 'unique-id-1',
  ...overrides,
})

describe('mintJWT', () => {
  it('returns a ClaimToken with header, payload, signature, and raw', async () => {
    const pair = await generateSigningKeyPair()
    const token = await mintJWT(makePayload(), pair.privateKey)
    expect(token.header).toEqual({ alg: 'RS256', typ: 'JWT' })
    expect(token.payload.room).toBe('test-room')
    expect(token.payload.role).toBe('owner')
    expect(token.payload.iss).toBe('peer-123')
    expect(token.payload.jti).toBe('unique-id-1')
    expect(typeof token.payload.iat).toBe('number')
    expect(typeof token.payload.exp).toBe('number')
    expect(typeof token.signature).toBe('string')
    expect(typeof token.raw).toBe('string')
  })

  it('raw string has three dot-separated parts', async () => {
    const pair = await generateSigningKeyPair()
    const token = await mintJWT(makePayload(), pair.privateKey)
    expect(token.raw.split('.')).toHaveLength(3)
  })

  it('sets iat to current time', async () => {
    const pair = await generateSigningKeyPair()
    const before = Math.floor(Date.now() / 1000)
    const token = await mintJWT(makePayload(), pair.privateKey)
    const after = Math.floor(Date.now() / 1000)
    expect(token.payload.iat).toBeGreaterThanOrEqual(before)
    expect(token.payload.iat).toBeLessThanOrEqual(after)
  })

  it('sets exp based on expirySeconds', async () => {
    const pair = await generateSigningKeyPair()
    const token = await mintJWT(makePayload(), pair.privateKey, 3600)
    expect(token.payload.exp - token.payload.iat).toBe(3600)
  })

  it('defaults to 86400 second expiry', async () => {
    const pair = await generateSigningKeyPair()
    const token = await mintJWT(makePayload(), pair.privateKey)
    expect(token.payload.exp - token.payload.iat).toBe(86400)
  })

  it('preserves all roles correctly', async () => {
    const pair = await generateSigningKeyPair()
    for (const role of [ROLES.OWNER, ROLES.MODERATOR, ROLES.GUEST]) {
      const token = await mintJWT(makePayload({ role }), pair.privateKey)
      expect(token.payload.role).toBe(role)
    }
  })
})

describe('decodeJWT', () => {
  it('decodes a minted token', async () => {
    const pair = await generateSigningKeyPair()
    const token = await mintJWT(makePayload(), pair.privateKey)
    const decoded = decodeJWT(token.raw)
    expect(decoded.header).toEqual({ alg: 'RS256', typ: 'JWT' })
    expect(decoded.payload.room).toBe('test-room')
    expect(decoded.payload.role).toBe('owner')
    expect(decoded.payload.iss).toBe('peer-123')
    expect(decoded.payload.jti).toBe('unique-id-1')
  })

  it('returns a ClaimToken with raw field matching input', async () => {
    const pair = await generateSigningKeyPair()
    const token = await mintJWT(makePayload(), pair.privateKey)
    const decoded = decodeJWT(token.raw)
    expect(decoded.raw).toBe(token.raw)
  })

  it('throws on malformed token', () => {
    expect(() => decodeJWT('not-a-jwt')).toThrow()
  })
})

describe('verifyJWT', () => {
  it('verifies a valid token from raw string', async () => {
    const pair = await generateSigningKeyPair()
    const token = await mintJWT(makePayload(), pair.privateKey)
    const result = await verifyJWT(token.raw, pair.publicKey)
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.payload.room).toBe('test-room')
      expect(result.reason).toBeNull()
    }
  })

  it('verifies a valid ClaimToken object', async () => {
    const pair = await generateSigningKeyPair()
    const token = await mintJWT(makePayload(), pair.privateKey)
    const result = await verifyJWT(token, pair.publicKey)
    expect(result.valid).toBe(true)
  })

  it('returns INVALID_SIGNATURE for tampered payload', async () => {
    const pair = await generateSigningKeyPair()
    const token = await mintJWT(makePayload(), pair.privateKey)
    // Tamper with the payload part
    const parts = token.raw.split('.')
    // Decode payload, modify, re-encode
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    payload.role = 'guest'
    const tamperedPayload = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
    const tampered = `${parts[0]}.${tamperedPayload}.${parts[2]}`
    const result = await verifyJWT(tampered, pair.publicKey)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.reason).toBe('INVALID_SIGNATURE')
      expect(result.payload).toBeNull()
    }
  })

  it('returns INVALID_SIGNATURE for wrong public key', async () => {
    const pair1 = await generateSigningKeyPair()
    const pair2 = await generateSigningKeyPair()
    const token = await mintJWT(makePayload(), pair1.privateKey)
    const result = await verifyJWT(token.raw, pair2.publicKey)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.reason).toBe('INVALID_SIGNATURE')
    }
  })

  it('returns TOKEN_EXPIRED for expired token', async () => {
    const pair = await generateSigningKeyPair()
    // Mint with 1-second expiry
    const token = await mintJWT(makePayload(), pair.privateKey, 1)
    // Fast-forward time by 2 seconds
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 2000)
    const result = await verifyJWT(token.raw, pair.publicKey)
    vi.useRealTimers()
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.reason).toBe('TOKEN_EXPIRED')
    }
  })

  it('returns MALFORMED_TOKEN for garbage input', async () => {
    const pair = await generateSigningKeyPair()
    const result = await verifyJWT('not.a.jwt', pair.publicKey)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.reason).toBe('MALFORMED_TOKEN')
    }
  })

  it('returns MALFORMED_TOKEN for wrong number of parts', async () => {
    const pair = await generateSigningKeyPair()
    const result = await verifyJWT('only.two', pair.publicKey)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.reason).toBe('MALFORMED_TOKEN')
    }
  })

  it('works with re-imported public key', async () => {
    const pair = await generateSigningKeyPair()
    const pubB64 = await exportSigningKey(pair.publicKey, 'public')
    const importedPub = await importSigningPublicKey(pubB64)
    const token = await mintJWT(makePayload(), pair.privateKey)
    const result = await verifyJWT(token.raw, importedPub)
    expect(result.valid).toBe(true)
  })

  it('correctly validates different roles', async () => {
    const pair = await generateSigningKeyPair()
    for (const role of [ROLES.OWNER, ROLES.MODERATOR, ROLES.GUEST]) {
      const token = await mintJWT(makePayload({ role }), pair.privateKey)
      const result = await verifyJWT(token.raw, pair.publicKey)
      expect(result.valid).toBe(true)
      if (result.valid) {
        expect(result.payload.role).toBe(role)
      }
    }
  })
})

afterEach(() => {
  vi.useRealTimers()
})
