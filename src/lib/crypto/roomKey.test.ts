import { describe, it, expect } from 'vitest'
import {
  generateRoomKey,
  exportRoomKey,
  importRoomKey,
  encryptWithRoomKey,
  decryptWithRoomKey,
  type EncryptedBlob,
} from './roomKey'

describe('generateRoomKey', () => {
  it('generates an AES-GCM key', async () => {
    const key = await generateRoomKey()
    expect(key.algorithm.name).toBe('AES-GCM')
  })

  it('generates a 256-bit key', async () => {
    const key = await generateRoomKey()
    expect((key.algorithm as AesKeyGenParams).length).toBe(256)
  })

  it('generates extractable keys', async () => {
    const key = await generateRoomKey()
    expect(key.extractable).toBe(true)
  })

  it('generates keys with encrypt and decrypt usages', async () => {
    const key = await generateRoomKey()
    expect(key.usages).toContain('encrypt')
    expect(key.usages).toContain('decrypt')
  })

  it('generates unique keys each time', async () => {
    const key1 = await generateRoomKey()
    const key2 = await generateRoomKey()
    expect(await exportRoomKey(key1)).not.toBe(await exportRoomKey(key2))
  })
})

describe('exportRoomKey / importRoomKey', () => {
  it('round-trips a room key', async () => {
    const key = await generateRoomKey()
    const exported = await exportRoomKey(key)
    const imported = await importRoomKey(exported)
    const reExported = await exportRoomKey(imported)
    expect(reExported).toBe(exported)
  })

  it('exported key is a base64url string', async () => {
    const key = await generateRoomKey()
    const exported = await exportRoomKey(key)
    expect(typeof exported).toBe('string')
    expect(exported).not.toMatch(/[+/=]/)
  })

  it('imported key retains correct algorithm', async () => {
    const key = await generateRoomKey()
    const exported = await exportRoomKey(key)
    const imported = await importRoomKey(exported)
    expect(imported.algorithm.name).toBe('AES-GCM')
  })

  it('imported key retains correct usages', async () => {
    const key = await generateRoomKey()
    const exported = await exportRoomKey(key)
    const imported = await importRoomKey(exported)
    expect(imported.usages).toContain('encrypt')
    expect(imported.usages).toContain('decrypt')
  })
})

describe('encryptWithRoomKey / decryptWithRoomKey', () => {
  it('round-trips a simple string', async () => {
    const key = await generateRoomKey()
    const blob = await encryptWithRoomKey('hello world', key)
    const decrypted = await decryptWithRoomKey(blob, key)
    expect(decrypted).toBe('hello world')
  })

  it('round-trips an empty string', async () => {
    const key = await generateRoomKey()
    const blob = await encryptWithRoomKey('', key)
    const decrypted = await decryptWithRoomKey(blob, key)
    expect(decrypted).toBe('')
  })

  it('round-trips unicode text', async () => {
    const key = await generateRoomKey()
    const text = 'Hello 🌍🎉 日本語テスト émojis café'
    const blob = await encryptWithRoomKey(text, key)
    const decrypted = await decryptWithRoomKey(blob, key)
    expect(decrypted).toBe(text)
  })

  it('round-trips a long string', async () => {
    const key = await generateRoomKey()
    const text = 'a'.repeat(100_000)
    const blob = await encryptWithRoomKey(text, key)
    const decrypted = await decryptWithRoomKey(blob, key)
    expect(decrypted).toBe(text)
  })

  it('returns an EncryptedBlob with iv and ciphertext', async () => {
    const key = await generateRoomKey()
    const blob = await encryptWithRoomKey('test', key)
    expect(typeof blob.iv).toBe('string')
    expect(typeof blob.ciphertext).toBe('string')
    expect(blob.iv).not.toMatch(/[+/=]/)
    expect(blob.ciphertext).not.toMatch(/[+/=]/)
  })

  it('uses a unique IV for each encryption', async () => {
    const key = await generateRoomKey()
    const blob1 = await encryptWithRoomKey('same text', key)
    const blob2 = await encryptWithRoomKey('same text', key)
    expect(blob1.iv).not.toBe(blob2.iv)
  })

  it('produces different ciphertext for same plaintext (due to random IV)', async () => {
    const key = await generateRoomKey()
    const blob1 = await encryptWithRoomKey('same text', key)
    const blob2 = await encryptWithRoomKey('same text', key)
    expect(blob1.ciphertext).not.toBe(blob2.ciphertext)
  })

  it('fails to decrypt with a different key', async () => {
    const key1 = await generateRoomKey()
    const key2 = await generateRoomKey()
    const blob = await encryptWithRoomKey('secret', key1)
    await expect(decryptWithRoomKey(blob, key2)).rejects.toThrow()
  })

  it('fails to decrypt with tampered ciphertext', async () => {
    const key = await generateRoomKey()
    const blob = await encryptWithRoomKey('secret', key)
    // Flip multiple bytes in the ciphertext to reliably break GCM authentication
    const tampered: EncryptedBlob = {
      iv: blob.iv,
      ciphertext: blob.ciphertext
        .split('')
        .map((c, i) => (i < 10 ? (c === 'A' ? 'B' : 'A') : c))
        .join(''),
    }
    await expect(decryptWithRoomKey(tampered, key)).rejects.toThrow()
  })

  it('fails to decrypt with tampered IV', async () => {
    const key = await generateRoomKey()
    const blob = await encryptWithRoomKey('secret', key)
    const tampered: EncryptedBlob = {
      iv: blob.iv.slice(0, -1) + (blob.iv.endsWith('A') ? 'B' : 'A'),
      ciphertext: blob.ciphertext,
    }
    await expect(decryptWithRoomKey(tampered, key)).rejects.toThrow()
  })
})
