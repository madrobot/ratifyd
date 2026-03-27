import { describe, it, expect, beforeEach } from 'vitest'
import { Identity } from './Identity'
import { IdentityError } from './error/IdentityError'
import { ROLES } from '../constants'
import { bufferToBase64url, base64urlToBuffer } from './helper'

async function generateRoomKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
}

async function encryptWithRoomKey(
  plaintext: string,
  key: CryptoKey,
): Promise<{ iv: string; ciphertext: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const enc = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  )
  return {
    iv: bufferToBase64url(iv.buffer as ArrayBuffer),
    ciphertext: bufferToBase64url(enc),
  }
}

async function decryptWithRoomKey(
  blob: { iv: string; ciphertext: string },
  key: CryptoKey,
): Promise<string> {
  const dec = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64urlToBuffer(blob.iv) },
    key,
    base64urlToBuffer(blob.ciphertext),
  )
  return new TextDecoder().decode(dec)
}

/** Wrap a room key with RSA-OAEP (mirrors Room.#wrapRoomKey for test use) */
async function wrapRoomKey(roomKey: CryptoKey, recipientOaepPublicKey: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', roomKey)
  const wrapped = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, recipientOaepPublicKey, raw)
  return bufferToBase64url(wrapped)
}

beforeEach(() => {
  localStorage.clear()
})

describe('Identity.create without OAEP key', () => {
  it('unwrapRoomKey throws IdentityError when OAEP key pair is missing', async () => {
    const identity = await Identity.create('test-user')
    const roomKey = await generateRoomKey()
    // Need a second identity with OAEP to wrap something to try unwrapping
    const identityWithOaep = await Identity.create('owner', true)
    const wrapped = await wrapRoomKey(roomKey, identityWithOaep.oaepPublicKey!)
    await expect(identity.unwrapRoomKey(wrapped)).rejects.toThrow(IdentityError)
  })

  it('unwrapRoomKey throws with message about OAEP key pair', async () => {
    const identity = await Identity.create('test-user')
    await expect(identity.unwrapRoomKey('some-fake-wrapped-key')).rejects.toThrow(
      'Cannot unwrap room key: OAEP key pair not present',
    )
  })
})

describe('Identity.create with OAEP key', () => {
  it('unwrapRoomKey succeeds when OAEP key pair is present', async () => {
    const identity = await Identity.create('owner', true)
    const roomKey = await generateRoomKey()
    const wrapped = await wrapRoomKey(roomKey, identity.oaepPublicKey!)
    const unwrapped = await identity.unwrapRoomKey(wrapped)
    expect(unwrapped.algorithm.name).toBe('AES-GCM')
  })

  it('oaepPublicKey is non-null', async () => {
    const identity = await Identity.create('owner', true)
    expect(identity.oaepPublicKey).not.toBeNull()
  })
})

