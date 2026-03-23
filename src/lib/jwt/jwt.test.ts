import { describe, it, expect, vi, afterEach } from 'vitest'
import { mintJWT, decodeJWT, verifyJWT } from './index'
import { generateSigningKeyPair, exportSigningPublicKey, importSigningPublicKey } from '../crypto/signing'
import { ROLES } from '../../constants'
import type { JWTPayload } from '../../constants'

const makePayload = (overrides?: Partial<Omit<JWTPayload, 'iat' | 'exp' | 'jti'>>) => ({
  room: 'test-room',
  role: ROLES.OWNER,
  iss: 'peer-123',
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
    expect(typeof token.payload.jti).toBe('string')
    expect(token.payload.jti.length).toBeGreaterThan(0)
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

  it('generates unique jti each time', async () => {
    const pair = await generateSigningKeyPair()
    const token1 = await mintJWT(makePayload(), pair.privateKey)
    const token2 = await mintJWT(makePayload(), pair.privateKey)
    expect(token1.payload.jti).not.toBe(token2.payload.jti)
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
    expect(typeof decoded.payload.jti).toBe('string')
  })

  it('returns a ClaimToken with raw field matching input', async () => {
    const pair = await generateSigningKeyPair()
    const token = await mintJWT(makePayload(), pair.privateKey)
    const decoded = decodeJWT(token.raw)
    expect(decoded.raw).toBe(token.raw)
  })

  it('throws on malformed token (garbage string)', () => {
    expect(() => decodeJWT('not-a-jwt')).toThrow()
  })

  it('throws on wrong number of parts', () => {
    expect(() => decodeJWT('only.two')).toThrow()
  })
})

describe('verifyJWT', () => {
  it('verifies a valid ClaimToken', async () => {
    const pair = await generateSigningKeyPair()
    const token = await mintJWT(makePayload(), pair.privateKey)
    const result = await verifyJWT(token, pair.publicKey)
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.payload.room).toBe('test-room')
      expect(result.reason).toBeNull()
    }
  })

  it('returns INVALID_SIGNATURE for tampered payload', async () => {
    const pair = await generateSigningKeyPair()
    const token = await mintJWT(makePayload(), pair.privateKey)
    const parts = token.raw.split('.')
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    payload.role = 'guest'
    const tamperedPayload = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
    const tampered = decodeJWT(`${parts[0]}.${tamperedPayload}.${parts[2]}`)
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
    const result = await verifyJWT(token, pair2.publicKey)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.reason).toBe('INVALID_SIGNATURE')
    }
  })

  it('returns TOKEN_EXPIRED for expired token', async () => {
    const pair = await generateSigningKeyPair()
    const token = await mintJWT(makePayload(), pair.privateKey, 1)
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 2000)
    const result = await verifyJWT(token, pair.publicKey)
    vi.useRealTimers()
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.reason).toBe('TOKEN_EXPIRED')
    }
  })

  it('works with re-imported public key', async () => {
    const pair = await generateSigningKeyPair()
    const pubB64 = await exportSigningPublicKey(pair.publicKey)
    const importedPub = await importSigningPublicKey(pubB64)
    const token = await mintJWT(makePayload(), pair.privateKey)
    const result = await verifyJWT(token, importedPub)
    expect(result.valid).toBe(true)
  })

  it('correctly validates different roles', async () => {
    const pair = await generateSigningKeyPair()
    for (const role of [ROLES.OWNER, ROLES.MODERATOR, ROLES.GUEST]) {
      const token = await mintJWT(makePayload({ role }), pair.privateKey)
      const result = await verifyJWT(token, pair.publicKey)
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
