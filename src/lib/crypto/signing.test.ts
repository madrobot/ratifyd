import { describe, it, expect } from 'vitest'
import {
  generateSigningKeyPair,
  exportSigningKey,
  importSigningPublicKey,
  importSigningPrivateKey,
  signBytes,
  verifySignature,
  generateNonce,
  bufferToBase64url,
  base64urlToBuffer,
} from './signing'

describe('bufferToBase64url / base64urlToBuffer', () => {
  it('round-trips an empty buffer', () => {
    const buf = new ArrayBuffer(0)
    const b64 = bufferToBase64url(buf)
    const out = base64urlToBuffer(b64)
    expect(out.byteLength).toBe(0)
  })

  it('round-trips arbitrary bytes', () => {
    const original = new Uint8Array([0, 1, 127, 128, 255])
    const b64 = bufferToBase64url(original.buffer)
    const out = new Uint8Array(base64urlToBuffer(b64))
    expect(out).toEqual(original)
  })

  it('produces URL-safe characters (no +, /, or =)', () => {
    const buf = new Uint8Array(256)
    for (let i = 0; i < 256; i++) buf[i] = i
    const b64 = bufferToBase64url(buf.buffer)
    expect(b64).not.toMatch(/[+/=]/)
  })

  it('round-trips large buffers', () => {
    const original = new Uint8Array(4096)
    crypto.getRandomValues(original)
    const b64 = bufferToBase64url(original.buffer)
    const out = new Uint8Array(base64urlToBuffer(b64))
    expect(out).toEqual(original)
  })
})

describe('generateSigningKeyPair', () => {
  it('generates a keypair with correct algorithm', async () => {
    const pair = await generateSigningKeyPair()
    expect(pair.publicKey.algorithm.name).toBe('RSASSA-PKCS1-v1_5')
    expect(pair.privateKey.algorithm.name).toBe('RSASSA-PKCS1-v1_5')
  })

  it('generates extractable keys', async () => {
    const pair = await generateSigningKeyPair()
    expect(pair.publicKey.extractable).toBe(true)
    expect(pair.privateKey.extractable).toBe(true)
  })

  it('generates keys with correct usages', async () => {
    const pair = await generateSigningKeyPair()
    expect(pair.publicKey.usages).toContain('verify')
    expect(pair.privateKey.usages).toContain('sign')
  })

  it('generates unique keypairs each time', async () => {
    const pair1 = await generateSigningKeyPair()
    const pair2 = await generateSigningKeyPair()
    const pub1 = await exportSigningKey(pair1.publicKey, 'public')
    const pub2 = await exportSigningKey(pair2.publicKey, 'public')
    expect(pub1).not.toBe(pub2)
  })
})

describe('exportSigningKey / importSigningPublicKey / importSigningPrivateKey', () => {
  it('round-trips a public key', async () => {
    const pair = await generateSigningKeyPair()
    const exported = await exportSigningKey(pair.publicKey, 'public')
    const imported = await importSigningPublicKey(exported)
    const reExported = await exportSigningKey(imported, 'public')
    expect(reExported).toBe(exported)
  })

  it('round-trips a private key', async () => {
    const pair = await generateSigningKeyPair()
    const exported = await exportSigningKey(pair.privateKey, 'private')
    const imported = await importSigningPrivateKey(exported)
    const reExported = await exportSigningKey(imported, 'private')
    expect(reExported).toBe(exported)
  })

  it('exported keys are base64url strings', async () => {
    const pair = await generateSigningKeyPair()
    const pubB64 = await exportSigningKey(pair.publicKey, 'public')
    const privB64 = await exportSigningKey(pair.privateKey, 'private')
    expect(pubB64).not.toMatch(/[+/=]/)
    expect(privB64).not.toMatch(/[+/=]/)
  })

  it('imported public key retains verify usage', async () => {
    const pair = await generateSigningKeyPair()
    const exported = await exportSigningKey(pair.publicKey, 'public')
    const imported = await importSigningPublicKey(exported)
    expect(imported.usages).toContain('verify')
  })

  it('imported private key retains sign usage', async () => {
    const pair = await generateSigningKeyPair()
    const exported = await exportSigningKey(pair.privateKey, 'private')
    const imported = await importSigningPrivateKey(exported)
    expect(imported.usages).toContain('sign')
  })
})

describe('signBytes / verifySignature', () => {
  it('signs and verifies a string', async () => {
    const pair = await generateSigningKeyPair()
    const sig = await signBytes(pair.privateKey, 'hello world')
    const valid = await verifySignature(pair.publicKey, sig, 'hello world')
    expect(valid).toBe(true)
  })

  it('signs and verifies an ArrayBuffer', async () => {
    const pair = await generateSigningKeyPair()
    const data = new TextEncoder().encode('binary data').buffer
    const sig = await signBytes(pair.privateKey, data)
    const valid = await verifySignature(pair.publicKey, sig, data)
    expect(valid).toBe(true)
  })

  it('fails verification with wrong data', async () => {
    const pair = await generateSigningKeyPair()
    const sig = await signBytes(pair.privateKey, 'correct data')
    const valid = await verifySignature(pair.publicKey, sig, 'wrong data')
    expect(valid).toBe(false)
  })

  it('fails verification with wrong public key', async () => {
    const pair1 = await generateSigningKeyPair()
    const pair2 = await generateSigningKeyPair()
    const sig = await signBytes(pair1.privateKey, 'some data')
    const valid = await verifySignature(pair2.publicKey, sig, 'some data')
    expect(valid).toBe(false)
  })

  it('signs empty string', async () => {
    const pair = await generateSigningKeyPair()
    const sig = await signBytes(pair.privateKey, '')
    const valid = await verifySignature(pair.publicKey, sig, '')
    expect(valid).toBe(true)
  })

  it('signature is an ArrayBuffer', async () => {
    const pair = await generateSigningKeyPair()
    const sig = await signBytes(pair.privateKey, 'data')
    expect(sig).toBeInstanceOf(ArrayBuffer)
    expect(sig.byteLength).toBeGreaterThan(0)
  })

  it('works with re-imported keys', async () => {
    const pair = await generateSigningKeyPair()
    const privB64 = await exportSigningKey(pair.privateKey, 'private')
    const pubB64 = await exportSigningKey(pair.publicKey, 'public')
    const importedPriv = await importSigningPrivateKey(privB64)
    const importedPub = await importSigningPublicKey(pubB64)
    const sig = await signBytes(importedPriv, 'round-trip test')
    const valid = await verifySignature(importedPub, sig, 'round-trip test')
    expect(valid).toBe(true)
  })
})

describe('generateNonce', () => {
  it('returns a 64-character hex string', () => {
    const nonce = generateNonce()
    expect(nonce).toMatch(/^[0-9a-f]{64}$/)
  })

  it('generates unique nonces', () => {
    const nonces = new Set(Array.from({ length: 100 }, () => generateNonce()))
    expect(nonces.size).toBe(100)
  })
})
