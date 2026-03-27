import { describe, it, expect, beforeAll } from 'vitest'
import { Claim } from './Claim'
import { Identity } from './Identity'
import { TokenError } from './error/TokenError'
import { ROLES } from '../constants'
import { bufferToBase64url, base64urlToBuffer } from './helper'

// ---------------------------------------------------------------------------
// Shared identity — RSA key generation is expensive; create once per suite
// ---------------------------------------------------------------------------
let identity: Identity

beforeAll(async () => {
  identity = await Identity.create('test-user')
})

// ---------------------------------------------------------------------------
// Helper: mint a standard valid claim
// ---------------------------------------------------------------------------
async function mintValid(): Promise<Claim> {
  return Claim.mint(
    'user-sub',
    'room-abc',
    ROLES.OWNER,
    'iss-server',
    identity.signingPublicKey,
    (data) => identity.sign(data instanceof ArrayBuffer ? data : (data as ArrayBufferView).buffer),
  )
}

// ---------------------------------------------------------------------------
// Helper: craft a raw JWT with an arbitrary payload without signing it with
// the real key (uses a different identity so the sig is valid but the key
// won't match when verified with `identity`).
// ---------------------------------------------------------------------------
async function craftTokenWithPayload(payload: Record<string, unknown>): Promise<string> {
  const otherIdentity = await Identity.create('other')
  const header = { alg: 'RS256', typ: 'JWT' }
  const encodeB64url = (obj: unknown) =>
    bufferToBase64url(new TextEncoder().encode(JSON.stringify(obj)).buffer as ArrayBuffer)
  const h = encodeB64url(header)
  const p = encodeB64url(payload)
  const input = `${h}.${p}`
  const sigBuf = await otherIdentity.sign(new TextEncoder().encode(input).buffer)
  const sig = bufferToBase64url(sigBuf)
  return `${input}.${sig}`
}

// ---------------------------------------------------------------------------
// Helper: craft a token signed with the CORRECT identity but a custom payload
// ---------------------------------------------------------------------------
async function craftTokenSignedByIdentity(payload: Record<string, unknown>): Promise<string> {
  const header = { alg: 'RS256', typ: 'JWT' }
  const encodeB64url = (obj: unknown) =>
    bufferToBase64url(new TextEncoder().encode(JSON.stringify(obj)).buffer as ArrayBuffer)
  const h = encodeB64url(header)
  const p = encodeB64url(payload)
  const input = `${h}.${p}`
  const sigBuf = await identity.sign(new TextEncoder().encode(input).buffer)
  const sig = bufferToBase64url(sigBuf)
  return `${input}.${sig}`
}

