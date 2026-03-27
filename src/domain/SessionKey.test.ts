import { describe, it, expect, beforeEach } from 'vitest'
import { SessionKey } from './SessionKey'
import { SessionKeyError } from './error/SessionKeyError'

const OAEP_ALGO: RsaHashedKeyGenParams = {
  name: 'RSA-OAEP',
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: 'SHA-256',
}

async function generateOaepPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(OAEP_ALGO, true, ['encrypt', 'decrypt'])
}

beforeEach(() => {
  localStorage.clear()
})

describe('SessionKey.generate()', () => {
  it('produces a key that round-trips encrypt→decrypt', async () => {
    const key = await SessionKey.generate()
    const plaintext = 'hello session key'
    const blob = await key.encrypt(plaintext)
    const result = await key.decrypt(blob)
    expect(result).toBe(plaintext)
  })
})

describe('SessionKey.save() / SessionKey.load()', () => {
  it('persists to and restores from localStorage', async () => {
    const key = await SessionKey.generate()
    await key.save('room-test-123')
    const loaded = await SessionKey.load('room-test-123')
    expect(loaded).not.toBeNull()

    const plaintext = 'persisted key test'
    const blob = await key.encrypt(plaintext)
    const result = await loaded!.decrypt(blob)
    expect(result).toBe(plaintext)
  })

  it('returns null when no key is stored for the given roomId', async () => {
    const result = await SessionKey.load('nonexistent-room')
    expect(result).toBeNull()
  })

  it('isolates room keys by roomId', async () => {
    const key1 = await SessionKey.generate()
    const key2 = await SessionKey.generate()
    await key1.save('room-1')
    await key2.save('room-2')

    const loaded1 = await SessionKey.load('room-1')
    const loaded2 = await SessionKey.load('room-2')

    const plaintext = 'isolation test'
    const blob1 = await key1.encrypt(plaintext)

    // key1 and loaded1 should interoperate
    const dec1 = await loaded1!.decrypt(blob1)
    expect(dec1).toBe(plaintext)

    // loaded2 should NOT be able to decrypt blob encrypted with key1
    await expect(loaded2!.decrypt(blob1)).rejects.toThrow()
  })
})

describe('SessionKey.fromWrapped()', () => {
  it('unwraps a key that was wrapped with wrapFor()', async () => {
    const { publicKey, privateKey } = await generateOaepPair()
    const key = await SessionKey.generate()
    const wrapped = await key.wrapFor(publicKey)
    const recovered = await SessionKey.fromWrapped(wrapped, privateKey)

    const plaintext = 'fromWrapped round-trip'
    const blob = await key.encrypt(plaintext)
    const result = await recovered.decrypt(blob)
    expect(result).toBe(plaintext)
  })

  it('throws if wrapped blob is decrypted with wrong private key', async () => {
    const { publicKey } = await generateOaepPair()
    const { privateKey: wrongPrivateKey } = await generateOaepPair()
    const key = await SessionKey.generate()
    const wrapped = await key.wrapFor(publicKey)
    await expect(SessionKey.fromWrapped(wrapped, wrongPrivateKey)).rejects.toThrow()
  })

  it('throws SessionKeyError when given a non-OAEP private key', async () => {
    const signKeyPair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    )
    const key = await SessionKey.generate()
    const { publicKey } = await generateOaepPair()
    const wrapped = await key.wrapFor(publicKey)
    await expect(SessionKey.fromWrapped(wrapped, signKeyPair.privateKey)).rejects.toThrow(
      SessionKeyError,
    )
  })
})

describe('SessionKey.encrypt()', () => {
  it('produces different ciphertexts on each call due to random IV', async () => {
    const key = await SessionKey.generate()
    const plaintext = 'same plaintext'
    const blob1 = await key.encrypt(plaintext)
    const blob2 = await key.encrypt(plaintext)
    // IVs should differ
    expect(blob1.iv).not.toBe(blob2.iv)
    // Ciphertexts should differ
    expect(blob1.ciphertext).not.toBe(blob2.ciphertext)
  })
})

describe('SessionKey.decrypt()', () => {
  it('throws when decrypting with a different key', async () => {
    const key1 = await SessionKey.generate()
    const key2 = await SessionKey.generate()
    const blob = await key1.encrypt('secret')
    await expect(key2.decrypt(blob)).rejects.toThrow()
  })
})

describe('SessionKey.wrapFor()', () => {
  it('rejects a non-OAEP key argument', async () => {
    const key = await SessionKey.generate()
    const signKey = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    )
    await expect(key.wrapFor(signKey.publicKey)).rejects.toThrow()
  })
})