describe('wrapRoomKey / unwrapRoomKey round-trip', () => {
  it('wraps and unwraps a room key correctly', async () => {
    const identity = await Identity.create('owner', true)
    const roomKey = await generateRoomKey()
    const wrapped = await wrapRoomKey(roomKey, identity.oaepPublicKey!)
    const unwrapped = await identity.unwrapRoomKey(wrapped)

    // Both original and unwrapped key should encrypt/decrypt the same plaintext
    const plaintext = 'hello room key round-trip'
    const blob = await encryptWithRoomKey(plaintext, roomKey)
    const decrypted = await decryptWithRoomKey(blob, unwrapped)
    expect(decrypted).toBe(plaintext)
  })

  it('original and unwrapped key encrypt to interoperable ciphertexts', async () => {
    const identity = await Identity.create('owner', true)
    const roomKey = await generateRoomKey()
    const wrapped = await wrapRoomKey(roomKey, identity.oaepPublicKey!)
    const unwrapped = await identity.unwrapRoomKey(wrapped)

    // Encrypt with original, decrypt with unwrapped
    const plaintext = 'cross-key decrypt test'
    const blob = await encryptWithRoomKey(plaintext, roomKey)
    const decrypted = await decryptWithRoomKey(blob, unwrapped)
    expect(decrypted).toBe(plaintext)

    // Encrypt with unwrapped, decrypt with original
    const blob2 = await encryptWithRoomKey(plaintext, unwrapped)
    const decrypted2 = await decryptWithRoomKey(blob2, roomKey)
    expect(decrypted2).toBe(plaintext)
  })

  it('wrapped key is a non-empty base64url string', async () => {
    const identity = await Identity.create('owner', true)
    const roomKey = await generateRoomKey()
    const wrapped = await wrapRoomKey(roomKey, identity.oaepPublicKey!)
    expect(typeof wrapped).toBe('string')
    expect(wrapped.length).toBeGreaterThan(0)
    expect(wrapped).not.toMatch(/[+/=]/)
  })

  it('wrapping for a different recipient and unwrapping with own key fails', async () => {
    const owner = await Identity.create('owner', true)
    const moderator = await Identity.create('moderator', true)
    const roomKey = await generateRoomKey()
    // Wrap for owner's OAEP key, but try to unwrap with moderator's private key
    const wrapped = await wrapRoomKey(roomKey, owner.oaepPublicKey!)
    await expect(moderator.unwrapRoomKey(wrapped)).rejects.toThrow()
  })
})

describe('mintClaim', () => {
  it('returns a Claim with the correct role', async () => {
    const identity = await Identity.create('owner')
    const claim = await identity.mintClaim(identity.id, 'room-xyz', ROLES.OWNER, 'owner-server')
    expect(claim.role).toBe(ROLES.OWNER)
  })

  it('returns a Claim with the correct issuer', async () => {
    const identity = await Identity.create('moderator')
    const claim = await identity.mintClaim(identity.id, 'room-xyz', ROLES.MODERATOR, 'issuer-id')
    expect(claim.issuer).toBe('issuer-id')
  })

  it('returns a Claim with the correct room', async () => {
    const identity = await Identity.create('guest')
    const claim = await identity.mintClaim(identity.id, 'room-42', ROLES.GUEST, 'issuer')
    expect(claim.room).toBe('room-42')
  })

  it('returns a Claim with the correct sub', async () => {
    const identity = await Identity.create('owner')
    const claim = await identity.mintClaim(identity.id, 'room-xyz', ROLES.OWNER, 'issuer')
    expect(claim.sub).toBe(identity.id)
  })

  it('returns a Claim that is not expired', async () => {
    const identity = await Identity.create('owner')
    const claim = await identity.mintClaim(identity.id, 'room-xyz', ROLES.OWNER, 'issuer')
    const now = Math.floor(Date.now() / 1000)
    expect(claim.expiry).toBeGreaterThan(now)
  })

  it('mintClaim resolves for a freshly created identity that always has a signing key pair', async () => {
    // Identity.create always generates a signing key pair, so mintClaim always succeeds here.
    // The IdentityError guard for a missing signing key pair cannot be reached via the public API.
    const identity = await Identity.create('owner')
    await expect(
      identity.mintClaim(identity.id, 'room-xyz', ROLES.OWNER, 'issuer'),
    ).resolves.toBeDefined()
  })

  it('minted claim raw JWT is a three-part dot-separated string', async () => {
    const identity = await Identity.create('owner')
    const claim = await identity.mintClaim(identity.id, 'room-xyz', ROLES.OWNER, 'issuer')
    const parts = claim.raw.split('.')
    expect(parts).toHaveLength(3)
  })

  it('minted claim can be verified with the identity signing public key', async () => {
    const identity = await Identity.create('owner')
    const claim = await identity.mintClaim(identity.id, 'room-xyz', ROLES.OWNER, 'issuer')
    const { Claim } = await import('./Claim')
    const verified = await Claim.verify(claim.raw, identity.signingPublicKey)
    expect(verified.role).toBe(ROLES.OWNER)
    expect(verified.issuer).toBe('issuer')
  })
})