// ---------------------------------------------------------------------------
// Claim.mint()
// ---------------------------------------------------------------------------
describe('Claim.mint()', () => {
  it('produces a token with correct sub, room, role, iss fields', async () => {
    const claim = await mintValid()
    expect(claim.sub).toBe('user-sub')
    expect(claim.room).toBe('room-abc')
    expect(claim.role).toBe(ROLES.OWNER)
    expect(claim.issuer).toBe('iss-server')
  })

  it('produces a token with a jti that is a valid UUID', async () => {
    const claim = await mintValid()
    expect(claim.jti).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('produces a token with iat approximately equal to now', async () => {
    const before = Math.floor(Date.now() / 1000)
    const claim = await mintValid()
    const after = Math.floor(Date.now() / 1000)
    expect(claim.issuedAt).toBeGreaterThanOrEqual(before)
    expect(claim.issuedAt).toBeLessThanOrEqual(after)
  })

  it('produces a token with exp = iat + 86400 (default)', async () => {
    const claim = await mintValid()
    expect(claim.expiry).toBe(claim.issuedAt + 86400)
  })

  it('respects a custom expirySeconds argument', async () => {
    const claim = await Claim.mint(
      'sub',
      'room',
      ROLES.GUEST,
      'iss',
      identity.signingPublicKey,
      (data) =>
        identity.sign(data instanceof ArrayBuffer ? data : (data as ArrayBufferView).buffer),
      3600,
    )
    expect(claim.expiry).toBe(claim.issuedAt + 3600)
  })

  it('produces a raw token that is three dot-separated base64url segments', async () => {
    const claim = await mintValid()
    const parts = claim.raw.split('.')
    expect(parts).toHaveLength(3)
    expect(parts.every((p) => /^[A-Za-z0-9_-]+$/.test(p))).toBe(true)
  })

  it('produces a verifiable token (round-trip with Claim.verify)', async () => {
    const claim = await mintValid()
    await expect(Claim.verify(claim.raw, identity.signingPublicKey)).resolves.toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Claim.verify()
// ---------------------------------------------------------------------------
describe('Claim.verify()', () => {
  it('succeeds with the correct public key', async () => {
    const claim = await mintValid()
    const verified = await Claim.verify(claim.raw, identity.signingPublicKey)
    expect(verified.sub).toBe('user-sub')
    expect(verified.role).toBe(ROLES.OWNER)
  })

  it('throws TokenError when the signature is tampered (bit flip)', async () => {
    const claim = await mintValid()
    const parts = claim.raw.split('.')
    // Decode the sig bytes, flip a bit, re-encode
    const sigBytes = new Uint8Array(base64urlToBuffer(parts[2]))
    sigBytes[0] ^= 0x01
    const tampered = `${parts[0]}.${parts[1]}.${bufferToBase64url(sigBytes.buffer as ArrayBuffer)}`
    await expect(Claim.verify(tampered, identity.signingPublicKey)).rejects.toThrow(TokenError)
  })

  it('throws TokenError with "Invalid token signature" for tampered token', async () => {
    const claim = await mintValid()
    const parts = claim.raw.split('.')
    const sigBytes = new Uint8Array(base64urlToBuffer(parts[2]))
    sigBytes[0] ^= 0xff
    const tampered = `${parts[0]}.${parts[1]}.${bufferToBase64url(sigBytes.buffer as ArrayBuffer)}`
    await expect(Claim.verify(tampered, identity.signingPublicKey)).rejects.toThrow(
      'Invalid token signature',
    )
  })

  it('throws TokenError for expired token (exp in the past)', async () => {
    const now = Math.floor(Date.now() / 1000)
    const expiredPayload = {
      sub: 'sub',
      room: 'room',
      role: ROLES.OWNER,
      iss: 'iss',
      jti: crypto.randomUUID(),
      iat: now - 7200,
      exp: now - 3600, // expired 1 hour ago
    }
    const expiredToken = await craftTokenSignedByIdentity(expiredPayload)
    // Verify should succeed signature-wise but the claim's getters will reflect the expired state.
    // Claim.verify itself does NOT check expiry — expiry is enforced by the getters.
    // So to test the expiry error we verify the token then access a getter.
    const claim = await Claim.verify(expiredToken, identity.signingPublicKey)
    expect(() => claim.sub).toThrow(TokenError)
    expect(() => claim.sub).toThrow('Token expired')
  })

  it('throws TokenError for a malformed token with only 1 part', async () => {
    await expect(Claim.verify('onlyone', identity.signingPublicKey)).rejects.toThrow(TokenError)
    await expect(Claim.verify('onlyone', identity.signingPublicKey)).rejects.toThrow(
      'Malformed token',
    )
  })

  it('throws TokenError for a malformed token with only 2 parts', async () => {
    await expect(Claim.verify('head.body', identity.signingPublicKey)).rejects.toThrow(TokenError)
    await expect(Claim.verify('head.body', identity.signingPublicKey)).rejects.toThrow(
      'Malformed token',
    )
  })

  it('throws TokenError when signed by the wrong key', async () => {
    const token = await craftTokenWithPayload({
      sub: 'sub',
      room: 'room',
      role: ROLES.GUEST,
      iss: 'iss',
      jti: crypto.randomUUID(),
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 86400,
    })
    await expect(Claim.verify(token, identity.signingPublicKey)).rejects.toThrow(TokenError)
  })
})

// ---------------------------------------------------------------------------
// Claim.peek()
// ---------------------------------------------------------------------------
describe('Claim.peek()', () => {
  it('extracts the sub field without verifying the signature', async () => {
    const claim = await mintValid()
    const sub = await Claim.peek(claim.raw, 'sub')
    expect(sub).toBe('user-sub')
  })

  it('extracts the room field', async () => {
    const claim = await mintValid()
    const room = await Claim.peek(claim.raw, 'room')
    expect(room).toBe('room-abc')
  })

  it('extracts the role field', async () => {
    const claim = await mintValid()
    const role = await Claim.peek(claim.raw, 'role')
    expect(role).toBe(ROLES.OWNER)
  })

  it('extracts the iss field', async () => {
    const claim = await mintValid()
    const iss = await Claim.peek(claim.raw, 'iss')
    expect(iss).toBe('iss-server')
  })

  it('extracts jti, iat, exp fields', async () => {
    const claim = await mintValid()
    const jti = await Claim.peek(claim.raw, 'jti')
    const iat = await Claim.peek(claim.raw, 'iat')
    const exp = await Claim.peek(claim.raw, 'exp')
    expect(typeof jti).toBe('string')
    expect(typeof iat).toBe('number')
    expect(typeof exp).toBe('number')
    expect(exp).toBeGreaterThan(iat)
  })

  it('works on a token with a wrong signature (does not verify)', async () => {
    const claim = await mintValid()
    const parts = claim.raw.split('.')
    const tampered = `${parts[0]}.${parts[1]}.invalidsig`
    const sub = await Claim.peek(tampered, 'sub')
    expect(sub).toBe('user-sub')
  })

  it('throws TokenError for a 1-part malformed token', async () => {
    await expect(Claim.peek('onlyone', 'sub')).rejects.toThrow(TokenError)
    await expect(Claim.peek('onlyone', 'sub')).rejects.toThrow('Malformed token')
  })

  it('throws TokenError for a 2-part malformed token', async () => {
    await expect(Claim.peek('head.body', 'sub')).rejects.toThrow(TokenError)
  })
})

// ---------------------------------------------------------------------------
// Verified Claim getters
// ---------------------------------------------------------------------------
describe('Verified Claim getters', () => {
  let claim: Claim

  beforeAll(async () => {
    claim = await mintValid()
    // Round-trip through verify to get a "verified" claim
    claim = await Claim.verify(claim.raw, identity.signingPublicKey)
  })

  it('sub returns the correct value', async () => {
    expect(claim.sub).toBe('user-sub')
  })

  it('room returns the correct value', async () => {
    expect(claim.room).toBe('room-abc')
  })

  it('role returns the correct value', async () => {
    expect(claim.role).toBe(ROLES.OWNER)
  })

  it('issuer returns the correct value', async () => {
    expect(claim.issuer).toBe('iss-server')
  })

  it('jti returns a non-empty string', async () => {
    expect(typeof claim.jti).toBe('string')
    expect(claim.jti.length).toBeGreaterThan(0)
  })

  it('issuedAt returns a Unix timestamp', async () => {
    expect(claim.issuedAt).toBeGreaterThan(1_000_000_000)
  })

  it('expiry returns a Unix timestamp greater than issuedAt', async () => {
    expect(claim.expiry).toBeGreaterThan(claim.issuedAt)
  })

  it('raw is a three-part dot-separated string', async () => {
    expect(claim.raw.split('.')).toHaveLength(3)
  })

  it('signature is a non-empty base64url string', async () => {
    expect(typeof claim.signature).toBe('string')
    expect(claim.signature.length).toBeGreaterThan(0)
    expect(claim.signature).not.toMatch(/[+/=]/)
  })

  it('header has alg=RS256 and typ=JWT', async () => {
    expect(claim.header.alg).toBe('RS256')
    expect(claim.header.typ).toBe('JWT')
  })
})

// ---------------------------------------------------------------------------
// Getter expiry enforcement on expired claims
// ---------------------------------------------------------------------------
describe('Claim getters throw TokenError on expired token', () => {
  let expiredClaim: Claim

  beforeAll(async () => {
    const now = Math.floor(Date.now() / 1000)
    const payload = {
      sub: 'expired-sub',
      room: 'expired-room',
      role: ROLES.MODERATOR,
      iss: 'expired-iss',
      jti: crypto.randomUUID(),
      iat: now - 7200,
      exp: now - 1, // expired 1 second ago
    }
    const token = await craftTokenSignedByIdentity(payload)
    expiredClaim = await Claim.verify(token, identity.signingPublicKey)
  })

  it('sub throws TokenError', () => {
    expect(() => expiredClaim.sub).toThrow(TokenError)
  })

  it('room throws TokenError', () => {
    expect(() => expiredClaim.room).toThrow(TokenError)
  })

  it('role throws TokenError', () => {
    expect(() => expiredClaim.role).toThrow(TokenError)
  })

  it('issuer throws TokenError', () => {
    expect(() => expiredClaim.issuer).toThrow(TokenError)
  })

  it('jti throws TokenError', () => {
    expect(() => expiredClaim.jti).toThrow(TokenError)
  })

  it('issuedAt throws TokenError', () => {
    expect(() => expiredClaim.issuedAt).toThrow(TokenError)
  })

  it('expiry does NOT throw (does not check expiry itself)', () => {
    expect(() => expiredClaim.expiry).not.toThrow()
    expect(expiredClaim.expiry).toBeLessThan(Math.floor(Date.now() / 1000))
  })

  it('raw does NOT throw (not expiry-gated)', () => {
    expect(() => expiredClaim.raw).not.toThrow()
  })

  it('signature does NOT throw (not expiry-gated)', () => {
    expect(() => expiredClaim.signature).not.toThrow()
  })

  it('header does NOT throw (not expiry-gated)', () => {
    expect(() => expiredClaim.header).not.toThrow()
  })
})
